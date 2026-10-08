// Tenant context: which company's private workspace the current request works on.
// Every signed-in account gets its own folder under data/tenants/<uid>/. The context
// travels with the request through AsyncLocalStorage, so the store, the pipeline and
// the routes do not need a user id passed through every call. Server only.

import { AsyncLocalStorage } from 'node:async_hooks';

export interface TenantCtx {
  uid: string;
}

const g = globalThis as typeof globalThis & { __cbTenantALS?: AsyncLocalStorage<TenantCtx> };
const als = (g.__cbTenantALS ??= new AsyncLocalStorage<TenantCtx>());

export const UID_RE = /^u_[a-f0-9]{12}$/;

/** Run `fn` inside a tenant's workspace. */
export function withTenant<T>(uid: string, fn: () => T): T {
  if (!UID_RE.test(uid)) throw new Error('Invalid account id.');
  return als.run({ uid }, fn);
}

/** The current tenant id, or null outside a signed-in request (tests, CLI scripts). */
export function currentUid(): string | null {
  return als.getStore()?.uid ?? null;
}

/** Portal tokens carry their owner: "<uid>.<random>". Returns the uid or null. */
export function uidFromPortalToken(token: string): string | null {
  const dot = token.indexOf('.');
  if (dot < 0) return null;
  const uid = token.slice(0, dot);
  return UID_RE.test(uid) ? uid : null;
}
