import { describe, it, expect } from 'vitest';
import { indiaIeepaRate, exemptionFlags } from '@/lib/engine/rates';
import { cbpInterest, rateForDate, simpleInterest } from '@/lib/engine/interest';
import { refundWindow, readClock, capePhase1Eligible } from '@/lib/engine/refundClock';
import { triage, normalizeIncoterm } from '@/lib/engine/incoterms';
import { leverage } from '@/lib/engine/leverage';
import { settlementLadder } from '@/lib/engine/settlement';
import { parseDate, parseNumber, normalizeHS, normRef, nameSimilarity, findDates, numericTokens } from '@/lib/engine/normalize';
import { fmtINRShort, round2, fmtINR } from '@/lib/engine/money';
import { addDays, diffDays, todayIso } from '@/lib/engine/dates';
import { ingest } from '@/lib/extraction/ingest';

describe('India IEEPA rate table', () => {
  it('is zero before 5 Apr 2025 and from 24 Feb 2026', () => {
    expect(indiaIeepaRate('2025-04-04').rate).toBe(0);
    expect(indiaIeepaRate('2026-02-24').rate).toBe(0);
    expect(indiaIeepaRate('2026-06-01').rate).toBe(0);
  });
  it('applies the 10% baseline from 5 Apr 2025', () => {
    expect(indiaIeepaRate('2025-04-05').rate).toBe(0.1);
    expect(indiaIeepaRate('2025-08-06').rate).toBe(0.1);
  });
  it('applies 25% from 7 Aug and 50% from 27 Aug 2025', () => {
    expect(indiaIeepaRate('2025-08-07', '2025-08-07').rate).toBe(0.25);
    expect(indiaIeepaRate('2025-08-26', '2025-08-10').rate).toBe(0.25);
    expect(indiaIeepaRate('2025-08-27', '2025-08-27').rate).toBe(0.5);
    expect(indiaIeepaRate('2026-01-15', '2025-12-10').rate).toBe(0.5);
  });
  it('drops the additional 25% from 7 Feb 2026', () => {
    expect(indiaIeepaRate('2026-02-06', '2026-01-05').rate).toBe(0.5);
    expect(indiaIeepaRate('2026-02-07', '2026-01-05').rate).toBe(0.25);
    expect(indiaIeepaRate('2026-02-23', '2026-01-20').rate).toBe(0.25);
  });
  it('honours the in-transit exceptions', () => {
    // loaded before 7 Aug, entered before 5 Oct → 10% reciprocal; loaded before 27 Aug and entered before 17 Sep → no additional
    expect(indiaIeepaRate('2025-09-10', '2025-08-05').rate).toBe(0.1);
    // loaded before 7 Aug but entered after 5 Oct → full rates
    expect(indiaIeepaRate('2025-10-06', '2025-08-05').rate).toBe(0.5);
    // loaded 20 Aug, entered 15 Sep → 25% only
    expect(indiaIeepaRate('2025-09-15', '2025-08-20').rate).toBe(0.25);
    // loaded 20 Aug, entered 18 Sep → 50%
    expect(indiaIeepaRate('2025-09-18', '2025-08-20').rate).toBe(0.5);
  });
  it('flags likely exemptions by HS code', () => {
    expect(exemptionFlags('3004.90').length).toBe(1);
    expect(exemptionFlags('6302.60.00').length).toBe(0);
    expect(exemptionFlags('7318.15').map((f) => f.code)).toContain('s232-metals');
  });
});

describe('CBP refund interest', () => {
  it('uses the quarterly table and carries the last rate forward', () => {
    expect(rateForDate('2025-09-01', 'corporate').rate).toBe(0.06);
    expect(rateForDate('2026-05-01', 'corporate').rate).toBe(0.05);
    expect(rateForDate('2026-05-01', 'non_corporate').rate).toBe(0.06);
    expect(rateForDate('2026-11-01', 'corporate').assumed).toBe(true);
  });
  it('compounds daily across quarters', () => {
    const r = cbpInterest(10000, '2025-10-01', '2026-07-04', 'corporate');
    // 182 days at 6%, 91 days at 5%, 3 days at 6%: roughly 10000*(0.06*182+0.05*91+0.06*3)/365
    const simple = (10000 * (0.06 * 182 + 0.05 * 91 + 0.06 * 3)) / 365;
    expect(r.days).toBe(276);
    expect(r.interest).toBeGreaterThan(simple);
    expect(r.interest).toBeLessThan(simple * 1.03);
    expect(r.segments.map((s) => s.rate)).toEqual([0.06, 0.06, 0.05, 0.06]);
  });
  it('returns zero for empty periods', () => {
    expect(cbpInterest(1000, '2026-01-01', '2026-01-01').interest).toBe(0);
    expect(cbpInterest(0, '2025-01-01', '2026-01-01').interest).toBe(0);
    expect(simpleInterest(1000, 0.06, 365)).toBe(60);
  });
});

describe('refund clock', () => {
  it('estimates CAPE + 60–90 days', () => {
    const w = refundWindow(null);
    expect(w.earliest).toBe('2026-06-19');
    expect(w.latest).toBe('2026-07-19');
    expect(w.likely).toBe('2026-07-04');
  });
  it('reads days held and holding interest', () => {
    const c = readClock(38400, '2026-10-08', 0.06, null);
    expect(c.daysHeld).toBe(96);
    expect(c.holdingInterest).toBe(round2((38400 * 0.06 * 96) / 365));
  });
  it('knows Phase 1 scope', () => {
    expect(capePhase1Eligible('2025-09-15').eligible).toBe(true);
    expect(capePhase1Eligible('2025-01-10').eligible).toBe(false);
    expect(capePhase1Eligible('2025-04-10').eligible).toBe(true);
  });
});

