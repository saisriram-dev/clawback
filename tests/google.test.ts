import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { engineStatus, gemmaClassify, gemmaTranscribe } from '@/lib/extraction/gemma';
import { DEFAULT_SETTINGS, type EngineSettings } from '@/lib/types';

// A stand-in for Google AI Studio's Gemini API serving Gemma 4.
let server: http.Server;
let base = '';
const seen: { url: string; key: string | undefined; body: any }[] = [];
let throttleOnce = true;

beforeAll(async () => {
  server = http.createServer(async (req, res) => {
    let body = '';
    for await (const ch of req) body += ch;
    const send = (code: number, obj: unknown) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(obj));
    };
    const key = req.headers['x-goog-api-key'] as string | undefined;
    seen.push({ url: req.url ?? '', key, body: body ? JSON.parse(body) : null });
    if (key !== 'test-key') return send(400, { error: { message: 'API key not valid.' } });
    if (req.method === 'GET' && req.url === '/v1beta/models/gemma-4-26b-a4b-it') return send(200, { name: 'models/gemma-4-26b-a4b-it' });
    if (req.method === 'GET') return send(404, { error: { message: 'not found' } });
    if (req.url === '/v1beta/models/gemma-4-26b-a4b-it:generateContent') {
      if (throttleOnce) {
        throttleOnce = false;
        return send(429, { error: { message: 'Resource exhausted' } });
      }
      const j = JSON.parse(body);
      const hasImage = j.contents[0].parts.some((p: any) => p.inlineData);
      const text = hasImage ? 'COMMERCIAL INVOICE\nInvoice No: X-1' : JSON.stringify({ doc_type: 'invoice' });
      return send(200, { candidates: [{ content: { parts: [{ text: 'thinking...', thought: true }, { text }] } }] });
    }
    return send(404, {});
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());

const cfg = (over: Partial<EngineSettings> = {}): EngineSettings => ({ ...DEFAULT_SETTINGS.engine, provider: 'google', baseUrl: base, model: 'gemma-4-26b-a4b-it', apiKey: 'test-key', timeoutSec: 30, ...over });

describe('Gemma through Google AI Studio (Gemini API)', () => {
  it('checks the key and the model', async () => {
    const ok = await engineStatus(cfg());
    expect(ok.online && ok.modelAvailable).toBe(true);
    const wrongModel = await engineStatus(cfg({ model: 'gemma-9-nope' }));
    expect(wrongModel.online).toBe(true);
    expect(wrongModel.modelAvailable).toBe(false);
    const badKey = await engineStatus(cfg({ apiKey: 'nope' }));
    expect(badKey.online).toBe(false);
  });

  it('sends the key as a header, retries a rate limit, and ignores thinking parts', async () => {
    const kind = await gemmaClassify(cfg(), [{ n: 1, page: 1, text: 'COMMERCIAL INVOICE' }, { n: 2, page: 1, text: 'Invoice No: KL/EX/25-26/118' }] as never);
    expect(kind).toBe('invoice');
    const posts = seen.filter((s) => s.url.endsWith(':generateContent'));
    expect(posts.length).toBe(2); // one 429, one success
    expect(posts.every((p) => p.key === 'test-key' && !p.url.includes('key='))).toBe(true);
    expect(posts[1].body.generationConfig.temperature).toBe(0);
    expect(posts[1].body.systemInstruction.parts[0].text.length).toBeGreaterThan(20);
  }, 20000);

  it('transcribes an image with inline data', async () => {
    const text = await gemmaTranscribe(cfg(), { mime: 'image/png', base64: 'iVBORw0KGgo=' });
    expect(text).toContain('COMMERCIAL INVOICE');
  });
});
