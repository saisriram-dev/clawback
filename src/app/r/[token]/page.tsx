import { readWorkspace, emptyWorkspace } from '@/lib/server/store';
import { uidFromPortalToken, withTenant } from '@/lib/server/tenant';
import { buildBuyerLedger } from '@/lib/ledger';
import { todayIso, fmtDate } from '@/lib/engine/dates';
import { fmtPct, fmtUSD } from '@/lib/engine/money';
import { Respond } from './respond';
import './portal.css';

export const dynamic = 'force-dynamic';

export async function generateMetadata() {
  return { title: 'Settlement proposal', robots: { index: false, follow: false } };
}

export default async function Portal({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const uid = uidFromPortalToken(token);
  const ws = uid ? await withTenant(uid, () => readWorkspace()) : emptyWorkspace();
  const buyer = Object.values(ws.buyers).find((b) => b.portalToken === token);
  if (!buyer || !buyer.portalEnabled) {
    return (
      <div className="portal">
        <div className="p-card"><h1>This link is not active</h1><p>Please contact your supplier for an updated link.</p></div>
      </div>
    );
  }
  const L = buildBuyerLedger(ws, buyer, todayIso());
  const lines = L.lines.filter((l) => !l.excluded);
  const byInvoice = new Map<string, { date: string; duty: number; absorbed: number; share: number }>();
  for (const l of lines) {
    const k = String(l.invoiceNo.v ?? '—');
    const cur = byInvoice.get(k) ?? { date: String(l.invoiceDate.v ?? ''), duty: 0, absorbed: 0, share: 0 };
    cur.duty += (l.tariffPaid.v as number) || 0;
    cur.absorbed += (l.absorbed.v as number) || 0;
    cur.share += (l.fairClaim.v as number) || 0;
    byInvoice.set(k, cur);
  }
  const last = buyer.responses.at(-1);
  const t = L.totals;
  return (
    <div className="portal">
      <div className="p-head">
        <div className="p-from">{ws.company.name}</div>
        <div className="p-sub">Proposal to reconcile tariff-related price concessions · prepared for {buyer.name}</div>
      </div>
      <div className="p-card">
        <h1>{fmtUSD(t.fairClaim)}</h1>
        <p className="p-lead">
          In 2025 {ws.company.name} reduced its prices so that {buyer.name} could absorb the IEEPA duty on Indian goods. Those duties are now being refunded to {buyer.name} with interest. The price reductions paid for <b>{fmtPct(t.ratio)}</b> of the duty, and this is the matching share of the refund.
        </p>
        <table className="p-tbl">
          <thead><tr><th>Invoice</th><th>Date</th><th className="n">Duty paid</th><th className="n">Our price reduction</th><th className="n">Share of refund</th></tr></thead>
          <tbody>
            {[...byInvoice.entries()].map(([k, v]) => (
              <tr key={k}><td className="mono">{k}</td><td>{fmtDate(v.date)}</td><td className="n">{fmtUSD(v.duty)}</td><td className="n">{fmtUSD(v.absorbed)}</td><td className="n">{fmtUSD(v.share)}</td></tr>
            ))}
          </tbody>
          <tfoot><tr><td colSpan={2}>Total</td><td className="n">{fmtUSD(t.tariffPaid)}</td><td className="n">{fmtUSD(t.absorbed)}</td><td className="n">{fmtUSD(t.fairClaim)}</td></tr></tfoot>
        </table>
        <p className="p-note">Share of refund = (our price reduction ÷ duty paid) × (refund + CBP interest). The full ledger with source documents is in the claim pack sent to you.</p>
      </div>

      {last ? (
        <div className="p-card p-done">
          <h2>Thank you, {last.name}.</h2>
          <p>
            {last.option === 'counter'
              ? `Your counter-proposal has been sent to ${ws.company.name}.`
              : `You selected option ${last.option}${last.amountUSD !== null ? ` (${fmtUSD(last.amountUSD)})` : ''}. ${ws.company.name} will follow up with the paperwork.`}
          </p>
        </div>
      ) : (
        <Respond token={token} options={L.options.map((o) => ({ id: o.id, title: o.title, amountUSD: o.amountUSD, summary: o.summary, terms: o.terms }))} exporter={ws.company.name} />
      )}
      <div className="p-foot">Sent via ClawBack on behalf of {ws.company.name}. This is a commercial proposal, not a legal demand.</div>
    </div>
  );
}