describe('IOR triage', () => {
  it('routes DDP out and keeps FOB/CIF', () => {
    expect(triage('DDP').route).toBe('claim_direct');
    expect(triage('FOB').route).toBe('negotiate');
    expect(triage(null).route).toBe('confirm');
    expect(normalizeIncoterm('C&F New York')).toBe('CFR');
    expect(normalizeIncoterm('FOB Tuticorin')).toBe('FOB');
    expect(normalizeIncoterm('Delivered Duty Paid (DDP) Newark')).toBe('DDP');
  });
});

describe('leverage and settlement', () => {
  it('scores leverage deterministically', () => {
    const r = leverage({ revenueSharePct: 10, relationshipSinceYear: 2016, openOrders: true }, 2026);
    expect(r.score).toBe(Math.round(100 * (0.4 * 1 + 0.35 * 1 + 0.25 * 0.8)));
    expect(leverage({ revenueSharePct: null, relationshipSinceYear: null, openOrders: null }, 2026).missing.length).toBe(3);
  });
  it('builds a three-rung ladder', () => {
    const o = settlementLadder({ fairClaimUSD: 1000.01, splitPct: 50, nextOrders: 3, paymentDays: 30 });
    expect(o.map((x) => x.id)).toEqual(['A', 'B', 'C']);
    expect(o[1].amountUSD).toBe(500.01);
    expect(round2(o[2].installments!.reduce((a, b) => a + b.amountUSD, 0))).toBe(1000.01);
  });
});

describe('normalisation', () => {
  it('parses Indian and US dates', () => {
    expect(parseDate('14/08/2025')).toBe('2025-08-14');
    expect(parseDate('08/14/2025')).toBe('2025-08-14');
    expect(parseDate('14-Aug-2025')).toBe('2025-08-14');
    expect(parseDate('August 14, 2025')).toBe('2025-08-14');
    expect(parseDate('Thu, 14 Aug 2025 10:12:00 +0530')).toBe('2025-08-14');
    expect(parseDate('2025-08-14')).toBe('2025-08-14');
    expect(parseDate('14th August 2025')).toBe('2025-08-14');
    expect(parseDate('31/02/2025')).toBe(null);
    expect(findDates('B/L Date: 19-Aug-2025  ETA 18 Sep 2025').map((d) => d.iso)).toEqual(['2025-08-19', '2025-09-18']);
  });
  it('parses numbers', () => {
    expect(parseNumber('$4.20')).toBe(4.2);
    expect(parseNumber('1,23,456.78')).toBe(123456.78);
    expect(parseNumber('USD 12,400.00')).toBe(12400);
    expect(parseNumber('4,20')).toBe(4.2);
    expect(parseNumber('(12.50)')).toBe(-12.5);
    expect(numericTokens('Bath towel 6302.60 1,200 PCS 5.10 6,120.00').map((t) => t.value)).toEqual([6302.6, 1200, 5.1, 6120]);
  });
  it('normalises references and names', () => {
    expect(normalizeHS('HS 6302.60.0020')).toBe('6302600020');
    expect(normRef('Inv. No. KL/EX/25-26/118')).toBe('KLEX2526118');
    expect(normRef('KL/EX/25-26/118')).toBe('KLEX2526118');
    expect(normRef('INV-2025-0118')).toBe('20250118');
    expect(normRef('PO 4471')).toBe('4471');
    expect(normRef('NORTHGATE-77')).toBe('NORTHGATE77');
    expect(nameSimilarity('Brightwater Home Supply Inc.', 'BRIGHTWATER HOME SUPPLY')).toBe(1);
    expect(nameSimilarity('Cedar & Finch Living LLC', 'Brightwater Home')).toBe(0);
  });
  it('formats INR in lakh/crore', () => {
    expect(fmtINRShort(28_400_000)).toBe('₹2.84 Cr');
    expect(fmtINRShort(3_840_000)).toBe('₹38.4 L');
    expect(fmtINR(1234567)).toBe('₹12,34,567');
  });
  it('does date math', () => {
    expect(addDays('2025-08-19', 30)).toBe('2025-09-18');
    expect(diffDays('2026-07-04', '2026-10-08')).toBe(96);
    expect(todayIso(new Date('2026-10-08T20:00:00Z'))).toBe('2026-10-09');
    expect(todayIso(new Date('2026-10-08T07:00:00Z'))).toBe('2026-10-08');
  });
});

describe('ingest rejects bad input clearly', () => {
  it('handles empty, legacy, binary and text files', async () => {
    await expect(ingest(Buffer.alloc(0), 'a.pdf')).rejects.toThrow(/empty/);
    await expect(ingest(Buffer.from('xx'), 'old.doc')).rejects.toThrow(/Legacy/);
    await expect(ingest(Buffer.from([0, 1, 2, 3, 0, 5]), 'blob.bin')).rejects.toThrow(/Unrecognised/);
    await expect(ingest(Buffer.from('x'), 'mail.msg')).rejects.toThrow(/\.msg/);
    const t = await ingest(Buffer.from('\uFEFFline one\r\n\r\n\r\nline two\t end'), 'note.txt');
    expect(t.lines.map((l) => l.text)).toEqual(['line one', '', 'line two     end']);
  });
});
