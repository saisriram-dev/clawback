import { z } from 'zod';
import { NextResponse } from 'next/server';
import { openRoute, body } from '@/lib/server/api';
import { findUserByEmail, checkPassword, sessionFor, cookieOptions, publicUser, checkRate, noteFailure, clearFailures, touchLogin, AuthError } from '@/lib/server/auth';
import { SESSION_COOKIE } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Login = z.object({ email: z.string().trim().email('Enter a valid email address'), password: z.string().min(1, 'Enter your password') });

export const POST = openRoute(async (req) => {
  const p = Login.parse(await body(req));
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'local';
  const key = `login:${p.email.toLowerCase()}:${ip}`;
  checkRate(key);
  const user = await findUserByEmail(p.email);
  // Same message for unknown email and wrong password, so accounts cannot be enumerated.
  if (!user || user.role === 'guest' || !checkPassword(p.password, user.passHash)) {
    noteFailure(key);
    throw new AuthError('Email or password is incorrect.', 401);
  }
  clearFailures(key);
  await touchLogin(user.uid);
  const { token, maxAge } = await sessionFor(user);
  const res = NextResponse.json({ user: publicUser(user) });
  res.cookies.set(SESSION_COOKIE, token, cookieOptions(maxAge, req));
  return res;
});
