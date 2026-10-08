// Gemma client. Gemma's role in ClawBack is narrow and explicit:
//   1. classify a document when the keyword rules are unsure,
//   2. read a document and cite where each value is written (line number + verbatim quote),
//   3. transcribe photos / scans into text lines.
// It never computes money. Every value it returns is checked against the source text
// by ground.ts before it is used.
//
// Runs against a local Ollama server (default), Google AI Studio (the Gemini API, which serves
// Gemma 4 as gemma-4-26b-a4b-it / gemma-4-31b-it), or any OpenAI-compatible server
// (llama.cpp, LM Studio, vLLM, OpenRouter) hosting an open Gemma model.

import type { DocKind, DocLine, EngineSettings } from '../types';
import { DOC_FIELDS, DOC_KIND_LABEL } from '../types';

export const PROMPT_VERSION = 'cb-extract-v3';

export interface Cite {
  value: string;
  line: number;
  quote: string;
}

export interface LlmExtraction {
  fields: Record<string, Cite>;
  items: Record<string, Cite>[];
}

export interface EngineStatus {
  online: boolean;
  provider: EngineSettings['provider'];
  baseUrl: string;
  model: string;
  modelAvailable: boolean;
  version?: string;
  models: string[];
  error?: string;
  hint?: string;
  checkedAt: string;
}

export class EngineError extends Error {
  constructor(message: string, public readonly kind: 'offline' | 'model' | 'timeout' | 'bad_output' | 'http' = 'http') {
    super(message);
    this.name = 'EngineError';
  }
}

export const GOOGLE_AI_BASE = 'https://generativelanguage.googleapis.com';

function trimBase(u: string): string {
  return u.replace(/\/+$/, '').replace(/\/v1(beta)?$/, '');
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Retry rate limits and brief outages (429 / 503) from hosted APIs: waits 6 s, 15 s, 30 s. */
async function httpRetry(url: string, init: RequestInit & { timeoutMs: number }): Promise<Response> {
  const waits = [6000, 15000, 30000];
  for (let i = 0; ; i++) {
    const r = await http(url, init);
    if ((r.status !== 429 && r.status !== 503) || i >= waits.length) return r;
    await sleep(waits[i]);
  }
}

async function http(url: string, init: RequestInit & { timeoutMs: number }): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), init.timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    if ((e as Error)?.name === 'AbortError') throw new EngineError(`The extraction engine did not answer within ${Math.round(init.timeoutMs / 1000)} s.`, 'timeout');
    throw new EngineError(`Cannot reach the extraction engine at ${url.split('/api')[0].split('/v1')[0]} (${msg}).`, 'offline');
  } finally {
    clearTimeout(t);
  }
}

// ---------------------------------------------------------------------------------------
// Status

