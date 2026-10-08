import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import type { AddressInfo } from 'node:net';

// End-to-end through the real store and pipeline, with a stand-in Ollama server.
const DATA = path.join(os.tmpdir(), `clawback-test-${process.pid}`);
process.env.CLAWBACK_DATA_DIR = DATA;

const TRANSCRIPT = [
  'KAVERI LOOMS PVT LTD                                  COMMERCIAL INVOICE',
  'Invoice No: KL/EX/25-26/139                 Invoice Date: 05-Jan-2026',
  "Buyer's PO No: KB-3391                       Shipping Bill No: 5071140",
  'Terms of Delivery: FOB Chennai               Currency: USD',
  'B/L Date: 09-Jan-2026                        Port of Loading: Chennai (INMAA1)',
  'Buyer:                                       Consignee:',
  'Kestrel Bay Trading Inc.                     Same as buyer',
  'Sl  Description of Goods   HS Code   Qty   Unit   Unit Price   Amount (USD)',
  '1   Cotton chindi bath mats 50x80 cm    5705.00.2030    14,000    PCS    3.20    44,800.00',
  '2   Cotton chindi runner 60x180 cm      5705.00.2030     3,000    PCS    7.40    22,200.00',
  '                                    Invoice Total (USD)    67,000.00',
].join('\n');

let server: http.Server;
let chats = 0;
let images = 0;

beforeAll(async () => {
  await fs.rm(DATA, { recursive: true, force: true });
  server = http.createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    const send = (o: unknown) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(o));
    };
    if (req.url === '/api/version') return send({ version: '0.12.0' });
    if (req.url === '/api/tags') return send({ models: [{ name: 'gemma4:e4b' }] });
    const j = JSON.parse(body || '{}');
    chats++;
    if (j.messages?.[1]?.images) {
      images++;
      return send({ message: { content: TRANSCRIPT } });
    }
    if (j.format?.properties?.doc_type) return send({ message: { content: '{"doc_type":"invoice"}' } });
    return send({ message: { content: '{"fields":{},"items":[]}' } });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
});
afterAll(async () => {
  server.close();
  await fs.rm(DATA, { recursive: true, force: true });
});

describe('pipeline with store', () => {
  it('reads a scanned PDF with Gemma OCR, links the buyer, caches, and survives a bad file', async () => {
    const store = await import('@/lib/server/store');
    const { processDocument } = await import('@/lib/server/pipeline');
    const port = (server.address() as AddressInfo).port;
    await store.mutate((ws) => {
      ws.company.name = 'Kaveri Looms Pvt Ltd';
      ws.settings.engine.baseUrl = `http://127.0.0.1:${port}`;
    });
    const add = async (file: string, name: string) => {
      const buf = await fs.readFile(file);
      const id = store.newId('d');
      await fs.mkdir(store.uploadDir(), { recursive: true });
      await fs.writeFile(store.uploadPath(`${id}${path.extname(name)}`), buf);
      await store.mutate((ws) => {
        ws.documents[id] = {
          id, filename: name, mime: '', size: buf.length, sha256: store.sha256(buf), storedAs: `${id}${path.extname(name)}`,
          uploadedAt: new Date().toISOString(), origin: 'upload', status: 'queued', kind: 'other', kindConfidence: 'low', kindMethod: 'rules',
          lines: [], meta: {}, fields: {}, itemCount: 0, engine: { used: 'none', warnings: [] }, buyerId: null,
        };
      });
      return id;
    };
    const scan = await add('demo/extra/invoice-139-scanned.pdf', 'invoice-139-scanned.pdf');
    await processDocument(scan);
    let ws = await store.readWorkspace();
    const d = ws.documents[scan];
    expect(d.status).toBe('ready');
    expect(d.meta.ocr).toBe(true);
    expect(d.kind).toBe('invoice');
    expect(d.engine.used).toBe('gemma');
    expect(d.fields['invoice_number'].value).toBe('KL/EX/25-26/139');
    expect(d.itemCount).toBe(2);
    expect(ws.buyers[d.buyerId!].name).toBe('Kestrel Bay Trading Inc.');
    expect(images).toBe(1);

    // Same input → cached, no new model calls
    const before = chats;
    await processDocument(scan);
    ws = await store.readWorkspace();
    expect(ws.documents[scan].engine.cached).toBe(true);
    expect(chats).toBe(before);

    // A corrupt PDF fails cleanly with a message
    const badPath = path.join(DATA, 'bad.pdf');
    await fs.writeFile(badPath, '%PDF-1.4\nthis is not really a pdf');
    const bad = await add(badPath, 'bad.pdf');
    await processDocument(bad);
    ws = await store.readWorkspace();
    expect(ws.documents[bad].status).toBe('failed');
    expect(ws.documents[bad].error).toBeTruthy();

    // Offline engine → rules fallback with a warning, not a failure
    await store.mutate((w) => {
      w.settings.engine.baseUrl = 'http://127.0.0.1:9';
    });
    (globalThis as { __cbStatus?: unknown }).__cbStatus = undefined;
    const txt = await add('demo/brightwater/price-revision-brightwater.eml', 'rev.eml');
    await processDocument(txt);
    ws = await store.readWorkspace();
    expect(ws.documents[txt].status).toBe('ready');
    expect(ws.documents[txt].engine.used).toBe('rules');
    expect(ws.documents[txt].engine.warnings.join(' ')).toMatch(/rules only/i);
  });

  it('writes atomically and recovers from a corrupt workspace file', async () => {
    const store = await import('@/lib/server/store');
    await store.mutate((ws) => {
      ws.company.phone = '123';
    });
    await fs.writeFile(path.join(DATA, 'workspace.json'), '{ broken');
    const ws = await store.readWorkspace();
    expect(ws.company.phone).toBe('123'); // from the backup
    const files = await fs.readdir(DATA);
    expect(files.some((f) => f.startsWith('workspace.corrupt-'))).toBe(true);
  });
});
