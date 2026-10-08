'use client';

import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useWorkspace } from '@/components/workspace';
import { ConfBadge, DocViewer } from '@/components/ui';
import { DOC_FIELDS, DOC_KIND_LABEL, type DocKind, type DocRecord, type Field, type FieldSpec } from '@/lib/types';
import { fmtDate } from '@/lib/engine/dates';
import { fmtHS } from '@/lib/engine/normalize';

const KINDS: DocKind[] = ['invoice', 'price_revision', 'bank_realization', 'refund_notice', 'other'];

export default function DocumentPage() {
  return (
    <Suspense fallback={<div className="muted">Loading…</div>}>
      <DocumentReview />
    </Suspense>
  );
}

function DocumentReview() {
  const { id } = useParams<{ id: string }>();
  const search = useSearchParams();
  const { ws, engine, patchDoc, reread, removeDoc } = useWorkspace();
  const doc = ws?.documents[id];
  const [focus, setFocus] = useState<{ line: number; quote: string } | null>(null);

  useEffect(() => {
    const l = Number(search.get('line'));
    if (l > 0 && doc) setFocus({ line: l, quote: '' });
  }, [search, doc?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const cited = useMemo(() => new Set(Object.values(doc?.fields ?? {}).map((f) => f.source?.line).filter((x): x is number => !!x)), [doc]);
  if (!ws) return null;
  if (!doc) return <div className="card card-b">Document not found. <Link href="/intake">Back to Intake</Link></div>;

  const buyers = Object.values(ws.buyers).sort((a, b) => a.name.localeCompare(b.name));
  const gemmaReady = !!engine?.online && !!engine?.modelAvailable;
  const spec = doc.kind !== 'other' ? DOC_FIELDS[doc.kind] : null;

  return (
    <div>
      <div className="row" style={{ marginBottom: 12 }}>
        <div>
          <div className="kicker"><Link href="/intake">Intake</Link> / {DOC_KIND_LABEL[doc.kind]}</div>
          <h1 style={{ wordBreak: 'break-all' }}>{doc.filename}</h1>
        </div>
        <span className="spacer" />
        <a className="btn sm" href={`/api/documents/${doc.id}/file`} target="_blank" rel="noreferrer">Original file ↗</a>
        {gemmaReady && <button className="btn sm" onClick={() => reread(doc.id, 'gemma')}>Re-read with Gemma</button>}
        <button className="btn sm" onClick={() => reread(doc.id, 'rules')}>Re-read with rules</button>
        <button className="btn sm ghost danger" onClick={() => window.confirm('Remove this document?') && removeDoc(doc.id).then(() => history.back())}>Remove</button>
      </div>

      <div className="split">
        <div className="stack">
          <div className="card card-b">
            <div className="grid2">
              <div>
                <label className="f">Document type</label>
                <select className="input" value={doc.kind} onChange={(e) => patchDoc(doc.id, { kind: e.target.value }).then(() => reread(doc.id))}>
                  {KINDS.map((k) => <option key={k} value={k}>{DOC_KIND_LABEL[k]}</option>)}
                </select>
                <div className="help">Detected by {doc.kindMethod === 'manual' ? 'you' : doc.kindMethod === 'rules' ? 'keyword rules' : 'Gemma'} ({doc.kindConfidence}).</div>
              </div>
              <div>
                <label className="f">Buyer</label>
                <select className="input" value={doc.buyerId ?? ''} onChange={(e) => patchDoc(doc.id, { buyerId: e.target.value || null })}>
                  <option value="">— not linked —</option>
                  {buyers.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
                {doc.buyerId && <div className="help"><Link href={`/buyers/${doc.buyerId}`}>Open buyer workbench →</Link></div>}
              </div>
            </div>
            <div className="row wrap small" style={{ marginTop: 8 }}>
              <span className="badge">{doc.meta.format ?? '—'}{doc.meta.pages ? ` · ${doc.meta.pages} page${doc.meta.pages > 1 ? 's' : ''}` : ''}</span>
              <span className="badge">{doc.lines.length} lines</span>
              {doc.engine.used === 'gemma' ? <span className="badge navy mono">{doc.engine.model}{doc.engine.cached ? ' · cached' : ''}</span> : <span className="badge">{doc.engine.used}</span>}
              {doc.engine.ms !== undefined && <span className="badge mono">{(doc.engine.ms / 1000).toFixed(1)} s</span>}
              {doc.engine.total ? <span className="badge ok">{doc.engine.grounded}/{doc.engine.total} grounded</span> : null}
              {doc.meta.ocr && <span className="badge warn">transcribed from image</span>}
              {doc.status !== 'ready' && <span className={`badge ${doc.status === 'failed' ? 'bad' : ''}`}>{doc.status}</span>}
            </div>
            {doc.error && <div className="flag error" style={{ marginTop: 8 }}><span className="mono">✕</span><span>{doc.error}</span></div>}
            {doc.engine.warnings.map((w, i) => <div key={i} className="flag warn" style={{ marginTop: 8 }}><span className="mono">!</span><span>{w}</span></div>)}
          </div>

          {spec && (
            <FieldsEditor
              doc={doc}
              spec={spec}
              onFocus={(f) => f.source && setFocus({ line: f.source.line, quote: f.source.quote })}
            />
          )}
          {!spec && <div className="card card-b muted small">Choose a document type to see its fields.</div>}
        </div>

        <div className="drawer">
          <DocViewer doc={doc} line={focus?.line} quote={focus?.quote} cited={cited} tall />
          <div className="tiny muted" style={{ marginTop: 6 }}>Lines with a faint tint hold an extracted value. Click a field’s line number to jump to it.</div>
        </div>
      </div>
    </div>
  );
}

function FieldsEditor({ doc, spec, onFocus }: { doc: DocRecord; spec: { fields: FieldSpec[]; items: FieldSpec[] }; onFocus: (f: Field) => void }) {
  const { patchDoc } = useWorkspace();
  return (
    <div className="card">
      <div className="card-h"><h2>Extracted values</h2><span className="muted small">Edit any value; the ledger updates immediately</span></div>
      <div className="card-b">
        <table className="tbl">
          <tbody>
            {spec.fields.map((s) => (
              <FieldRow key={s.key} doc={doc} k={s.key} spec={s} onFocus={onFocus} />
            ))}
          </tbody>
        </table>
        {spec.items.length > 0 && (
          <>
            <div className="row" style={{ margin: '16px 0 6px' }}>
              <h3>{doc.kind === 'invoice' ? 'Line items' : doc.kind === 'price_revision' ? 'Price changes' : 'Realisations'}</h3>
              <span className="spacer" />
              <button className="btn sm" onClick={() => patchDoc(doc.id, { addItem: true })}>+ Add</button>
            </div>
            {Array.from({ length: doc.itemCount }, (_, i) => (
              <div key={i} style={{ border: '1px solid var(--rule-2)', borderRadius: 4, marginBottom: 8 }}>
                <div className="row" style={{ padding: '6px 8px', background: 'var(--paper-2)' }}>
                  <span className="kicker">#{i + 1}</span>
                  <span className="spacer" />
                  <button className="btn ghost sm danger" onClick={() => window.confirm('Remove this item?') && patchDoc(doc.id, { removeItem: i })}>Remove</button>
                </div>
                <table className="tbl">
                  <tbody>
                    {spec.items.map((s) => (
                      <FieldRow key={s.key} doc={doc} k={`items.${i}.${s.key}`} spec={s} onFocus={onFocus} />
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
            {doc.itemCount === 0 && <div className="small muted">None found. Add them by hand if the document has them.</div>}
          </>
        )}
      </div>
    </div>
  );
}

function display(f: Field | undefined): string {
  if (!f || f.value === null) return '';
  if (f.type === 'date') return f.value;
  if (f.type === 'hs') return fmtHS(f.value);
  if (f.method === 'manual' && f.raw) return f.raw;
  if (f.type === 'money') {
    const n = Number(f.value);
    if (Number.isFinite(n)) return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4, useGrouping: false });
  }
  return f.value;
}

function FieldRow({ doc, k, spec, onFocus }: { doc: DocRecord; k: string; spec: FieldSpec; onFocus: (f: Field) => void }) {
  const { setField, revertField } = useWorkspace();
  const f = doc.fields[k];
  const [v, setV] = useState(display(f));
  useEffect(() => setV(display(f)), [f?.value, f?.raw]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = v !== display(f);
  const save = () => dirty && setField(doc.id, k, v.trim() === '' ? null : v);
  return (
    <tr>
      <td style={{ width: 150 }} className="small">
        {spec.label}
        {f?.type === 'date' && f.value && <div className="tiny muted">{fmtDate(f.value)}</div>}
      </td>
      <td>
        <div className="row">
          <input
            className={`input${spec.type === 'money' || spec.type === 'number' || spec.type === 'date' || spec.type === 'hs' ? ' mono' : ''}`}
            value={v}
            placeholder={spec.type === 'date' ? 'YYYY-MM-DD or 14-Aug-2025' : ''}
            onChange={(e) => setV(e.target.value)}
            onBlur={save}
            onKeyDown={(e) => e.key === 'Enter' && save()}
          />
        </div>
        {f?.note && f.method !== 'manual' && <div className="tiny" style={{ color: 'var(--warn)', marginTop: 2 }}>{f.note}</div>}
        {f?.alt && (
          <div className="tiny" style={{ marginTop: 2 }}>
            Other reading: <span className="mono">{f.alt.value}</span>{' '}
            <button className="btn ghost sm" onClick={() => setField(doc.id, k, f.alt!.value)}>use</button>
          </div>
        )}
      </td>
      <td style={{ width: 92 }}>{f ? <ConfBadge conf={f.confidence} /> : <span className="tiny muted">—</span>}</td>
      <td style={{ width: 96 }} className="right">
        {f?.source && (
          <button className="btn ghost sm mono" onClick={() => onFocus(f)} title={f.source.quote}>line {f.source.line}</button>
        )}
        {f?.original && <button className="btn ghost sm" title={`Extracted: ${f.original.value ?? '—'}`} onClick={() => revertField(doc.id, k)}>↺</button>}
      </td>
    </tr>
  );
}
