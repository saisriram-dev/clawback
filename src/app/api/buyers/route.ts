import { z } from 'zod';
import { route, json, body } from '@/lib/server/api';
import { mutate } from '@/lib/server/store';
import { newBuyer } from '@/lib/server/buyers';

export const dynamic = 'force-dynamic';

export const POST = route(async (req) => {
  const p = z.object({ name: z.string().trim().min(2).max(120) }).parse(await body(req));
  const b = await mutate((ws) => {
    const nb = newBuyer(p.name);
    ws.buyers[nb.id] = nb;
    return nb;
  });
  return json(b, 201);
});