export async function engineStatus(cfg: EngineSettings): Promise<EngineStatus> {
  const base = trimBase(cfg.baseUrl);
  const st: EngineStatus = { online: false, provider: cfg.provider, baseUrl: base, model: cfg.model, modelAvailable: false, models: [], checkedAt: new Date().toISOString() };
  try {
    if (cfg.provider === 'ollama') {
      const v = await http(`${base}/api/version`, { method: 'GET', timeoutMs: 3000 });
      if (v.ok) st.version = ((await v.json()) as { version?: string }).version;
      const r = await http(`${base}/api/tags`, { method: 'GET', timeoutMs: 4000 });
      if (!r.ok) throw new EngineError(`Ollama answered ${r.status}`);
      const j = (await r.json()) as { models?: { name: string; model?: string }[] };
      st.models = (j.models ?? []).map((m) => m.name || m.model || '').filter(Boolean);
      st.online = true;
      const want = cfg.model.includes(':') ? cfg.model : `${cfg.model}:latest`;
      st.modelAvailable = st.models.some((m) => m === cfg.model || m === want);
      if (!st.modelAvailable) st.hint = `Model not pulled yet. Run:  ollama pull ${cfg.model}`;
    } else if (cfg.provider === 'google') {
      const key = googleKey(cfg);
      if (!key) throw new EngineError('No Google AI Studio API key. Add GEMMA_API_KEY on the server or paste a key in Settings.');
      const r = await http(`${base}/v1beta/models/${encodeURIComponent(cfg.model)}`, { method: 'GET', timeoutMs: 6000, headers: { 'x-goog-api-key': key } });
      if (r.status === 400 || r.status === 401 || r.status === 403) throw new EngineError(`Google AI Studio rejected the API key (${r.status}). Create a new key at aistudio.google.com/apikey.`);
      st.online = true;
      st.version = 'Google AI Studio';
      st.models = [cfg.model];
      st.modelAvailable = r.ok;
      if (!r.ok) st.hint = `Google AI Studio does not offer "${cfg.model}". Use gemma-4-26b-a4b-it or gemma-4-31b-it.`;
    } else {
      const r = await http(`${base}/v1/models`, { method: 'GET', timeoutMs: 4000, headers: authHeaders(cfg) });
      if (!r.ok) throw new EngineError(`Server answered ${r.status}`);
      const j = (await r.json()) as { data?: { id: string }[] };
      st.models = (j.data ?? []).map((m) => m.id);
      st.online = true;
      st.modelAvailable = st.models.length === 0 || st.models.includes(cfg.model);
      if (!st.modelAvailable) st.hint = `The server does not list "${cfg.model}". Available: ${st.models.slice(0, 5).join(', ')}`;
    }
  } catch (e) {
    st.online = false;
    st.error = (e as Error).message;
    st.hint =
      cfg.provider === 'ollama'
        ? 'Start Ollama (install from ollama.com, then it runs in the background) and pull a Gemma model:  ollama pull ' + cfg.model
        : cfg.provider === 'google'
          ? st.error ?? 'Check the Google AI Studio API key and model name.'
          : 'Start your OpenAI-compatible server (llama.cpp / LM Studio / vLLM) with a Gemma model loaded.';
  }
  return st;
}

/**
 * The workspace's own key wins. Otherwise a server-wide GEMMA_API_KEY is used, but only for the
 * server-wide GEMMA_BASE_URL, so the deployment's key is never sent anywhere else and never reaches a browser.
 */
/** Google AI Studio key: the workspace's own, else the server-wide GEMMA_API_KEY (never sent to browsers). */
function googleKey(cfg: EngineSettings): string {
  if (cfg.apiKey) return cfg.apiKey;
  const envKey = process.env.GEMMA_API_KEY ?? '';
  const envProvider = process.env.GEMMA_PROVIDER;
  const envBase = trimBase(process.env.GEMMA_BASE_URL || GOOGLE_AI_BASE);
  return envKey && envProvider === 'google' && trimBase(cfg.baseUrl) === envBase ? envKey : '';
}

function authHeaders(cfg: EngineSettings): Record<string, string> {
  const envKey = process.env.GEMMA_API_KEY;
  const envBase = process.env.GEMMA_BASE_URL;
  const key = cfg.apiKey || (envKey && envBase && trimBase(cfg.baseUrl) === trimBase(envBase) ? envKey : '');
  return key ? { Authorization: `Bearer ${key}` } : {};
}

// ---------------------------------------------------------------------------------------
// Low-level chat call

interface ChatOpts {
  system: string;
  user: string;
  schema?: object;
  image?: { mime: string; base64: string };
  maxTokens?: number;
}

