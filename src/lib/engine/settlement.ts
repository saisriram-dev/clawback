// Settlement ladder: three ways for the buyer to say yes.

import { round2 } from './money';

export type OptionId = 'A' | 'B' | 'C';

export interface SettlementOption {
  id: OptionId;
  title: string;
  amountUSD: number;
  share: number; // of the fair claim
  summary: string;
  terms: string[];
  whyItWorks: string;
  installments?: { label: string; amountUSD: number }[];
}

export interface SettlementInput {
  fairClaimUSD: number;
  splitPct: number; // option B, e.g. 50
  nextOrders: number; // option C, number of future invoices to spread over
  paymentDays: number; // option A/B terms
}

export function settlementLadder(i: SettlementInput): SettlementOption[] {
  const claim = round2(Math.max(0, i.fairClaimUSD));
  const split = Math.min(100, Math.max(1, i.splitPct));
  const n = Math.max(1, Math.min(6, Math.round(i.nextOrders)));
  const bAmount = round2((claim * split) / 100);

  const installments: { label: string; amountUSD: number }[] = [];
  let remaining = claim;
  for (let k = 1; k <= n; k++) {
    const amt = k === n ? round2(remaining) : round2(claim / n);
    installments.push({ label: `Order ${k}`, amountUSD: amt });
    remaining = round2(remaining - amt);
  }

  return [
    {
      id: 'A',
      title: 'Full settlement by credit note',
      amountUSD: claim,
      share: 1,
      summary: `The buyer remits the full fair share of the refund, including CBP interest, within ${i.paymentDays} days.`,
      terms: [
        `Amount: 100% of the fair claim`,
        `Payment by wire transfer against our credit note within ${i.paymentDays} days`,
        'Full and final settlement of the tariff-sharing discount for the listed invoices',
      ],
      whyItWorks: 'Clean and final. Best when the refund has clearly landed and the relationship is strong.',
    },
    {
      id: 'B',
      title: `${split}/${100 - split} split`,
      amountUSD: bAmount,
      share: split / 100,
      summary: `Both sides share the refund attributable to our discount: the buyer remits ${split}% within ${i.paymentDays} days.`,
      terms: [
        `Amount: ${split}% of the fair claim`,
        `Payment by wire transfer within ${i.paymentDays} days`,
        'We waive the balance in recognition of the relationship',
      ],
      whyItWorks: 'Gives the buyer a visible concession and closes fast. Use it when the buyer disputes how much of the discount was tariff-driven.',
    },
    {
      id: 'C',
      title: 'Credit against the next order',
      amountUSD: claim,
      share: 1,
      summary: `No cash moves now. The full amount is applied as a refund-share line on the invoice for the next ${n === 1 ? 'purchase order' : `${n} purchase orders`}.`,
      terms: [
        n === 1 ? 'Applied on the next purchase-order invoice' : `Spread in equal parts over the next ${n} purchase-order invoices`,
        'Current pricing held for those orders',
        'Settles automatically as the orders ship',
      ],
      whyItWorks: 'Keeps the money inside the relationship: the buyer pays it with the next order instead of writing a cheque, and you secure the next order. This is the option buyers are most likely to accept.',
      installments,
    },
  ];
}
