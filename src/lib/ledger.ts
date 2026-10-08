// Absorption Ledger: turns extracted documents into claim figures.
// Pure and deterministic: no model, no I/O, no clock (today is passed in).
// Runs on the server (claim pack, portfolio) and in the browser (instant recalculation).

import type { Buyer, Confidence, DocRecord, Field, LineOverride, Settings, SourceRef, Workspace, DocKind } from './types';
import { addDays, fmtDate, diffDays } from './engine/dates';
import { clamp, fmtPct, fmtPrice, fmtUSD, round2, round4, usdToInr } from './engine/money';
import { indiaIeepaRate, exemptionFlags, type AppliedComponent, IEEPA_END_EXCLUSIVE } from './engine/rates';
import { cbpInterest } from './engine/interest';
import { readClock, capePhase1Eligible, type ClockReading } from './engine/refundClock';
import { triage, includesFreight, includesInsurance, normalizeIncoterm, type IorDecision, type Ior } from './engine/incoterms';
import { leverage as leverageScore, type LeverageResult } from './engine/leverage';
import { settlementLadder, type SettlementOption } from './engine/settlement';
import { buildObjections, type Objection, type EvidenceRef } from './engine/objections';
import { normRef, splitList, tokens, jaccard, parseNumber } from './engine/normalize';

export type CellConf = Confidence | 'computed' | 'estimated' | 'lookup' | 'default' | 'missing';

export interface Cell {
  v: number | string | null;
  fmt: 'usd' | 'price' | 'num' | 'pct' | 'date' | 'text' | 'hs';
  src: SourceRef | null;
  conf: CellConf;
  field?: { docId: string; key: string } | null; // the document field behind this value (editable)
  override?: keyof LineOverride | null; // the line override that can replace it (editable)
  note?: string;
}

export interface ReceiptStep {
  label: string;
  formula: string;
  plugged: string;
  result: string;
}

export interface Flag {
  level: 'info' | 'warn' | 'error';
  code: string;
  text: string;
}

export interface LedgerLine {
  key: string;
  docId: string;
  itemIndex: number;
  exhibit: string;
  invoiceNo: Cell;
  invoiceDate: Cell;
  description: Cell;
  hs: Cell;
  qty: Cell;
  unit: string;
  incoterm: Cell;
  ior: Ior;
  invoicePrice: Cell;
  baseline: Cell;
  revised: Cell;
  discountMode: 'on_invoice' | 'credit_note' | 'none';
  lineAmount: Cell;
  freightAlloc: number;
  customsValue: Cell;
  loadDate: Cell;
  entryDate: Cell;
  rate: Cell;
  rateComponents: AppliedComponent[];
  rateTrail: string[];
  tariffPaid: Cell;
  absorbed: Cell;
  ratio: Cell;
  refundPrincipal: Cell;
  interest: Cell;
  fairClaim: Cell;
  realized: Cell | null;
  realizedCheck: 'match' | 'short' | 'over' | null;
  revisionDocId: string | null;
  revisionExhibit: string | null;
  flags: Flag[];
  receipt: ReceiptStep[];
  excluded: boolean;
  exempt: boolean;
  phase1: boolean;
}

export interface Exhibit {
  code: string;
  docId: string;
  kind: DocKind;
  title: string;
  date: string | null;
  filename: string;
}

export interface BuyerTotals {
  lines: number;
  customsValue: number;
  tariffPaid: number;
  absorbed: number;
  ratio: number;
  refundPrincipal: number;
  interest: number;
  fairClaim: number;
  fairClaimINR: number;
  directClaim: number;
  directClaimINR: number;
  realized: number;
}

export interface BuyerLedger {
  buyer: Buyer;
  lines: LedgerLine[];
  directLines: LedgerLine[];
  exhibits: Exhibit[];
  totals: BuyerTotals;
  route: 'negotiate' | 'claim_direct' | 'mixed' | 'confirm' | 'empty';
  decision: IorDecision;
  incoterms: string[];
  clock: ClockReading;
  leverage: LeverageResult;
  priority: number;
  options: SettlementOption[];
  objections: Objection[];
  flags: Flag[];
  tariffMention: EvidenceRef | null;
  docCount: number;
}

export interface Portfolio {
  today: string;
  buyers: BuyerLedger[];
  totals: {
    fairClaimUSD: number;
    fairClaimINR: number;
    buyersWithClaim: number;
    tariffPaidUSD: number;
    absorbedUSD: number;
    ratio: number;
    directClaimUSD: number;
    recoveredUSD: number;
    recoveredINR: number;
    agreedUSD: number;
    documents: number;
    lines: number;
    fieldsTotal: number;
    fieldsGrounded: number;
    needsReview: number;
  };
  unassigned: DocRecord[];
}

// ---------------------------------------------------------------------------------------
// Field access

export function field(doc: DocRecord | undefined, key: string): Field | undefined {
  return doc?.fields[key];
}

function cellFromField(doc: DocRecord, key: string, fmt: Cell['fmt']): Cell {
  const f = doc.fields[key];
  if (!f || f.value === null || f.value === '') {
    return { v: null, fmt, src: null, conf: 'missing', field: { docId: doc.id, key } };
  }
  const v = fmt === 'usd' || fmt === 'price' || fmt === 'num' ? parseNumber(f.value) : f.value;
  return { v, fmt, src: f.source, conf: f.confidence, field: { docId: doc.id, key } };
}

function numOf(c: Cell): number | null {
  return typeof c.v === 'number' && Number.isFinite(c.v) ? c.v : null;
}

const approx = (a: number | null, b: number | null, tol = 0.006) => a !== null && b !== null && Math.abs(a - b) <= Math.max(tol, Math.abs(b) * 0.001);

