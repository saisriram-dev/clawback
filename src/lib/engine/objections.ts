// Objection handler: rules-based rebuttals for the four objections buyers raise.
// Every rebuttal is assembled from ledger evidence; where the evidence is weak, it says so.

import type { SourceRef } from '../types';
import { fmtDate } from './dates';
import { fmtPct, fmtUSD } from './money';

export interface EvidenceRef {
  label: string;
  text: string;
  src?: SourceRef | null;
  exhibit?: string | null;
}

export interface Check {
  label: string;
  status: 'pass' | 'fail' | 'unknown';
}

export interface Objection {
  id: 'passed_on' | 'fob' | 'no_refund_yet' | 'volume';
  objection: string;
  strength: 'strong' | 'moderate' | 'weak';
  response: string;
  evidence: EvidenceRef[];
  checks: Check[];
}

export interface ObjectionFacts {
  exporterName: string;
  buyerName: string;
  ratio: number;
  fairClaimUSD: number;
  tariffPaidUSD: number;
  absorbedUSD: number;
  incoterms: string[];
  incotermEvidence: EvidenceRef | null;
  tariffMention: EvidenceRef | null;
  volumeMention: EvidenceRef | null;
  firstRevisionDate: string | null;
  firstRevisionExhibit: string | null;
  avgQtyBefore: number | null;
  avgQtyAfter: number | null;
  avgDiscountPct: number | null; // (baseline − revised) ÷ baseline
  rateAtRevision: number | null;
  refundLikelyDate: string;
  refundBasis: 'confirmed' | 'estimated';
  daysHeld: number;
  holdingInterestUSD: number;
  phase1Eligible: number;
  phase1Total: number;
  earliestEntry: string | null;
  latestEntry: string | null;
}

const TARIFF_EVENTS = ['2025-08-07', '2025-08-27'];

function strengthOf(checks: Check[]): Objection['strength'] {
  const pass = checks.filter((c) => c.status === 'pass').length;
  const fail = checks.filter((c) => c.status === 'fail').length;
  if (fail === 0 && pass >= 2) return 'strong';
  if (pass > fail) return 'moderate';
  return 'weak';
}

