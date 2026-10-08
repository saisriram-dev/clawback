import { promises as fs } from 'node:fs';
import { z } from 'zod';
import { route, json, body, HttpError } from '@/lib/server/api';
import { mutate, readWorkspace, uploadPath, logEvent } from '@/lib/server/store';
import { pruneBuyers, newBuyer } from '@/lib/server/buyers';
import { normalizeValue } from '@/lib/engine/normalize';
import { DOC_FIELDS, type DocKind, type FieldType } from '@/lib/types';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

export const GET = route<Ctx>(async (_req, { params }) => {
  const { id } = await params;
  const ws = await readWorkspace();
  const d = ws.documents[id];
  if (!d) throw new HttpError(404, 'Document not found.');
  return json(d);
});

const Patch = z.object({
  kind: z.enum(['invoice', 'price_revision', 'bank_realization', 'refund_notice', 'other']).optional(),
  buyerId: z.string().nullable().optional(),
  newBuyerName: z.string().min(2).max(120).optional(),
  fields: z.record(z.string(), z.string().max(2000).nullable()).optional(),
  revert: z.array(z.string()).optional(),
  addItem: z.boolean().optional(),
  removeItem: z.number().int().min(0).optional(),
});

function typeFor(kind: DocKind, key: string): FieldType | null {
  if (kind === 'other') return null;
  const spec = DOC_FIELDS[kind];
  const m = /^items\.(\d+)\.(.+)$/.exec(key);
  const f = m ? spec.items.find((x) => x.key === m[2]) : spec.fields.find((x) => x.key === key);
  return f ? f.type : null;
}

export const PATCH = route<Ctx>(async (req, { params }) => {
  const { id } = await params;
  const p = Patch.parse(await body(req));
  const doc = await mutate((ws) => {
    const d = ws.documents[id];
    if (!d) throw new HttpError(404, 'Document not found.');

    if (p.kind && p.kind !== d.kind) {
      d.kind = p.kind;
      d.kindMethod = 'manual';
      d.kindConfidence = 'manual';
      d.fields = {};
      d.itemCount = 0;
      logEvent(ws, 'kind', `${d.filename} marked as ${p.kind}`, { docId: id });
    }
    if (p.newBuyerName) {
      const b = newBuyer(p.newBuyerName.trim());
      ws.buyers[b.id] = b;
      d.buyerId = b.id;
      d.buyerMethod = 'manual';
    } else if (p.buyerId !== undefined) {
      if (p.buyerId && !ws.buyers[p.buyerId]) throw new HttpError(400, 'Unknown buyer.');
      d.buyerId = p.buyerId;
      d.buyerMethod = 'manual';
    }
    if (p.addItem) {
      d.itemCount += 1;
    }
    if (p.removeItem !== undefined && p.removeItem < d.itemCount) {
      const idx = p.removeItem;
      const next: typeof d.fields = {};
      for (const [k, f] of Object.entries(d.fields)) {
        const m = /^items\.(\d+)\.(.+)$/.exec(k);
        if (!m) next[k] = f;
        else if (Number(m[1]) < idx) next[k] = f;
        else if (Number(m[1]) > idx) next[`items.${Number(m[1]) - 1}.${m[2]}`] = f;
      }
      d.fields = next;
      d.itemCount -= 1;
    }
    if (p.fields) {
      for (const [key, raw] of Object.entries(p.fields)) {
        const type = typeFor(d.kind, key);
        if (!type) throw new HttpError(400, `Unknown field ${key} for this document type.`);
        const m = /^items\.(\d+)\./.exec(key);
        if (m && Number(m[1]) >= d.itemCount) d.itemCount = Number(m[1]) + 1;
        const prev = d.fields[key];
        const value = raw === null || raw.trim() === '' ? null : normalizeValue(type, raw);
        if (raw && raw.trim() && value === null) throw new HttpError(400, `“${raw}” is not a valid ${type === 'money' || type === 'number' ? 'number' : type === 'date' ? 'date' : type}.`);
        d.fields[key] = {
          value,
          raw,
          type,
          confidence: 'manual',
          method: 'manual',
          source: prev?.source ?? null,
          note: 'Corrected by you',
          original: prev && prev.method !== 'manual' ? { value: prev.value, method: prev.method, confidence: prev.confidence, source: prev.source } : prev?.original ?? null,
          correctedAt: new Date().toISOString(),
        };
        logEvent(ws, 'corrected', `${d.filename}: ${key} set to ${raw ?? '—'}${prev?.value ? ` (was ${prev.value})` : ''}`, { docId: id, buyerId: d.buyerId ?? undefined });
      }
    }
    if (p.revert) {
      for (const key of p.revert) {
        const f = d.fields[key];
        if (f?.original) {
          d.fields[key] = { value: f.original.value, raw: f.original.value, type: f.type, confidence: f.original.confidence, method: f.original.method, source: f.original.source };
        } else if (f && f.method === 'manual') delete d.fields[key];
      }
    }
    pruneBuyers(ws);
    return d;
  });
  return json(doc);
});

export const DELETE = route<Ctx>(async (_req, { params }) => {
  const { id } = await params;
  const stored = await mutate((ws) => {
    const d = ws.documents[id];
    if (!d) throw new HttpError(404, 'Document not found.');
    delete ws.documents[id];
    for (const k of Object.keys(ws.lineOverrides)) if (k.startsWith(`${id}#`)) delete ws.lineOverrides[k];
    pruneBuyers(ws);
    logEvent(ws, 'deleted', `${d.filename} removed`);
    return d.storedAs;
  });
  await fs.unlink(uploadPath(stored)).catch(() => {});
  return json({ ok: true });
});
