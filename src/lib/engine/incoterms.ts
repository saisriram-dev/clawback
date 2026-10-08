// IOR triage: who was the US importer of record, and so who receives the CBP refund?

export const INCOTERMS = ['EXW', 'FCA', 'FAS', 'FOB', 'CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP'] as const;
export type Incoterm = (typeof INCOTERMS)[number];

export type Ior = 'buyer' | 'exporter' | 'unknown';

export interface IorDecision {
  incoterm: Incoterm | null;
  ior: Ior;
  route: 'negotiate' | 'claim_direct' | 'confirm';
  headline: string;
  detail: string;
}

export function normalizeIncoterm(raw: string | null | undefined): Incoterm | null {
  if (!raw) return null;
  const s = raw.toUpperCase().replace(/[^A-Z&]/g, ' ');
  if (/\bC\s*&\s*F\b|\bCNF\b|\bCANDF\b/.test(s)) return 'CFR';
  if (/\bDAT\b/.test(s)) return 'DPU';
  for (const t of INCOTERMS) if (new RegExp(`\\b${t}\\b`).test(s)) return t;
  return null;
}

/** Freight and insurance that are inside the invoice price but outside US customs value. */
export function includesFreight(t: Incoterm | null): boolean {
  return t === 'CFR' || t === 'CIF' || t === 'CPT' || t === 'CIP' || t === 'DAP' || t === 'DPU' || t === 'DDP';
}
export function includesInsurance(t: Incoterm | null): boolean {
  return t === 'CIF' || t === 'CIP';
}

export function triage(incoterm: Incoterm | null): IorDecision {
  if (!incoterm) {
    return {
      incoterm,
      ior: 'unknown',
      route: 'confirm',
      headline: 'Incoterm not found',
      detail: 'Confirm the Incoterm on the invoice. Under DDP you were the importer of record and claim from CBP yourself; under any other term the buyer received the refund.',
    };
  }
  if (incoterm === 'DDP') {
    return {
      incoterm,
      ior: 'exporter',
      route: 'claim_direct',
      headline: 'You can claim directly from CBP',
      detail: 'Shipped DDP: you (or your US entity or IOR service) were the importer of record, so the refund is paid to you. File a CAPE Declaration in the ACE Portal, or have your customs broker file it. This is not a negotiation with the buyer.',
    };
  }
  const cleared = incoterm === 'DAP' || incoterm === 'DPU' ? ' Under DAP/DPU the buyer normally clears import; confirm you did not act as IOR.' : '';
  return {
    incoterm,
    ior: 'buyer',
    route: 'negotiate',
    headline: 'Buyer was the importer of record',
    detail: `Shipped ${incoterm}: the buyer cleared US customs, paid the IEEPA duty and receives the refund. Your share is recovered by negotiation, supported by this claim pack.${cleared}`,
  };
}