// ---------------------------------------------------------------------------------------
// Revision items and bank realisations, flattened per buyer

interface RevisionItem {
  doc: DocRecord;
  index: number;
  product: string | null;
  hs: string | null;
  baseline: number | null;
  revised: number | null;
  appliesTo: string[];
  date: string | null;
  effectiveFrom: string | null;
}

function revisionItems(docs: DocRecord[]): RevisionItem[] {
  const out: RevisionItem[] = [];
  for (const d of docs) {
    const appliesTo = splitList(d.fields['applies_to']?.value).map(normRef).filter(Boolean);
    const date = d.fields['email_date']?.value ?? null;
    const effectiveFrom = d.fields['effective_from']?.value ?? null;
    for (let i = 0; i < d.itemCount; i++) {
      out.push({
        doc: d,
        index: i,
        product: d.fields[`items.${i}.product`]?.value ?? null,
        hs: d.fields[`items.${i}.hs_code`]?.value ?? null,
        baseline: parseNumber(d.fields[`items.${i}.baseline_price`]?.value ?? null),
        revised: parseNumber(d.fields[`items.${i}.revised_price`]?.value ?? null),
        appliesTo,
        date,
        effectiveFrom,
      });
    }
  }
  return out;
}

interface Realisation {
  doc: DocRecord;
  index: number;
  invoiceRef: string;
  amount: number | null;
  date: string | null;
}

function realisations(docs: DocRecord[]): Realisation[] {
  const out: Realisation[] = [];
  for (const d of docs) {
    for (let i = 0; i < d.itemCount; i++) {
      const ref = normRef(d.fields[`items.${i}.invoice_ref`]?.value);
      if (!ref) continue;
      out.push({
        doc: d,
        index: i,
        invoiceRef: ref,
        amount: parseNumber(d.fields[`items.${i}.fcy_amount`]?.value ?? null),
        date: d.fields[`items.${i}.realization_date`]?.value ?? null,
      });
    }
  }
  return out;
}

function matchRevision(
  revs: RevisionItem[],
  inv: { ref: string; po: string; date: string | null; hs: string | null; desc: string | null; price: number | null },
): { item: RevisionItem; explicit: boolean } | null {
  let best: { item: RevisionItem; score: number; explicit: boolean } | null = null;
  const descTokens = tokens(inv.desc);
  for (const r of revs) {
    if (r.baseline === null && r.revised === null) continue;
    let score = 0;
    const listed = r.appliesTo.length > 0;
    const explicit = listed && ((!!inv.ref && r.appliesTo.includes(inv.ref)) || (!!inv.po && r.appliesTo.includes(inv.po)));
    if (explicit) score += 100;
    else if (listed && inv.ref) score -= 40;
    if (r.hs && inv.hs) {
      if (r.hs.slice(0, 6) === inv.hs.slice(0, 6)) score += 30;
      else if (r.hs.slice(0, 4) === inv.hs.slice(0, 4)) score += 15;
      else score -= 30;
    }
    if (r.product && descTokens.size) {
      const j = jaccard(tokens(r.product), descTokens);
      if (j >= 0.3) score += 20;
      else if (j === 0 && r.hs === null) score -= 10;
    }
    const atRevised = approx(inv.price, r.revised);
    const atBaseline = approx(inv.price, r.baseline);
    if (atRevised) score += 40;
    else if (atBaseline) score += explicit ? 25 : -60; // a baseline-priced invoice only counts if the revision names it
    const start = r.effectiveFrom ?? r.date;
    if (start && inv.date) {
      if (inv.date >= start) score += 10;
      else if (!explicit && !atRevised) score -= 30;
    }
    if (score >= 30 && (!best || score > best.score)) best = { item: r, score, explicit };
  }
  return best ? { item: best.item, explicit: best.explicit } : null;
}

// ---------------------------------------------------------------------------------------

const KIND_ORDER: DocKind[] = ['invoice', 'price_revision', 'bank_realization', 'refund_notice', 'other'];

function docDate(d: DocRecord): string | null {
  return (
    d.fields['invoice_date']?.value ??
    d.fields['email_date']?.value ??
    d.fields['items.0.realization_date']?.value ??
    d.fields['refund_date']?.value ??
    null
  );
}

function docTitle(d: DocRecord): string {
  switch (d.kind) {
    case 'invoice':
      return `Commercial invoice ${d.fields['invoice_number']?.value ?? d.filename}`;
    case 'price_revision':
      return `Price revision${d.fields['email_date']?.value ? ` of ${fmtDate(d.fields['email_date']?.value)}` : ''}${d.fields['subject']?.value ? `: “${d.fields['subject']?.value}”` : ''}`;
    case 'bank_realization':
      return `Bank realisation ${d.fields['document_ref']?.value ?? d.filename}`;
    case 'refund_notice':
      return `Refund confirmation ${d.fields['cape_reference']?.value ?? ''}`.trim();
    default:
      return d.filename;
  }
}

export function exhibitsFor(docs: DocRecord[]): Exhibit[] {
  const sorted = [...docs].sort((a, b) => {
    const k = KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind);
    if (k) return k;
    const da = docDate(a) ?? '9999';
    const db = docDate(b) ?? '9999';
    if (da !== db) return da < db ? -1 : 1;
    return a.filename.localeCompare(b.filename);
  });
  return sorted.map((d, i) => ({ code: `A-${i + 1}`, docId: d.id, kind: d.kind, title: docTitle(d), date: docDate(d), filename: d.filename }));
}

const TARIFF_WORDS = /\b(tariffs?|duty|duties|ieepa|reciprocal|customs|levy|50\s?%|25\s?%)\b/i;
const VOLUME_WORDS = /\b(volume|bulk|larger (orders?|quantities)|quantity commitment|annual commitment|minimum order|higher quantities)\b/i;

