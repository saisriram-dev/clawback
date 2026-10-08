import { z } from 'zod';
import { route, json, body, HttpError } from '@/lib/server/api';
import { mutate, logEvent } from '@/lib/server/store';
import { mergeBuyers } from '@/lib/server/buyers';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

/** Merge this buyer into another one (e.g. the same company detected under two names). */
export const POST = route<Ctx>(async (req, { params }) => {
  const { id } = await params;
  const { into } = z.object({ into: z.string() }).parse(await body(req));
  await mutate((ws) => {
    if (!ws.buyers[id] || !ws.buyers[into]) throw new HttpError(404, 'Buyer not found.');
    const name = ws.buyers[id].name;
    mergeBuyers(ws, id, into);
    logEvent(ws, 'merge', `${name} merged into ${ws.buyers[into].name}`, { buyerId: into });
  });
  return json({ ok: true, id: into });
});
