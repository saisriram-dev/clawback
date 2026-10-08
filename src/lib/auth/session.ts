// Signed session tokens: base64url(JSON payload) + "." + base64url(HMAC-SHA256).
// Uses Web Crypto only, so the same code runs in middleware (edge) and in route handlers (Node).

export const SESSION_COOKIE = 'cb_session';
export const SESSION_DAYS = 14;

export interface SessionPayload {
  uid: string;
  email: string;
  name: string;
  role: 'owner' | 'guest';
  exp: number; // unix seconds
}

const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s: string): Uint8Array {
  const pad = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function signSession(p: SessionPayload, secret: string): Promise<string> {
  const body = b64url(enc.encode(JSON.stringify(p)));
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(body)));
  return `${body}.${b64url(sig)}`;
}

export async function verifySession(token: string | undefined | null, secret: string): Promise<SessionPayload | null> {
  if (!token) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  try {
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), fromB64url(sig) as BufferSource, enc.encode(body));
    if (!ok) return null;
    const p = JSON.parse(new TextDecoder().decode(fromB64url(body))) as SessionPayload;
    if (!p.uid || typeof p.exp !== 'number' || p.exp < Math.floor(Date.now() / 1000)) return null;
    return p;
  } catch {
    return null;
  }
}

/** Cheap shape check for middleware when the secret is not available there. */
export function looksLikeSession(token: string | undefined | null): boolean {
  return !!token && /^[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}$/.test(token);
}
