import { headers } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { readWorkspace } from '@/lib/server/store';
import { sessionFromCookies } from '@/lib/server/auth';
import { withTenant } from '@/lib/server/tenant';
import { buildBuyerLedger, type Cell, type LedgerLine } from '@/lib/ledger';
import { todayIso, fmtDate, fmtDateLong, addDays } from '@/lib/engine/dates';
import { fmtINR, fmtPct, fmtPrice, fmtUSD, usdToInr } from '@/lib/engine/money';
import { fmtHS } from '@/lib/engine/normalize';
import { rateSource } from '@/lib/engine/rates';
import { DOC_KIND_LABEL, type DocRecord } from '@/lib/types';
import { PrintButton } from './print-button';
import './pack.css';

export const dynamic = 'force-dynamic';

export default async function ClaimPack({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await sessionFromCookies();
  if (!session) redirect(`/login?next=/claim/${encodeURIComponent(id)}`);
  const ws = await withTenant(session.uid, () => readWorkspace());
  const buyer = ws.buyers[id];
  if (!buyer) {
    return (
      <div className="pack-missing">
        Buyer not found. <Link href="/">Back to ClawBack</Link>
      </div>
    );
  }
  const today = todayIso();
  const L = buildBuyerLedger(ws, buyer, today);
  const lines = L.lines.filter((l) => !l.excluded);
  const fx = ws.settings.fxUsdInr;
  const c = ws.company;
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  const proto = h.get('x-forwarded-proto') ?? 'http';
  const portal = `${proto}://${host}/r/${buyer.portalToken}`;
  const t = L.totals;
  const invoices = [...new Set(lines.map((l) => String(l.invoiceNo.v ?? '')))].filter(Boolean);
  const dates = lines.map((l) => (typeof l.invoiceDate.v === 'string' ? l.invoiceDate.v : '')).filter(Boolean).sort();
  const revEx = [...new Set(lines.map((l) => l.revisionExhibit).filter(Boolean))] as string[];
  const ref = `CB/${buyer.name.replace(/[^A-Za-z]/g, '').slice(0, 4).toUpperCase()}/${today.replace(/-/g, '')}`;
  const greeting = buyer.contactName ? `Dear ${buyer.contactName.split(' ')[0]},` : 'Dear Sir or Madam,';
  const respondBy = addDays(today, 14);
  const incoterms = L.incoterms.filter((x) => x !== 'DDP').join('/') || 'FOB';
  const exhibitByDoc = new Map(L.exhibits.map((e) => [e.docId, e.code]));
  const exOf = (cell: Cell | null | undefined) => (cell?.src ? exhibitByDoc.get(cell.src.docId) ?? '' : '');

  // Lines cited per document, for the evidence annex
  const cited = new Map<string, Map<number, string>>();
  const cite = (cell: Cell | null | undefined, label: string) => {
    if (!cell?.src) return;
    const m = cited.get(cell.src.docId) ?? new Map<number, string>();
    if (!m.has(cell.src.line)) m.set(cell.src.line, label);
    cited.set(cell.src.docId, m);
  };
  for (const l of lines) {
    cite(l.invoiceNo, 'Invoice number');
    cite(l.qty, 'Quantity and price');
    cite(l.baseline, 'Baseline price');
    cite(l.revised, 'Revised price');
    cite(l.incoterm, 'Incoterm');
    cite(l.loadDate, 'Shipment date');
    if (l.realized) cite(l.realized, 'Amount realised');
  }
  if (L.tariffMention?.src) {
    const m = cited.get(L.tariffMention.src.docId) ?? new Map<number, string>();
    m.set(L.tariffMention.src.line, 'Reason given for the price change');
    cited.set(L.tariffMention.src.docId, m);
  }

  const optionC = L.options.find((o) => o.id === 'C');

  return (
    <div className="pack">
      <div className="pack-toolbar no-print">
        <Link href={`/buyers/${buyer.id}`}>← Back to {buyer.name}</Link>
        <span style={{ flex: 1 }} />
        <span className="pack-hint">A4 · tick “Background graphics” for exhibit stamps</span>
        <PrintButton />
      </div>

      {/* ---------------- Cover letter ---------------- */}
      <section className="sheet">
        <header className="letterhead">
          <div className="lh-name">{c.name}</div>
          <div className="lh-meta">
            {c.address}
            {c.iec && <> · IEC {c.iec}</>}
            {c.gstin && <> · GSTIN {c.gstin}</>}
            {(c.email || c.phone) && <><br />{[c.email, c.phone].filter(Boolean).join(' · ')}</>}
          </div>
        </header>
        <div className="meta-row">
          <div>
            <div>{fmtDateLong(today)}</div>
            <div className="mono small">Ref: {ref}</div>
          </div>
        </div>
        <div className="to">
          <div><b>{buyer.name}</b></div>
          {buyer.address && <div>{buyer.address}</div>}
          {buyer.contactName && <div>Attn: {buyer.contactName}</div>}
        </div>
        <div className="subject">Subject: Reconciliation of tariff-related price concessions following the IEEPA duty refund</div>
        <div className="letter">
          <p>{greeting}</p>
          <p>
            Between {fmtDate(dates[0])} and {fmtDate(dates.at(-1))} we shipped {invoices.length} invoice{invoices.length === 1 ? '' : 's'} to {buyer.name} on {incoterms} terms. When the IEEPA tariffs on Indian goods took effect in August 2025, we agreed to reduce our prices{revEx.length ? ` (Exhibit ${revEx.join(', ')})` : ''} so that you could carry part of the new duty.
          </p>
          <p>
            On 20 February 2026 the US Supreme Court held that IEEPA does not authorise tariffs, and CBP is refunding those duties, with interest, to the importer of record through its CAPE process. As importer of record on these shipments, {buyer.name} {L.clock.window.basis === 'confirmed' ? 'has received' : 'is receiving'} a refund of about {fmtUSD(t.refundPrincipal, 0)} plus interest.
          </p>
          <p>
            Our price reductions paid for <b>{fmtPct(t.ratio)}</b> of that duty ({fmtUSD(t.absorbed)} of {fmtUSD(t.tariffPaid)}). We are asking to reconcile that share: <b>{fmtUSD(t.fairClaim)}</b>, including the proportional CBP interest. The enclosed ledger shows the calculation line by line, and every figure is tied to an exhibit.
          </p>
          <p>
            To make this simple, we have set out three ways to settle on page 2. Option C, a credit applied against your next order, needs no separate payment. You can reply by selecting an option at the link below, or by email, and we would appreciate your response by {fmtDateLong(respondBy)}.
          </p>
          <p>We value our partnership and look forward to continuing it on fair terms for both sides.</p>
          <p className="sign">
            Yours sincerely,
            <br />
            <br />
            <b>{c.signatoryName || '________________'}</b>
            <br />
            {c.signatoryTitle}, {c.name}
          </p>
        </div>
        <div className="encl">
          <b>Enclosed:</b> 1. Summary and settlement options · 2. Absorption ledger · 3. Method · 4. Evidence annex (Exhibits A-1 to A-{L.exhibits.length})
          <div className="mono small">Respond online: {portal}</div>
        </div>
      </section>

      {/* ---------------- Summary + settlement ---------------- */}
      <section className="sheet">
        <h2 className="sec">1. Summary</h2>
        <table className="kv">
          <tbody>
            <tr><td>Invoices covered</td><td className="mono">{invoices.join(', ')}</td></tr>
            <tr><td>Shipment period</td><td>{fmtDate(dates[0])} – {fmtDate(dates.at(-1))}</td></tr>
            <tr><td>Delivery terms</td><td>{incoterms} (buyer was importer of record)</td></tr>
            <tr><td>IEEPA duty paid by {buyer.name}</td><td className="mono">{fmtUSD(t.tariffPaid)}</td></tr>
            <tr><td>Our price reductions applied to that duty</td><td className="mono">{fmtUSD(t.absorbed)}</td></tr>
            <tr><td>Share of the duty we funded</td><td className="mono">{fmtPct(t.ratio, 2)}</td></tr>
            <tr><td>Refund to {buyer.name} ({L.clock.window.basis})</td><td className="mono">{fmtUSD(t.refundPrincipal)} + {fmtUSD(t.interest)} interest</td></tr>
            <tr className="total"><td>Our fair share</td><td className="mono">{fmtUSD(t.fairClaim)} <span className="muted">({fmtINR(usdToInr(t.fairClaim, fx))} at ₹{fx.toFixed(2)})</span></td></tr>
          </tbody>
        </table>

        <h2 className="sec">2. Settlement options</h2>
        <div className="opts">
          {L.options.map((o) => (
            <div key={o.id} className={`opt${o.id === 'C' ? ' rec' : ''}`}>
              <div className="opt-id">Option {o.id}</div>
              <div className="opt-title">{o.title}</div>
              <div className="opt-amt mono">{fmtUSD(o.amountUSD)}</div>
              <div className="opt-sum">{o.summary}</div>
              <ul>{o.terms.map((x) => <li key={x}>{x}</li>)}</ul>
              {o.installments && o.installments.length > 1 && <div className="mono tiny">{o.installments.map((x) => `${x.label}: ${fmtUSD(x.amountUSD)}`).join(' · ')}</div>}
            </div>
          ))}
        </div>
        <p className="small">Select an option at <span className="mono">{portal}</span> or reply to this letter.{optionC ? ` Option C keeps the settlement inside our ongoing business.` : ''}</p>
      </section>

      {/* ---------------- Ledger ---------------- */}
      <section className="sheet wide">
        <h2 className="sec">3. Absorption ledger</h2>
        <table className="ledger-p">
          <thead>
            <tr>
              <th>Invoice</th><th>Date</th><th>HS code</th><th className="n">Qty</th><th className="n">Baseline</th><th className="n">Revised</th><th className="n">Customs value</th><th>Entry*</th><th className="n">Rate</th><th className="n">Duty paid</th><th className="n">Absorbed</th><th className="n">Ratio</th><th className="n">Fair share</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <LedgerRow key={l.key} l={l} exOf={exOf} />
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={6}>Total</td>
              <td className="n">{fmtUSD(t.customsValue)}</td>
              <td /><td />
              <td className="n">{fmtUSD(t.tariffPaid)}</td>
              <td className="n">{fmtUSD(t.absorbed)}</td>
              <td className="n">{fmtPct(t.ratio)}</td>
              <td className="n">{fmtUSD(t.fairClaim)}</td>
            </tr>
          </tfoot>
        </table>
        <p className="tiny">Superscripts are exhibit numbers. *Entry dates marked “est.” are the loading date plus {buyer.transitDays ?? ws.settings.transitDaysDefault} days’ transit; we will use your actual entry dates from CBP Form 7501 if you share them. Fair share = ratio × (duty refunded + CBP interest at the IRS overpayment rate, compounded daily).</p>
      </section>

      {/* ---------------- Method ---------------- */}
      <section className="sheet">
        <h2 className="sec">4. Method</h2>
        <ol className="method">
          <li><b>Duty paid</b> = customs value × IEEPA rate on the entry date. India: 10% baseline from 5 Apr 2025; 25% from 7 Aug 2025; plus 25% additional duty from 27 Aug 2025 to 6 Feb 2026; no IEEPA duty on entries from 24 Feb 2026. In-transit exceptions applied where the loading date qualifies.</li>
          <li><b>Absorbed</b> = (baseline price − revised price) × quantity, never more than the duty paid on that line.</li>
          <li><b>Ratio</b> = absorbed ÷ duty paid.</li>
          <li><b>Fair share</b> = ratio × (refund + CBP interest). The rest of the refund stays with {buyer.name}.</li>
        </ol>
        <div className="small">Rate sources:</div>
        <ul className="small">
          {[...new Set(lines.flatMap((l) => l.rateComponents.map((c) => c.sourceId)))].map((sid) => {
            const s = rateSource(sid);
            return s ? <li key={sid}>{s.title}</li> : null;
          })}
        </ul>
      </section>

      {/* ---------------- Evidence annex ---------------- */}
      <section className="sheet">
        <h2 className="sec">5. Evidence annex</h2>
        {L.exhibits.map((e) => {
          const d = ws.documents[e.docId];
          const marks = cited.get(e.docId);
          return (
            <div key={e.docId} className="exhibit">
              <div className="ex-head">
                <span className="stamp-p">EXHIBIT {e.code}</span>
                <div>
                  <div className="ex-title">{e.title}</div>
                  <div className="tiny muted">{DOC_KIND_LABEL[e.kind]} · {e.filename}{e.date ? ` · ${fmtDate(e.date)}` : ''}</div>
                </div>
              </div>
              {d && <Excerpt doc={d} marks={marks} />}
            </div>
          );
        })}
        <footer className="pack-foot">
          Prepared with ClawBack on {fmtDateLong(today)}. Negotiation support, not legal advice. Figures are calculated deterministically from the exhibits; estimates are marked.
        </footer>
      </section>
    </div>
  );
}

function LedgerRow({ l, exOf }: { l: LedgerLine; exOf: (c: Cell | null | undefined) => string }) {
  const sup = (c: Cell | null | undefined) => {
    const x = exOf(c);
    return x ? <sup>{x}</sup> : null;
  };
  return (
    <tr>
      <td className="mono">{String(l.invoiceNo.v ?? '—')}{sup(l.invoiceNo)}</td>
      <td>{fmtDate(l.invoiceDate.v as string)}</td>
      <td className="mono">{fmtHS(l.hs.v as string)}</td>
      <td className="n">{typeof l.qty.v === 'number' ? l.qty.v.toLocaleString('en-US') : '—'}</td>
      <td className="n">{fmtPrice(l.baseline.v as number)}{sup(l.baseline)}</td>
      <td className="n">{fmtPrice(l.revised.v as number)}{sup(l.revised)}</td>
      <td className="n">{fmtUSD(l.customsValue.v as number)}</td>
      <td>{fmtDate(l.entryDate.v as string)}{l.entryDate.conf === 'estimated' ? ' est.' : ''}</td>
      <td className="n">{fmtPct(l.rate.v as number, 0)}</td>
      <td className="n">{fmtUSD(l.tariffPaid.v as number)}</td>
      <td className="n">{fmtUSD(l.absorbed.v as number)}</td>
      <td className="n">{fmtPct(l.ratio.v as number)}</td>
      <td className="n b">{fmtUSD(l.fairClaim.v as number)}</td>
    </tr>
  );
}

function Excerpt({ doc, marks }: { doc: DocRecord; marks?: Map<number, string> }) {
  const n = doc.lines.length;
  if (!n) return null;
  // Short documents in full; longer ones as cited lines with one line of context.
  let show: number[];
  if (n <= 30 || !marks?.size) show = Array.from({ length: Math.min(n, 30) }, (_, i) => i + 1);
  else {
    const set = new Set<number>();
    for (const ln of marks.keys()) for (let k = ln - 1; k <= ln + 1; k++) if (k >= 1 && k <= n) set.add(k);
    show = [...set].sort((a, b) => a - b);
  }
  let prev = 0;
  return (
    <div className="excerpt">
      {show.map((ln) => {
        const gap = prev > 0 && ln > prev + 1;
        prev = ln;
        const label = marks?.get(ln);
        return (
          <div key={ln}>
            {gap && <div className="gap">⋯</div>}
            <div className={`xl${label ? ' hl' : ''}`}>
              <span className="xn">{ln}</span>
              <span className="xt">{doc.lines[ln - 1].text || ' '}</span>
              {label && <span className="xlab">{label}</span>}
            </div>
          </div>
        );
      })}
      {n > 30 && !marks?.size && <div className="gap">⋯ {n - 30} more lines in the original document</div>}
    </div>
  );
}
