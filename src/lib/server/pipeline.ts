// Document pipeline: ingest → classify → extract (rules + Gemma) → ground → merge → assign buyer.
// A single in-process queue processes one document at a time so a local model is never
// overloaded. Server only.

import { promises as fs } from 'node:fs';
import type { DocKind, DocRecord, EngineSettings, Field, Workspace } from '../types';
import { ingest, IngestError, textToLines } from '../extraction/ingest';
import { classifyByRules, extractByRules } from '../extraction/rules';
import { engineStatus, gemmaClassify, gemmaExtract, gemmaTranscribe, PROMPT_VERSION, type EngineStatus, type LlmExtraction } from '../extraction/gemma';
import { mergeExtraction } from '../extraction/ground';
import { assignBuyer, pruneBuyers } from './buyers';
import { mutate, readWorkspace, uploadPath, readCache, writeCache, logEvent } from './store';
import { currentUid, withTenant } from './tenant';

type G = typeof globalThis & {
  __cbQueue?: string[];
  __cbRunning?: boolean;
  __cbStatus?: { at: number; key: string; st: EngineStatus };
};
const g = globalThis as G;

// ---------------------------------------------------------------------------------------
// Engine status (cached for 15 s)

function cfgKey(c: EngineSettings) {
  return `${c.provider}|${c.baseUrl}|${c.model}`;
}

export async function getEngineStatus(cfg: EngineSettings, force = false): Promise<EngineStatus> {
  const key = cfgKey(cfg);
  if (!force && g.__cbStatus && g.__cbStatus.key === key && Date.now() - g.__cbStatus.at < 15_000) return g.__cbStatus.st;
  const st = await engineStatus(cfg);
  g.__cbStatus = { at: Date.now(), key, st };
  return st;
}

async function gemmaUsable(cfg: EngineSettings, mode: string): Promise<{ use: boolean; reason?: string }> {
  if (mode === 'rules') return { use: false, reason: 'Rules-only mode is selected in Settings.' };
  const st = await getEngineStatus(cfg);
  if (st.online && st.modelAvailable) return { use: true };
  return { use: false, reason: st.online ? st.hint ?? 'Gemma model not available.' : `Extraction engine offline: ${st.error ?? ''}` };
}

// ---------------------------------------------------------------------------------------

export interface ProcessOptions {
  forceEngine?: 'gemma' | 'rules';
}

