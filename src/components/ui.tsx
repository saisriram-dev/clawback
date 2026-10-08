'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import type { Cell } from '@/lib/ledger';
import type { Flag } from '@/lib/ledger';
import type { DocRecord } from '@/lib/types';
import type { EngineStatus } from '@/lib/extraction/gemma';
import { fmtCell, CONF_LABEL, CONF_SHORT } from '@/lib/client';

export function Logo({ size = 26 }: { size?: number }) {
  // Three claw marks pulling back a curve: a "claw back".
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id="cbg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#e8336d" />
          <stop offset="0.55" stopColor="#ff6a3d" />
          <stop offset="1" stopColor="#ffb627" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="30" height="30" rx="9" fill="url(#cbg)" />
      <path d="M9 23 C 11 15, 14 10, 20 8" stroke="#ffffff" strokeWidth="2.4" fill="none" strokeLinecap="round" />
      <path d="M13 24 C 15 17, 18 13, 23 11" stroke="#ffffff" strokeWidth="2.4" fill="none" strokeLinecap="round" />
      <path d="M17 25 C 19 20, 21 17, 25 15" stroke="#170f3a" strokeWidth="2.4" fill="none" strokeLinecap="round" />
    </svg>
  );
}

export function NumCell({ cell, active, onClick, title, children }: { cell: Cell | null | undefined; active?: boolean; onClick?: () => void; title?: string; children?: ReactNode }) {
  if (!cell) return <span className="muted">—</span>;
  const conf = cell.conf;
  const cls = ['num-btn', active ? 'active' : '', conf === 'missing' ? 'missing' : '', conf === 'computed' ? 'computed' : ''].filter(Boolean).join(' ');
  return (
    <button type="button" className={cls} onClick={onClick} title={title ?? `${CONF_LABEL[conf]}${cell.note ? ` · ${cell.note}` : ''}. Click to see the source.`}>
      {children ?? fmtCell(cell)}
      {conf !== 'computed' && <span className={`dot ${conf}`} aria-label={CONF_SHORT[conf]} />}
    </button>
  );
}

export function ConfBadge({ conf }: { conf: Cell['conf'] }) {
  const cls = conf === 'high' ? 'ok' : conf === 'low' || conf === 'missing' ? 'warn' : conf === 'manual' ? 'navy' : '';
  return (
    <span className={`badge ${cls}`} title={CONF_LABEL[conf]}>
      <span className={`dot ${conf}`} /> {CONF_SHORT[conf]}
    </span>
  );
}

export function Flags({ flags, max }: { flags: Flag[]; max?: number }) {
  if (!flags.length) return null;
  const list = max ? flags.slice(0, max) : flags;
  return (
    <div>
      {list.map((f, i) => (
        <div key={i} className={`flag ${f.level}`}>
          <span className="mono">{f.level === 'error' ? '✕' : f.level === 'warn' ? '!' : 'i'}</span>
          <span>{f.text}</span>
        </div>
      ))}
    </div>
  );
}

export function Bar({ value, accent }: { value: number; accent?: boolean }) {
  return (
    <div className={`bar${accent ? ' accent' : ''}`}>
      <i style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

export function EnginePill({ engine, mode }: { engine: EngineStatus | null; mode?: string }) {
  if (!engine) return <span className="pill">Extraction engine…</span>;
  if (mode === 'rules') return <span className="pill off"><span className="led" /> Extraction: deterministic rules only</span>;
  const ok = engine.online && engine.modelAvailable;
  return (
    <span className={`pill ${ok ? 'on' : 'off'}`} title={ok ? `${engine.provider === 'ollama' ? `Ollama ${engine.version ?? ''}` : engine.provider === 'google' ? 'Google AI Studio' : 'Server'} at ${engine.baseUrl}` : engine.hint ?? engine.error ?? ''}>
      <span className="led" />
      {ok ? (
        <>
          Extraction engine: <b className="mono">{engine.model}</b>
        </>
      ) : engine.online ? (
        <>Gemma model not pulled · rules engine active</>
      ) : (
        <>Gemma offline · rules engine active</>
      )}
    </span>
  );
}

/** Text view of a document with line numbers; highlights the cited line and quote. */
export function DocViewer({ doc, line, quote, tall, cited }: { doc: DocRecord; line?: number | null; quote?: string | null; tall?: boolean; cited?: Set<number> }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!line || !box.current) return;
    const el = box.current.querySelector<HTMLElement>(`[data-ln="${line}"]`);
    if (el) box.current.scrollTop = Math.max(0, el.offsetTop - box.current.clientHeight / 2 + 20);
    const mark = box.current.querySelector<HTMLElement>('mark');
    if (mark) {
      const left = mark.offsetLeft;
      const w = box.current.clientWidth;
      box.current.scrollLeft = left + mark.offsetWidth > w - 20 ? Math.max(0, left - w / 2) : 0;
    } else box.current.scrollLeft = 0;
  }, [line, quote, doc.id]);
  if (!doc.lines.length) {
    return <div className="doc" style={{ padding: 16 }}><span className="muted">{doc.status === 'failed' ? doc.error : 'No text yet.'}</span></div>;
  }
  let lastPage = 1;
  return (
    <div className={`doc${tall ? ' tall' : ''}${['eml', 'text', 'docx', 'html'].includes(doc.meta.format ?? '') ? ' wrap' : ''}`} ref={box}>
      {doc.lines.map((l, i) => {
        const n = i + 1;
        const pageBreak = l.page !== lastPage;
        lastPage = l.page;
        const hit = n === line;
        return (
          <div key={i}>
            {pageBreak && <div className="page">Page {l.page}</div>}
            <div className={`ln${hit ? ' hit' : cited?.has(n) ? ' cited' : ''}`} data-ln={n}>
              <span className="no">{n}</span>
              <span>{hit && quote ? highlight(l.text, quote) : l.text || ' '}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function highlight(text: string, quote: string): ReactNode {
  const q = quote.trim();
  if (!q) return text;
  let idx = text.indexOf(q);
  let len = q.length;
  if (idx < 0) {
    // whitespace-insensitive match
    const esc = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    const m = new RegExp(esc, 'i').exec(text);
    if (m) {
      idx = m.index;
      len = m[0].length;
    }
  }
  if (idx < 0) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark>{text.slice(idx, idx + len)}</mark>
      {text.slice(idx + len)}
    </>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="card empty">
      <h2>{title}</h2>
      <div className="muted">{children}</div>
    </div>
  );
}

export function Labeled({ label, help, children }: { label: string; help?: string; children: ReactNode }) {
  return (
    <div className="field">
      <label className="f">{label}</label>
      {children}
      {help && <div className="help">{help}</div>}
    </div>
  );
}
