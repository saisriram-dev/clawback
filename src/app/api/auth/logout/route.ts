import { NextResponse } from 'next/server';
import { openRoute } from '@/lib/server/api';
import { cookieOptions } from '@/lib/server/auth';
import { SESSION_COOKIE } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

export const POST = openRoute(async (req) => {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, '', { ...cookieOptions(0, req), maxAge: 0 });
  return res;
});
