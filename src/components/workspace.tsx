'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { DocRecord, LineOverride, Workspace, Buyer, Company, Settings } from '@/lib/types';
import type { EngineStatus } from '@/lib/extraction/gemma';
import { buildPortfolio, type Portfolio } from '@/lib/ledger';
import { api, isBusy } from '@/lib/client';
import { normalizeValue } from '@/lib/engine/normalize';
import { DOC_FIELDS } from '@/lib/types';

export interface Me {
  uid: string;
  email: string;
  name: string;
  role: 'owner' | 'guest';
}

interface Snapshot {
  me?: Me;
  ws: Workspace;
  engine: EngineStatus;
  queue: { pending: number; current: string | null };
  today: string;
}

interface Ctx {
  me: Me | null;
  logout: () => Promise<void>;
  ws: Workspace | null;
  engine: EngineStatus | null;
  queue: Snapshot['queue'];
  today: string;
  portfolio: Portfolio | null;
  loading: boolean;
  error: string | null;
  busy: boolean;
  refresh: (opts?: { engine?: boolean }) => Promise<void>;
  toast: (msg: string, err?: boolean) => void;
  setField: (docId: string, key: string, raw: string | null) => Promise<void>;
  revertField: (docId: string, key: string) => Promise<void>;
  patchDoc: (docId: string, body: Record<string, unknown>) => Promise<void>;
  setLine: (key: string, patch: Partial<Record<keyof LineOverride, unknown>>) => Promise<void>;
  patchBuyer: (id: string, body: Partial<Buyer> & { rotateToken?: boolean }) => Promise<void>;
  patchSettings: (body: { company?: Partial<Company>; settings?: Partial<Settings> & { engine?: Partial<Settings['engine']> } }) => Promise<void>;
  upload: (files: File[]) => Promise<void>;
  paste: (text: string, title: string) => Promise<void>;
  reread: (docId: string, engine?: 'gemma' | 'rules') => Promise<void>;
  removeDoc: (docId: string) => Promise<void>;
  loadDemo: (engine: 'rules' | 'auto') => Promise<void>;
  resetAll: () => Promise<void>;
}

const WsCtx = createContext<Ctx | null>(null);

export function useWorkspace(): Ctx {
  const c = useContext(WsCtx);
  if (!c) throw new Error('useWorkspace outside provider');
  return c;
}

