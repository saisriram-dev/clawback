// Leverage score: a simple, published formula. Higher when the relationship is long,
// the buyer has open orders with you, and you are not over-dependent on them.

import { clamp } from './money';

export interface LeverageInput {
  revenueSharePct: number | null; // this buyer's share of your revenue, 0–100
  relationshipSinceYear: number | null;
  openOrders: boolean | null;
}

export const LEVERAGE_WEIGHTS = { years: 0.4, openOrders: 0.35, independence: 0.25 };

export interface LeverageResult {
  score: number; // 0–100
  parts: { label: string; input: string; score: number; weight: number }[];
  missing: string[];
}

export function leverage(input: LeverageInput, currentYear: number): LeverageResult {
  const missing: string[] = [];
  let yearsScore = 0.5;
  let yearsLabel = 'unknown (0.5 assumed)';
  if (input.relationshipSinceYear && input.relationshipSinceYear > 1900) {
    const years = Math.max(0, currentYear - input.relationshipSinceYear);
    yearsScore = clamp(years / 10, 0, 1);
    yearsLabel = `${years} yr (capped at 10)`;
  } else missing.push('relationship start year');

  let openScore = 0.5;
  let openLabel = 'unknown (0.5 assumed)';
  if (input.openOrders === true) {
    openScore = 1;
    openLabel = 'yes';
  } else if (input.openOrders === false) {
    openScore = 0;
    openLabel = 'no';
  } else missing.push('open orders');

  let indScore = 0.5;
  let indLabel = 'unknown (0.5 assumed)';
  if (input.revenueSharePct !== null && Number.isFinite(input.revenueSharePct)) {
    indScore = clamp(1 - input.revenueSharePct / 50, 0, 1);
    indLabel = `${input.revenueSharePct}% of revenue`;
  } else missing.push('share of revenue');

  const w = LEVERAGE_WEIGHTS;
  const score = Math.round(100 * (w.years * yearsScore + w.openOrders * openScore + w.independence * indScore));
  return {
    score,
    parts: [
      { label: 'Relationship length', input: yearsLabel, score: yearsScore, weight: w.years },
      { label: 'Open orders with you', input: openLabel, score: openScore, weight: w.openOrders },
      { label: 'Independence (1 − share ÷ 50%)', input: indLabel, score: indScore, weight: w.independence },
    ],
    missing,
  };
}