export function buildObjections(f: ObjectionFacts): Objection[] {
  const out: Objection[] = [];
  const keepShare = 1 - f.ratio;

  // 1. "We passed the cost on to retail."
  {
    const checks: Check[] = [
      { label: 'Claim limited to the absorbed share of the refund', status: f.ratio > 0 && f.ratio <= 1 ? 'pass' : 'unknown' },
      { label: 'Price concession linked to the tariff in writing', status: f.tariffMention ? 'pass' : 'fail' },
    ];
    const evidence: EvidenceRef[] = [];
    if (f.tariffMention) evidence.push(f.tariffMention);
    evidence.push({
      label: 'Absorption ratio',
      text: `${fmtUSD(f.absorbedUSD)} of ${fmtUSD(f.tariffPaidUSD)} in IEEPA duty was offset by our price reduction (${fmtPct(f.ratio)}).`,
    });
    out.push({
      id: 'passed_on',
      objection: '“We passed the cost on to retail.”',
      strength: strengthOf(checks),
      checks,
      evidence,
      response:
        `Our claim covers only the part of the duty that our price reduction paid for: ${fmtPct(f.ratio)} of the refund. ` +
        `The other ${fmtPct(keepShare)} stays with ${f.buyerName}, and that is the share any downstream customer could look to. ` +
        `The portion we funded through the discount never reached your retail price, because it came out of our invoice rather than your landed cost.` +
        (f.tariffMention ? ` The discount was agreed explicitly because of the tariff (${f.tariffMention.exhibit ?? 'see exhibit'}).` : ''),
    });
  }

  // 2. "It was FOB, so it's not your concern."
  {
    const fobLike = f.incoterms.filter((t) => t !== 'DDP');
    const checks: Check[] = [
      { label: 'Incoterm confirms the buyer was importer of record', status: fobLike.length ? 'pass' : 'unknown' },
      { label: 'Discount tied to the tariff in writing', status: f.tariffMention ? 'pass' : 'fail' },
    ];
    const evidence: EvidenceRef[] = [];
    if (f.incotermEvidence) evidence.push(f.incotermEvidence);
    if (f.tariffMention) evidence.push(f.tariffMention);
    out.push({
      id: 'fob',
      objection: '“It was FOB, so it’s not your concern.”',
      strength: strengthOf(checks),
      checks,
      evidence,
      response:
        `Agreed: under ${fobLike.join('/') || 'these terms'} ${f.buyerName} was the importer of record, which is exactly why the refund was paid to you and not to us. ` +
        `Incoterms decide delivery, risk and who clears customs. They say nothing about how a price concession tied to a duty is settled once that duty is refunded. ` +
        `We are not asking about duty liability. We are asking to reconcile a discount we gave because of a duty that has now been returned to you.`,
    });
  }

  // 3. "We haven't received the refund yet."
  {
    const checks: Check[] = [
      { label: 'Entries within CAPE Phase 1 scope', status: f.phase1Total ? (f.phase1Eligible === f.phase1Total ? 'pass' : f.phase1Eligible > 0 ? 'unknown' : 'fail') : 'unknown' },
      { label: 'Expected refund date has passed', status: f.daysHeld > 0 ? 'pass' : 'fail' },
    ];
    const evidence: EvidenceRef[] = [
      {
        label: 'Refund clock',
        text:
          f.refundBasis === 'confirmed'
            ? `Refund confirmed on ${fmtDate(f.refundLikelyDate)}.`
            : `CAPE Phase 1 opened 20 Apr 2026; CBP expects valid refunds 60–90 days after a declaration is accepted. Likely landing: ~${fmtDate(f.refundLikelyDate)}.`,
      },
      {
        label: 'Entries',
        text: `${f.phase1Eligible} of ${f.phase1Total} entries (${fmtDate(f.earliestEntry)} to ${fmtDate(f.latestEntry)}) fall within CAPE Phase 1 scope (unliquidated, or within 80 days of liquidation, on the opening date).`,
      },
    ];
    if (f.daysHeld > 0) {
      evidence.push({ label: 'Time value', text: `At the CBP refund rate, holding ${fmtUSD(f.fairClaimUSD)} for ${f.daysHeld} days is worth ${fmtUSD(f.holdingInterestUSD)} to the holder.` });
    }
    out.push({
      id: 'no_refund_yet',
      objection: '“We haven’t received the refund yet.”',
      strength: strengthOf(checks),
      checks,
      evidence,
      response:
        (f.daysHeld > 0
          ? `Your entries fall within CAPE Phase 1, which opened on 20 April 2026, and CBP has been paying valid claims 60 to 90 days after acceptance. On that timeline the refund would have landed around ${fmtDate(f.refundLikelyDate)}. `
          : `CAPE Phase 1 opened on 20 April 2026 and CBP expects refunds 60 to 90 days after acceptance. `) +
        `If yours is still pending, we are happy to sign now with payment due within 10 business days of the refund reaching your ACE account. Could you share the CAPE declaration status so we can schedule it?`,
    });
  }

  // 4. "The discount was for volume, not the tariff."
  {
    const timed =
      f.firstRevisionDate !== null &&
      TARIFF_EVENTS.some((t) => {
        const d = (Date.parse(f.firstRevisionDate!) - Date.parse(t)) / 86_400_000;
        return d >= -21 && d <= 60;
      });
    const volumeUp = f.avgQtyBefore !== null && f.avgQtyAfter !== null ? f.avgQtyAfter > f.avgQtyBefore * 1.1 : null;
    const checks: Check[] = [
      { label: 'Revision correspondence names the tariff', status: f.tariffMention ? 'pass' : 'fail' },
      { label: 'Revision dated within weeks of a tariff increase (7 Aug / 27 Aug 2025)', status: f.firstRevisionDate ? (timed ? 'pass' : 'fail') : 'unknown' },
      { label: 'Order quantities did not rise after the discount', status: volumeUp === null ? 'unknown' : volumeUp ? 'fail' : 'pass' },
      { label: 'No volume commitment in the revision', status: f.volumeMention ? 'fail' : 'pass' },
    ];
    const evidence: EvidenceRef[] = [];
    if (f.tariffMention) evidence.push(f.tariffMention);
    if (f.firstRevisionDate) evidence.push({ label: 'Timing', text: `Price revised on ${fmtDate(f.firstRevisionDate)}${timed ? ', within weeks of the 7 Aug / 27 Aug 2025 tariff increases' : ''}.`, exhibit: f.firstRevisionExhibit });
    if (f.avgQtyBefore !== null && f.avgQtyAfter !== null) {
      evidence.push({ label: 'Quantities', text: `Average quantity per invoice line: ${Math.round(f.avgQtyBefore).toLocaleString('en-US')} before the revision, ${Math.round(f.avgQtyAfter).toLocaleString('en-US')} after.` });
    }
    if (f.avgDiscountPct !== null && f.rateAtRevision !== null) {
      evidence.push({ label: 'Size of discount', text: `The price cut averaged ${fmtPct(f.avgDiscountPct)} while the IEEPA rate on these entries was ${fmtPct(f.rateAtRevision, 0)}.` });
    }
    if (f.volumeMention) evidence.push({ ...f.volumeMention, label: 'Risk: volume language' });
    const parts: string[] = [];
    if (f.tariffMention) parts.push(`the revision itself cites the tariff (${f.tariffMention.exhibit ?? 'exhibit'}: “${f.tariffMention.text}”)`);
    if (timed) parts.push(`it came within weeks of the August 2025 increases`);
    if (volumeUp === false) parts.push(`order quantities did not increase afterwards`);
    out.push({
      id: 'volume',
      objection: '“The discount was for volume, not the tariff.”',
      strength: strengthOf(checks),
      checks,
      evidence,
      response: parts.length
        ? `The record shows otherwise: ${parts.join('; ')}. A volume discount follows a volume commitment; this one followed a duty increase.` +
          (f.volumeMention ? ' (Note: the correspondence also mentions volume, so expect this objection and lead with the tariff wording.)' : '')
        : 'Weak ground: the documents do not tie the discount to the tariff. Add the email or message where the tariff was given as the reason before sending.',
    });
  }

  return out;
}