export async function processDocument(id: string, opts: ProcessOptions = {}): Promise<void> {
  const ws0 = await readWorkspace();
  const doc0 = ws0.documents[id];
  if (!doc0) return;
  await mutate((ws) => {
    const d = ws.documents[id];
    if (d) {
      d.status = 'processing';
      d.error = undefined;
    }
  });

  const cfg = ws0.settings.engine;
  const mode = opts.forceEngine ?? cfg.mode;
  const warnings: string[] = [];
  const t0 = Date.now();

  try {
    const buf = await fs.readFile(uploadPath(doc0.storedAs));
    const ing = await ingest(buf, doc0.filename);
    let lines = ing.lines;
    const gate = await gemmaUsable(cfg, mode);
    if (mode === 'gemma' && !gate.use) throw new IngestError(gate.reason ?? 'Gemma is required but not available.');
    if (!gate.use && gate.reason && mode !== 'rules') warnings.push(`Read by deterministic rules only. ${gate.reason}`);

    let ocr = false;
    if (ing.needsOcr) {
      if (!ing.images?.length) {
        throw new IngestError('This PDF has no text layer and no page images ClawBack can read. Upload photos of the pages (PNG/JPG), or the original digital PDF.');
      }
      if (!gate.use) throw new IngestError('Photos and scans need the Gemma extraction engine. Start Ollama with a Gemma model (see Settings), then press “Re-read”.');
      const all: typeof lines = [];
      for (const img of ing.images) {
        const cacheKey = `ocr_${doc0.sha256}_p${img.page}_${cfg.model.replace(/[^a-z0-9]/gi, '_')}_${PROMPT_VERSION}`;
        let text = (await readCache<{ text: string }>(cacheKey))?.text;
        if (!text) {
          text = await gemmaTranscribe(cfg, img);
          await writeCache(cacheKey, { text });
        }
        all.push(...textToLines(text, img.page).filter((l, i, a) => l.text.trim() || (i > 0 && a[i - 1].text.trim())));
      }
      lines = all;
      ocr = true;
      if (!lines.some((l) => l.text.trim())) throw new IngestError('Gemma could not read any text in this image.');
      if (ing.format === 'pdf' && (ing.pages ?? 0) > ing.images.length) warnings.push(`Transcribed ${ing.images.length} of ${ing.pages} scanned pages.`);
    }

    const exporterName = ws0.company.name;
    const ctx = { exporterName, exporterDomains: ws0.company.emailDomains };

    // Classification: rules first; ask Gemma only when the rules are unsure.
    const rc = classifyByRules(lines, ing.format === 'eml');
    let kind: DocKind = rc.kind;
    let kindConfidence: DocRecord['kindConfidence'] = rc.confident ? 'high' : 'medium';
    let kindMethod: DocRecord['kindMethod'] = 'rules';
    const keepKind = doc0.kindMethod === 'manual';
    if (keepKind) {
      kind = doc0.kind;
      kindConfidence = 'manual';
      kindMethod = 'manual';
    } else if (gate.use && !rc.confident) {
      try {
        const gk = await gemmaClassify(cfg, lines);
        kindMethod = gk === rc.kind ? 'gemma+rules' : 'gemma';
        kindConfidence = gk === rc.kind ? 'high' : 'medium';
        kind = gk;
      } catch (e) {
        warnings.push(`Gemma classification failed: ${(e as Error).message}`);
      }
    }

    // Extraction
    const rules = extractByRules(kind, lines, ctx, ing.meta);
    let llm: LlmExtraction | null = null;
    let used: DocRecord['engine']['used'] = 'rules';
    let cached = false;
    if (gate.use && kind !== 'other') {
      const cacheKey = `x_${doc0.sha256}_${kind}_${cfg.model.replace(/[^a-z0-9]/gi, '_')}_${PROMPT_VERSION}`;
      const hit = await readCache<LlmExtraction>(cacheKey);
      if (hit) {
        llm = hit;
        cached = true;
        used = 'gemma';
      } else {
        try {
          const r = await gemmaExtract(cfg, kind, lines, exporterName);
          llm = r.result;
          used = 'gemma';
          if (r.truncated) warnings.push('Long document: Gemma read the first 400 lines; the rules engine read all of it.');
          await writeCache(cacheKey, llm);
        } catch (e) {
          warnings.push(`Gemma could not read this document (${(e as Error).message}). Fell back to the deterministic rules.`);
        }
      }
    }
    if (ing.meta.truncated) warnings.push('Document truncated to the first 3,000 lines.');

    const merged = mergeExtraction(kind, id, lines, rules, llm);
    if (kind === 'other') warnings.push('Not recognised as an invoice, price revision, bank realisation or refund confirmation. Set the type if this is wrong.');
    else if (merged.total === 0) warnings.push('No fields could be read. Check the document type or enter the values by hand.');

    await mutate((ws) => {
      const d = ws.documents[id];
      if (!d) return;
      // Keep human corrections across re-reads.
      const manual: Record<string, Field> = {};
      for (const [k, f] of Object.entries(d.fields)) if (f.method === 'manual' && d.kind === kind) manual[k] = f;
      d.lines = lines;
      d.kind = kind;
      d.kindConfidence = kindConfidence;
      d.kindMethod = kindMethod;
      d.fields = { ...merged.fields, ...manual };
      let maxItem = merged.itemCount;
      for (const k of Object.keys(manual)) {
        const m = /^items\.(\d+)\./.exec(k);
        if (m) maxItem = Math.max(maxItem, Number(m[1]) + 1);
      }
      d.itemCount = maxItem;
      d.meta = { ...d.meta, ...ing.meta, pages: ing.pages, ocr, format: ing.format };
      d.engine = {
        used,
        model: used === 'gemma' ? cfg.model : undefined,
        ms: Date.now() - t0,
        warnings,
        promptVersion: used === 'gemma' ? PROMPT_VERSION : undefined,
        cached,
        grounded: merged.grounded,
        total: merged.total,
      };
      d.status = 'ready';
      d.error = undefined;
      d.buyerId = assignBuyer(ws, d);
      if (!d.buyerId) d.buyerMethod = undefined;
      pruneBuyers(ws);
      logEvent(ws, 'extracted', `${d.filename}: ${merged.total} fields read (${used === 'gemma' ? `Gemma ${cfg.model}${cached ? ', cached' : ''} + rules` : 'rules'})`, { docId: id, buyerId: d.buyerId ?? undefined });
    });
  } catch (e) {
    const msg = e instanceof IngestError ? e.message : `Unexpected error: ${(e as Error)?.message ?? String(e)}`;
    await mutate((ws) => {
      const d = ws.documents[id];
      if (!d) return;
      d.status = 'failed';
      d.error = msg;
      d.engine = { used: 'none', warnings, ms: Date.now() - t0 };
      logEvent(ws, 'failed', `${d.filename}: ${msg}`, { docId: id });
    });
  }
}

