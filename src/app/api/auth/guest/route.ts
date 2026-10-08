import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { openRoute } from '@/lib/server/api';
import { createUser, sessionFor, cookieOptions, publicUser, checkRate, noteFailure } from '@/lib/server/auth';
import { withTenant } from '@/lib/server/tenant';
import { loadDemoWorkspace } from '@/lib/server/demo';
import { queueState } from '@/lib/server/pipeline';
import { gemmaConfigured } from '@/lib/server/store';
import { SESSION_COOKIE } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * One-click demo: a private, disposable sandbox pre-loaded with the demo exporter.
 * Every visitor (or judge) gets their own copy, so nobody overwrites anyone else.
 */
export const POST = openRoute(async (req) => {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'local';
  checkRate(`guest:${ip}`);
  noteFailure(`guest:${ip}`); // counts towards the limit: at most 8 sandboxes per IP per 15 minutes
  const tag = crypto.randomBytes(4).toString('hex');
  const user = await createUser({
    email: `demo-${tag}@guest.clawback`,
    name: 'Demo visitor',
    company: 'Kaveri Looms Pvt Ltd',
    password: crypto.randomBytes(24).toString('hex'),
    role: 'guest',
  });
  // With Gemma configured, the demo is read by Gemma (results are cached by file, so later sandboxes load instantly).
  await withTenant(user.uid, () => loadDemoWorkspace(gemmaConfigured() ? 'auto' : 'rules'));
  // Wait (up to 30 s) for the rules engine to finish reading, so the visitor lands on a full portfolio.
  const t0 = Date.now();
  while (Date.now() - t0 < 30_000) {
    const q = withTenant(user.uid, () => queueState());
    if (q.pending === 0 && !q.current) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  const { token, maxAge } = await sessionFor(user);
  const res = NextResponse.json({ user: publicUser(user) });
  res.cookies.set(SESSION_COOKIE, token, cookieOptions(maxAge, req));
  return res;
});
