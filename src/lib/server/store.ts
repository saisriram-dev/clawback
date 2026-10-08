// Workspace store: one JSON file plus an uploads folder per account. Server only.
// Writes are serialised, atomic (temp file + rename) and retried on Windows file locks
// (OneDrive, antivirus). A backup of the last good state is kept beside it.
// Each signed-in account works in data/tenants/<uid>/ (see tenant.ts). Outside a
// signed-in request (tests, scripts) the store falls back to the data folder itself.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { Workspace } from '../types';
import { DEFAULT_COMPANY, DEFAULT_SETTINGS } from '../types';
import { currentUid } from './tenant';

export const DATA_DIR = process.env.CLAWBACK_DATA_DIR ? path.resolve(process.env.CLAWBACK_DATA_DIR) : path.join(process.cwd(), 'data');
/** Extraction cache is content-addressed (file hash), so it is shared safely across accounts. */
export const CACHE_DIR = path.join(DATA_DIR, 'cache');
export const TENANTS_DIR = path.join(DATA_DIR, 'tenants');

/** Folder holding the current account's workspace and uploads. */
export function tenantDir(): string {
  const uid = currentUid();
  return uid ? path.join(TENANTS_DIR, uid) : DATA_DIR;
}
export function uploadDir(): string {
  return path.join(tenantDir(), 'uploads');
}
const wsFile = () => path.join(tenantDir(), 'workspace.json');
const bakFile = () => path.join(tenantDir(), 'workspace.bak.json');

type G = typeof globalThis & { __cbChains?: Map<string, Promise<unknown>>; __cbDirsReady?: Set<string> };
const g = globalThis as G;
const chains = (g.__cbChains ??= new Map());
const dirsReady = (g.__cbDirsReady ??= new Set());

/**
 * Server-wide Gemma configuration from environment variables, so every workspace on a
 * deployment reads documents with the same Gemma. Returns null when nothing is configured.
 *   GEMMA_PROVIDER=google  + GEMMA_API_KEY (+ GEMMA_MODEL)   Google AI Studio / Gemini API
 *   GEMMA_PROVIDER=ollama  (+ GEMMA_BASE_URL, GEMMA_MODEL)   local Ollama
 *   GEMMA_PROVIDER=openai  + GEMMA_BASE_URL (+ key, model)   any OpenAI-compatible server
 */
export function envEngine(): Partial<Workspace['settings']['engine']> | null {
  const e = process.env;
  const p = e.GEMMA_PROVIDER;
  const out: Partial<Workspace['settings']['engine']> = {};
  if (e.CLAWBACK_ENGINE_MODE === 'rules' || e.CLAWBACK_ENGINE_MODE === 'auto' || e.CLAWBACK_ENGINE_MODE === 'gemma') out.mode = e.CLAWBACK_ENGINE_MODE;
  if (p === 'google') {
    out.provider = 'google';
    out.baseUrl = e.GEMMA_BASE_URL || 'https://generativelanguage.googleapis.com';
    out.model = e.GEMMA_MODEL || 'gemma-4-26b-a4b-it';
    out.timeoutSec = 180;
  } else if (p === 'ollama') {
    out.provider = 'ollama';
    if (e.GEMMA_BASE_URL) out.baseUrl = e.GEMMA_BASE_URL;
    if (e.GEMMA_MODEL) out.model = e.GEMMA_MODEL;
  } else if (p === 'openai' && e.GEMMA_BASE_URL) {
    out.provider = 'openai';
    out.baseUrl = e.GEMMA_BASE_URL;
    if (e.GEMMA_MODEL) out.model = e.GEMMA_MODEL;
  } else {
    return Object.keys(out).length ? out : null;
  }
  return out;
}

/** True when the server itself is configured to read with Gemma. */
export function gemmaConfigured(): boolean {
  const e = envEngine();
  return !!e?.provider;
}

function envEngineDefaults(): Partial<Workspace['settings']['engine']> {
  return envEngine() ?? {};
}

export function emptyWorkspace(): Workspace {
  return {
    version: 1,
    company: { ...DEFAULT_COMPANY },
    settings: (() => {
      const st = structuredClone(DEFAULT_SETTINGS);
      st.engine = { ...st.engine, ...envEngineDefaults() };
      return st;
    })(),
    buyers: {},
    documents: {},
    lineOverrides: {},
    events: [],
  };
}