// ---------------------------------------------------------------------------------------
// Queue (one shared worker; each job remembers which account it belongs to)

interface Job {
  uid: string | null;
  id: string;
  force?: 'gemma' | 'rules';
}

type GQ = typeof globalThis & { __cbJobs?: Job[]; __cbCurrentJob?: Job | null; __cbBootedTenants?: Set<string> };
const gq = globalThis as GQ;

export function enqueue(ids: string[], opts: ProcessOptions = {}): void {
  const uid = currentUid();
  gq.__cbJobs ??= [];
  for (const id of ids) {
    const dup = gq.__cbJobs.some((j) => j.id === id && j.uid === uid) || (gq.__cbCurrentJob?.id === id && gq.__cbCurrentJob?.uid === uid);
    if (!dup) gq.__cbJobs.push({ uid, id, force: opts.forceEngine });
  }
  void runQueue();
}

async function runQueue(): Promise<void> {
  if (g.__cbRunning) return;
  g.__cbRunning = true;
  try {
    while (gq.__cbJobs && gq.__cbJobs.length) {
      const job = gq.__cbJobs.shift()!;
      gq.__cbCurrentJob = job;
      try {
        const work = () => processDocument(job.id, { forceEngine: job.force });
        await (job.uid ? withTenant(job.uid, work) : work());
      } catch (e) {
        console.error('[clawback] processing failed', job.id, e);
      }
      gq.__cbCurrentJob = null;
    }
  } finally {
    g.__cbRunning = false;
  }
}

/** Queue state for the current account only. */
export function queueState(): { pending: number; current: string | null } {
  const uid = currentUid();
  const pending = (gq.__cbJobs ?? []).filter((j) => j.uid === uid).length;
  const cur = gq.__cbCurrentJob && gq.__cbCurrentJob.uid === uid ? gq.__cbCurrentJob.id : null;
  return { pending, current: cur };
}

/** After a restart, pick up this account's documents that were waiting or mid-way. */
export async function bootQueue(): Promise<void> {
  const key = currentUid() ?? '_root';
  gq.__cbBootedTenants ??= new Set();
  if (gq.__cbBootedTenants.has(key)) return;
  gq.__cbBootedTenants.add(key);
  const ws = await readWorkspace();
  const stuck = Object.values(ws.documents)
    .filter((d) => d.status === 'queued' || d.status === 'processing')
    .sort((a, b) => a.uploadedAt.localeCompare(b.uploadedAt))
    .map((d) => d.id);
  if (stuck.length) enqueue(stuck);
}

export type { Workspace };
