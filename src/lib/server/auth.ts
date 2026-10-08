// Accounts: users.json in the data folder, scrypt-hashed passwords, HMAC-signed session cookie.
// Server only (Node runtime).

import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { cookies } from 'next/headers';
import { DATA_DIR, writeFileAtomic } from './store';
import { SESSION_COOKIE, SESSION_DAYS, signSession, verifySession, type SessionPayload } from '../auth/session';

export interface UserRecord {
  uid: string;
  email: string;
  name: string;
  company: string;
  role: 'owner' | 'guest';
  passHash: string; // scrypt$N$salt$hash
  createdAt: string;
  lastLoginAt: string | null;
}

const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SECRET_FILE = path.join(DATA_DIR, '.auth-secret');

type G = typeof globalThis & { __cbSecret?: string; __cbUsersChain?: Promise<unknown>; __cbAttempts?: Map<string, { n: number; until: number; first: number }> };
const g = globalThis as G;

/** AUTH_SECRET from the environment; otherwise one generated once and kept in the data folder. */
export async function authSecret(): Promise<string> {
  if (process.env.AUTH_SECRET && process.env.AUTH_SECRET.length >= 16) return process.env.AUTH_SECRET;
  if (g.__cbSecret) return g.__cbSecret;
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    g.__cbSecret = (await fs.readFile(SECRET_FILE, 'utf8')).trim();
    if (g.__cbSecret.length >= 32) return g.__cbSecret;
  } catch {
    /* create below */
  }
  g.__cbSecret = crypto.randomBytes(32).toString('hex');
  await fs.writeFile(SECRET_FILE, g.__cbSecret, 'utf8');
  return g.__cbSecret;
}

// ---------------------------------------------------------------------------------------
// Users file (serialised writes)

async function readUsers(): Promise<UserRecord[]> {
  try {
    return JSON.parse(await fs.readFile(USERS_FILE, 'utf8')) as UserRecord[];
  } catch {
    return [];
  }
}

function mutateUsers<T>(fn: (users: UserRecord[]) => T | Promise<T>): Promise<T> {
  const prev = g.__cbUsersChain ?? Promise.resolve();
  const next = prev
    .catch(() => {})
    .then(async () => {
      await fs.mkdir(DATA_DIR, { recursive: true });
      const users = await readUsers();
      const out = await fn(users);
      await writeFileAtomic(USERS_FILE, JSON.stringify(users, null, 1));
      return out;
    });
  g.__cbUsersChain = next.catch(() => {});
  return next;
}

export async function findUserByEmail(email: string): Promise<UserRecord | null> {
  const e = email.trim().toLowerCase();
  return (await readUsers()).find((u) => u.email === e) ?? null;
}

export async function findUser(uid: string): Promise<UserRecord | null> {
  return (await readUsers()).find((u) => u.uid === uid) ?? null;
}

// ---------------------------------------------------------------------------------------
// Passwords

const SCRYPT_N = 16384;

