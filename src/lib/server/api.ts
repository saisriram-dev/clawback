import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { sessionFromRequest } from './auth';
import { withTenant } from './tenant';
import type { SessionPayload } from '../auth/session';

export function json(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
}

export function fail(message: string, status = 400): NextResponse {
  return NextResponse.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store' } });
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

type Handler<C> = (req: Request, ctx: C) => Promise<Response>;
type AuthedHandler<C> = (req: Request, ctx: C, session: SessionPayload) => Promise<Response>;

function handleError(e: unknown): NextResponse {
  if (e instanceof HttpError) return fail(e.message, e.status);
  if (e instanceof ZodError) return fail(`Invalid input: ${e.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`, 400);
  const status = (e as { status?: number })?.status;
  if (typeof status === 'number' && status >= 400 && status < 500) return fail((e as Error).message, status);
  console.error('[clawback]', e);
  return fail(`Something went wrong: ${(e as Error)?.message ?? String(e)}`, 500);
}

/**
 * Signed-in route: checks the session cookie, then runs the handler inside that
 * account's private workspace. Every failure becomes a clear JSON error instead of a crash.
 */
export function route<C>(h: AuthedHandler<C>): Handler<C> {
  return async (req, ctx) => {
    try {
      const session = await sessionFromRequest(req);
      if (!session) return fail('Please sign in to continue.', 401);
      return await withTenant(session.uid, () => h(req, ctx, session));
    } catch (e) {
      return handleError(e);
    }
  };
}

/** Public route (sign-in, health check, buyer portal). No session required. */
export function openRoute<C>(h: Handler<C>): Handler<C> {
  return async (req, ctx) => {
    try {
      return await h(req, ctx);
    } catch (e) {
      return handleError(e);
    }
  };
}

export async function body<T = unknown>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError(400, 'Request body must be JSON.');
  }
}