function scanEvidence(docs: DocRecord[], re: RegExp, exhibits: Exhibit[], label: string): EvidenceRef | null {
  for (const d of docs) {
    const start = d.meta.emailSubject ? 0 : 0;
    for (let i = start; i < d.lines.length; i++) {
      const t = d.lines[i].text;
      if (/^(from|to|cc|date|subject)\s*:/i.test(t.trim())) continue;
      if (re.test(t)) {
        const ex = exhibits.find((e) => e.docId === d.id)?.code ?? null;
        return { label, text: t.trim().slice(0, 240), src: { docId: d.id, line: i + 1, quote: t.trim() }, exhibit: ex };
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------------------

export function buildBuyerLedger(ws: Workspace, buyer: Buyer, today: string): BuyerLedger {
  const s: Settings = ws.settings;
  const docs = Object.values(ws.documents).filter((d) => d.buyerId === buyer.id && d.status === 'ready');
  const exhibits = exhibitsFor(docs);
  const exOf = (id: string) => exhibits.find((e) => e.docId === id)?.code ?? '—';
  const invoices = docs.filter((d) => d.kind === 'invoice');
  const revDocs = docs.filter((d) => d.kind === 'price_revision');
  const revs = revisionItems(revDocs);
  const reals = realisations(docs.filter((d) => d.kind === 'bank_realization'));

  // Refund confirmation: buyer fields first, then any refund notice on file.
  const notices = docs.filter((d) => d.kind === 'refund_notice');
  let confirmedDate = buyer.refundConfirmedDate;
  let confirmedPrincipal = buyer.refundConfirmedUSD;
  let confirmedInterest = buyer.refundConfirmedInterestUSD;
  if (!confirmedDate && notices.length) {
    const dates = notices.map((n) => n.fields['refund_date']?.value).filter(Boolean) as string[];
    confirmedDate = dates.sort().at(-1) ?? null;
    const p = notices.map((n) => parseNumber(n.fields['refund_amount']?.value ?? null)).filter((x): x is number => x !== null);
    const it = notices.map((n) => parseNumber(n.fields['interest_amount']?.value ?? null)).filter((x): x is number => x !== null);
    if (p.length && confirmedPrincipal === null) confirmedPrincipal = round2(p.reduce((a, b) => a + b, 0));
    if (it.length && confirmedInterest === null) confirmedInterest = round2(it.reduce((a, b) => a + b, 0));
  }

  const clockForDates = readClock(0, today, s.holdingRatePct / 100, confirmedDate);
  const refundDate = clockForDates.window.likely;
  const transit = buyer.transitDays ?? s.transitDaysDefault;

  const all: LedgerLine[] = [];

  for (const inv of invoices) {
    const invNo = cellFromField(inv, 'invoice_number', 'text');
    const invDate = cellFromField(inv, 'invoice_date', 'date');
    const shipDate = cellFromField(inv, 'ship_date', 'date');
    const incotermCell = cellFromField(inv, 'incoterm', 'text');
    const incoterm = normalizeIncoterm(typeof incotermCell.v === 'string' ? incotermCell.v : null);
    const decision = triage(incoterm);
    const freight = parseNumber(inv.fields['freight']?.value ?? null) ?? 0;
    const insurance = parseNumber(inv.fields['insurance']?.value ?? null) ?? 0;
    const freightIns = round2((includesFreight(incoterm) ? freight : 0) + (includesInsurance(incoterm) ? insurance : 0));
    const ref = normRef(typeof invNo.v === 'string' ? invNo.v : '');
    const po = normRef(inv.fields['po_number']?.value);

    // Line amounts for freight allocation
    const items = Array.from({ length: inv.itemCount }, (_, i) => {
      const qty = cellFromField(inv, `items.${i}.qty`, 'num');
      const price = cellFromField(inv, `items.${i}.unit_price`, 'price');
      const amount = cellFromField(inv, `items.${i}.amount`, 'usd');
      let q = numOf(qty);
      let p = numOf(price);
      const a = numOf(amount);
      if (q === null && a !== null && p) {
        q = round4(a / p);
        qty.v = q;
        qty.conf = 'computed';
        qty.note = 'amount ÷ unit price';
      }
      if (p === null && a !== null && q) {
        p = round4(a / q);
        price.v = p;
        price.conf = 'computed';
        price.note = 'amount ÷ quantity';
      }
      const lineAmt = q !== null && p !== null ? round2(q * p) : a ?? 0;
      return { qty, price, amount, q, p, a, lineAmt };
    });
    const invoiceGross = round2(items.reduce((acc, it) => acc + it.lineAmt, 0));
    const statedTotal = parseNumber(inv.fields['total']?.value ?? null);
    // Freight/insurance are outside US customs value. Deduct them from the item amounts only
    // when the item prices include them (i.e. the invoice total equals the item sum).
    const tol = (x: number) => Math.max(1, x * 0.002);
    const freightAddedSeparately =
      statedTotal !== null && freightIns > 0 && Math.abs(statedTotal - (invoiceGross + freight + insurance)) <= tol(statedTotal) && Math.abs(statedTotal - invoiceGross) > tol(statedTotal);
    const deductible = freightAddedSeparately ? 0 : freightIns;

    // Realisations for this invoice
    const myReals = ref ? reals.filter((r) => r.invoiceRef === ref || r.invoiceRef.endsWith(ref) || ref.endsWith(r.invoiceRef)) : [];
    const realizedAmt = myReals.length ? round2(myReals.reduce((acc, r) => acc + (r.amount ?? 0), 0)) : null;
    const invoiceTotal = statedTotal ?? invoiceGross;

    items.forEach((it, i) => {
      const key = `${inv.id}#${i}`;
      const ov: LineOverride = ws.lineOverrides[key] ?? {};
      const flags: Flag[] = [];
      const receipt: ReceiptStep[] = [];

      const desc = cellFromField(inv, `items.${i}.description`, 'text');
      const hs = cellFromField(inv, `items.${i}.hs_code`, 'hs');
      const listPrice = cellFromField(inv, `items.${i}.list_price`, 'price');
      const unit = inv.fields[`items.${i}.unit`]?.value ?? '';
      const q = it.q ?? 0;
      const p = it.p;

      if (it.q === null) flags.push({ level: 'error', code: 'no-qty', text: 'Quantity not found. Correct it to compute this line.' });
      if (p === null) flags.push({ level: 'error', code: 'no-price', text: 'Unit price not found. Correct it to compute this line.' });
      if (it.a !== null && it.q !== null && it.p !== null && Math.abs(it.a - it.q * it.p) > Math.max(0.05, it.a * 0.01)) {
        flags.push({ level: 'warn', code: 'amount-mismatch', text: `Line amount ${fmtUSD(it.a)} differs from qty × price ${fmtUSD(round2(it.q * it.p))}.` });
      }

      // ---- baseline & revised
      const match = matchRevision(revs, {
        ref,
        po,
        date: typeof invDate.v === 'string' ? invDate.v : null,
        hs: typeof hs.v === 'string' ? hs.v : null,
        desc: typeof desc.v === 'string' ? desc.v : null,
        price: p,
      });
      const rev = match?.item ?? null;
      const revBaselineCell = rev ? cellFromField(rev.doc, `items.${rev.index}.baseline_price`, 'price') : null;
      const revRevisedCell = rev ? cellFromField(rev.doc, `items.${rev.index}.revised_price`, 'price') : null;

      let discountMode: LedgerLine['discountMode'] = 'none';
      let baseline: Cell;
      let revised: Cell;
      const invoicePriceCell: Cell = { ...it.price };

      if (ov.discountMode) discountMode = ov.discountMode;
      else if (numOf(listPrice) !== null) discountMode = 'on_invoice';
      else if (rev) {
        if (approx(p, rev.revised)) discountMode = 'on_invoice';
        else if (approx(p, rev.baseline) && match?.explicit) discountMode = 'credit_note';
        else discountMode = 'on_invoice';
      }

      if (ov.baselinePrice !== undefined && ov.baselinePrice !== null) {
        baseline = { v: ov.baselinePrice, fmt: 'price', src: null, conf: 'manual', override: 'baselinePrice' };
      } else if (numOf(listPrice) !== null) {
        baseline = { ...listPrice, override: 'baselinePrice' };
      } else if (revBaselineCell && numOf(revBaselineCell) !== null) {
        baseline = { ...revBaselineCell, override: 'baselinePrice' };
      } else {
        baseline = { v: null, fmt: 'price', src: null, conf: 'missing', override: 'baselinePrice', note: 'No pre-tariff price found' };
      }

      if (ov.revisedPrice !== undefined && ov.revisedPrice !== null) {
        revised = { v: ov.revisedPrice, fmt: 'price', src: null, conf: 'manual', override: 'revisedPrice' };
      } else if (discountMode === 'credit_note' && revRevisedCell && numOf(revRevisedCell) !== null) {
        revised = { ...revRevisedCell, override: 'revisedPrice' };
      } else if (discountMode === 'credit_note' && realizedAmt !== null && items.length === 1 && q > 0) {
        const r = round4((realizedAmt - deductible) / q);
        revised = { v: r, fmt: 'price', src: myReals[0] ? srcOfReal(myReals[0]) : null, conf: 'computed', note: 'bank-realised amount ÷ quantity', override: 'revisedPrice' };
      } else {
        revised = { ...invoicePriceCell, override: 'revisedPrice' };
      }

      // A shipment invoiced at a revision's old price, before that revision, is a pre-revision shipment.
      if (baseline.v === null && !rev && p !== null && typeof invDate.v === 'string') {
        const pre = revs.find((r) => approx(p, r.baseline) && invDate.v! < (r.effectiveFrom ?? r.date ?? '0000'));
        if (pre) {
          baseline = { ...invoicePriceCell, override: 'baselinePrice', note: 'pre-revision shipment at the original price' };
          flags.push({ level: 'info', code: 'pre-revision', text: `Shipped before the price revision (${exOf(pre.doc.id)}) at the original price: nothing was absorbed on this line.` });
        }
      }
      if (decision.ior === 'exporter') {
        flags.push({ level: 'info', code: 'ddp-value', text: 'DDP price includes US duty and delivery costs, so the customs value is lower than the invoice value. Enter the entered value from your CBP Form 7501 for an exact figure.' });
      } else if (baseline.v === null && !ov.excluded) {
        flags.push({ level: 'warn', code: 'no-baseline', text: 'No pre-tariff price found for this line, so nothing is counted as absorbed. Upload the price-revision email or enter the baseline price.' });
      }
      if (rev && discountMode === 'on_invoice' && numOf(listPrice) === null && !approx(p, rev.revised)) {
        flags.push({ level: 'warn', code: 'price-differs', text: `Invoice price ${fmtPrice(p)} differs from the revised price ${fmtPrice(rev.revised)} in ${exOf(rev.doc.id)}. Invoice price used.` });
      }

      // ---- customs value
      const lineAmount: Cell = { v: it.lineAmt, fmt: 'usd', src: it.amount.src ?? it.price.src, conf: 'computed', note: 'qty × invoice unit price' };
      const freightAlloc = invoiceGross > 0 ? round2((deductible * it.lineAmt) / invoiceGross) : 0;
      let customsValue: Cell;
      if (ov.customsValue !== undefined && ov.customsValue !== null) {
        customsValue = { v: ov.customsValue, fmt: 'usd', src: null, conf: 'manual', override: 'customsValue' };
      } else {
        customsValue = { v: round2(it.lineAmt - freightAlloc), fmt: 'usd', src: null, conf: 'computed', override: 'customsValue' };
      }
      if ((incoterm === 'CIF' || incoterm === 'CFR' || incoterm === 'CIP' || incoterm === 'CPT') && freightIns === 0) {
        flags.push({ level: 'warn', code: 'no-freight', text: `${incoterm} invoice without a separate freight figure: US customs value excludes international freight${includesInsurance(incoterm) ? ' and insurance' : ''}, so it may be overstated. Enter the customs value from the entry if you have it.` });
      }
      receipt.push({
        label: 'Customs value',
        formula: deductible > 0 ? 'qty × invoice unit price − freight & insurance share' : 'qty × invoice unit price',
        plugged: deductible > 0 ? `${fmtQty(q)} × ${fmtPrice(p)} − ${fmtUSD(freightAlloc)}` : `${fmtQty(q)} × ${fmtPrice(p)}`,
        result: fmtUSD(numOf(customsValue)),
      });

      // ---- dates
      const shipIso = typeof shipDate.v === 'string' ? shipDate.v : null;
      const invIso = typeof invDate.v === 'string' ? invDate.v : null;
      let loadDate: Cell;
      if (ov.loadDate) loadDate = { v: ov.loadDate, fmt: 'date', src: null, conf: 'manual', override: 'loadDate' };
      else if (shipIso) loadDate = { ...shipDate, override: 'loadDate' };
      else if (invIso) loadDate = { v: invIso, fmt: 'date', src: invDate.src, conf: 'estimated', override: 'loadDate', note: 'invoice date used as loading date' };
      else loadDate = { v: null, fmt: 'date', src: null, conf: 'missing', override: 'loadDate' };

      let entryDate: Cell;
      const loadIso = typeof loadDate.v === 'string' ? loadDate.v : null;
      if (ov.entryDate) entryDate = { v: ov.entryDate, fmt: 'date', src: null, conf: 'manual', override: 'entryDate' };
      else if (loadIso) entryDate = { v: addDays(loadIso, transit), fmt: 'date', src: loadDate.src, conf: 'estimated', override: 'entryDate', note: `loading date + ${transit} days transit` };
      else entryDate = { v: null, fmt: 'date', src: null, conf: 'missing', override: 'entryDate' };
      const entryIso = typeof entryDate.v === 'string' ? entryDate.v : null;
      if (!entryIso) flags.push({ level: 'error', code: 'no-date', text: 'No invoice, shipment or entry date: the duty rate cannot be looked up.' });

      // ---- rate
      let rateVal = 0;
      let components: AppliedComponent[] = [];
      let trail: string[] = [];
      let rateCell: Cell;
      if (ov.exempt) {
        rateCell = { v: 0, fmt: 'pct', src: null, conf: 'manual', override: 'exempt', note: 'marked exempt' };
        trail = ['Marked exempt by user.'];
      } else if (ov.ratePct !== undefined && ov.ratePct !== null) {
        rateVal = ov.ratePct / 100;
        rateCell = { v: rateVal, fmt: 'pct', src: null, conf: 'manual', override: 'ratePct' };
        trail = [`Rate set manually to ${ov.ratePct}%.`];
      } else if (entryIso) {
        const r = indiaIeepaRate(entryIso, loadIso);
        rateVal = r.rate;
        components = r.components;
        trail = r.trail;
        rateCell = { v: rateVal, fmt: 'pct', src: null, conf: 'lookup', override: 'ratePct' };
      } else {
        rateCell = { v: null, fmt: 'pct', src: null, conf: 'missing', override: 'ratePct' };
      }
      if (typeof hs.v === 'string' && !ov.exempt) {
        for (const ef of exemptionFlags(hs.v)) flags.push({ level: 'warn', code: ef.code, text: ef.text });
      }
      if (entryIso && entryIso >= IEEPA_END_EXCLUSIVE) flags.push({ level: 'info', code: 'post-ieepa', text: 'Entered after IEEPA duties ended (24 Feb 2026): nothing to refund.' });
      receipt.push({
        label: 'IEEPA rate on entry date',
        formula: 'rate_table(entry_date, loading_date)',
        plugged: `entry ${fmtDate(entryIso)}${entryDate.conf === 'estimated' ? ` (est. ${fmtDate(loadIso)} + ${transit} d)` : ''}${components.length ? ': ' + components.map((c) => `${(c.rate * 100).toFixed(0)}%`).join(' + ') : ''}`,
        result: fmtPct(rateVal, 0),
      });

      // ---- the four formulas
      const cv = numOf(customsValue) ?? 0;
      const tariffPaid = round2(cv * rateVal);
      receipt.push({ label: 'Tariff paid by buyer', formula: 'customs_value × IEEPA_rate', plugged: `${fmtUSD(cv)} × ${fmtPct(rateVal, 0)}`, result: fmtUSD(tariffPaid) });

      const b = numOf(baseline);
      const rv = numOf(revised);
      const rawAbsorbed = b !== null && rv !== null ? round2((b - rv) * q) : 0;
      const absorbed = round2(clamp(rawAbsorbed, 0, tariffPaid));
      if (rawAbsorbed > tariffPaid && tariffPaid > 0) flags.push({ level: 'info', code: 'capped', text: `Price reduction ${fmtUSD(rawAbsorbed)} exceeds the duty paid; capped at ${fmtUSD(tariffPaid)}.` });
      if (rawAbsorbed < 0) flags.push({ level: 'warn', code: 'price-up', text: 'Revised price is higher than the baseline: no absorption.' });
      receipt.push({
        label: 'Absorbed by you',
        formula: 'min((baseline − revised) × qty, tariff_paid)',
        plugged: b !== null && rv !== null ? `min((${fmtPrice(b)} − ${fmtPrice(rv)}) × ${fmtQty(q)}, ${fmtUSD(tariffPaid)}) = min(${fmtUSD(rawAbsorbed)}, ${fmtUSD(tariffPaid)})` : 'no baseline price',
        result: fmtUSD(absorbed),
      });

      const ratio = tariffPaid > 0 ? absorbed / tariffPaid : 0;
      receipt.push({ label: 'Absorption ratio', formula: 'absorbed ÷ tariff_paid', plugged: `${fmtUSD(absorbed)} ÷ ${fmtUSD(tariffPaid)}`, result: fmtPct(ratio, 2) });

      const ior = decision.ior;
      const depositDate = entryIso ? addDays(entryIso, s.depositLagDays) : null;
      const interestRes = depositDate && tariffPaid > 0 ? cbpInterest(tariffPaid, depositDate, refundDate, s.interestBasis) : null;
      const principal = tariffPaid;
      const interest = interestRes?.interest ?? 0;
      receipt.push({
        label: 'CBP interest on the refund',
        formula: 'refund × daily-compounded IRS overpayment rate, deposit → refund',
        plugged: depositDate ? `${fmtUSD(principal)} from ${fmtDate(depositDate)} to ${fmtDate(refundDate)} (${interestRes?.days ?? 0} d at ${uniqueRates(interestRes)})` : '—',
        result: fmtUSD(interest),
      });

      const fair = round2(ratio * (principal + interest));
      receipt.push({ label: 'Fair claim', formula: 'absorption_ratio × (refund + interest)', plugged: `${fmtPct(ratio, 2)} × (${fmtUSD(principal)} + ${fmtUSD(interest)})`, result: fmtUSD(fair) });

      // ---- realised amount (invoice level)
      let realized: Cell | null = null;
      let realizedCheck: LedgerLine['realizedCheck'] = null;
      if (realizedAmt !== null) {
        realized = { v: realizedAmt, fmt: 'usd', src: srcOfReal(myReals[0]), conf: myReals[0].doc.fields[`items.${myReals[0].index}.fcy_amount`]?.confidence ?? 'medium', field: { docId: myReals[0].doc.id, key: `items.${myReals[0].index}.fcy_amount` }, note: myReals.length > 1 ? `${myReals.length} realisations` : undefined };
        const diff = realizedAmt - invoiceTotal;
        realizedCheck = Math.abs(diff) <= Math.max(5, invoiceTotal * 0.005) ? 'match' : diff < 0 ? 'short' : 'over';
        if (realizedCheck === 'short') flags.push({ level: 'info', code: 'short-realised', text: `Bank realised ${fmtUSD(realizedAmt)} against an invoice total of ${fmtUSD(invoiceTotal)} (short by ${fmtUSD(-diff)}).` });
      }

      const line: LedgerLine = {
        key,
        docId: inv.id,
        itemIndex: i,
        exhibit: exOf(inv.id),
        invoiceNo: invNo,
        invoiceDate: invDate,
        description: desc,
        hs,
        qty: it.qty,
        unit,
        incoterm: incotermCell,
        ior,
        invoicePrice: invoicePriceCell,
        baseline,
        revised,
        discountMode,
        lineAmount,
        freightAlloc,
        customsValue,
        loadDate,
        entryDate,
        rate: rateCell,
        rateComponents: components,
        rateTrail: trail,
        tariffPaid: { v: tariffPaid, fmt: 'usd', src: null, conf: 'computed' },
        absorbed: { v: absorbed, fmt: 'usd', src: null, conf: 'computed' },
        ratio: { v: ratio, fmt: 'pct', src: null, conf: 'computed' },
        refundPrincipal: { v: principal, fmt: 'usd', src: null, conf: 'computed' },
        interest: { v: interest, fmt: 'usd', src: null, conf: 'estimated' },
        fairClaim: { v: fair, fmt: 'usd', src: null, conf: 'computed' },
        realized,
        realizedCheck,
        revisionDocId: rev?.doc.id ?? null,
        revisionExhibit: rev ? exOf(rev.doc.id) : null,
        flags,
        receipt,
        excluded: !!ov.excluded,
        exempt: !!ov.exempt,
        phase1: entryIso ? capePhase1Eligible(entryIso).eligible : false,
      };
      all.push(line);
    });
  }

  // Confirmed refund overrides the per-line estimate, allocated by duty paid.
  const negotiable = all.filter((l) => l.ior !== 'exporter');
  const direct = all.filter((l) => l.ior === 'exporter');
  const active = negotiable.filter((l) => !l.excluded);
  const sumPaid = round2(active.reduce((a, l) => a + (l.tariffPaid.v as number), 0));
  if (confirmedPrincipal !== null && sumPaid > 0) {
    for (const l of active) {
      const share = (l.tariffPaid.v as number) / sumPaid;
      const principal = round2(confirmedPrincipal * share);
      const interest = confirmedInterest !== null ? round2(confirmedInterest * share) : (l.interest.v as number);
      const ratio = l.ratio.v as number;
      const fair = round2(ratio * (principal + interest));
      l.refundPrincipal = { v: principal, fmt: 'usd', src: null, conf: 'computed', note: 'confirmed refund allocated by duty paid' };
      l.interest = { v: interest, fmt: 'usd', src: null, conf: confirmedInterest !== null ? 'computed' : 'estimated' };
      l.fairClaim = { v: fair, fmt: 'usd', src: null, conf: 'computed' };
      l.receipt = l.receipt.filter((r) => r.label !== 'Fair claim');
      l.receipt.push({ label: 'Confirmed refund share', formula: 'confirmed_refund × tariff_paid ÷ Σ tariff_paid', plugged: `${fmtUSD(confirmedPrincipal)} × ${fmtPct(share, 2)}`, result: fmtUSD(principal) });
      l.receipt.push({ label: 'Fair claim', formula: 'absorption_ratio × (refund + interest)', plugged: `${fmtPct(ratio, 2)} × (${fmtUSD(principal)} + ${fmtUSD(interest)})`, result: fmtUSD(fair) });
    }
  }

  const sumOf = (ls: LedgerLine[], k: 'customsValue' | 'tariffPaid' | 'absorbed' | 'refundPrincipal' | 'interest' | 'fairClaim') =>
    round2(ls.reduce((a, l) => a + ((l[k].v as number) || 0), 0));

  const tariffPaid = sumOf(active, 'tariffPaid');
  const absorbed = sumOf(active, 'absorbed');
  const fairClaim = sumOf(active, 'fairClaim');
  const directActive = direct.filter((l) => !l.excluded);
  const directClaim = round2(sumOf(directActive, 'tariffPaid') + sumOf(directActive, 'interest'));
  const realizedSeen = new Set<string>();
  let realized = 0;
  for (const l of all) {
    if (l.realized && !realizedSeen.has(l.docId)) {
      realizedSeen.add(l.docId);
      realized += l.realized.v as number;
    }
  }

  const totals: BuyerTotals = {
    lines: active.length,
    customsValue: sumOf(active, 'customsValue'),
    tariffPaid,
    absorbed,
    ratio: tariffPaid > 0 ? absorbed / tariffPaid : 0,
    refundPrincipal: sumOf(active, 'refundPrincipal'),
    interest: sumOf(active, 'interest'),
    fairClaim,
    fairClaimINR: usdToInr(fairClaim, s.fxUsdInr),
    directClaim,
    directClaimINR: usdToInr(directClaim, s.fxUsdInr),
    realized: round2(realized),
  };

  const incoterms = [...new Set(all.map((l) => (typeof l.incoterm.v === 'string' ? normalizeIncoterm(l.incoterm.v) : null)).filter(Boolean))] as string[];
  let route: BuyerLedger['route'] = 'empty';
  if (all.length) {
    if (direct.length && !negotiable.length) route = 'claim_direct';
    else if (direct.length && negotiable.length) route = 'mixed';
    else if (negotiable.some((l) => l.ior === 'unknown')) route = 'confirm';
    else route = 'negotiate';
  }
  const decision = triage(route === 'claim_direct' ? 'DDP' : (normalizeIncoterm(incoterms.find((t) => t !== 'DDP') ?? null) ?? (incoterms.includes('DDP') ? 'DDP' : null)));

  const clock = readClock(fairClaim, today, s.holdingRatePct / 100, confirmedDate);
  const currentYear = Number(today.slice(0, 4));
  const lev = leverageScore(
    { revenueSharePct: buyer.revenueSharePct, relationshipSinceYear: buyer.relationshipSinceYear, openOrders: buyer.openOrders },
    currentYear,
  );
  const options = settlementLadder({ fairClaimUSD: fairClaim, splitPct: s.splitPct, nextOrders: s.nextOrders, paymentDays: s.paymentDays });

  // Objection evidence
  const tariffMention = scanEvidence(revDocs, TARIFF_WORDS, exhibits, 'Reason given for the discount');
  const volumeMention = scanEvidence(revDocs, VOLUME_WORDS, exhibits, 'Volume language');
  const revDates = revDocs.map((d) => d.fields['email_date']?.value).filter(Boolean).sort() as string[];
  const firstRev = revDates[0] ?? null;
  const firstRevDoc = firstRev ? revDocs.find((d) => d.fields['email_date']?.value === firstRev) : undefined;
  const before = all.filter((l) => firstRev && typeof l.invoiceDate.v === 'string' && l.invoiceDate.v < firstRev && numOf(l.qty) !== null);
  const after = all.filter((l) => firstRev && typeof l.invoiceDate.v === 'string' && l.invoiceDate.v >= firstRev && numOf(l.qty) !== null);
  const avg = (ls: LedgerLine[]) => (ls.length ? ls.reduce((a, l) => a + (numOf(l.qty) ?? 0), 0) / ls.length : null);
  const discounted = active.filter((l) => numOf(l.baseline) && numOf(l.revised) !== null && (numOf(l.baseline)! > numOf(l.revised)!));
  const avgDiscount = discounted.length ? discounted.reduce((a, l) => a + (numOf(l.baseline)! - numOf(l.revised)!) / numOf(l.baseline)!, 0) / discounted.length : null;
  const ratesAfter = discounted.map((l) => numOf(l.rate)).filter((x): x is number => x !== null);
  const entries = active.map((l) => (typeof l.entryDate.v === 'string' ? l.entryDate.v : null)).filter(Boolean).sort() as string[];
  const incoLine = all.find((l) => l.incoterm.src && l.ior === 'buyer');

  const objections = buildObjections({
    exporterName: ws.company.name,
    buyerName: buyer.name,
    ratio: totals.ratio,
    fairClaimUSD: fairClaim,
    tariffPaidUSD: tariffPaid,
    absorbedUSD: absorbed,
    incoterms,
    incotermEvidence: incoLine ? { label: 'Incoterm', text: `${incoLine.incoterm.v} on invoice ${incoLine.invoiceNo.v ?? ''}`, src: incoLine.incoterm.src, exhibit: incoLine.exhibit } : null,
    tariffMention,
    volumeMention,
    firstRevisionDate: firstRev,
    firstRevisionExhibit: firstRevDoc ? exOf(firstRevDoc.id) : null,
    avgQtyBefore: avg(before),
    avgQtyAfter: avg(after),
    avgDiscountPct: avgDiscount,
    rateAtRevision: ratesAfter.length ? Math.max(...ratesAfter) : null,
    refundLikelyDate: clock.window.likely,
    refundBasis: clock.window.basis,
    daysHeld: clock.daysHeld,
    holdingInterestUSD: clock.holdingInterest,
    phase1Eligible: active.filter((l) => l.phase1).length,
    phase1Total: active.length,
    earliestEntry: entries[0] ?? null,
    latestEntry: entries.at(-1) ?? null,
  });

  const flags: Flag[] = [];
  if (confirmedPrincipal !== null && sumPaid > 0 && Math.abs(confirmedPrincipal - sumPaid) > sumPaid * 0.05) {
    flags.push({ level: 'warn', code: 'refund-mismatch', text: `The confirmed refund (${fmtUSD(confirmedPrincipal)}) differs from the duty ClawBack computed on these lines (${fmtUSD(sumPaid)}). Check which entries it covers; it is currently spread across all lines in proportion to duty.` });
  }
  if (lev.missing.length) flags.push({ level: 'info', code: 'leverage-missing', text: `Leverage uses neutral values for: ${lev.missing.join(', ')}. Fill in the buyer profile.` });
  if (!revDocs.length && negotiable.length) flags.push({ level: 'warn', code: 'no-revision', text: 'No price-revision document for this buyer. Upload the email or letter where the discount was agreed.' });
  if (!tariffMention && revDocs.length) flags.push({ level: 'warn', code: 'no-tariff-mention', text: 'The revision documents do not mention the tariff. The “volume discount” objection will be hard to answer.' });

  return {
    buyer,
    lines: negotiable,
    directLines: direct,
    exhibits,
    totals,
    route,
    decision,
    incoterms,
    clock,
    leverage: lev,
    priority: round2(fairClaim * (lev.score / 100)),
    options,
    objections,
    flags,
    tariffMention,
    docCount: docs.length,
  };
}

function srcOfReal(r: Realisation): SourceRef | null {
  return r.doc.fields[`items.${r.index}.fcy_amount`]?.source ?? r.doc.fields[`items.${r.index}.invoice_ref`]?.source ?? null;
}

function fmtQty(q: number): string {
  return q.toLocaleString('en-US', { maximumFractionDigits: 4 });
}

function uniqueRates(r: ReturnType<typeof cbpInterest> | null): string {
  if (!r || !r.segments.length) return '—';
  const rates = [...new Set(r.segments.map((s) => `${(s.rate * 100).toFixed(0)}%`))];
  return rates.join('/') + ' p.a.';
}

// ---------------------------------------------------------------------------------------

export function buildPortfolio(ws: Workspace, today: string): Portfolio {
  const buyers = Object.values(ws.buyers).map((b) => buildBuyerLedger(ws, b, today));
  buyers.sort((a, b) => {
    const ra = a.route === 'claim_direct' || a.route === 'empty' ? 1 : 0;
    const rb = b.route === 'claim_direct' || b.route === 'empty' ? 1 : 0;
    if (ra !== rb) return ra - rb;
    return b.priority - a.priority || b.totals.fairClaim - a.totals.fairClaim || a.buyer.name.localeCompare(b.buyer.name);
  });
  const fx = ws.settings.fxUsdInr;
  const docs = Object.values(ws.documents);
  let fieldsTotal = 0;
  let fieldsGrounded = 0;
  let needsReview = 0;
  for (const d of docs) {
    if (d.status !== 'ready') continue;
    for (const f of Object.values(d.fields)) {
      if (f.value === null) continue;
      fieldsTotal++;
      if (f.source && (f.confidence === 'high' || f.confidence === 'medium' || f.confidence === 'manual')) fieldsGrounded++;
      if (f.confidence === 'low') needsReview++;
    }
  }
  const fairClaimUSD = round2(buyers.reduce((a, b) => a + b.totals.fairClaim, 0));
  const tariffPaidUSD = round2(buyers.reduce((a, b) => a + b.totals.tariffPaid, 0));
  const absorbedUSD = round2(buyers.reduce((a, b) => a + b.totals.absorbed, 0));
  const recoveredUSD = round2(buyers.reduce((a, b) => a + (b.buyer.stage === 'settled' ? b.buyer.recoveredUSD ?? b.buyer.agreedUSD ?? 0 : 0), 0));
  const agreedUSD = round2(buyers.reduce((a, b) => a + (b.buyer.agreedUSD ?? 0), 0));
  return {
    today,
    buyers,
    totals: {
      fairClaimUSD,
      fairClaimINR: usdToInr(fairClaimUSD, fx),
      buyersWithClaim: buyers.filter((b) => b.totals.fairClaim > 0).length,
      tariffPaidUSD,
      absorbedUSD,
      ratio: tariffPaidUSD > 0 ? absorbedUSD / tariffPaidUSD : 0,
      directClaimUSD: round2(buyers.reduce((a, b) => a + b.totals.directClaim, 0)),
      recoveredUSD,
      recoveredINR: usdToInr(recoveredUSD, fx),
      agreedUSD,
      documents: docs.length,
      lines: buyers.reduce((a, b) => a + b.totals.lines, 0),
      fieldsTotal,
      fieldsGrounded,
      needsReview,
    },
    unassigned: docs.filter((d) => !d.buyerId && d.status === 'ready'),
  };
}

export function daysBetween(a: string, b: string): number {
  return diffDays(a, b);
}