export function hashPassword(pw: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 32, { N: SCRYPT_N, r: 8, p: 1 });
  return `scrypt$${SCRYPT_N}$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

export function checkPassword(pw: string, stored: string): boolean {
  const [alg, n, salt, hash] = stored.split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const want = Buffer.from(hash, 'base64url');
  const got = crypto.scryptSync(pw, Buffer.from(salt, 'base64url'), want.length, { N: Number(n), r: 8, p: 1 });
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}

export function newUid(): string {
  return `u_${crypto.randomBytes(6).toString('hex')}`;
}

export async function createUser(input: { email: string; name: string; company: string; password: string; role?: 'owner' | 'guest' }): Promise<UserRecord> {
  const email = input.email.trim().toLowerCase();
  return mutateUsers((users) => {
    if (users.some((u) => u.email === email)) throw new AuthError('An account with this email already exists. Sign in instead.', 409);
    const u: UserRecord = {
      uid: newUid(),
      email,
      name: input.name.trim(),
      company: input.company.trim(),
      role: input.role ?? 'owner',
      passHash: hashPassword(input.password),
      createdAt: new Date().toISOString(),
      lastLoginAt: new Date().toISOString(),
    };
    users.push(u);
    // Guest sandboxes are disposable: keep only the 200 most recent.
    const guests = users.filter((x) => x.role === 'guest');
    if (guests.length > 200) {
      const drop = new Set(guests.slice(0, guests.length - 200).map((x) => x.uid));
      for (let i = users.length - 1; i >= 0; i--) if (drop.has(users[i].uid)) users.splice(i, 1);
    }
    return u;
  });
}

export async function touchLogin(uid: string): Promise<void> {
  await mutateUsers((users) => {
    const u = users.find((x) => x.uid === uid);
    if (u) u.lastLoginAt = new Date().toISOString();
  }).catch(() => {});
}

export async function updateUser(uid: string, patch: Partial<Pick<UserRecord, 'name' | 'company'>> & { password?: string }): Promise<UserRecord> {
  return mutateUsers((users) => {
    const u = users.find((x) => x.uid === uid);
    if (!u) throw new AuthError('Account not found.', 404);
    if (patch.name) u.name = patch.name.trim();
    if (patch.company) u.company = patch.company.trim();
    if (patch.password) u.passHash = hashPassword(patch.password);
    return u;
  });
}

export class AuthError extends Error {
  constructor(message: string, public status = 401) {
    super(message);
  }
}

// ---------------------------------------------------------------------------------------
// Brute-force protection: 8 failed sign-ins per email+IP in 15 minutes locks for 15 minutes.

const WINDOW = 15 * 60 * 1000;

export function checkRate(key: string): void {
  g.__cbAttempts ??= new Map();
  const a = g.__cbAttempts.get(key);
  if (a && a.until > Date.now()) {
    const min = Math.ceil((a.until - Date.now()) / 60000);
    throw new AuthError(`Too many failed attempts. Try again in ${min} minute${min > 1 ? 's' : ''}.`, 429);
  }
}

export function noteFailure(key: string): void {
  g.__cbAttempts ??= new Map();
  const now = Date.now();
  const a = g.__cbAttempts.get(key);
  if (!a || now - a.first > WINDOW) {
    g.__cbAttempts.set(key, { n: 1, first: now, until: 0 });
    return;
  }
  a.n++;
  if (a.n >= 8) a.until = now + WINDOW;
}

export function clearFailures(key: string): void {
  g.__cbAttempts?.delete(key);
}

// ---------------------------------------------------------------------------------------
// Sessions

export async function sessionFor(u: UserRecord): Promise<{ token: string; maxAge: number }> {
  const maxAge = (u.role === 'guest' ? 2 : SESSION_DAYS) * 24 * 3600;
  const payload: SessionPayload = { uid: u.uid, email: u.email, name: u.name, role: u.role, exp: Math.floor(Date.now() / 1000) + maxAge };
  return { token: await signSession(payload, await authSecret()), maxAge };
}

/** Secure cookies whenever the browser reached us over HTTPS (Render, tunnels); plain HTTP on a LAN still works. */
export function cookieOptions(maxAge: number, req: Request) {
  const proto = req.headers.get('x-forwarded-proto') ?? new URL(req.url).protocol.replace(':', '');
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: proto.split(',')[0].trim() === 'https',
    path: '/',
    maxAge,
  };
}

function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

/** Session from an API request's Cookie header. */
export async function sessionFromRequest(req: Request): Promise<SessionPayload | null> {
  return verifySession(readCookie(req.headers.get('cookie'), SESSION_COOKIE), await authSecret());
}

/** Session inside a server component. */
export async function sessionFromCookies(): Promise<SessionPayload | null> {
  const jar = await cookies();
  return verifySession(jar.get(SESSION_COOKIE)?.value, await authSecret());
}

export function publicUser(u: UserRecord | SessionPayload & { company?: string }) {
  return { uid: u.uid, email: u.email, name: u.name, role: u.role, company: 'company' in u ? u.company : undefined };
}
