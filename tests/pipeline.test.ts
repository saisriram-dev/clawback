import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { ingest } from '@/lib/extraction/ingest';
import { classifyByRules, extractByRules } from '@/lib/extraction/rules';
import { mergeExtraction } from '@/lib/extraction/ground';
import { assignBuyer } from '@/lib/server/buyers';
import { emptyWorkspace } from '@/lib/server/store';
import { buildPortfolio } from '@/lib/ledger';
import type { DocRecord, Workspace } from '@/lib/types';
import { fmtUSD, fmtINRShort } from '@/lib/engine/money';

export async function demoWorkspace(): Promise<Workspace> {
  const ws = emptyWorkspace();
  ws.company.name = 'Kaveri Looms Pvt Ltd';
  ws.company.emailDomains = ['kaveriloom.example'];
  const manifest = JSON.parse(await fs.readFile('demo/manifest.json', 'utf8'));
  let n = 0;
  for (const b of manifest.buyers) {
    for (const rel of b.files) {
      const file = path.join('demo', rel);
      const buf = await fs.readFile(file);
      const ing = await ingest(buf, file);
      const c = classifyByRules(ing.lines, ing.format === 'eml');
      const id = `d${++n}`;
      const r = extractByRules(c.kind, ing.lines, { exporterName: ws.company.name, exporterDomains: ws.company.emailDomains }, ing.meta);
      const m = mergeExtraction(c.kind, id, ing.lines, r, null);
      const doc: DocRecord = {
        id, filename: path.basename(file), mime: '', size: buf.length, sha256: '', storedAs: '', uploadedAt: new Date().toISOString(), origin: 'demo',
        status: 'ready', kind: c.kind, kindConfidence: 'high', kindMethod: 'rules', lines: ing.lines, meta: { ...ing.meta },
        fields: m.fields, itemCount: m.itemCount, engine: { used: 'rules', warnings: [] }, buyerId: null,
      };
      ws.documents[id] = doc;
      doc.buyerId = assignBuyer(ws, doc);
    }
  }
  // apply profiles
  for (const mb of manifest.buyers) {
    const b = Object.values(ws.buyers).find((x) => x.name === mb.name || x.aliases.includes(mb.name));
    if (b) Object.assign(b, mb.profile, { transitDays: mb.transitDays });
  }
  return ws;
}

describe('demo portfolio (rules engine only)', () => {
  it('builds the expected ledger', async () => {
    const ws = await demoWorkspace();
    const p = buildPortfolio(ws, '2026-10-08');
    const by = (n: string) => p.buyers.find((b) => b.buyer.name.startsWith(n))!;
    expect(p.buyers.length).toBe(7);
    expect(p.unassigned.length).toBe(0);
    expect(p.totals.buyersWithClaim).toBe(6);
    expect(p.totals.fairClaimUSD).toBeGreaterThan(290000);
    expect(p.totals.fairClaimUSD).toBeLessThan(300000);
    expect(fmtINRShort(p.totals.fairClaimINR)).toBe('₹2.85 Cr');
    // every extracted value traced to a line
    expect(p.totals.fieldsGrounded).toBe(p.totals.fieldsTotal);

    const bw = by('Brightwater');
    expect(bw.route).toBe('negotiate');
    expect(bw.lines.length).toBe(10);
    expect(bw.lines.filter((l) => l.flags.some((f) => f.code === 'pre-revision')).length).toBe(2);
    expect(bw.lines.find((l) => l.invoiceNo.v === 'KL/EX/25-26/142')!.rate.v).toBe(0.25);
    expect(bw.totals.absorbed).toBe(121850);

    const cf = by('Cedar');
    expect(cf.lines.filter((l) => l.discountMode === 'credit_note').length).toBe(2);
    expect(cf.lines.find((l) => l.invoiceNo.v === 'KL/EX/25-26/121')!.realizedCheck).toBe('short');
    expect(cf.totals.absorbed).toBe(58800);

    const pal = by('Palisade');
    expect(pal.lines[0].baseline.v).toBe(14.5);

    const ms = by('Marisol');
    expect(ms.lines[0].rate.v).toBe(0.25); // in-transit: loaded 20 Aug, entered 13 Sep
    expect(ms.lines[0].customsValue.v).toBe(44600); // CFR freight deducted

    const kb = by('Kestrel');
    expect(kb.clock.window.basis).toBe('confirmed');
    expect(kb.totals.refundPrincipal).toBe(49600);

    const ng = by('Northgate');
    expect(ng.objections.find((o) => o.id === 'volume')!.strength).toBe('moderate');

    const bs = by('Bluestem');
    expect(bs.route).toBe('claim_direct');
    expect(bs.totals.fairClaim).toBe(0);
    expect(bs.totals.directClaim).toBeGreaterThan(60000);
    void fmtUSD;
  });

  it('is deterministic: same input, same output', async () => {
    const a = buildPortfolio(await demoWorkspace(), '2026-10-08');
    const b = buildPortfolio(await demoWorkspace(), '2026-10-08');
    const strip = (p: typeof a) => p.buyers.map((x) => [x.buyer.name, x.totals, x.lines.map((l) => l.receipt)]);
    expect(JSON.stringify(strip(a))).toBe(JSON.stringify(strip(b)));
  });
});
