import { z } from 'zod';
import { NextResponse } from 'next/server';
import { openRoute, body } from '@/lib/server/api';
import { createUser, sessionFor, cookieOptions, publicUser, checkRate, noteFailure } from '@/lib/server/auth';
import { withTenant } from '@/lib/server/tenant';
import { mutate, ensureDirs } from '@/lib/server/store';
import { SESSION_COOKIE } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Signup = z.object({
  name: z.string().trim().min(2, 'Enter your name').max(80),
  company: z.string().trim().min(2, 'Enter your company name').max(120),
  email: z.string().trim().email('Enter a valid email address').max(160),
  password: z.string().min(8, 'Use at least 8 characters').max(200),
});

/** Create an account with its own private workspace, then sign in. */
export const POST = openRoute(async (req) => {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'local';
  checkRate(`signup:${ip}`);
  const p = Signup.parse(await body(req));
  let user;
  try {
    user = await createUser(p);
  } catch (e) {
    noteFailure(`signup:${ip}`);
    throw e;
  }
  await withTenant(user.uid, async () => {
    await ensureDirs();
    await mutate((ws) => {
      ws.company.name = p.company;
      ws.company.email = p.email;
      ws.company.signatoryName = p.name;
      const dom = p.email.split('@')[1];
      if (dom && !/^(gmail|yahoo|outlook|hotmail|live|icloud|rediffmail|proton)\./i.test(dom)) ws.company.emailDomains = [dom];
    });
  });
  const { token, maxAge } = await sessionFor(user);
  const res = NextResponse.json({ user: publicUser(user) });
  res.cookies.set(SESSION_COOKIE, token, cookieOptions(maxAge, req));
  return res;
});
