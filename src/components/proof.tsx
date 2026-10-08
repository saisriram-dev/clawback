'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { BuyerLedger, Cell, LedgerLine } from '@/lib/ledger';
import type { LineOverride } from '@/lib/types';
import { useWorkspace } from './workspace';
import { ConfBadge, DocViewer, Flags } from './ui';
import { fmtCell, docLabel } from '@/lib/client';
import { fmtDate } from '@/lib/engine/dates';
import { rateSource } from '@/lib/engine/rates';

export type ColKey =
  | 'invoiceNo' | 'invoiceDate' | 'hs' | 'description' | 'qty' | 'baseline' | 'revised' | 'invoicePrice' | 'customsValue'
  | 'loadDate' | 'entryDate' | 'rate' | 'tariffPaid' | 'absorbed' | 'ratio' | 'interest' | 'refundPrincipal' | 'fairClaim' | 'realized' | 'incoterm';

export const COL_LABEL: Record<ColKey, string> = {
  invoiceNo: 'Invoice number',
  invoiceDate: 'Invoice date',
  hs: 'HS code',
  description: 'Description',
  qty: 'Quantity',
  baseline: 'Baseline price',
  revised: 'Revised price',
  invoicePrice: 'Invoice unit price',
  customsValue: 'Customs value',
  loadDate: 'Loading date',
  entryDate: 'US entry date',
  rate: 'IEEPA rate',
  tariffPaid: 'Tariff paid by buyer',
  absorbed: 'Absorbed by you',
  ratio: 'Absorption ratio',
  interest: 'CBP interest',
  refundPrincipal: 'Refund principal',
  fairClaim: 'Fair claim',
  realized: 'Amount realised',
  incoterm: 'Incoterm',
};

const STEP_FOR: Partial<Record<ColKey, string>> = {
  customsValue: 'Customs value',
  rate: 'IEEPA rate on entry date',
  entryDate: 'IEEPA rate on entry date',
  tariffPaid: 'Tariff paid by buyer',
  absorbed: 'Absorbed by you',
  ratio: 'Absorption ratio',
  interest: 'CBP interest on the refund',
  fairClaim: 'Fair claim',
};

const OVERRIDE_INPUT: Partial<Record<keyof LineOverride, 'money' | 'date' | 'pct'>> = {
  baselinePrice: 'money',
  revisedPrice: 'money',
  customsValue: 'money',
  entryDate: 'date',
  loadDate: 'date',
  ratePct: 'pct',
};

const METHOD_TEXT: Record<string, string> = {
  'gemma+rules': 'Read by Gemma and confirmed by the rules engine',
  gemma: 'Read by Gemma, located on the cited line',
  rules: 'Read by the deterministic rules engine',
  manual: 'Entered or corrected by you',
};

