import { describe, it, expect, beforeAll } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';

const DATA = path.join(os.tmpdir(), `cb-auth-${Date.now()}`);
process.env.CLAWBACK_DATA_DIR = DATA;

describe('authorization', () => {
  beforeAll(async () => {
    await fs.mkdir(DATA, { recursive: true });
  });

  it('signs and verifies sessions, and rejects tampered or expired ones', async () => {
    const { signSession, verifySession } = await import('@/lib/auth/session');
    const secret = 'x'.repeat(32);
    const p = { uid: 'u_0123456789ab', email: 'a@b.in', name: 'A', role: 'owner' as const, exp: Math.floor(Date.now() / 1000) + 60 };
    const t = await signSession(p, secret);
    expect((await verifySession(t, secret))?.uid).toBe(p.uid);
    expect(await verifySession(t, 'y'.repeat(32))).toBeNull();
    const [body, sig] = t.split('.');
    const forged = Buffer.from(JSON.stringify({ ...p, uid: 'u_ffffffffffff' })).toString('base64url');
    expect(await verifySession(`${forged}.${sig}`, secret)).toBeNull();
    expect(await verifySession(`${body}.${sig}`, secret)).not.toBeNull();
    const old = await signSession({ ...p, exp: 1 }, secret);
    expect(await verifySession(old, secret)).toBeNull();
  });

  it('hashes passwords with scrypt and checks them in constant time', async () => {
    const { hashPassword, checkPassword } = await import('@/lib/server/auth');
    const h = hashPassword('correct horse');
    expect(h.startsWith('scrypt$')).toBe(true);
    expect(h).not.toContain('correct horse');
    expect(checkPassword('correct horse', h)).toBe(true);
    expect(checkPassword('wrong horse', h)).toBe(false);
  });

  it('keeps every account in its own private workspace', async () => {
    const store = await import('@/lib/server/store');
    const { withTenant } = await import('@/lib/server/tenant');
    await withTenant('u_aaaaaaaaaaaa', () => store.mutate((ws) => void (ws.company.name = 'Alpha Exports')));
    await withTenant('u_bbbbbbbbbbbb', () => store.mutate((ws) => void (ws.company.name = 'Beta Textiles')));
    expect((await withTenant('u_aaaaaaaaaaaa', () => store.readWorkspace())).company.name).toBe('Alpha Exports');
    expect((await withTenant('u_bbbbbbbbbbbb', () => store.readWorkspace())).company.name).toBe('Beta Textiles');
    expect(() => withTenant('../../etc', () => 1)).toThrow();
  });

  it('puts the owner in buyer-portal tokens so public links find the right workspace', async () => {
    const store = await import('@/lib/server/store');
    const { withTenant, uidFromPortalToken } = await import('@/lib/server/tenant');
    const t = withTenant('u_cccccccccccc', () => store.newToken());
    expect(uidFromPortalToken(t)).toBe('u_cccccccccccc');
    expect(uidFromPortalToken('no-owner-token')).toBeNull();
    expect(uidFromPortalToken('u_../x.abc')).toBeNull();
  });
});
