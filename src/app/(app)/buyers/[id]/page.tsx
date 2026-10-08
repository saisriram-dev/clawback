'use client';

import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useWorkspace } from '@/components/workspace';
import { InterestTicker } from '@/components/ticker';
import { NumCell, Flags, Bar, Labeled } from '@/components/ui';
import { ProofPanel, type ColKey } from '@/components/proof';
import type { BuyerLedger, Cell, LedgerLine } from '@/lib/ledger';
import { fmtINR, fmtINRShort, fmtPct, fmtUSD, usdToInr } from '@/lib/engine/money';
import { fmtDate, fmtMonth } from '@/lib/engine/dates';
import { STAGES, STAGE_LABEL, DOC_KIND_LABEL, type Buyer, type Stage } from '@/lib/types';
import { LEVERAGE_WEIGHTS } from '@/lib/engine/leverage';
import { docLabel } from '@/lib/client';

type Tab = 'ledger' | 'negotiation' | 'documents' | 'profile';

export default function BuyerPage() {
  return (
    <Suspense fallback={<div className="muted">Loading…</div>}>
      <BuyerWorkbench />
    </Suspense>
  );
}

function BuyerWorkbench() {
  const { id } = useParams<{ id: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const { ws, portfolio, patchBuyer, setLine, loading } = useWorkspace();
  const [tab, setTab] = useState<Tab>((search.get('tab') as Tab) || 'ledger');
  const [sel, setSel] = useState<{ k: string; c: ColKey } | null>(null);

  const ledger = useMemo(() => portfolio?.buyers.find((b) => b.buyer.id === id) ?? null, [portfolio, id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setSel(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (loading && !ws) return <div className="muted">Loading…</div>;
  if (!ws) return null;
  if (!ledger) {
    return (
      <div className="card card-b">
        Buyer not found. <Link href="/buyers">All buyers</Link>
      </div>
    );
  }

  const b = ledger.buyer;
  const fx = ws.settings.fxUsdInr;
  const t = ledger.totals;
  const select = (k: string, c: ColKey) => setSel({ k, c });
  const isSel = (l: LedgerLine, c: ColKey) => sel?.k === l.key && sel.c === c;

  return (
    <div>
      <div className="buyer-h">
        <div>
          <div className="kicker"><Link href="/buyers">Buyers</Link> /</div>
          <h1>{b.name}</h1>
          <div className="small muted">
            {[b.address, b.contactName && `${b.contactName}${b.contactEmail ? ` <${b.contactEmail}>` : ''}`].filter(Boolean).join(' · ') || 'Add address and contact in the Profile tab'}
          </div>
          <div className="row wrap" style={{ marginTop: 8 }}>
            <RouteBadge ledger={ledger} />
            <span className="badge mono">{ledger.incoterms.join(' / ') || 'Incoterm ?'}</span>
            <span className="badge">Leverage {ledger.leverage.score}/100</span>
            {ledger.clock.window.basis === 'confirmed' && <span className="badge ok">Refund confirmed {fmtDate(ledger.clock.window.likely)}</span>}
          </div>
        </div>
        <span className="spacer" />
        <div className="row">
          <select className="input" style={{ width: 150 }} value={b.stage} onChange={(e) => patchBuyer(b.id, { stage: e.target.value as Stage })}>
            {STAGES.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
          </select>
          {ledger.route !== 'claim_direct' && (
            <a className="btn primary" href={`/claim/${b.id}`} target="_blank" rel="noreferrer">Claim pack ↗</a>
          )}
        </div>
      </div>

      {ledger.route === 'claim_direct' ? (
        <div className="callout ok" style={{ marginBottom: 16 }}>
          <b>{ledger.decision.headline}.</b> {ledger.decision.detail} Estimated refund: <b className="mono">{fmtUSD(t.directClaim)}</b> ({fmtINR(t.directClaimINR)}) including CBP interest.
        </div>
      ) : (
        <div className="kpi-strip">
          <div className="kpi">
            <div className="kicker">Duty paid by buyer</div>
            <div className="v">{fmtUSD(t.tariffPaid, 0)}</div>
            <div className="s">{t.lines} lines · customs value {fmtUSD(t.customsValue, 0)}</div>
          </div>
          <div className="kpi">
            <div className="kicker">Absorbed by you</div>
            <div className="v">{fmtUSD(t.absorbed, 0)}</div>
            <div className="s">(baseline − revised) × qty, capped at duty</div>
          </div>
          <div className="kpi">
            <div className="kicker">Absorption ratio</div>
            <div className="v">{fmtPct(t.ratio)}</div>
            <div className="s">share of their refund your discount paid for</div>
          </div>
          <div className="kpi">
            <div className="kicker">Fair claim</div>
            <div className="v" style={{ color: 'var(--accent-ink)' }}>{fmtINRShort(t.fairClaimINR)}</div>
            <div className="s">{fmtUSD(t.fairClaim)} incl. {fmtUSD(t.interest * t.ratio, 0)} interest share</div>
          </div>
          <div className="kpi">
            <div className="kicker">Refund clock</div>
            <div className="v">{ledger.clock.landed ? `${ledger.clock.daysHeld} days` : '—'}</div>
            <div className="s">{ledger.clock.landed ? `held since ~${fmtDate(ledger.clock.window.likely)}` : `expected ~${fmtMonth(ledger.clock.window.likely)}`}</div>
          </div>
        </div>
      )}

      <div className="tabs" role="tablist">
        {(['ledger', 'negotiation', 'documents', 'profile'] as Tab[]).map((k) => (
          <button
            key={k}
            className={tab === k ? 'on' : ''}
            role="tab"
            onClick={() => {
              setTab(k);
              router.replace(`/buyers/${b.id}?tab=${k}`, { scroll: false });
            }}
          >
            {k === 'ledger' ? 'Absorption ledger' : k === 'negotiation' ? 'Negotiation' : k === 'documents' ? 'Exhibits' : 'Profile'}
            {k === 'documents' && <span className="count">{ledger.exhibits.length}</span>}
          </button>
        ))}
      </div>

      {tab === 'ledger' && (
        <div className="stack">
          <Flags flags={ledger.flags} />
          {ledger.lines.length > 0 && (
            <LedgerTable title="Absorption ledger" lines={ledger.lines} select={select} isSel={isSel} setLine={setLine} totals={ledger} />
          )}
          {ledger.directLines.length > 0 && (
            <LedgerTable title="DDP lines: claim directly from CBP" lines={ledger.directLines} select={select} isSel={isSel} setLine={setLine} direct />
          )}
          {!ledger.lines.length && !ledger.directLines.length && (
            <div className="card card-b muted">No invoices for this buyer yet. Upload them on the <Link href="/intake">Intake</Link> page.</div>
          )}
          <div className="small muted">
            Click any number to open its source line, see the calculation receipt or correct it. Dots: <span className="dot high" /> verified · <span className="dot medium" /> read · <span className="dot low" /> check · <span className="dot manual" /> edited · <span className="dot estimated" /> estimate / table.
          </div>
        </div>
      )}

      {tab === 'negotiation' && <Negotiation ledger={ledger} fx={fx} />}
      {tab === 'documents' && <Exhibits ledger={ledger} />}
      {tab === 'profile' && <Profile buyer={b} onSave={(body) => patchBuyer(b.id, body)} defaultTransit={ws.settings.transitDaysDefault} />}

      {sel && (
        <>
          <div className="scrim" onClick={() => setSel(null)} />
          <div className="drawer-fixed">
            <ProofPanel ledger={ledger} lineKey={sel.k} col={sel.c} onSelect={select} onClose={() => setSel(null)} />
          </div>
        </>
      )}
    </div>
  );
}

function RouteBadge({ ledger }: { ledger: BuyerLedger }) {
  switch (ledger.route) {
    case 'claim_direct':
      return <span className="badge ok">You were IOR · claim from CBP</span>;
    case 'mixed':
      return <span className="badge warn">Mixed: DDP + buyer-cleared</span>;
    case 'confirm':
      return <span className="badge warn">Confirm Incoterm</span>;
    case 'negotiate':
      return <span className="badge navy">Buyer was IOR · negotiation</span>;
    default:
      return <span className="badge">No invoices</span>;
  }
}

function LedgerTable({
  title,
  lines,
  select,
  isSel,
  setLine,
  totals,
  direct,
}: {
  title: string;
  lines: LedgerLine[];
  select: (k: string, c: ColKey) => void;
  isSel: (l: LedgerLine, c: ColKey) => boolean;
  setLine: (key: string, patch: Record<string, unknown>) => Promise<void>;
  totals?: BuyerLedger;
  direct?: boolean;
}) {
  const N = (l: LedgerLine, c: ColKey, whole = false) => {
    const cell = l[c as keyof LedgerLine] as Cell | null;
    return (
      <NumCell cell={cell} active={isSel(l, c)} onClick={() => select(l.key, c)}>
        {whole && cell && typeof cell.v === 'number' ? fmtUSD(cell.v, 0) : undefined}
      </NumCell>
    );
  };
  return (
    <div className="card">
      <div className="card-h"><h2>{title}</h2><span className="muted small">{lines.length} lines</span></div>
      <div className="tbl-wrap">
        <table className="tbl ledger">
          <thead>
            <tr>
              <th>Invoice · date</th>
              <th>HS code · qty</th>
              <th>{direct ? 'Unit price' : 'Baseline → revised'}</th>
              <th className="n">Customs value</th>
              <th>Rate · US entry</th>
              <th className="n">Duty paid</th>
              {!direct && <th className="n">Absorbed</th>}
              {!direct && <th className="n">Ratio</th>}
              {direct ? <th className="n">CBP interest</th> : <th className="n">Fair claim</th>}
              <th>Bank</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              const worst = l.flags.find((f) => f.level === 'error') ?? l.flags.find((f) => f.level === 'warn');
              return (
                <tr key={l.key} className={l.excluded ? 'excluded' : ''}>
                  <td>
                    {N(l, 'invoiceNo')}
                    <span className="exsup" title={`Exhibit ${l.exhibit}`}>{l.exhibit}</span>
                    <span className="l2">{N(l, 'invoiceDate')}</span>
                  </td>
                  <td>
                    {N(l, 'hs')}
                    <span className="l2">{N(l, 'qty')}<span className="unit">{l.unit}</span></span>
                  </td>
                  <td>
                    {direct ? (
                      N(l, 'revised')
                    ) : (
                      <>
                        {N(l, 'baseline')}
                        <span className="arrow">→</span>
                        {N(l, 'revised')}
                        {l.discountMode === 'credit_note' && <span className="l2 tiny muted">via credit note</span>}
                      </>
                    )}
                  </td>
                  <td className="n">{N(l, 'customsValue', true)}</td>
                  <td>
                    {N(l, 'rate')}
                    <span className="l2">{N(l, 'entryDate')}</span>
                  </td>
                  <td className="n">{N(l, 'tariffPaid', true)}</td>
                  {!direct && <td className="n">{N(l, 'absorbed', true)}</td>}
                  {!direct && <td className="n">{N(l, 'ratio')}</td>}
                  {direct ? <td className="n">{N(l, 'interest')}</td> : <td className="n claim">{N(l, 'fairClaim')}</td>}
                  <td>
                    {l.realized ? (
                      <NumCell cell={l.realized} active={isSel(l, 'realized')} onClick={() => select(l.key, 'realized')} title={`Realised ${fmtUSD(l.realized.v as number)} per the bank document${l.realizedCheck === 'match' ? ', matching the invoice' : ', different from the invoice total'}`}>
                        <span className={`badge ${l.realizedCheck === 'match' ? 'ok' : 'warn'}`}>{l.realizedCheck === 'match' ? '✓ realised' : l.realizedCheck === 'short' ? 'short' : 'over'}</span>
                      </NumCell>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td className="nowrap">
                    {worst && (
                      <button className={`badge ${worst.level === 'error' ? 'bad' : 'warn'}`} style={{ cursor: 'pointer' }} title={worst.text} onClick={() => select(l.key, 'fairClaim')}>
                        {worst.level === 'error' ? '✕' : '!'} {l.flags.filter((f) => f.level !== 'info').length}
                      </button>
                    )}{' '}
                    <button className="btn ghost sm" title={l.excluded ? 'Include this line' : 'Exclude this line from the claim'} onClick={() => setLine(l.key, { excluded: !l.excluded })}>
                      {l.excluded ? '↺' : '⊘'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
          {totals && !direct && (
            <tfoot>
              <tr>
                <td colSpan={3}>Totals</td>
                <td className="n">{fmtUSD(totals.totals.customsValue, 0)}</td>
                <td />
                <td className="n">{fmtUSD(totals.totals.tariffPaid, 0)}</td>
                <td className="n">{fmtUSD(totals.totals.absorbed, 0)}</td>
                <td className="n">{fmtPct(totals.totals.ratio)}</td>
                <td className="n" style={{ color: 'var(--accent-ink)' }}>{fmtUSD(totals.totals.fairClaim)}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

function Negotiation({ ledger, fx }: { ledger: BuyerLedger; fx: number }) {
  const { patchBuyer, toast, ws } = useWorkspace();
  const holdingRate = ws?.settings.holdingRatePct ?? 6;
  const b = ledger.buyer;
  const c = ledger.clock;
  const [origin, setOrigin] = useState('');
  useEffect(() => setOrigin(window.location.origin), []);
  if (ledger.route === 'claim_direct') {
    return <div className="card card-b">This buyer’s shipments were DDP: you were the importer of record, so there is nothing to negotiate. Claim the refund from CBP through CAPE.</div>;
  }
  const portal = `${origin}/r/${b.portalToken}`;
  const first = b.contactName ? b.contactName.split(' ')[0] : null;
  const co = ws?.company;
  const outreach = [
    `${first ? `Hi ${first}` : 'Hello'},`,
    '',
    `Following up on the IEEPA tariff refund for the shipments we sent ${b.name} in 2025. The price reductions we agreed covered about ${Math.round(ledger.totals.ratio * 100)}% of the duty on those entries, so we have put together a short, line-by-line summary with three settlement options, including a credit against your next order.`,
    '',
    `You can review it and choose an option here: ${portal}`,
    '',
    'Happy to talk it through.',
    `${co?.signatoryName || ''}${co?.name ? `, ${co.name}` : ''}`.trim(),
  ].join('\n');
  const waHref = `https://wa.me/?text=${encodeURIComponent(outreach)}`;
  const mailHref = `mailto:${b.contactEmail ?? ''}?subject=${encodeURIComponent(`IEEPA tariff refund: settlement proposal from ${co?.name ?? 'your supplier'}`)}&body=${encodeURIComponent(outreach)}`;
  const angle = Math.min(330, (c.daysHeld / 365) * 360);
  return (
    <div className="stack">
      <div className="grid2">
        <div className="card">
          <div className="card-h"><h2>Refund clock</h2><span className="badge">{c.window.basis === 'confirmed' ? 'confirmed' : 'estimated'}</span></div>
          <div className="card-b">
            <div className="clock">
              <div className="face"><i style={{ transform: `rotate(${angle}deg)` }} /><b /></div>
              <div>
                {c.landed ? (
                  <div style={{ fontFamily: 'var(--serif)', fontSize: 17, color: 'var(--navy-900)' }}>
                    {b.name} has {c.window.basis === 'confirmed' ? '' : 'likely '}held your <b className="mono">{fmtUSD(ledger.totals.fairClaim, 0)}</b> since ~{fmtMonth(c.window.likely)}.
                  </div>
                ) : (
                  <div style={{ fontFamily: 'var(--serif)', fontSize: 17 }}>Refund expected around {fmtDate(c.window.likely)}.</div>
                )}
                <div className="small" style={{ marginTop: 4 }}>
                  Interest accruing to them: <b className="mono">{fmtUSD(c.holdingInterest)}</b> ({c.daysHeld} days at {holdingRate}% p.a.)
                </div>
                {c.landed && b.stage !== 'settled' && <InterestTicker light baseUSD={c.holdingInterest} owedUSD={ledger.totals.fairClaim} ratePct={holdingRate} fx={fx} />}
              </div>
            </div>
            <div className="small muted" style={{ marginTop: 10 }}>{c.window.explanation} Window: {fmtDate(c.window.earliest)} – {fmtDate(c.window.latest)}. If the buyer confirms the date, enter it in the Profile tab.</div>
          </div>
        </div>
        <div className="card">
          <div className="card-h" id="leverage"><h2>Leverage</h2><span className="mono">{ledger.leverage.score}/100</span></div>
          <div className="card-b">
            <table className="tbl">
              <thead><tr><th>Factor</th><th>Input</th><th className="n">Score</th><th className="n">Weight</th></tr></thead>
              <tbody>
                {ledger.leverage.parts.map((p) => (
                  <tr key={p.label}><td>{p.label}</td><td className="small">{p.input}</td><td className="n">{p.score.toFixed(2)}</td><td className="n">{p.weight}</td></tr>
                ))}
              </tbody>
            </table>
            <div className="tiny muted" style={{ marginTop: 6 }}>
              leverage = 100 × ({LEVERAGE_WEIGHTS.years} × years/10 + {LEVERAGE_WEIGHTS.openOrders} × open orders + {LEVERAGE_WEIGHTS.independence} × (1 − revenue share ÷ 50%)). Priority = fair claim × leverage ÷ 100 = <span className="mono">{fmtUSD(ledger.priority, 0)}</span>.
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-h"><h2>Settlement ladder</h2><span className="muted small">Three ways for {b.name} to say yes</span></div>
        <div className="card-b">
          <div className="ladder">
            {ledger.options.map((o) => (
              <div key={o.id} className={`rung${o.id === 'C' ? ' rec' : ''}`}>
                <div className="row"><span className="opt">Option {o.id}</span>{o.id === 'C' && <span className="badge warn">most likely to be accepted</span>}</div>
                <h3>{o.title}</h3>
                <div className="amt">{fmtUSD(o.amountUSD)}</div>
                <div className="small muted mono">{fmtINR(usdToInr(o.amountUSD, fx))}</div>
                <div className="small">{o.summary}</div>
                <ul>{o.terms.map((t) => <li key={t}>{t}</li>)}</ul>
                {o.installments && o.installments.length > 1 && (
                  <div className="tiny muted mono">{o.installments.map((x) => `${x.label}: ${fmtUSD(x.amountUSD)}`).join(' · ')}</div>
                )}
                <div className="why">{o.whyItWorks}</div>
                <button className={`btn sm${b.agreedOption === o.id ? ' primary' : ''}`} onClick={() => patchBuyer(b.id, { agreedOption: o.id, agreedUSD: o.amountUSD, stage: 'settled' })}>
                  {b.agreedOption === o.id ? '✓ Agreed' : 'Record as agreed'}
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-h"><h2>Objection handler</h2><span className="muted small">Rules-based rebuttals built from this buyer’s evidence</span></div>
        <div className="card-b">
          {ledger.objections.map((o) => (
            <details key={o.id} className="obj">
              <summary>
                <span className="q">{o.objection}</span>
                <span className="spacer" />
                <span className={`badge ${o.strength === 'strong' ? 'ok' : o.strength === 'moderate' ? 'warn' : 'bad'}`}>{o.strength} answer</span>
              </summary>
              <div className="body">
                <div className="resp">{o.response}</div>
                <div className="row" style={{ marginBottom: 8 }}>
                  <button className="btn sm" onClick={() => navigator.clipboard.writeText(o.response).then(() => toast('Rebuttal copied.'), () => toast('Copy failed: select the text instead.', true))}>Copy reply</button>
                </div>
                <div className="grid2">
                  <div>
                    <div className="kicker" style={{ marginBottom: 4 }}>Checks</div>
                    {o.checks.map((c) => (
                      <div key={c.label} className={`check ${c.status}`}><span className="m">{c.status === 'pass' ? '✓' : c.status === 'fail' ? '✕' : '?'}</span>{c.label}</div>
                    ))}
                  </div>
                  <div>
                    <div className="kicker" style={{ marginBottom: 4 }}>Evidence</div>
                    {o.evidence.map((e, i) => (
                      <div key={i} className="small" style={{ marginBottom: 6 }}>
                        <b>{e.label}{e.exhibit ? ` (Exhibit ${e.exhibit}${e.src ? `, line ${e.src.line}` : ''})` : ''}:</b>{' '}
                        {e.src ? <Link href={`/documents/${e.src.docId}?line=${e.src.line}`}>“{e.text}”</Link> : e.text}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </details>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="card-h"><h2>Buyer response link</h2><span className="muted small">A clean summary where {b.name} picks an option</span></div>
        <div className="card-b">
          <div className="row">
            <input className="input mono" readOnly value={portal} onFocus={(e) => e.currentTarget.select()} />
            <button className="btn" onClick={() => navigator.clipboard.writeText(portal).then(() => toast('Link copied.'), () => toast('Copy failed.', true))}>Copy</button>
            <a className="btn" href={portal} target="_blank" rel="noreferrer">Preview ↗</a>
          </div>
          <div className="row small" style={{ marginTop: 8 }}>
            <label className="row" style={{ gap: 6 }}>
              <input type="checkbox" checked={b.portalEnabled} onChange={(e) => patchBuyer(b.id, { portalEnabled: e.target.checked })} /> Link active
            </label>
            <button className="btn ghost sm" onClick={() => patchBuyer(b.id, { rotateToken: true })}>Generate a new link</button>
            <span className="muted">Anyone with this link sees only this buyer’s settlement summary, never your other buyers or documents. Generate a new link to revoke the old one.</span>
          </div>
          <div className="callout" style={{ marginTop: 12 }}>
            <div className="row wrap" style={{ marginBottom: 8 }}>
              <b>Send it</b>
              <span className="muted small">A ready-to-send message with the link. Edit it before sending if you like.</span>
              <span className="spacer" />
              <a className="btn wa sm" href={waHref} target="_blank" rel="noreferrer">Share on WhatsApp</a>
              <a className="btn sm" href={mailHref}>Send by email</a>
              <button className="btn sm" onClick={() => navigator.clipboard.writeText(outreach).then(() => toast('Message copied.'), () => toast('Copy failed.', true))}>Copy message</button>
              {b.stage === 'drafted' && <button className="btn sm primary" onClick={() => patchBuyer(b.id, { stage: 'sent' })}>Mark as sent</button>}
            </div>
            <div className="small" style={{ whiteSpace: 'pre-wrap', fontFamily: 'var(--serif)', lineHeight: 1.55 }}>{outreach}</div>
          </div>
          {b.responses.length > 0 && (
            <table className="tbl" style={{ marginTop: 12 }}>
              <thead><tr><th>When</th><th>Who</th><th>Response</th><th className="n">Amount</th><th>Note</th></tr></thead>
              <tbody>
                {b.responses.slice().reverse().map((r, i) => (
                  <tr key={i}>
                    <td className="small">{new Date(r.at).toLocaleString('en-IN')}</td>
                    <td>{r.name}</td>
                    <td>{r.option === 'counter' ? <span className="badge warn">counter-proposal</span> : <span className="badge ok">accepted option {r.option}</span>}</td>
                    <td className="n">{r.amountUSD !== null ? fmtUSD(r.amountUSD) : '—'}</td>
                    <td className="small">{r.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function Exhibits({ ledger }: { ledger: BuyerLedger }) {
  const { ws } = useWorkspace();
  return (
    <div className="card">
      <div className="card-h"><h2>Exhibits</h2><span className="muted small">Numbered as they appear in the claim pack</span></div>
      <table className="tbl">
        <thead><tr><th>Exhibit</th><th>Type</th><th>Document</th><th>Date</th><th>Read by</th><th className="n">Grounded</th><th /></tr></thead>
        <tbody>
          {ledger.exhibits.map((e) => {
            const d = ws?.documents[e.docId];
            return (
              <tr key={e.docId}>
                <td><span className="stamp">{e.code}</span></td>
                <td className="small">{DOC_KIND_LABEL[e.kind]}</td>
                <td>{e.title}<div className="tiny muted">{e.filename}</div></td>
                <td className="small">{fmtDate(e.date)}</td>
                <td className="small">{d?.engine.used === 'gemma' ? d.engine.model : d?.engine.used ?? '—'}</td>
                <td className="n small">{d?.engine.total ? `${d.engine.grounded}/${d.engine.total}` : '—'}</td>
                <td className="right"><Link className="btn sm" href={`/documents/${e.docId}`}>Review</Link></td>
              </tr>
            );
          })}
          {!ledger.exhibits.length && <tr><td colSpan={7} className="muted">No documents.</td></tr>}
        </tbody>
      </table>
      {ledger.exhibits.length > 0 && <div className="card-b tiny muted">Source labels: {ledger.exhibits.map((e) => `${e.code} = ${docLabel(ws?.documents[e.docId])}`).join(' · ')}</div>}
    </div>
  );
}

function Profile({ buyer, onSave, defaultTransit }: { buyer: Buyer; onSave: (b: Partial<Buyer>) => Promise<void>; defaultTransit: number }) {
  const { ws, patchBuyer } = useWorkspace();
  const router = useRouter();
  const [f, setF] = useState(() => toForm(buyer));
  useEffect(() => setF(toForm(buyer)), [buyer]);
  const others = Object.values(ws?.buyers ?? {}).filter((x) => x.id !== buyer.id);
  const num = (v: string) => (v.trim() === '' ? null : Number(v));
  const save = () =>
    onSave({
      name: f.name.trim() || buyer.name,
      address: f.address || null,
      contactName: f.contactName || null,
      contactEmail: f.contactEmail || null,
      revenueSharePct: num(f.revenueSharePct),
      relationshipSinceYear: num(f.relationshipSinceYear),
      openOrders: f.openOrders === '' ? null : f.openOrders === 'yes',
      transitDays: num(f.transitDays),
      refundConfirmedDate: f.refundConfirmedDate || null,
      refundConfirmedUSD: num(f.refundConfirmedUSD),
      refundConfirmedInterestUSD: num(f.refundConfirmedInterestUSD),
      recoveredUSD: num(f.recoveredUSD),
      notes: f.notes,
    });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="grid2">
      <div className="card card-b">
        <h2 style={{ marginBottom: 12 }}>Buyer profile</h2>
        <Labeled label="Company name"><input className="input" value={f.name} onChange={set('name')} /></Labeled>
        <Labeled label="Address"><input className="input" value={f.address} onChange={set('address')} /></Labeled>
        <div className="grid2">
          <Labeled label="Contact name"><input className="input" value={f.contactName} onChange={set('contactName')} /></Labeled>
          <Labeled label="Contact email"><input className="input" value={f.contactEmail} onChange={set('contactEmail')} /></Labeled>
        </div>
        <h3 style={{ margin: '8px 0' }}>Leverage inputs</h3>
        <div className="grid2">
          <Labeled label="Share of your revenue (%)" help="This buyer’s share of your export revenue"><input className="input mono" value={f.revenueSharePct} onChange={set('revenueSharePct')} /></Labeled>
          <Labeled label="Buying from you since (year)"><input className="input mono" value={f.relationshipSinceYear} onChange={set('relationshipSinceYear')} /></Labeled>
        </div>
        <Labeled label="Open orders with you?">
          <select className="input" value={f.openOrders} onChange={set('openOrders')}>
            <option value="">Unknown</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </Labeled>
        <Labeled label="Notes"><textarea className="input" rows={3} value={f.notes} onChange={set('notes')} /></Labeled>
        <button className="btn primary" onClick={save}>Save profile</button>
      </div>
      <div className="stack">
        <div className="card card-b">
          <h2 style={{ marginBottom: 12 }}>Refund and shipping facts</h2>
          <Labeled label="Transit days to US entry" help={`Loading date + this many days estimates the entry date. Default ${defaultTransit}.`}>
            <input className="input mono" placeholder={String(defaultTransit)} value={f.transitDays} onChange={set('transitDays')} />
          </Labeled>
          <Labeled label="Refund received by buyer on" help="If the buyer confirms it. Otherwise ClawBack estimates CAPE + 60–90 days.">
            <input className="input mono" type="date" value={f.refundConfirmedDate} onChange={set('refundConfirmedDate')} />
          </Labeled>
          <div className="grid2">
            <Labeled label="Refund principal (USD)"><input className="input mono" value={f.refundConfirmedUSD} onChange={set('refundConfirmedUSD')} /></Labeled>
            <Labeled label="Refund interest (USD)"><input className="input mono" value={f.refundConfirmedInterestUSD} onChange={set('refundConfirmedInterestUSD')} /></Labeled>
          </div>
          <Labeled label="Amount actually recovered (USD)" help="Fill in when the money arrives; shown on the pipeline.">
            <input className="input mono" value={f.recoveredUSD} onChange={set('recoveredUSD')} />
          </Labeled>
          <button className="btn primary" onClick={save}>Save</button>
        </div>
        {others.length > 0 && (
          <div className="card card-b">
            <h3>Same company under another name?</h3>
            <div className="row" style={{ marginTop: 8 }}>
              <select className="input" id="mergeInto" defaultValue="">
                <option value="" disabled>Merge into…</option>
                {others.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
              <button
                className="btn"
                onClick={async () => {
                  const into = (document.getElementById('mergeInto') as HTMLSelectElement).value;
                  if (!into) return;
                  const res = await fetch(`/api/buyers/${buyer.id}/merge`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ into }) });
                  if (res.ok) router.push(`/buyers/${into}`);
                }}
              >
                Merge
              </button>
            </div>
            <div className="help">Moves all documents to the other buyer and keeps this name as an alias.</div>
          </div>
        )}
        <div className="tiny muted">Stage last changed {new Date(buyer.stageUpdatedAt).toLocaleString('en-IN')}. <button className="btn ghost sm" onClick={() => patchBuyer(buyer.id, { stage: 'drafted', agreedOption: null, agreedUSD: null })}>Reset negotiation</button></div>
      </div>
    </div>
  );
}

function toForm(b: Buyer) {
  const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));
  return {
    name: b.name,
    address: s(b.address),
    contactName: s(b.contactName),
    contactEmail: s(b.contactEmail),
    revenueSharePct: s(b.revenueSharePct),
    relationshipSinceYear: s(b.relationshipSinceYear),
    openOrders: b.openOrders === null ? '' : b.openOrders ? 'yes' : 'no',
    transitDays: s(b.transitDays),
    refundConfirmedDate: s(b.refundConfirmedDate),
    refundConfirmedUSD: s(b.refundConfirmedUSD),
    refundConfirmedInterestUSD: s(b.refundConfirmedInterestUSD),
    recoveredUSD: s(b.recoveredUSD),
    notes: b.notes ?? '',
  };
}