async function chat(cfg: EngineSettings, o: ChatOpts): Promise<string> {
  const base = trimBase(cfg.baseUrl);
  const timeoutMs = Math.max(30, cfg.timeoutSec) * 1000;
  if (cfg.provider === 'ollama') {
    const body: Record<string, unknown> = {
      model: cfg.model,
      stream: false,
      keep_alive: '30m',
      think: false,
      options: { temperature: 0, top_k: 1, top_p: 1, seed: 42, num_ctx: cfg.numCtx, num_predict: o.maxTokens ?? 4096 },
      messages: [
        { role: 'system', content: o.system },
        { role: 'user', content: o.user, ...(o.image ? { images: [o.image.base64] } : {}) },
      ],
    };
    if (o.schema) body.format = o.schema;
    let r = await http(`${base}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), timeoutMs });
    if (!r.ok) {
      const txt = await r.text();
      if (/think/i.test(txt)) {
        delete body.think;
        r = await http(`${base}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), timeoutMs });
      } else if (r.status === 404 || /not found|pull/i.test(txt)) {
        throw new EngineError(`Model "${cfg.model}" is not available in Ollama. Run: ollama pull ${cfg.model}`, 'model');
      } else {
        throw new EngineError(`Ollama error ${r.status}: ${txt.slice(0, 200)}`);
      }
      if (!r.ok) throw new EngineError(`Ollama error ${r.status}: ${(await r.text()).slice(0, 200)}`);
    }
    const j = (await r.json()) as { message?: { content?: string }; error?: string };
    if (j.error) throw new EngineError(j.error);
    return j.message?.content ?? '';
  }

  if (cfg.provider === 'google') return chatGoogle(cfg, o, base, timeoutMs);

  // OpenAI-compatible
  const userContent = o.image
    ? [
        { type: 'text', text: o.user },
        { type: 'image_url', image_url: { url: `data:${o.image.mime};base64,${o.image.base64}` } },
      ]
    : o.user;
  const body: Record<string, unknown> = {
    model: cfg.model,
    temperature: 0,
    top_p: 1,
    seed: 42,
    max_tokens: o.maxTokens ?? 4096,
    messages: [
      { role: 'system', content: o.system },
      { role: 'user', content: userContent },
    ],
  };
  if (o.schema) body.response_format = { type: 'json_schema', json_schema: { name: 'clawback_extraction', schema: o.schema, strict: true } };
  const headers = { 'Content-Type': 'application/json', ...authHeaders(cfg) };
  let r = await httpRetry(`${base}/v1/chat/completions`, { method: 'POST', headers, body: JSON.stringify(body), timeoutMs });
  if (!r.ok && o.schema) {
    body.response_format = { type: 'json_object' };
    r = await http(`${base}/v1/chat/completions`, { method: 'POST', headers, body: JSON.stringify(body), timeoutMs });
    if (!r.ok) {
      delete body.response_format;
      r = await http(`${base}/v1/chat/completions`, { method: 'POST', headers, body: JSON.stringify(body), timeoutMs });
    }
  }
  if (!r.ok) throw new EngineError(`Server error ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = (await r.json()) as { choices?: { message?: { content?: string } }[] };
  return j.choices?.[0]?.message?.content ?? '';
}

/** Google AI Studio (Gemini API) generateContent with a Gemma model. */
async function chatGoogle(cfg: EngineSettings, o: ChatOpts, base: string, timeoutMs: number): Promise<string> {
  const key = googleKey(cfg);
  if (!key) throw new EngineError('No Google AI Studio API key configured.', 'offline');
  const parts: Record<string, unknown>[] = [{ text: o.user }];
  if (o.image) parts.push({ inlineData: { mimeType: o.image.mime, data: o.image.base64 } });
  const gen: Record<string, unknown> = { temperature: 0, topP: 1, topK: 1, seed: 42, maxOutputTokens: o.maxTokens ?? 4096 };
  if (o.schema) gen.responseMimeType = 'application/json';
  const body: Record<string, unknown> = {
    systemInstruction: { parts: [{ text: o.system }] },
    contents: [{ role: 'user', parts }],
    generationConfig: { ...gen, thinkingConfig: { thinkingLevel: 'minimal' } },
  };
  const url = `${base}/v1beta/models/${encodeURIComponent(cfg.model)}:generateContent`;
  const headers = { 'Content-Type': 'application/json', 'x-goog-api-key': key };
  let r = await httpRetry(url, { method: 'POST', headers, body: JSON.stringify(body), timeoutMs });
  if (r.status === 400) {
    // Older Gemma models reject thinking settings, JSON mode or system instructions: retry with the plainest request.
    const plain = {
      contents: [{ role: 'user', parts: [{ text: `${o.system}\n\n${o.user}` }, ...parts.slice(1)] }],
      generationConfig: { temperature: 0, topP: 1, topK: 1, maxOutputTokens: o.maxTokens ?? 4096 },
    };
    r = await httpRetry(url, { method: 'POST', headers, body: JSON.stringify(plain), timeoutMs });
  }
  if (r.status === 404) throw new EngineError(`Google AI Studio does not offer "${cfg.model}". Use gemma-4-26b-a4b-it.`, 'model');
  if (!r.ok) throw new EngineError(`Google AI Studio error ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = (await r.json()) as { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[]; promptFeedback?: { blockReason?: string } };
  if (j.promptFeedback?.blockReason) throw new EngineError(`Google AI Studio blocked the request (${j.promptFeedback.blockReason}).`, 'bad_output');
  return (j.candidates?.[0]?.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? '').join('');
}