/** Fill in any keys added in later versions so old workspaces keep working. */
export function migrate(raw: Partial<Workspace>): Workspace {
  const base = emptyWorkspace();
  const ws: Workspace = {
    ...base,
    ...raw,
    company: { ...base.company, ...(raw.company ?? {}) },
    settings: {
      ...base.settings,
      ...(raw.settings ?? {}),
      engine: { ...base.settings.engine, ...(raw.settings?.engine ?? {}) },
    },
    buyers: raw.buyers ?? {},
    documents: raw.documents ?? {},
    lineOverrides: raw.lineOverrides ?? {},
    events: raw.events ?? [],
  } as Workspace;
  // A workspace that never changed its engine follows the server's Gemma configuration.
  const env = envEngine();
  const d = DEFAULT_SETTINGS.engine;
  const eng = ws.settings.engine;
  if (env?.provider && eng.provider === d.provider && eng.baseUrl === d.baseUrl && eng.model === d.model && !eng.apiKey) {
    ws.settings.engine = { ...eng, ...env };
  }
  for (const b of Object.values(ws.buyers)) {
    b.aliases ??= [];
    b.domains ??= [];
    b.responses ??= [];
    b.refundConfirmedInterestUSD ??= null;
    b.portalEnabled ??= true;
    b.notes ??= '';
  }
  for (const d of Object.values(ws.documents)) {
    d.fields ??= {};
    d.lines ??= [];
    d.meta ??= {};
    d.engine ??= { used: 'none', warnings: [] };
    d.engine.warnings ??= [];
  }
  return ws;
}

export async function ensureDirs(): Promise<void> {
  const dir = tenantDir();
  if (dirsReady.has(dir)) return;
  await fs.mkdir(path.join(dir, 'uploads'), { recursive: true });
  await fs.mkdir(CACHE_DIR, { recursive: true });
  dirsReady.add(dir);
}

async function readFileJson(file: string): Promise<Partial<Workspace> | null> {
  try {
    const txt = await fs.readFile(file, 'utf8');
    return JSON.parse(txt) as Partial<Workspace>;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
}

async function loadUnlocked(): Promise<Workspace> {
  await ensureDirs();
  const WS_FILE = wsFile();
  const BAK_FILE = bakFile();
  try {
    const raw = await readFileJson(WS_FILE);
    return raw ? migrate(raw) : emptyWorkspace();
  } catch {
    // Corrupt file: keep it for inspection and fall back to the last good backup.
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    await fs.copyFile(WS_FILE, path.join(tenantDir(), `workspace.corrupt-${stamp}.json`)).catch(() => {});
    try {
      const bak = await readFileJson(BAK_FILE);
      return bak ? migrate(bak) : emptyWorkspace();
    } catch {
      return emptyWorkspace();
    }
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function writeFileAtomic(file: string, data: string): Promise<void> {
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  await fs.writeFile(tmp, data, 'utf8');
  let lastErr: unknown;
  for (let attempt = 0; attempt < 12; attempt++) {
    try {
      await fs.rename(tmp, file);
      return;
    } catch (e) {
      lastErr = e;
      const code = (e as NodeJS.ErrnoException).code;
      if (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES') break;
      await sleep(40 * (attempt + 1));
    }
  }
  // Last resort on locked files: copy over, then remove the temp file.
  try {
    await fs.copyFile(tmp, file);
    await fs.unlink(tmp).catch(() => {});
  } catch {
    await fs.unlink(tmp).catch(() => {});
    throw lastErr;
  }
}

async function saveUnlocked(ws: Workspace): Promise<void> {
  await ensureDirs();
  if (ws.events.length > 500) ws.events = ws.events.slice(-500);
  const json = JSON.stringify(ws);
  await writeFileAtomic(wsFile(), json);
  await writeFileAtomic(bakFile(), json).catch(() => {});
}

/** Read the current workspace (waits for pending writes). */
export async function readWorkspace(): Promise<Workspace> {
  const prev = chains.get(tenantDir()) ?? Promise.resolve();
  await prev.catch(() => {});
  return loadUnlocked();
}

/** Serialised read-modify-write. The callback may mutate `ws` in place. */
export function mutate<T>(fn: (ws: Workspace) => T | Promise<T>): Promise<T> {
  const key = tenantDir();
  const prev = chains.get(key) ?? Promise.resolve();
  const next = prev
    .catch(() => {})
    .then(async () => {
      const ws = await loadUnlocked();
      const out = await fn(ws);
      await saveUnlocked(ws);
      return out;
    });
  chains.set(key, next.catch(() => {}));
  return next;
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
}

/** Buyer-portal token. Prefixed with the owner's account id so the public link finds the right workspace. */
export function newToken(): string {
  const rnd = crypto.randomBytes(18).toString('base64url');
  const uid = currentUid();
  return uid ? `${uid}.${rnd}` : rnd;
}

export function sha256(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

export function uploadPath(storedAs: string): string {
  const safe = path.basename(storedAs);
  return path.join(uploadDir(), safe);
}

export async function readCache<T>(key: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(path.join(CACHE_DIR, `${key}.json`), 'utf8')) as T;
  } catch {
    return null;
  }
}

export async function writeCache(key: string, value: unknown): Promise<void> {
  await ensureDirs();
  await writeFileAtomic(path.join(CACHE_DIR, `${key}.json`), JSON.stringify(value)).catch(() => {});
}

export function logEvent(ws: Workspace, kind: string, text: string, ids: { docId?: string; buyerId?: string } = {}): void {
  ws.events.push({ at: new Date().toISOString(), kind, text, ...ids });
}