function fieldType(doc: DocRecord, key: string) {
  if (doc.kind === 'other') return 'text';
  const spec = DOC_FIELDS[doc.kind];
  const m = /^items\.(\d+)\.(.+)$/.exec(key);
  return (m ? spec.items.find((f) => f.key === m[2]) : spec.fields.find((f) => f.key === key))?.type ?? 'text';
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [toastMsg, setToastMsg] = useState<{ m: string; err: boolean } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflight = useRef(0);

  const toast = useCallback((m: string, err = false) => {
    setToastMsg({ m, err });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(null), err ? 7000 : 3500);
  }, []);

  const refresh = useCallback(async (opts: { engine?: boolean } = {}) => {
    try {
      const s = await api<Snapshot>(`/api/workspace${opts.engine ? '?engine=force' : ''}`);
      if (inflight.current === 0) setSnap(s);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  const snapRef = useRef<Snapshot | null>(null);
  snapRef.current = snap;

  // Poll: fast while documents are being read, slow otherwise. One timer at a time.
  const schedule = useCallback(
    (delay: number) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(async () => {
        await refresh();
        const s = snapRef.current;
        const busy = s ? isBusy(Object.values(s.ws.documents)) || s.queue.pending > 0 : false;
        schedule(busy ? 1200 : 15000);
      }, delay);
    },
    [refresh],
  );

  useEffect(() => {
    schedule(0);
    const onFocus = () => schedule(0);
    window.addEventListener('focus', onFocus);
    return () => {
      if (timer.current) clearTimeout(timer.current);
      window.removeEventListener('focus', onFocus);
    };
  }, [schedule]);

  const kick = useCallback(() => schedule(400), [schedule]);

  const run = useCallback(
    async (fn: () => Promise<unknown>, ok?: string) => {
      inflight.current++;
      try {
        await fn();
        if (ok) toast(ok);
      } catch (e) {
        toast((e as Error).message, true);
        throw e;
      } finally {
        inflight.current--;
        await refresh();
      }
    },
    [refresh, toast],
  );

  // Optimistic local edit so the ledger recalculates before the server answers.
  const localField = useCallback((docId: string, key: string, raw: string | null) => {
    setSnap((s) => {
      if (!s) return s;
      const ws = structuredClone(s.ws);
      const d = ws.documents[docId];
      if (!d) return s;
      const type = fieldType(d, key);
      const prev = d.fields[key];
      d.fields[key] = {
        value: raw === null || raw === '' ? null : normalizeValue(type, raw),
        raw,
        type: type as never,
        confidence: 'manual',
        method: 'manual',
        source: prev?.source ?? null,
        original: prev && prev.method !== 'manual' ? { value: prev.value, method: prev.method, confidence: prev.confidence, source: prev.source } : prev?.original ?? null,
      };
      const m = /^items\.(\d+)\./.exec(key);
      if (m && Number(m[1]) >= d.itemCount) d.itemCount = Number(m[1]) + 1;
      return { ...s, ws };
    });
  }, []);

  const localLine = useCallback((key: string, patch: Partial<Record<keyof LineOverride, unknown>>) => {
    setSnap((s) => {
      if (!s) return s;
      const ws = structuredClone(s.ws);
      const cur: Record<string, unknown> = { ...(ws.lineOverrides[key] ?? {}) };
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === false) delete cur[k];
        else cur[k] = v;
      }
      if (Object.keys(cur).length) ws.lineOverrides[key] = cur as LineOverride;
      else delete ws.lineOverrides[key];
      return { ...s, ws };
    });
  }, []);

  const value = useMemo<Ctx>(() => {
    const ws = snap?.ws ?? null;
    const portfolio = ws && snap ? buildPortfolio(ws, snap.today) : null;
    return {
      me: snap?.me ?? null,
      logout: async () => {
        await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
        window.location.href = '/welcome';
      },
      ws,
      engine: snap?.engine ?? null,
      queue: snap?.queue ?? { pending: 0, current: null },
      today: snap?.today ?? '',
      portfolio,
      loading,
      error,
      busy: ws ? isBusy(Object.values(ws.documents)) : false,
      refresh,
      toast,
      setField: async (docId, key, raw) => {
        localField(docId, key, raw);
        await run(() => api(`/api/documents/${docId}`, { method: 'PATCH', json: { fields: { [key]: raw } } }), 'Saved. Ledger recalculated.');
      },
      revertField: async (docId, key) => run(() => api(`/api/documents/${docId}`, { method: 'PATCH', json: { revert: [key] } }), 'Reverted to the extracted value.'),
      patchDoc: async (docId, body) => run(() => api(`/api/documents/${docId}`, { method: 'PATCH', json: body })),
      setLine: async (key, patch) => {
        localLine(key, patch);
        await run(() => api('/api/lines', { method: 'PATCH', json: { key, patch } }), 'Saved. Ledger recalculated.');
      },
      patchBuyer: async (id, body) => run(() => api(`/api/buyers/${id}`, { method: 'PATCH', json: body })),
      patchSettings: async (body) => run(() => api('/api/settings', { method: 'PATCH', json: body }), 'Settings saved.'),
      upload: async (files) => {
        const fd = new FormData();
        for (const f of files) fd.append('files', f);
        await run(async () => {
          const r = await api<{ created: { duplicateOf?: string }[] }>('/api/documents', { method: 'POST', body: fd });
          const dups = r.created.filter((c) => c.duplicateOf).length;
          if (dups) toast(`${dups} file${dups > 1 ? 's were' : ' was'} already in the workspace and skipped.`);
        });
        kick();
      },
      paste: async (text, title) => {
        await run(() => api('/api/documents', { method: 'POST', json: { text, title } }), 'Added. Reading it now.');
        kick();
      },
      reread: async (docId, engine) => {
        await run(() => api(`/api/documents/${docId}/reread`, { method: 'POST', json: { engine } }), 'Re-reading the document.');
        kick();
      },
      removeDoc: async (docId) => run(() => api(`/api/documents/${docId}`, { method: 'DELETE' }), 'Document removed.'),
      loadDemo: async (engine) => {
        await run(() => api('/api/demo', { method: 'POST', json: { engine } }), 'Demo workspace loading…');
        kick();
      },
      resetAll: async () => run(() => api('/api/demo', { method: 'DELETE' }), 'Workspace cleared.'),
    };
  }, [snap, loading, error, refresh, toast, run, kick, localField, localLine]);

  return (
    <WsCtx.Provider value={value}>
      {children}
      {toastMsg && (
        <div className={`toast${toastMsg.err ? ' err' : ''}`} role="status">
          {toastMsg.m}
        </div>
      )}
    </WsCtx.Provider>
  );
}
