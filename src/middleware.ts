// Page guard: signed-out visitors see the landing page or the sign-in page instead of the app.
// API routes check the session themselves (src/lib/server/api.ts), so this is only about navigation.

import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, looksLikeSession, verifySession } from '@/lib/auth/session';

const PUBLIC = [/^\/welcome$/, /^\/login$/, /^\/signup$/, /^\/r\//, /^\/api\//];

export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (PUBLIC.some((re) => re.test(pathname))) return NextResponse.next();
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const secret = process.env.AUTH_SECRET;
  const ok = secret && secret.length >= 16 ? !!(await verifySession(token, secret)) : looksLikeSession(token);
  if (ok) return NextResponse.next();
  const url = req.nextUrl.clone();
  if (pathname === '/') {
    url.pathname = '/welcome';
    url.search = '';
  } else {
    url.pathname = '/login';
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
  }
  return NextResponse.redirect(url);
}

export const config = {
  // Everything except Next.js assets and files with an extension (icons, fonts, images).
  matcher: ['/((?!_next/|.*\\.[a-zA-Z0-9]+$).*)'],
};