export function ProofPanel({ ledger, lineKey, col, onSelect, onClose }: { ledger: BuyerLedger; lineKey: string; col: ColKey; onSelect: (k: string, c: ColKey) => void; onClose: () => void }) {
  const { ws, setField, revertField, setLine } = useWorkspace();
  const line = [...ledger.lines, ...ledger.directLines].find((l) => l.key === lineKey);
  const cell: Cell | null | undefined = line ? (line[col as keyof LedgerLine] as Cell | null) : null;
  const srcDoc = cell?.src ? ws?.documents[cell.src.docId] : undefined;
  const fieldDoc = cell?.field ? ws?.documents[cell.field.docId] : undefined;
  const field = cell?.field && fieldDoc ? fieldDoc.fields[cell.field.key] : undefined;
  const exhibit = srcDoc ? ledger.exhibits.find((e) => e.docId === srcDoc.id)?.code : undefined;
  const [draft, setDraft] = useState('');
  const [ovDraft, setOvDraft] = useState('');

  useEffect(() => {
    setDraft(field?.raw ?? field?.value ?? (cell?.v !== null && cell?.v !== undefined ? String(cell.v) : ''));
    const ov = cell?.override ? ws?.lineOverrides[lineKey]?.[cell.override] : undefined;
    setOvDraft(ov !== undefined && ov !== null && typeof ov !== 'boolean' ? String(ov) : '');
  }, [lineKey, col, field?.raw, field?.value, cell?.v, cell?.override, ws?.lineOverrides]);

  if (!line || !cell) return null;
  const ovKind = cell.override ? OVERRIDE_INPUT[cell.override] : undefined;
  const ov = ws?.lineOverrides[lineKey] ?? {};
  const stepName = STEP_FOR[col];

  const saveOverride = () => {
    if (!cell.override) return;
    const raw = ovDraft.trim();
    if (!raw) return void setLine(lineKey, { [cell.override]: null });
    if (ovKind === 'date') return void setLine(lineKey, { [cell.override]: raw });
    const n = Number(raw.replace(/[,$%\s]/g, ''));
    if (!Number.isFinite(n)) return;
    void setLine(lineKey, { [cell.override]: n });
  };

  return (
    <div className="card">
      <div className="card-h">
        <div className="kicker">
          {line.exhibit} · invoice {String(line.invoiceNo.v ?? '')} · item {line.itemIndex + 1}
        </div>
        <span className="spacer" />
        <button className="btn ghost sm" onClick={onClose} aria-label="Close">✕</button>
      </div>
      <div className="card-b stack">
        <div>
          <div className="muted small">{COL_LABEL[col]}</div>
          <div className="row" style={{ alignItems: 'baseline', gap: 12 }}>
            <div className="mono" style={{ fontSize: 26, fontWeight: 600, color: 'var(--navy-900)' }}>{fmtCell(cell)}</div>
            <ConfBadge conf={cell.conf} />
          </div>
          <div style={{ marginTop: 4, fontSize: 13.5 }}>
            {cell.src && srcDoc ? (
              <>
                {COL_LABEL[col]} <b className="mono">{fmtCell(cell)}</b>, from {docLabel(srcDoc)}
                {exhibit ? ` (Exhibit ${exhibit})` : ''}, line {cell.src.line}.
              </>
            ) : cell.conf === 'computed' ? (
              <>Computed deterministically. The calculation receipt below shows every input.</>
            ) : cell.conf === 'lookup' ? (
              <>Looked up in the dated IEEPA rate table for India.</>
            ) : cell.conf === 'estimated' ? (
              <>Estimated{cell.note ? `: ${cell.note}` : ''}. Replace it with the actual figure if you have it.</>
            ) : cell.conf === 'manual' ? (
              <>Set by you for this line.</>
            ) : (
              <>Not found in the documents. Enter it below.</>
            )}
          </div>
          {field && <div className="muted small" style={{ marginTop: 2 }}>{METHOD_TEXT[field.method] ?? field.method}{field.note && field.method !== 'manual' ? '' : ''}</div>}
        </div>

        {field?.note && field.confidence === 'low' && <div className="flag warn"><span className="mono">!</span><span>{field.note}</span></div>}
        {field?.alt && (
          <div className="callout">
            <div className="small">
              Other reading: <b className="mono">{field.alt.value}</b> ({field.alt.method === 'rules' ? 'rules engine' : 'Gemma'}
              {field.alt.source ? `, line ${field.alt.source.line}` : ''})
            </div>
            <button className="btn sm" style={{ marginTop: 6 }} onClick={() => setField(cell.field!.docId, cell.field!.key, field.alt!.value)}>Use this value</button>
          </div>
        )}

        {(cell.field || cell.override) && (
          <div className="callout navy">
            {cell.field && (
              <>
                <label className="f">Correct the value in the document</label>
                <div className="row">
                  <input className="input mono" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && setField(cell.field!.docId, cell.field!.key, draft)} />
                  <button className="btn primary" onClick={() => setField(cell.field!.docId, cell.field!.key, draft)}>Save</button>
                </div>
                {field?.original && (
                  <div className="small muted" style={{ marginTop: 6 }}>
                    Extracted value: <span className="mono">{field.original.value ?? '—'}</span>{' '}
                    <button className="btn ghost sm" onClick={() => revertField(cell.field!.docId, cell.field!.key)}>Revert</button>
                  </div>
                )}
                <div className="help">Applies everywhere this document is used. The ledger recalculates instantly.</div>
              </>
            )}
            {cell.override && ovKind && (
              <div style={{ marginTop: cell.field ? 12 : 0 }}>
                <label className="f">{cell.field ? 'Or override for this line only' : `Set ${COL_LABEL[col].toLowerCase()} for this line`}</label>
                <div className="row">
                  <input
                    className="input mono"
                    type={ovKind === 'date' ? 'date' : 'text'}
                    placeholder={ovKind === 'pct' ? 'e.g. 25' : ovKind === 'money' ? 'e.g. 4.20' : ''}
                    value={ovDraft}
                    onChange={(e) => setOvDraft(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && saveOverride()}
                  />
                  <button className="btn" onClick={saveOverride}>Apply</button>
                  {ov[cell.override] !== undefined && (
                    <button className="btn ghost sm" onClick={() => setLine(lineKey, { [cell.override!]: null })}>Clear</button>
                  )}
                </div>
                {col === 'entryDate' && <div className="help">Use the entry date from the buyer’s CBP Form 7501 if they share it. Transit days can be set per buyer in the Profile tab.</div>}
                {col === 'customsValue' && <div className="help">The entered value from the 7501 is the most accurate figure.</div>}
              </div>
            )}
          </div>
        )}

        {(col === 'baseline' || col === 'revised') && line.ior !== 'exporter' && (
          <div>
            <label className="f">How was the discount given?</label>
            <div className="seg">
              <button className={line.discountMode !== 'credit_note' ? 'on' : ''} onClick={() => setLine(lineKey, { discountMode: 'on_invoice' })}>On the invoice</button>
              <button className={line.discountMode === 'credit_note' ? 'on' : ''} onClick={() => setLine(lineKey, { discountMode: 'credit_note' })}>Credit note after shipment</button>
            </div>
            <div className="help">
              {line.discountMode === 'credit_note'
                ? 'Customs value used the original invoice price; the buyer short-paid the difference later.'
                : 'The invoice already carries the revised price, so customs value used it.'}
              {line.revisionExhibit ? ` Price revision: Exhibit ${line.revisionExhibit}.` : ''}
            </div>
          </div>
        )}

        {col === 'rate' && (
          <div>
            <div className="kicker" style={{ marginBottom: 6 }}>Rate table rows applied</div>
            {line.rateComponents.length ? (
              <table className="tbl">
                <tbody>
                  {line.rateComponents.map((c) => {
                    const s = rateSource(c.sourceId);
                    return (
                      <tr key={c.id}>
                        <td>{c.label}{c.note ? <span className="badge" style={{ marginLeft: 6 }}>{c.note}</span> : null}</td>
                        <td className="n">{(c.rate * 100).toFixed(0)}%</td>
                        <td>{s && <a href={s.url} target="_blank" rel="noreferrer">source</a>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <div className="muted small">No IEEPA component applies.</div>
            )}
            <ul className="small" style={{ paddingLeft: 18, color: 'var(--ink-2)' }}>
              {line.rateTrail.map((t, i) => <li key={i}>{t}</li>)}
            </ul>
            <label className="row small" style={{ gap: 6 }}>
              <input type="checkbox" checked={!!ov.exempt} onChange={(e) => setLine(lineKey, { exempt: e.target.checked })} />
              This HTSUS line was exempt from IEEPA duties
            </label>
          </div>
        )}

        {stepName && (
          <div>
            <div className="kicker" style={{ marginBottom: 6 }}>Calculation receipt</div>
            <div className="receipt">
              {line.receipt.map((s, i) => (
                <div key={i} className={`step${s.label === 'Fair claim' ? ' final' : ''}`} style={s.label === stepName ? { background: '#fdf3cf', margin: '0 -8px', padding: '7px 8px' } : undefined}>
                  <div className="lbl">{s.label}</div>
                  <div className="fx">{s.formula}</div>
                  <div className="row">
                    <span className="pl">{s.plugged}</span>
                    <span className="spacer" />
                    <span className="res">= {s.result}</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="row wrap small" style={{ marginTop: 8, gap: 6 }}>
              <span className="muted">Inputs:</span>
              {(['qty', 'baseline', 'revised', 'customsValue', 'entryDate', 'rate'] as ColKey[]).map((k) => (
                <button key={k} className="btn sm" onClick={() => onSelect(lineKey, k)}>{COL_LABEL[k]}</button>
              ))}
            </div>
          </div>
        )}

        <Flags flags={line.flags} />

        {srcDoc && cell.src && (
          <div>
            <div className="row" style={{ marginBottom: 6 }}>
              <div className="kicker">Source · {srcDoc.filename}</div>
              <span className="spacer" />
              <Link className="btn sm" href={`/documents/${srcDoc.id}?line=${cell.src.line}`}>Open</Link>
              <a className="btn sm" href={`/api/documents/${srcDoc.id}/file`} target="_blank" rel="noreferrer">Original file</a>
            </div>
            <DocViewer doc={srcDoc} line={cell.src.line} quote={cell.src.quote} />
            <div className="tiny muted" style={{ marginTop: 4 }}>
              {srcDoc.kind === 'price_revision' && srcDoc.fields['email_date']?.value ? `Dated ${fmtDate(srcDoc.fields['email_date']?.value)} · ` : ''}
              {srcDoc.engine.used === 'gemma' ? `Read by ${srcDoc.engine.model}` : 'Read by rules engine'}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