// ---------------------------------------------------------------------------------------
// JSON handling

export function parseJsonLoose(text: string): unknown {
  let s = text.trim();
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start < 0 || end <= start) throw new EngineError('The model did not return JSON.', 'bad_output');
  s = s.slice(start, end + 1);
  try {
    return JSON.parse(s);
  } catch {
    const fixed = s.replace(/,\s*([}\]])/g, '$1').replace(/[“”]/g, '"');
    try {
      return JSON.parse(fixed);
    } catch {
      throw new EngineError('The model returned malformed JSON.', 'bad_output');
    }
  }
}

function toCite(x: unknown): Cite | null {
  if (x === null || x === undefined) return null;
  if (typeof x === 'string' || typeof x === 'number') {
    const v = String(x).trim();
    return v ? { value: v, line: 0, quote: v } : null;
  }
  if (typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  const value = o.value === null || o.value === undefined ? '' : String(o.value).trim();
  if (!value) return null;
  const lineRaw = typeof o.line === 'number' ? o.line : parseInt(String(o.line ?? '0').replace(/\D/g, ''), 10);
  const quote = o.quote === null || o.quote === undefined ? '' : String(o.quote).trim();
  return { value, line: Number.isFinite(lineRaw) ? lineRaw : 0, quote: quote || value };
}

export function coerceExtraction(raw: unknown, kind: Exclude<DocKind, 'other'>): LlmExtraction {
  const spec = DOC_FIELDS[kind];
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const fieldsIn = (obj.fields && typeof obj.fields === 'object' ? obj.fields : obj) as Record<string, unknown>;
  const fields: Record<string, Cite> = {};
  for (const f of spec.fields) {
    const c = toCite(fieldsIn[f.key]);
    if (c) fields[f.key] = c;
  }
  const items: Record<string, Cite>[] = [];
  const itemsIn = Array.isArray(obj.items) ? obj.items : [];
  for (const it of itemsIn.slice(0, 200)) {
    if (!it || typeof it !== 'object') continue;
    const out: Record<string, Cite> = {};
    for (const f of spec.items) {
      const c = toCite((it as Record<string, unknown>)[f.key]);
      if (c) out[f.key] = c;
    }
    if (Object.keys(out).length) items.push(out);
  }
  return { fields, items };
}

// ---------------------------------------------------------------------------------------
// Prompts

const SYSTEM_EXTRACT = [
  'You are the extraction engine inside ClawBack, software used by Indian exporters to reconcile US tariff refunds with their buyers.',
  'You read ONE trade document and copy specific values out of it.',
  'Rules:',
  '1. Copy each value exactly as written in the document. Never calculate, convert, round, translate or guess.',
  '2. For each value give "line": the number printed before the "|" on the line where the value appears, and "quote": a short verbatim span copied from that line that contains the value.',
  '3. If a value is not present, return "value": "", "line": 0, "quote": "".',
  '4. The exporter is the user of this software; the buyer is the other company. Never return the exporter as the buyer.',
  '5. Output only JSON that matches the schema.',
].join('\n');

const CITE_SCHEMA = {
  type: 'object',
  properties: { value: { type: 'string' }, line: { type: 'integer' }, quote: { type: 'string' } },
  required: ['value', 'line', 'quote'],
};

export function extractionSchema(kind: Exclude<DocKind, 'other'>): object {
  const spec = DOC_FIELDS[kind];
  const fieldProps: Record<string, object> = {};
  for (const f of spec.fields) fieldProps[f.key] = CITE_SCHEMA;
  const itemProps: Record<string, object> = {};
  for (const f of spec.items) itemProps[f.key] = CITE_SCHEMA;
  return {
    type: 'object',
    properties: {
      fields: { type: 'object', properties: fieldProps, required: spec.fields.map((f) => f.key) },
      items: { type: 'array', items: { type: 'object', properties: itemProps, required: spec.items.map((f) => f.key) } },
    },
    required: ['fields', 'items'],
  };
}

export function numberedText(lines: DocLine[], maxLines = 400): { text: string; truncated: boolean } {
  const slice = lines.slice(0, maxLines);
  const text = slice.map((l, i) => `${String(i + 1).padStart(4, '0')}| ${l.text}`).join('\n');
  return { text, truncated: lines.length > maxLines };
}

function extractionPrompt(kind: Exclude<DocKind, 'other'>, lines: DocLine[], exporterName: string): { user: string; truncated: boolean } {
  const spec = DOC_FIELDS[kind];
  const { text, truncated } = numberedText(lines);
  const parts = [
    `Document type: ${DOC_KIND_LABEL[kind]}.`,
    exporterName ? `The exporter (our user) is "${exporterName}".` : '',
    '',
    'Fields to extract into "fields":',
    ...spec.fields.map((f) => `- ${f.key}: ${f.hint}`),
  ];
  if (spec.items.length) {
    const what = kind === 'invoice' ? 'one entry per goods line in the invoice table' : kind === 'price_revision' ? 'one entry per product whose price changed' : 'one entry per realisation / remittance row';
    parts.push('', `"items": ${what}, each with:`, ...spec.items.map((f) => `- ${f.key}: ${f.hint}`));
  } else {
    parts.push('', '"items": return an empty array.');
  }
  parts.push('', 'DOCUMENT (each line starts with its line number):', text);
  return { user: parts.filter((p) => p !== undefined).join('\n'), truncated };
}

// ---------------------------------------------------------------------------------------
// Public API

export async function gemmaExtract(
  cfg: EngineSettings,
  kind: Exclude<DocKind, 'other'>,
  lines: DocLine[],
  exporterName: string,
): Promise<{ result: LlmExtraction; ms: number; truncated: boolean; raw: string }> {
  const t0 = Date.now();
  const { user, truncated } = extractionPrompt(kind, lines, exporterName);
  const raw = await chat(cfg, { system: SYSTEM_EXTRACT, user, schema: extractionSchema(kind) });
  const parsed = parseJsonLoose(raw);
  return { result: coerceExtraction(parsed, kind), ms: Date.now() - t0, truncated, raw };
}

const KINDS: DocKind[] = ['invoice', 'price_revision', 'bank_realization', 'refund_notice', 'other'];

export async function gemmaClassify(cfg: EngineSettings, lines: DocLine[]): Promise<DocKind> {
  const { text } = numberedText(lines, 120);
  const raw = await chat(cfg, {
    system: 'You classify trade documents for an Indian exporter. Output only JSON.',
    user: [
      'Which one is this document?',
      '- invoice: a commercial/export invoice with goods lines and prices',
      '- price_revision: an email, letter or note agreeing a lower/changed price or discount for a buyer',
      '- bank_realization: a bank document proving export proceeds were received (e-BRC, FIRA, FIRC, inward remittance advice, realisation statement)',
      '- refund_notice: a US customs (CBP/CAPE) refund confirmation or statement',
      '- other: anything else',
      '',
      text,
    ].join('\n'),
    schema: { type: 'object', properties: { doc_type: { type: 'string', enum: KINDS } }, required: ['doc_type'] },
    maxTokens: 64,
  });
  const j = parseJsonLoose(raw) as { doc_type?: string };
  const k = String(j.doc_type ?? '').toLowerCase() as DocKind;
  return KINDS.includes(k) ? k : 'other';
}

export async function gemmaTranscribe(cfg: EngineSettings, image: { mime: string; base64: string }): Promise<string> {
  const raw = await chat(cfg, {
    system: 'You are an OCR engine. You transcribe documents exactly. You never summarise, translate, correct or add anything.',
    user: 'Transcribe all text in this document image, top to bottom. Keep each printed line on its own line. Keep table rows on one line with cells separated by four spaces. Output plain text only.',
    image,
    maxTokens: 6000,
  });
  return raw.replace(/^```[a-z]*\s*/i, '').replace(/```\s*$/i, '').trim();
}
