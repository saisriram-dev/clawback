import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { promises as fs } from 'node:fs';
import { AddressInfo } from 'node:net';
import { ingest } from '@/lib/extraction/ingest';
import { extractByRules } from '@/lib/extraction/rules';
import { engineStatus, gemmaExtract, gemmaClassify, gemmaTranscribe, parseJsonLoose } from '@/lib/extraction/gemma';
import { mergeExtraction, groundCite } from '@/lib/extraction/ground';
import { DEFAULT_SETTINGS } from '@/lib/types';

// A stand-in for Ollama's HTTP API. It answers like Gemma would, including one wrong
// line number and one value that is not in the document, so grounding can be tested.
let server: http.Server;
let base = '';
const calls: any[] = [];

function lineOf(prompt: string, needle: string): number {
  const m = prompt.split('\n').find((l) => /^\d{4}\| /.test(l) && l.includes(needle));
  return m ? Number(m.slice(0, 4)) : 0;
}

beforeAll(async () => {
  server = http.createServer(async (req, res) => {
    let body = '';
    for await (const ch of req) body += ch;
    const send = (code: number, obj: unknown) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(obj));
    };
    if (req.url === '/api/version') return send(200, { version: '0.12.0' });
    if (req.url === '/api/tags') return send(200, { models: [{ name: 'gemma4:e4b' }, { name: 'gemma3:4b' }] });
    if (req.url === '/api/chat') {
      const j = JSON.parse(body);
      calls.push(j);
      if (j.model !== 'gemma4:e4b') return send(404, { error: `model "${j.model}" not found, try pulling it first` });
      const user: string = j.messages[1].content;
      if (j.messages[1].images) return send(200, { message: { content: 'COMMERCIAL INVOICE\nInvoice No: X-1    Date: 01-Sep-2025\nBuyer: Test Buyer Inc.' } });
      if (j.format?.properties?.doc_type) return send(200, { message: { content: JSON.stringify({ doc_type: 'invoice' }) } });
      const cite = (value: string, line: number, quote = value) => ({ value, line, quote });
      const out = {
        fields: {
          buyer_name: cite('Brightwater Home Supply Inc.', lineOf(user, 'Brightwater Home Supply Inc.')),
          invoice_number: cite('KL/EX/25-26/118', lineOf(user, 'Invoice No:')),
          invoice_date: cite('22-Aug-2025', lineOf(user, 'Invoice No:') + 3), // wrong line on purpose
          currency: cite('USD', lineOf(user, 'Currency')),
          incoterm: cite('FOB', lineOf(user, 'Terms of Delivery'), 'FOB Tuticorin'),
          ship_date: cite('30-Aug-2025', lineOf(user, 'B/L Date')), // not in the document on purpose
          shipping_bill_no: cite('4417823', lineOf(user, 'Shipping Bill')),
          po_number: cite('BW-4471', lineOf(user, 'PO No')),
          freight: cite('', 0, ''),
          insurance: cite('', 0, ''),
          total: cite('116,600.00', lineOf(user, 'Invoice Total')),
        },
        items: [
          { description: cite('Cotton bath towels 70x140 cm', lineOf(user, 'bath towels')), hs_code: cite('6302.60.0020', lineOf(user, 'bath towels')), qty: cite('16,000', lineOf(user, 'bath towels')), unit: cite('PCS', lineOf(user, 'bath towels')), list_price: cite('', 0, ''), unit_price: cite('5.10', lineOf(user, 'bath towels')), amount: cite('81,600.00', lineOf(user, 'bath towels')) },
          { description: cite('Cotton hand towels 40x70 cm', lineOf(user, 'hand towels')), hs_code: cite('6302.60.0020', lineOf(user, 'hand towels')), qty: cite('20,000', lineOf(user, 'hand towels')), unit: cite('PCS', lineOf(user, 'hand towels')), list_price: cite('', 0, ''), unit_price: cite('1.75', lineOf(user, 'hand towels')), amount: cite('35,000.00', lineOf(user, 'hand towels')) },
        ],
      };
      return send(200, { message: { content: '```json\n' + JSON.stringify(out) + '\n```' } });
    }
    send(404, { error: 'not found' });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());

const cfg = () => ({ ...DEFAULT_SETTINGS.engine, baseUrl: base, model: 'gemma4:e4b', timeoutSec: 30 });

describe('Gemma via Ollama', () => {
  it('reports status, model availability and offline state', async () => {
    const st = await engineStatus(cfg());
    expect(st.online).toBe(true);
    expect(st.modelAvailable).toBe(true);
    expect(st.version).toBe('0.12.0');
    const missing = await engineStatus({ ...cfg(), model: 'gemma4:31b' });
    expect(missing.modelAvailable).toBe(false);
    expect(missing.hint).toContain('ollama pull gemma4:31b');
    const off = await engineStatus({ ...cfg(), baseUrl: 'http://127.0.0.1:9' });
    expect(off.online).toBe(false);
    expect(off.hint).toContain('ollama');
  });

  it('extracts with citations, sends deterministic options, and grounding catches errors', async () => {
    const buf = await fs.readFile('demo/brightwater/invoice-118.pdf');
    const ing = await ingest(buf, 'invoice-118.pdf');
    const r = await gemmaExtract(cfg(), 'invoice', ing.lines, 'Kaveri Looms Pvt Ltd');
    const sent = calls.at(-1);
    expect(sent.options.temperature).toBe(0);
    expect(sent.options.seed).toBe(42);
    expect(sent.format.properties.fields).toBeTruthy();
    expect(r.result.items.length).toBe(2);

    const rules = extractByRules('invoice', ing.lines, { exporterName: 'Kaveri Looms Pvt Ltd' });
    const m = mergeExtraction('invoice', 'd1', ing.lines, rules, r.result);
    expect(m.fields.invoice_number.confidence).toBe('high');
    expect(m.fields.invoice_number.method).toBe('gemma+rules');
    // wrong line number is re-pointed to the real line
    expect(m.fields.invoice_date.source?.line).toBe(rules.fields.invoice_date.line);
    // invented value is caught: rules value wins and the field is flagged for review
    expect(m.fields.ship_date.value).toBe('2025-08-28');
    expect(m.fields.ship_date.confidence).toBe('low');
    expect(m.fields.ship_date.alt?.value).toBe('2025-08-30');
    expect(m.fields['items.0.qty'].value).toBe('16000');
    expect(m.fields['items.0.qty'].confidence).toBe('high');
    expect(m.itemCount).toBe(2);
  });

  it('classifies and transcribes', async () => {
    expect(await gemmaClassify(cfg(), [{ page: 1, text: 'something' }])).toBe('invoice');
    const t = await gemmaTranscribe(cfg(), { mime: 'image/png', base64: 'AAAA' });
    expect(t).toContain('Invoice No: X-1');
  });

  it('explains a missing model clearly', async () => {
    await expect(gemmaExtract({ ...cfg(), model: 'gemma4:31b' }, 'invoice', [{ page: 1, text: 'x' }], '')).rejects.toThrow(/ollama pull gemma4:31b/);
  });

  it('grounds values independently', () => {
    const lines = [{ page: 1, text: 'Revised price USD 5.10 per pc' }];
    expect(groundCite(lines, { value: '5.1', line: 1, quote: '5.10' }, 'money').ok).toBe(true);
    expect(groundCite(lines, { value: '5.20', line: 1, quote: '5.20' }, 'money').ok).toBe(false);
    expect(parseJsonLoose('Sure! {"a": 1,}')).toEqual({ a: 1 });
  });
});
