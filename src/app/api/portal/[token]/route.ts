import { z } from 'zod';
import { openRoute, json, body, HttpError } from '@/lib/server/api';
import { uidFromPortalToken, withTenant } from '@/lib/server/tenant';
import { mutate, logEvent } from '@/lib/server/store';
import { buildBuyerLedger } from '@/lib/ledger';
import { todayIso } from '@/lib/engine/dates';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ token: string }> };

const Resp = z.object({
  option: z.enum(['A', 'B', 'C', 'counter']),
  name: z.string().trim().min(2).max(120),
  note: z.string().max(2000).default(''),
  amountUSD: z.number().finite().min(0).max(1e10).nullable().optional(),
});

/** The buyer's answer from the shared response page. */
export const POST = openRoute<Ctx>(async (req, { params }) => {
  const { token } = await params;
  const p = Resp.parse(await body(req));
  const uid = uidFromPortalToken(token);
  if (!uid) throw new HttpError(404, 'This link is no longer active.');
  const out = await withTenant(uid, () => mutate((ws) => {
    const b = Object.values(ws.buyers).find((x) => x.portalToken === token);
    if (!b || !b.portalEnabled) throw new HttpError(404, 'This link is no longer active.');
    const ledger = buildBuyerLedger(ws, b, todayIso());
    const opt = ledger.options.find((o) => o.id === p.option);
    const amount = opt ? opt.amountUSD : p.amountUSD ?? null;
    b.responses.push({ at: new Date().toISOString(), option: p.option, amountUSD: amount, name: p.name, note: p.note });
    if (opt) {
      b.agreedOption = opt.id;
      b.agreedUSD = amount;
      b.stage = 'settled';
    } else {
      b.stage = 'countered';
    }
    b.stageUpdatedAt = new Date().toISOString();
    logEvent(ws, 'portal', `${b.name}: ${p.name} ${opt ? `accepted option ${opt.id} (${opt.title})` : 'sent a counter-proposal'}`, { buyerId: b.id });
    return { option: p.option, amountUSD: amount };
  }));
  return json(out);
});
