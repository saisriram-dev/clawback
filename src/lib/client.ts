// Browser helpers: API calls and cell formatting. Safe to import in client components.

import type { Cell, CellConf } from './ledger';
import type { DocRecord } from './types';
import { fmtDate } from './engine/dates';
import { fmtPct, fmtPrice, fmtUSD } from './engine/money';
import { fmtHS } from './engine/normalize';

export async function api<T = unknown>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const res = await fetch(path, {
    ...rest,
    headers: json !== undefined ? { 'Content-Type': 'application/json', ...(rest.headers ?? {}) } : rest.headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
    cache: 'no-store',
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (res.status === 401 && typeof window !== 'undefined' && !/^\/(login|signup|welcome|r\/)/.test(window.location.pathname)) {
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
  }
  if (!res.ok) {
    const msg = (data as { error?: string } | null)?.error ?? `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return data as T;
}

export function fmtCell(c: Cell | null | undefined): string {
  if (!c || c.v === null || c.v === undefined || c.v === '') return '—';
  switch (c.fmt) {
    case 'usd':
      return fmtUSD(c.v as number);
    case 'price':
      return fmtPrice(c.v as number);
    case 'num':
      return (c.v as number).toLocaleString('en-US', { maximumFractionDigits: 3 });
    case 'pct':
      return fmtPct(c.v as number, 1);
    case 'date':
      return fmtDate(c.v as string);
    case 'hs':
      return fmtHS(c.v as string);
    default:
      return String(c.v);
  }
}

export const CONF_LABEL: Record<CellConf, string> = {
  high: 'Verified: Gemma and the rules engine agree, and the value is on the cited line',
  medium: 'Read from the document and found on the cited line',
  low: 'Check: readings disagree or the value was not found verbatim',
  manual: 'Entered or corrected by you',
  computed: 'Computed by ClawBack from the values above',
  estimated: 'Estimated: replace with the actual figure if you have it',
  lookup: 'From the dated rate table',
  default: 'Default setting',
  missing: 'Not found: enter it to complete this line',
};

export const CONF_SHORT: Record<CellConf, string> = {
  high: 'verified',
  medium: 'read',
  low: 'check',
  manual: 'edited',
  computed: 'computed',
  estimated: 'estimate',
  lookup: 'rate table',
  default: 'default',
  missing: 'missing',
};

export function docLabel(d: DocRecord | undefined): string {
  if (!d) return 'document';
  switch (d.kind) {
    case 'invoice':
      return `invoice ${d.fields['invoice_number']?.value ?? d.filename}`;
    case 'price_revision': {
      const dt = d.fields['email_date']?.value;
      return d.meta.emailFrom ? `email${dt ? ` dated ${fmtDate(dt)}` : ''}` : `price revision${dt ? ` dated ${fmtDate(dt)}` : ''}`;
    }
    case 'bank_realization':
      return /\.csv$/i.test(d.filename) ? 'e-BRC export' : /fira/i.test(d.lines.slice(0, 8).map((l) => l.text).join(' ')) ? 'FIRA' : 'bank realisation certificate';
    case 'refund_notice':
      return 'refund confirmation';
    default:
      return d.filename;
  }
}

export function isBusy(docs: DocRecord[]): boolean {
  return docs.some((d) => d.status === 'queued' || d.status === 'processing');
}
