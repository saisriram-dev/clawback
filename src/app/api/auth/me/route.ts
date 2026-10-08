import { z } from 'zod';
import { route, openRoute, json, body, HttpError } from '@/lib/server/api';
import { findUser, publicUser, updateUser, checkPassword, sessionFromRequest } from '@/lib/server/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** The signed-in user, or { user: null } when signed out. */
export const GET = openRoute(async (req) => {
  const session = await sessionFromRequest(req);
  const u = session ? await findUser(session.uid) : null;
  return json({ user: u ? publicUser(u) : null });
});

const Patch = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  currentPassword: z.string().optional(),
  newPassword: z.string().min(8, 'Use at least 8 characters').max(200).optional(),
});

/** Update your name or change your password. */
export const PATCH = route(async (req, _ctx, session) => {
  const p = Patch.parse(await body(req));
  const u = await findUser(session.uid);
  if (!u) throw new HttpError(401, 'Your session has expired. Please sign in again.');
  if (p.newPassword) {
    if (u.role === 'guest') throw new HttpError(403, 'Demo accounts cannot set a password. Create a free account instead.');
    if (!p.currentPassword || !checkPassword(p.currentPassword, u.passHash)) throw new HttpError(400, 'Current password is incorrect.');
  }
  const out = await updateUser(u.uid, { name: p.name, password: p.newPassword });
  return json({ user: publicUser(out) });
});
