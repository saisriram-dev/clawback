import { promises as fs } from 'node:fs';
import { NextResponse } from 'next/server';
import { DATA_DIR, envEngine } from '@/lib/server/store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const started = Date.now();

/**
 * Health check for Render (and any uptime monitor). Public, cheap, no workspace data.
 * Returns 200 when the server is up and the data folder is writable.
 */
async function check() {
  let storage = 'ok';
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.access(DATA_DIR, (await import('node:fs')).constants.W_OK);
  } catch {
    storage = 'read-only';
  }
  const g = envEngine();
  return {
    status: storage === 'ok' ? 'ok' : 'degraded',
    service: 'clawback',
    gemma: g?.provider ? { provider: g.provider, model: g.model ?? 'gemma4:e4b' } : { provider: 'per-workspace settings (default: local Ollama gemma4:e4b)' },
    uptimeSec: Math.round((Date.now() - started) / 1000),
    storage,
    time: new Date().toISOString(),
  };
}

export async function GET() {
  const body = await check();
  return NextResponse.json(body, { status: body.status === 'ok' ? 200 : 503, headers: { 'Cache-Control': 'no-store' } });
}

/** Some monitors send HEAD requests. */
export async function HEAD() {
  const body = await check();
  return new NextResponse(null, { status: body.status === 'ok' ? 200 : 503, headers: { 'Cache-Control': 'no-store' } });
}
