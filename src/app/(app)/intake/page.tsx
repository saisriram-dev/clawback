'use client';

import Link from 'next/link';
import { useMemo, useRef, useState } from 'react';
import { useWorkspace } from '@/components/workspace';
import { DOC_KIND_LABEL, type DocKind, type DocRecord } from '@/lib/types';
import { fmtUSD } from '@/lib/engine/money';

const ACCEPT = '.pdf,.eml,.txt,.csv,.tsv,.html,.htm,.docx,.xlsx,.png,.jpg,.jpeg,.webp,.md';
const KINDS: DocKind[] = ['invoice', 'price_revision', 'bank_realization', 'refund_notice', 'other'];

export default function IntakePage() {
  const { ws, portfolio, upload, paste, patchDoc, reread, removeDoc, loadDemo, resetAll, engine } = useWorkspace();
  const [over, setOver] = useState(false);
  const [sending, setSending] = useState(false);
  const [showPaste, setShowPaste] = useState(false);
  const [text, setText] = useState('');
  const [title, setTitle] = useState('');
  const [filter, setFilter] = useState<'all' | 'review' | 'failed'>('all');
  const input = useRef<HTMLInputElement>(null);

  const docs = useMemo(() => Object.values(ws?.documents ?? {}).sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt)), [ws]);
  const buyers = useMemo(() => Object.values(ws?.buyers ?? {}).sort((a, b) => a.name.localeCompare(b.name)), [ws]);
  const gemmaReady = !!engine?.online && !!engine?.modelAvailable;
  if (!ws) return null;

  const needsReview = (d: DocRecord) => d.status === 'ready' && (Object.values(d.fields).some((f) => f.confidence === 'low') || !d.buyerId || d.kind === 'other' || d.engine.warnings.length > 0);
  const shown = docs.filter((d) => (filter === 'all' ? true : filter === 'failed' ? d.status === 'failed' : needsReview(d)));

  const send = async (files: FileList | File[] | null) => {
    if (!files || !files.length) return;
    setSending(true);
    try {
      await upload(Array.from(files));
    } finally {
      setSending(false);
      if (input.current) input.current.value = '';
    }
  };

  const triage = (portfolio?.buyers ?? []).filter((b) => b.route !== 'empty');

  return (
    <div className="stack">
      <div className="row">
        <h1>Intake</h1>
        <span className="spacer" />
        <button className="btn sm" onClick={() => loadDemo('rules')}>Load demo workspace</button>
        {gemmaReady && <button className="btn sm" onClick={() => loadDemo('auto')}>Load demo, read with Gemma</button>}
        {docs.length > 0 && (
          <button className="btn sm danger" onClick={() => confirmReset() && resetAll()}>Clear workspace</button>
        )}
      </div>

      <div
        className={`drop${over ? ' over' : ''}`}
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void send(e.dataTransfer.files);
        }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
      >
        <input ref={input} type="file" multiple accept={ACCEPT} style={{ display: 'none' }} onChange={(e) => void send(e.target.files)} />
        <h2>{sending ? 'Uploading…' : 'Drop documents here, or click to choose'}</h2>
        <div className="small muted">
          Commercial invoices · price-revision emails (.eml) and letters · e-BRC / FIRA / bank statements · CAPE refund confirmations
        </div>
        <div className="tiny muted" style={{ marginTop: 6 }}>
          PDF, EML, DOCX, XLSX, CSV, TXT, HTML{gemmaReady ? ', and photos or scans (read by Gemma)' : ' · photos and scans need the Gemma engine'}
        </div>
      </div>

      <div>
        <button className="btn sm" onClick={() => setShowPaste((v) => !v)}>{showPaste ? 'Hide' : 'Paste an email or message instead'}</button>
        {showPaste && (
          <div className="card card-b" style={{ marginTop: 8 }}>
            <div className="grid2">
              <div>
                <label className="f">Title</label>
                <input className="input" placeholder="e.g. WhatsApp from Dana, 11 Aug 2025" value={title} onChange={(e) => setTitle(e.target.value)} />
              </div>
              <div className="help" style={{ alignSelf: 'end' }}>Copy the full email including the From, Date and Subject lines if you can.</div>
            </div>
            <textarea className="input mono" rows={8} style={{ marginTop: 8 }} placeholder="Paste the email, letter or message text here" value={text} onChange={(e) => setText(e.target.value)} />
            <div className="row" style={{ marginTop: 8 }}>
              <button
                className="btn primary"
                disabled={!text.trim()}
                onClick={async () => {
                  await paste(text, title);
                  setText('');
                  setTitle('');
                }}
              >
                Add document
              </button>
            </div>
          </div>
        )}
      </div>

      {triage.length > 0 && (
        <div className="card">
          <div className="card-h">
            <h2>Importer-of-record triage</h2>
            <span className="muted small">From the Incoterm on each invoice</span>
          </div>
          <div className="tbl-wrap">
            <table className="tbl">
              <tbody>
                {triage.map((b) => (
                  <tr key={b.buyer.id}>
                    <td style={{ width: '28%' }}><Link href={`/buyers/${b.buyer.id}`} style={{ fontWeight: 600 }}>{b.buyer.name}</Link></td>
                    <td style={{ width: 110 }}><span className="badge mono">{b.incoterms.join(' / ') || '—'}</span></td>
                    <td>
                      {b.route === 'claim_direct' ? (
                        <span><span className="badge ok">You can claim directly from CBP</span> <span className="small muted">You were the importer of record. Est. {fmtUSD(b.totals.directClaim, 0)} incl. interest.</span></span>
                      ) : b.route === 'mixed' ? (
                        <span><span className="badge warn">Mixed</span> <span className="small muted">DDP lines go to CBP directly; the rest to the negotiation pack.</span></span>
                      ) : b.route === 'confirm' ? (
                        <span><span className="badge warn">Confirm Incoterm</span> <span className="small muted">Not found on an invoice. Treated as buyer-cleared until you confirm.</span></span>
                      ) : (
                        <span><span className="badge navy">Negotiation pack</span> <span className="small muted">Buyer was the importer of record and received the refund.</span></span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-h">
          <h2>Documents</h2>
          <span className="muted small">{docs.length} total</span>
          <span className="spacer" />
          <div className="seg">
            {(['all', 'review', 'failed'] as const).map((f) => (
              <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>
                {f === 'all' ? 'All' : f === 'review' ? `Needs review (${docs.filter(needsReview).length})` : `Failed (${docs.filter((d) => d.status === 'failed').length})`}
              </button>
            ))}
          </div>
        </div>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>File</th>
                <th>Type</th>
                <th>Buyer</th>
                <th>Read by</th>
                <th className="n">Grounded</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shown.map((d) => (
                <tr key={d.id}>
                  <td style={{ maxWidth: 260 }}>
                    <Link href={`/documents/${d.id}`} style={{ fontWeight: 500, wordBreak: 'break-all' }}>{d.filename}</Link>
                    {d.engine.warnings.length > 0 && <div className="tiny" style={{ color: 'var(--warn)' }}>{d.engine.warnings[0]}</div>}
                  </td>
                  <td>
                    <select className="input" style={{ width: 190 }} value={d.kind} disabled={d.status !== 'ready'} onChange={(e) => patchDoc(d.id, { kind: e.target.value }).then(() => reread(d.id))}>
                      {KINDS.map((k) => <option key={k} value={k}>{DOC_KIND_LABEL[k]}</option>)}
                    </select>
                  </td>
                  <td>
                    <select
                      className="input"
                      style={{ width: 210 }}
                      value={d.buyerId ?? ''}
                      disabled={d.status !== 'ready'}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === '__new') {
                          const name = window.prompt('Buyer company name');
                          if (name && name.trim().length >= 2) void patchDoc(d.id, { newBuyerName: name.trim() });
                        } else void patchDoc(d.id, { buyerId: v || null });
                      }}
                    >
                      <option value="">— not linked —</option>
                      {buyers.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                      <option value="__new">+ New buyer…</option>
                    </select>
                  </td>
                  <td className="small">
                    {d.engine.used === 'gemma' ? <span className="badge navy mono">{d.engine.model}{d.engine.cached ? ' · cached' : ''}</span> : d.engine.used === 'rules' ? <span className="badge">rules</span> : <span className="muted">—</span>}
                  </td>
                  <td className="n small">{d.engine.total ? `${d.engine.grounded}/${d.engine.total}` : '—'}</td>
                  <td>
                    {d.status === 'ready' && <span className="badge ok">ready</span>}
                    {d.status === 'queued' && <span className="badge">queued</span>}
                    {d.status === 'processing' && <span className="badge navy"><span className="spinner" /> reading</span>}
                    {d.status === 'failed' && <span className="badge bad" title={d.error}>failed</span>}
                    {d.status === 'failed' && <div className="tiny" style={{ color: 'var(--bad)', maxWidth: 280 }}>{d.error}</div>}
                  </td>
                  <td className="nowrap right">
                    <Link className="btn sm" href={`/documents/${d.id}`}>Review</Link>{' '}
                    {gemmaReady && <button className="btn sm" title="Read again with Gemma" disabled={d.status === 'processing' || d.status === 'queued'} onClick={() => reread(d.id, 'gemma')}>Re-read</button>}{' '}
                    {!gemmaReady && d.status === 'failed' && <button className="btn sm" onClick={() => reread(d.id)}>Retry</button>}{' '}
                    <button className="btn sm ghost danger" title="Remove" onClick={() => window.confirm(`Remove ${d.filename}?`) && removeDoc(d.id)}>✕</button>
                  </td>
                </tr>
              ))}
              {!shown.length && (
                <tr><td colSpan={7} className="muted" style={{ padding: 20 }}>{docs.length ? 'Nothing in this view.' : 'No documents yet. Drop files above or load the demo workspace.'}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function confirmReset(): boolean {
  return window.confirm('Remove all documents, buyers and negotiation history from this workspace? Settings and your company profile are kept.');
}
