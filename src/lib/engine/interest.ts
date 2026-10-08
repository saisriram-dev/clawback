// Interest that CBP adds to IEEPA refunds. CBP pays interest on refunds under
// 19 C.F.R. § 24.36 at the IRS overpayment rate (26 U.S.C. § 6621), set quarterly,
// compounded daily. ClawBack estimates it; the buyer's ACE statement has the exact figure.

import { addDays, diffDays, isLeapYear, toUtc, fromUtc } from './dates';
import { round2 } from './money';

export type InterestBasis = 'corporate' | 'non_corporate';

export interface QuarterRate {
  quarterStart: string; // ISO, first day of quarter
  corporate: number; // decimal per annum
  nonCorporate: number;
  source: string;
  assumed?: boolean;
}

// CBP quarterly notices (Federal Register / STR Trade Report summaries).
export const CBP_OVERPAYMENT_RATES: QuarterRate[] = [
  { quarterStart: '2025-01-01', corporate: 0.06, nonCorporate: 0.07, source: 'CBP notice, Q1 2025' },
  { quarterStart: '2025-04-01', corporate: 0.06, nonCorporate: 0.07, source: 'CBP notice, Q2 2025' },
  { quarterStart: '2025-07-01', corporate: 0.06, nonCorporate: 0.07, source: 'CBP notice, Q3 2025' },
  { quarterStart: '2025-10-01', corporate: 0.06, nonCorporate: 0.07, source: 'CBP notice, Q4 2025' },
  { quarterStart: '2026-01-01', corporate: 0.06, nonCorporate: 0.07, source: 'CBP notice, Q1 2026' },
  { quarterStart: '2026-04-01', corporate: 0.05, nonCorporate: 0.06, source: 'CBP notice, Q2 2026' },
  { quarterStart: '2026-07-01', corporate: 0.06, nonCorporate: 0.07, source: 'CBP notice FR 2026-13298, Q3 2026' },
];

export const INTEREST_SOURCE_URL = 'https://public-inspection.federalregister.gov/2026-13298.pdf';

function quarterStartOf(iso: string): string {
  const [y, m] = iso.split('-').map(Number);
  const qm = Math.floor((m - 1) / 3) * 3 + 1;
  return `${y}-${String(qm).padStart(2, '0')}-01`;
}

export function rateForDate(iso: string, basis: InterestBasis): { rate: number; assumed: boolean; source: string } {
  const qs = quarterStartOf(iso);
  let pick: QuarterRate | undefined;
  for (const q of CBP_OVERPAYMENT_RATES) if (q.quarterStart <= qs) pick = q;
  if (!pick) pick = CBP_OVERPAYMENT_RATES[0];
  const exact = pick.quarterStart === qs;
  return {
    rate: basis === 'corporate' ? pick.corporate : pick.nonCorporate,
    assumed: !exact,
    source: exact ? pick.source : `${pick.source} (carried forward; later notice not in table)`,
  };
}

export interface InterestResult {
  interest: number;
  days: number;
  segments: { from: string; to: string; days: number; rate: number; assumed: boolean }[];
}

/**
 * Daily-compounded interest on `principal` from `from` (inclusive) to `to` (exclusive).
 */
export function cbpInterest(principal: number, from: string, to: string, basis: InterestBasis = 'corporate'): InterestResult {
  const days = diffDays(from, to);
  if (!(principal > 0) || days <= 0) return { interest: 0, days: Math.max(0, days), segments: [] };

  let balance = principal;
  const segments: InterestResult['segments'] = [];
  let cursor = from;
  while (cursor < to) {
    const qs = quarterStartOf(cursor);
    const [y, m] = qs.split('-').map(Number);
    const nextQ = m + 3 > 12 ? `${y + 1}-01-01` : `${y}-${String(m + 3).padStart(2, '0')}-01`;
    const segEnd = nextQ < to ? nextQ : to;
    const segDays = diffDays(cursor, segEnd);
    const { rate, assumed } = rateForDate(cursor, basis);
    // Compound daily within the segment. Leap years use 366.
    for (let i = 0; i < segDays; i++) {
      const day = fromUtc(toUtc(cursor) + i * 86_400_000);
      const yearDays = isLeapYear(Number(day.slice(0, 4))) ? 366 : 365;
      balance *= 1 + rate / yearDays;
    }
    segments.push({ from: cursor, to: segEnd, days: segDays, rate, assumed });
    cursor = segEnd;
  }
  return { interest: round2(balance - principal), days, segments };
}

/** Simple-interest time value, used for "interest accruing to the buyer" on money they hold. */
export function simpleInterest(principal: number, ratePa: number, days: number): number {
  if (!(principal > 0) || !(days > 0) || !(ratePa > 0)) return 0;
  return round2((principal * ratePa * days) / 365);
}

export { addDays };
