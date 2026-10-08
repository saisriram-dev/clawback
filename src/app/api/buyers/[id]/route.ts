import { z } from 'zod';
import { route, json, body, HttpError } from '@/lib/server/api';
import { mutate, logEvent, newToken } from '@/lib/server/store';
import { isIsoDate } from '@/lib/engine/dates';
import { STAGE_LABEL } from '@/lib/types';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

const money = z.number().finite().min(0).max(1e10).nullable();

const Patch = z
  .object({
    name: z.string().trim().min(2).max(120),
    country: z.string().max(80).nullable(),
    address: z.string().max(300).nullable(),
    contactName: z.string().max(120).nullable(),
    contactEmail: z.string().max(200).nullable(),
    revenueSharePct: z.number().finite().min(0).max(100).nullable(),
    relationshipSinceYear: z.number().int().min(1950).max(2100).nullable(),
    openOrders: z.boolean().nullable(),
    stage: z.enum(['drafted', 'sent', 'countered', 'settled']),
    agreedOption: z.enum(['A', 'B', 'C']).nullable(),
    agreedUSD: money,
    recoveredUSD: money,
    refundConfirmedDate: z.string().nullable().refine((v) => v === null || isIsoDate(v), 'must be YYYY-MM-DD'),
    refundConfirmedUSD: money,
    refundConfirmedInterestUSD: money,
    transitDays: z.number().int().min(1).max(120).nullable(),
    notes: z.string().max(5000),
    portalEnabled: z.boolean(),
    rotateToken: z.boolean(),
  })
  .partial();

export const PATCH = route<Ctx>(async (req, { params }) => {
  const { id } = await params;
  const p = Patch.parse(await body(req));
  const b = await mutate((ws) => {
    const b = ws.buyers[id];
    if (!b) throw new HttpError(404, 'Buyer not found.');
    const { rotateToken, ...rest } = p;
    if (rest.stage && rest.stage !== b.stage) {
      b.stageUpdatedAt = new Date().toISOString();
      logEvent(ws, 'stage', `${b.name} moved to ${STAGE_LABEL[rest.stage]}`, { buyerId: id });
    }
    Object.assign(b, rest);
    if (rotateToken) b.portalToken = newToken();
    return b;
  });
  return json(b);
});

export const DELETE = route<Ctx>(async (_req, { params }) => {
  const { id } = await params;
  await mutate((ws) => {
    if (!ws.buyers[id]) throw new HttpError(404, 'Buyer not found.');
    for (const d of Object.values(ws.documents)) if (d.buyerId === id) d.buyerId = null;
    delete ws.buyers[id];
  });
  return json({ ok: true });
});
