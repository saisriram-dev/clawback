import { route } from '@/lib/server/api';
import { readWorkspace } from '@/lib/server/store';
import { buildPortfolio } from '@/lib/ledger';
import { todayIso } from '@/lib/engine/dates';

export const dynamic = 'force-dynamic';

/** Download the workspace and computed ledger as JSON (backup / audit trail). */
export const GET = route(async (req) => {
  const ws = await readWorkspace();
  const url = new URL(req.url);
  const today = todayIso();
  if (url.searchParams.get('format') === 'csv') {
    const p = buildPortfolio(ws, today);
    const head = ['buyer', 'exhibit', 'invoice', 'invoice_date', 'hs_code', 'qty', 'baseline_price', 'revised_price', 'incoterm', 'customs_value', 'entry_date', 'ieepa_rate', 'tariff_paid', 'absorbed', 'absorption_ratio', 'refund_interest', 'fair_claim_usd', 'amount_realised'];
    const esc = (v: unknown) => {
      const s = v === null || v === undefined ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows = p.buyers.flatMap((b) =>
      [...b.lines, ...b.directLines].map((l) =>
        [b.buyer.name, l.exhibit, l.invoiceNo.v, l.invoiceDate.v, l.hs.v, l.qty.v, l.baseline.v, l.revised.v, l.incoterm.v, l.customsValue.v, l.entryDate.v, l.rate.v, l.tariffPaid.v, l.absorbed.v, typeof l.ratio.v === 'number' ? l.ratio.v.toFixed(4) : '', l.interest.v, l.fairClaim.v, l.realized?.v ?? ''].map(esc).join(','),
      ),
    );
    return new Response([head.join(','), ...rows].join('\r\n'), {
      headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="clawback-ledger-${today}.csv"` },
    });
  }
  return new Response(JSON.stringify(ws, null, 2), {
    headers: { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="clawback-workspace-${today}.json"` },
  });
});
