// Refund clock: when did the buyer's IEEPA refund most likely land, and what has
// holding the exporter's share been worth to them since? Pure date math.

import { addDays, diffDays, maxDate } from './dates';
import { simpleInterest } from './interest';

// CBP's Consolidated Administration and Processing of Entries (CAPE), Phase 1.
export const CAPE = {
  phase1Open: '2026-04-20',
  firstRefundExpected: '2026-05-11',
  refundLagMinDays: 60,
  refundLagMaxDays: 90,
  // Phase 1 covers unliquidated entries and entries within 80 days of liquidation.
  phase1LiquidationGraceDays: 80,
  // Typical liquidation is about 314 days after entry.
  typicalLiquidationDays: 314,
  sourceUrl: 'https://www.steptoe.com/en/news-publications/global-trade-and-investment-law-blog/cbp-cape-mechanism-begins-processing-ieepa-tariff-refunds.html',
  sourceTitle: 'Steptoe: CBP CAPE mechanism begins processing IEEPA tariff refunds',
};

export interface RefundWindow {
  earliest: string;
  likely: string;
  latest: string;
  basis: 'confirmed' | 'estimated';
  explanation: string;
}

/** Estimated refund landing window for a buyer, unless they have confirmed the date. */
export function refundWindow(confirmedDate?: string | null): RefundWindow {
  if (confirmedDate) {
    return {
      earliest: confirmedDate,
      likely: confirmedDate,
      latest: confirmedDate,
      basis: 'confirmed',
      explanation: `Refund date confirmed as ${confirmedDate}.`,
    };
  }
  const earliest = addDays(CAPE.phase1Open, CAPE.refundLagMinDays);
  const latest = addDays(CAPE.phase1Open, CAPE.refundLagMaxDays);
  const likely = addDays(CAPE.phase1Open, Math.round((CAPE.refundLagMinDays + CAPE.refundLagMaxDays) / 2));
  return {
    earliest,
    likely,
    latest,
    basis: 'estimated',
    explanation: `CAPE Phase 1 opened ${CAPE.phase1Open}; CBP expects valid refunds 60–90 days after a declaration is accepted. Assumes the buyer filed in the first week.`,
  };
}

export interface ClockReading {
  window: RefundWindow;
  daysHeld: number; // since the likely landing date, 0 if not yet landed
  landed: boolean;
  holdingInterest: number; // value to the buyer of holding `amount` since landing
}

export function readClock(amount: number, today: string, holdingRatePa: number, confirmedDate?: string | null): ClockReading {
  const window = refundWindow(confirmedDate);
  const daysHeld = Math.max(0, diffDays(window.likely, today));
  return {
    window,
    daysHeld,
    landed: today >= window.likely,
    holdingInterest: simpleInterest(amount, holdingRatePa, daysHeld),
  };
}

/** Is an entry within CAPE Phase 1 scope (unliquidated, or within 80 days of liquidation, on the opening date)? */
export function capePhase1Eligible(entryDate: string): { eligible: boolean; estLiquidation: string; reason: string } {
  const estLiquidation = addDays(entryDate, CAPE.typicalLiquidationDays);
  const cutoff = addDays(CAPE.phase1Open, -CAPE.phase1LiquidationGraceDays);
  const eligible = estLiquidation >= cutoff;
  return {
    eligible,
    estLiquidation,
    reason: eligible
      ? `Entry ${entryDate} would liquidate around ${estLiquidation}, so on ${CAPE.phase1Open} it was unliquidated or inside the 80-day window: Phase 1 scope.`
      : `Entry ${entryDate} likely liquidated around ${estLiquidation}, more than 80 days before CAPE opened: may fall in a later phase or need a protest.`,
  };
}

export function latestOf(dates: (string | null | undefined)[]): string | null {
  let out: string | null = null;
  for (const d of dates) if (d) out = out ? maxDate(out, d) : d;
  return out;
}
