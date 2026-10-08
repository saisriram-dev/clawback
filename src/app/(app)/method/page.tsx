import { INDIA_IEEPA_TIMELINE, RATE_SOURCES } from '@/lib/engine/rates';
import { CBP_OVERPAYMENT_RATES, INTEREST_SOURCE_URL } from '@/lib/engine/interest';
import { CAPE } from '@/lib/engine/refundClock';
import { LEVERAGE_WEIGHTS } from '@/lib/engine/leverage';
import { fmtDate } from '@/lib/engine/dates';

export default function MethodPage() {
  return (
    <div className="stack" style={{ maxWidth: 1000 }}>
      <h1>Method &amp; sources</h1>
      <div className="callout navy">
        <b>AI reads the documents, deterministic code does the math, and a human approves every number.</b> Same input, same output, every time. The extraction engine (Gemma) only locates values and cites the line they are on; a grounding check confirms each value is written on that line before it is used.
      </div>

      <div className="card card-b">
        <h2 style={{ marginBottom: 8 }}>The four formulas</h2>
        <div className="receipt">
          <div className="step"><div className="lbl">Tariff paid by the buyer</div><div className="pl">tariff_paid = customs_value × IEEPA_rate(entry_date, loading_date)</div></div>
          <div className="step"><div className="lbl">Absorbed by you</div><div className="pl">absorbed = min((baseline_price − revised_price) × qty, tariff_paid)</div></div>
          <div className="step"><div className="lbl">Absorption ratio</div><div className="pl">absorption_ratio = absorbed ÷ tariff_paid</div></div>
          <div className="step final"><div className="lbl">Fair claim</div><div className="pl">fair_claim = absorption_ratio × (refund + CBP interest)</div></div>
        </div>
        <ul className="small" style={{ paddingLeft: 18, marginTop: 10, color: 'var(--ink-2)' }}>
          <li><b>Customs value</b> is the invoiced line amount. For C-terms, international freight and insurance are deducted when they are inside the unit price, because US customs value excludes them.</li>
          <li><b>Discount on the invoice vs. credit note:</b> if the discount was given after shipment (credit note or short payment), the customs value used the original price; ClawBack handles both.</li>
          <li><b>Entry date</b> is estimated as loading (B/L) date + transit days unless you enter the actual date from the buyer’s CBP Form 7501.</li>
          <li><b>Refund</b> is the duty paid unless the buyer confirms the actual refund, which is then allocated across lines in proportion to duty paid.</li>
          <li>Money is rounded to cents at every reported step.</li>
        </ul>
      </div>

      <div className="card card-b">
        <h2 style={{ marginBottom: 8 }}>India IEEPA rate table</h2>
        <table className="tbl">
          <thead><tr><th>Component</th><th className="n">Rate</th><th>Entries from</th><th>Entries before</th><th>In-transit exception</th></tr></thead>
          <tbody>
            {INDIA_IEEPA_TIMELINE.map((w) => (
              <tr key={w.id}>
                <td>{w.label}</td>
                <td className="n">{(w.rate * 100).toFixed(0)}%</td>
                <td className="mono small">{fmtDate(w.from)}</td>
                <td className="mono small">{w.to ? fmtDate(w.to) : '—'}</td>
                <td className="small">{w.inTransit ? `Loaded before ${fmtDate(w.inTransit.loadedBefore)} and entered before ${fmtDate(w.inTransit.enteredBefore)}: ${w.inTransit.fallbackRate ? `${w.inTransit.fallbackRate * 100}%` : 'not applied'}` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <ul className="small" style={{ paddingLeft: 18, marginTop: 10, color: 'var(--ink-2)' }}>
          <li>India’s combined rate reached 50% because two separate IEEPA measures applied at once: the 25% reciprocal rate (from 7 Aug 2025) and the additional 25% duty (from 27 Aug 2025).</li>
          <li>The additional 25% was removed for entries from 7 Feb 2026. An 18% reciprocal rate was announced on 2 Feb 2026 but was to apply only once the interim agreement entered into force; ClawBack keeps 25% until IEEPA collection ended.</li>
          <li>The Supreme Court held on 20 Feb 2026 (Learning Resources, Inc. v. Trump) that IEEPA does not authorise tariffs; collection stopped for entries from 24 Feb 2026. Later duties under Section 122 are not IEEPA refunds.</li>
          <li>Annex II goods (e.g. pharmaceuticals, energy, semiconductors), Section 232 goods (steel, aluminium, copper, autos, some wood products) and agricultural lines exempted from 13 Nov 2025 were outside some or all of these duties. ClawBack flags these HS chapters for you to check; it never silently zeroes them.</li>
        </ul>
      </div>

      <div className="grid2">
        <div className="card card-b">
          <h2 style={{ marginBottom: 8 }}>CBP refund interest</h2>
          <p className="small">CBP adds interest to IEEPA refunds under 19 C.F.R. § 24.36 at the IRS overpayment rate, set quarterly. ClawBack compounds daily from the deposit date (entry + deposit lag) to the refund date.</p>
          <table className="tbl">
            <thead><tr><th>Quarter from</th><th className="n">Corporate</th><th className="n">Non-corporate</th></tr></thead>
            <tbody>
              {CBP_OVERPAYMENT_RATES.map((q) => (
                <tr key={q.quarterStart}><td className="mono small">{fmtDate(q.quarterStart)}</td><td className="n">{(q.corporate * 100).toFixed(0)}%</td><td className="n">{(q.nonCorporate * 100).toFixed(0)}%</td></tr>
              ))}
            </tbody>
          </table>
          <div className="tiny muted" style={{ marginTop: 6 }}>Later quarters carry the last published rate forward. <a href={INTEREST_SOURCE_URL} target="_blank" rel="noreferrer">CBP notice, Q3 2026</a></div>
        </div>
        <div className="card card-b">
          <h2 style={{ marginBottom: 8 }}>Refund clock (CAPE)</h2>
          <p className="small">CBP’s Consolidated Administration and Processing of Entries (CAPE) Phase 1 opened on {fmtDate(CAPE.phase1Open)}. CBP expects valid refunds {CAPE.refundLagMinDays}–{CAPE.refundLagMaxDays} days after a declaration is accepted; the first refunds were expected around {fmtDate(CAPE.firstRefundExpected)}. Refunds are paid by ACH to the importer of record.</p>
          <p className="small">ClawBack estimates the landing date as CAPE opening + {CAPE.refundLagMinDays}–{CAPE.refundLagMaxDays} days (likely date: the midpoint) unless the buyer confirms it. Phase 1 covers unliquidated entries and entries within {CAPE.phase1LiquidationGraceDays} days of liquidation.</p>
          <a className="small" href={CAPE.sourceUrl} target="_blank" rel="noreferrer">{CAPE.sourceTitle}</a>
          <h2 style={{ margin: '16px 0 8px' }} id="leverage">Leverage score</h2>
          <p className="small mono">leverage = 100 × ({LEVERAGE_WEIGHTS.years} × min(years ÷ 10, 1) + {LEVERAGE_WEIGHTS.openOrders} × open_orders + {LEVERAGE_WEIGHTS.independence} × (1 − min(revenue_share ÷ 50%, 1)))</p>
          <p className="small">Higher when the relationship is long, the buyer still has orders with you, and you are not over-dependent on them. Buyers are ranked by fair claim × leverage.</p>
        </div>
      </div>

      <div className="card card-b">
        <h2 style={{ marginBottom: 8 }}>Sources</h2>
        <ul className="small" style={{ paddingLeft: 18 }}>
          {RATE_SOURCES.map((s) => <li key={s.id}><a href={s.url} target="_blank" rel="noreferrer">{s.title}</a></li>)}
          <li><a href={CAPE.sourceUrl} target="_blank" rel="noreferrer">{CAPE.sourceTitle}</a></li>
          <li><a href={INTEREST_SOURCE_URL} target="_blank" rel="noreferrer">CBP quarterly interest rates (Federal Register)</a></li>
        </ul>
        <p className="small muted">Facts were checked in October 2026. Tariff and refund rules change; confirm the treatment of your own entries with your customs broker.</p>
      </div>

      <div className="callout">
        <b>Negotiation support, not legal advice.</b> There is no legal mechanism that compels a US importer to share an IEEPA refund with a supplier. ClawBack helps you make a well-documented commercial request.
      </div>
    </div>
  );
}
