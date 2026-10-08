// Deterministic rules extractor. Runs on every document, with or without Gemma:
// it is the fallback when the model is offline and the cross-check when it is not.
// Output values are raw text as written, each with the line it came from.

import type { DocKind, DocLine } from '../types';
import { findDates, numericTokens, parseNumber, companyKey, normalizeHS } from '../engine/normalize';

export interface Hit {
  value: string;
  line: number; // 1-based
  quote: string;
}

export interface RuleResult {
  fields: Record<string, Hit>;
  itemCount: number;
}

export interface RuleContext {
  exporterName?: string;
  exporterDomains?: string[];
}

// ---------------------------------------------------------------------------------------
// Classification

const SIGNALS: Record<Exclude<DocKind, 'other'>, [RegExp, number][]> = {
  invoice: [
    [/commercial\s+invoice/i, 6],
    [/\binvoice\s*(no|number|#|date)/i, 3],
    [/\b(hs|hsn|hts)\s*(code|no)?\b/i, 2],
    [/\bport\s+of\s+(loading|discharge)\b/i, 2],
    [/\b(consignee|bill\s+to|sold\s+to|notify\s+party)\b/i, 1],
    [/\bterms\s+of\s+(delivery|payment)\b/i, 2],
    [/\b(grand\s+total|total\s+amount|amount\s+chargeable)\b/i, 1],
    [/\bproforma\b/i, -2],
    [/\bpacking\s+list\b/i, -2],
  ],
  price_revision: [
    [/\b(revised|revision|new|reduced|adjusted)\s+(unit\s+)?pric(e|es|ing)\b/i, 4],
    [/\bprice\s+(revision|reduction|change|adjustment|concession)\b/i, 4],
    [/\bfrom\s+(usd|us\$|\$)\s?\d[\d.,]*.{0,30}\bto\s+(usd|us\$|\$)?\s?\d/i, 4],
    [/\b(tariff|duty|duties|ieepa|reciprocal)\b/i, 2],
    [/\bdiscount\b/i, 2],
    [/^(from|subject|to|date):/im, 1],
  ],
  bank_realization: [
    [/\be-?brc\b/i, 6],
    [/bank\s+reali[sz]ation/i, 6],
    [/\b(fira|firc)\b/i, 6],
    [/foreign\s+inward\s+remittance/i, 6],
    [/\birm\b/i, 3],
    [/purpose\s+code|p010[2-3]/i, 3],
    [/\breali[sz]ed\b/i, 2],
  ],
  refund_notice: [
    [/\bcape\b/i, 4],
    [/\brefund\b/i, 2],
    [/\b(ach|ace\s+portal|cbp|customs\s+and\s+border)\b/i, 2],
    [/\binterest\b/i, 1],
  ],
};

export function classifyByRules(lines: DocLine[], isEmail: boolean): { kind: DocKind; scores: Record<string, number>; confident: boolean } {
  const text = lines.map((l) => l.text).join('\n');
  const scores: Record<string, number> = {};
  for (const [kind, sigs] of Object.entries(SIGNALS)) {
    let s = 0;
    for (const [re, w] of sigs) {
      const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
      const n = Math.min(3, (text.match(g) || []).length);
      s += n > 0 ? w + (n - 1) * Math.sign(w) : 0;
    }
    scores[kind] = s;
  }
  if (isEmail) scores.price_revision += 3;
  if (isEmail) scores.invoice -= 3;
  // A refund notice must mention refund AND CBP/CAPE.
  if (!/\brefund/i.test(text) || !/\b(cape|cbp|customs)\b/i.test(text)) scores.refund_notice = Math.min(scores.refund_notice, 2);
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [topKind, top] = ranked[0];
  const second = ranked[1][1];
  if (top < 4) return { kind: 'other', scores, confident: top <= 1 };
  return { kind: topKind as DocKind, scores, confident: top >= 6 && top - second >= 3 };
}

// ---------------------------------------------------------------------------------------
// Helpers

const GAP = /\s{3,}|\t|\s\|\s/;

function seg(s: string): string {
  const t = s.replace(/^[\s:#.\-–=]+/, '').replace(/^\([^)]{0,24}\)\s*[:#.\-–=]*\s*/, '');
  return (t.split(GAP)[0] ?? '').trim();
}

/** Find `label` and return the value written after it (same line) or under it (next line, same column). */
function labelled(lines: DocLine[], label: RegExp, accept?: (v: string) => string | null, from = 0, to = lines.length): Hit | null {
  const ok = (v: string) => (v ? (accept ? accept(v) : v) : null);
  for (let i = from; i < Math.min(to, lines.length); i++) {
    const t = lines[i].text;
    const m = label.exec(t);
    if (!m) continue;
    const same = ok(seg(t.slice((m.index ?? 0) + m[0].length)));
    if (same) return { value: same, line: i + 1, quote: same };
    // value under the label (layout-preserved text keeps columns aligned)
    for (let j = i + 1; j < Math.min(lines.length, i + 3); j++) {
      const nxt = lines[j].text;
      if (!nxt.trim()) continue;
      const col = m.index ?? 0;
      const slice = nxt.length > col ? nxt.slice(Math.max(0, col - 2)) : '';
      const under = ok(seg(slice)) ?? (col < 4 ? ok(seg(nxt)) : null);
      if (under) return { value: under, line: j + 1, quote: under };
      break;
    }
  }
  return null;
}

const acceptRef = (v: string): string | null => {
  const m = /[A-Z0-9][A-Z0-9/\-_.]*\d[A-Z0-9/\-_.]*/i.exec(v);
  return m ? m[0].replace(/[.\-/]+$/, '') : null;
};

const acceptDate = (v: string): string | null => {
  const d = findDates(v);
  return d.length ? d[0].text : null;
};

const acceptMoneyLast = (v: string): string | null => {
  let masked = v;
  for (const d of findDates(v)) masked = masked.replace(d.text, ' '.repeat(d.text.length));
  const toks = numericTokens(masked).filter((t) => !/^\d{4}$/.test(t.text) || t.value < 1900);
  return toks.length ? toks[toks.length - 1].text : null;
};

const acceptName = (v: string): string | null => {
  const s = v.replace(/^(m\/s\.?|messrs\.?)\s*/i, '').trim();
  if (!/[A-Za-z]{3,}/.test(s) || /^\d/.test(s)) return null;
  if (/^(same as|as per|to order|n\/?a)\b/i.test(s)) return null;
  if (/:/.test(s) || /^(consignee|buyer|notify|address|ship\s+to|bill\s+to|sold\s+to|exporter|shipper|seller|name)\b/i.test(s)) return null;
  return s.replace(/[,;]+$/, '');
};

function isExporter(name: string, ctx: RuleContext): boolean {
  if (!ctx.exporterName) return false;
  const a = companyKey(name);
  const b = companyKey(ctx.exporterName);
  return !!a && !!b && (a === b || a.includes(b) || b.includes(a));
}

function firstLineMatching(lines: DocLine[], re: RegExp, from = 0): number {
  for (let i = from; i < lines.length; i++) if (re.test(lines[i].text)) return i;
  return -1;
}

const UNITS = /^(pcs?|nos?|sets?|kgs?|mts?|mtrs?|meters?|m|doz|dozens?|prs?|pairs?|units?|ctns?|cartons?|sqm|lbs?|yds?|rolls?|bags?|boxes|ea)\.?$/i;
const HS_TOKEN = /^\d{4}\.\d{2}(\.\d{2,4})?$|^\d{6,10}$/;

// ---------------------------------------------------------------------------------------
// Invoice

function invoiceItems(lines: DocLine[]): { items: Record<string, Hit>[]; } {
  // Column order hint from a header row
  let qtyFirst = true;
  let hasListCol = false;
  const hdr = firstLineMatching(lines, /\b(qty|quantity)\b.*\b(rate|price|unit\s*price)\b|\b(rate|price|unit\s*price)\b.*\b(qty|quantity)\b/i);
  if (hdr >= 0) {
    const h = lines[hdr].text.toLowerCase();
    const qi = h.search(/\b(qty|quantity)\b/);
    const pi = h.search(/\b(rate|price|unit\s*price)\b/);
    qtyFirst = qi < pi;
    hasListCol = /\b(list|original|gross|old|catalog(ue)?)\s*(price|rate)\b/i.test(h);
  }

  const items: Record<string, Hit>[] = [];
  const start = hdr >= 0 ? hdr + 1 : 0;
  for (let i = start; i < lines.length; i++) {
    const t = lines[i].text;
    if (/\b(sub-?total|grand\s+total|total|freight|insurance|discount|less|tax|igst|amount\s+in\s+words|bank|balance)\b/i.test(t)) continue;
    const dateSpans = findDates(t).map((d) => {
      const idx = t.indexOf(d.text);
      return [idx, idx + d.text.length] as const;
    });
    const hsToks: { text: string; index: number }[] = [];
    const masked = t.replace(/\b\d{4}\.\d{2}(?:\.\d{2,4})?\b|\b\d{8,10}\b/g, (mm, idx: number) => {
      hsToks.push({ text: mm, index: idx });
      return ' '.repeat(mm.length);
    });
    const serial = /^\s*\d{1,3}[.)]?\s+(?=[A-Za-z])/.exec(t);
    const offset = serial ? serial[0].length : 0;
    const toks = numericTokens(masked).filter((tok) => tok.index >= offset && !dateSpans.some(([a, b]) => tok.index >= a && tok.index < b));
    const nums = toks.filter((x) => x.value > 0);
    if (nums.length < 3) continue;

    let found: { q: (typeof nums)[0]; p: (typeof nums)[0]; a: (typeof nums)[0] } | null = null;
    for (let c = nums.length - 1; c >= 2 && !found; c--) {
      const amt = nums[c];
      for (let x = 0; x < c && !found; x++) {
        for (let y = x + 1; y < c && !found; y++) {
          const A = nums[x];
          const B = nums[y];
          const prod = A.value * B.value;
          if (Math.abs(prod - amt.value) <= Math.max(0.02, amt.value * 0.005)) {
            const [q, p] = qtyFirst ? [A, B] : [B, A];
            found = { q, p, a: amt };
          }
        }
      }
    }
    if (!found) continue;

    const item: Record<string, Hit> = {};
    const L = i + 1;
    item.qty = { value: found.q.text, line: L, quote: found.q.text };
    item.unit_price = { value: found.p.text, line: L, quote: found.p.text };
    item.amount = { value: found.a.text, line: L, quote: found.a.text };

    // list price: an extra number between qty/price and amount, higher than the net price
    if (hasListCol || /\b(list|original|gross|old)\b/i.test(t)) {
      const extra = nums.find((n) => n !== found!.q && n !== found!.p && n !== found!.a && n.index < found!.a.index && n.value > found!.p.value && n.value < found!.p.value * 3);
      if (extra) item.list_price = { value: extra.text, line: L, quote: extra.text };
    }

    // unit: a word right after the quantity
    const afterQty = t.slice(found.q.index + found.q.text.length).trim().split(/\s+/)[0] ?? '';
    if (UNITS.test(afterQty)) item.unit = { value: afterQty.toUpperCase().replace(/\.$/, ''), line: L, quote: afterQty };

    // HS code on this line or the line above/below
    let hsHit: Hit | null = null;
    if (hsToks.length) hsHit = { value: hsToks[0].text, line: L, quote: hsToks[0].text };
    else {
      for (const j of [i - 1, i + 1]) {
        if (j < 0 || j >= lines.length) continue;
        const m = /\b(?:hs|hsn|hts)\s*(?:code)?\s*[:#]?\s*(\d{4}[.\s]?\d{2}(?:[.\s]?\d{2,4})?)\b/i.exec(lines[j].text);
        if (m) {
          hsHit = { value: m[1], line: j + 1, quote: m[1] };
          break;
        }
      }
    }
    if (hsHit && normalizeHS(hsHit.value)) item.hs_code = hsHit;

    // description: text after the serial number, up to the first number or HS code
    const stops = [found.q.index, found.p.index, ...hsToks.map((x) => x.index)].filter((x) => x >= offset);
    const stop = stops.length ? Math.min(...stops) : t.length;
    let desc = t.slice(offset, stop).trim().split(GAP)[0].trim();
    if (/^\d{1,3}$/.test(desc)) desc = '';
    if (desc && desc.length >= 3) item.description = { value: desc, line: L, quote: desc };
    items.push(item);
  }
  return { items };
}

function extractInvoice(lines: DocLine[], ctx: RuleContext): RuleResult {
  const f: Record<string, Hit> = {};
  const put = (k: string, h: Hit | null) => {
    if (h) f[k] = h;
  };

  put('invoice_number', labelled(lines, /\b(?:commercial\s+)?invoice\s*(?:no|number|#)\.?\s*(?:&\s*date)?/i, acceptRef) ?? labelled(lines, /\binv\.?\s*no\.?/i, acceptRef));
  let invDate = labelled(lines, /\binvoice\s*date\b|\bdate\s+of\s+invoice\b/i, acceptDate);
  if (!invDate && f.invoice_number) {
    const ln = lines[f.invoice_number.line - 1].text;
    const d = findDates(ln);
    if (d.length) invDate = { value: d[0].text, line: f.invoice_number.line, quote: d[0].text };
  }
  if (!invDate) invDate = labelled(lines, /^\s*date\b/i, acceptDate, 0, Math.min(lines.length, 25));
  put('invoice_date', invDate);
  put('ship_date', labelled(lines, /\b(?:b\/?l|bill\s+of\s+lading|awb|on[-\s]?board|shipped\s+on|date\s+of\s+shipment|shipment\s+date|sailing\s+date|etd|vessel\s+sailed)\b\s*(?:no\.?\s*[^\s]*\s*)?(?:date|dt\.?)?\s*(?:&\s*date)?/i, acceptDate));
  put('shipping_bill_no', labelled(lines, /\bshipping\s+bill\s*(?:no|number)\.?/i, acceptRef) ?? labelled(lines, /\bs\/?b\s*no\.?/i, acceptRef));
  put('po_number', labelled(lines, /\b(?:buyer'?s?\s*)?(?:p\.?o\.?|purchase\s+order|order)\s*(?:no|number|#|ref)\.?/i, acceptRef));

  // Incoterm: prefer a labelled line
  const incoRe = /\b(EXW|FCA|FAS|FOB|CFR|CNF|C&F|CIF|CPT|CIP|DAP|DPU|DAT|DDP)\b/;
  let inco: Hit | null = null;
  for (let i = 0; i < lines.length && !inco; i++) {
    const t = lines[i].text;
    if (/\b(terms?\s+of\s+delivery|delivery\s+terms?|incoterms?|price\s+terms?|terms?\s+of\s+sale|shipment\s+terms?)\b/i.test(t)) {
      const m = incoRe.exec(t) ?? (i + 1 < lines.length ? incoRe.exec(lines[i + 1].text) : null);
      if (m) {
        const ln = incoRe.exec(t) ? i : i + 1;
        const quoteM = /\b(EXW|FCA|FAS|FOB|CFR|CNF|C&F|CIF|CPT|CIP|DAP|DPU|DAT|DDP)\b[^,;|]{0,30}/.exec(lines[ln].text);
        inco = { value: m[1], line: ln + 1, quote: (quoteM?.[0] ?? m[1]).split(GAP)[0].trim() };
      }
    }
  }
  if (!inco) {
    for (let i = 0; i < lines.length && !inco; i++) {
      const m = incoRe.exec(lines[i].text);
      if (m) inco = { value: m[1], line: i + 1, quote: m[1] };
    }
  }
  put('incoterm', inco);

  // Currency
  const cur = labelled(lines, /\bcurrency\b/i, (v) => (/\b[A-Z]{3}\b/.exec(v.toUpperCase())?.[0] ?? null));
  if (cur) put('currency', cur);
  else {
    const i = firstLineMatching(lines, /\b(USD|US\$)\b|\$\s?\d/);
    if (i >= 0) {
      const m = /\bUSD\b|US\$|\$/.exec(lines[i].text)!;
      put('currency', { value: m[0], line: i + 1, quote: m[0] });
    }
  }

  // Buyer
  const buyerLabels = [
    /\b(?:buyer|importer|sold\s+to|bill\s+to|billed\s+to|customer)\b(?!\s*(?:'|’)s)(?!\s*(?:po|p\.o|order|ref|code|id)\b)(?:\s*\([^)]*\))?\s*(?:name)?\s*:?/i,
    /\bconsignee\b(?:\s*\([^)]*\))?\s*:?/i,
  ];
  for (const re of buyerLabels) {
    if (f.buyer_name) break;
    for (let i = 0; i < lines.length; i++) {
      const h = labelled(lines, re, acceptName, i, i + 1);
      if (h && !isExporter(h.value, ctx) && !/^(name|address|details)$/i.test(h.value)) {
        f.buyer_name = h;
        break;
      }
    }
  }

  put('freight', labelled(lines, /\b(?:ocean\s+|sea\s+|air\s+)?freight(?:\s+charges)?\b/i, acceptMoneyLast));
  put('insurance', labelled(lines, /\binsurance(?:\s+charges)?\b/i, acceptMoneyLast));
  let total: Hit | null = null;
  for (let i = lines.length - 1; i >= 0 && !total; i--) {
    if (/\b(grand\s+total|invoice\s+total|total\s+invoice\s+value|total\s+amount|total\s+value|amount\s+payable)\b/i.test(lines[i].text)) {
      const v = acceptMoneyLast(lines[i].text);
      if (v) total = { value: v, line: i + 1, quote: v };
    }
  }
  for (let i = lines.length - 1; i >= 0 && !total; i--) {
    if (/^\s*total\b/i.test(lines[i].text) || /\btotal\s*(\(?usd\)?|us\$)/i.test(lines[i].text)) {
      const v = acceptMoneyLast(lines[i].text);
      if (v) total = { value: v, line: i + 1, quote: v };
    }
  }
  put('total', total);

  const { items } = invoiceItems(lines);
  items.forEach((it, idx) => {
    for (const [k, h] of Object.entries(it)) f[`items.${idx}.${k}`] = h;
  });
  return { fields: f, itemCount: items.length };
}

// ---------------------------------------------------------------------------------------
// Price revision (usually an email)

const CUR = String.raw`(?:usd|us\$|\$|u\.s\.\s*\$)`;
const NUM = String.raw`(\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?)`;
const PAIR_RES: RegExp[] = [
  new RegExp(String.raw`\bfrom\s+${CUR}?\s?${NUM}(?:\s*(?:\/|per)\s*[a-z]+)?\s*(?:\(?[a-z]+\)?\s*)?\bto\s+${CUR}?\s?${NUM}`, 'i'),
  new RegExp(String.raw`${CUR}\s?${NUM}(?:\s*(?:\/|per)\s*[a-z]+)?\s*(?:→|->|=>|⇒)\s*${CUR}?\s?${NUM}`, 'i'),
  new RegExp(String.raw`\b(?:was|old|previous|current|existing|original)\s*(?:price)?\s*:?\s*${CUR}\s?${NUM}.{0,40}?\b(?:now|new|revised)\s*(?:price)?\s*:?\s*${CUR}?\s?${NUM}`, 'i'),
];

function extractRevision(lines: DocLine[], ctx: RuleContext, meta: { emailFrom?: string; emailDate?: string; emailSubject?: string }): RuleResult {
  const f: Record<string, Hit> = {};
  const hdr = (name: string) => {
    const i = firstLineMatching(lines, new RegExp(`^${name}:`, 'i'));
    if (i < 0) return null;
    const v = lines[i].text.replace(new RegExp(`^${name}:\\s*`, 'i'), '').trim();
    return v ? { value: v, line: i + 1, quote: v } : null;
  };
  const from = hdr('From');
  const subj = hdr('Subject');
  const date = hdr('Date') ?? hdr('Sent');
  if (from) f.email_from = from;
  if (subj) f.subject = subj;
  if (date) {
    const d = findDates(date.value);
    if (d.length) f.email_date = { value: d[0].text, line: date.line, quote: d[0].text };
  }
  if (!f.email_date) {
    for (let i = 0; i < Math.min(lines.length, 15); i++) {
      const d = findDates(lines[i].text);
      if (d.length) {
        f.email_date = { value: d[0].text, line: i + 1, quote: d[0].text };
        break;
      }
    }
  }

  // Buyer: a company line in the correspondence that is not the exporter
  const corp = /\b([A-Z][A-Za-z0-9&'.\- ]{2,60}\s(?:Inc\.?|LLC|L\.L\.C\.|Corp\.?|Corporation|Co\.|Company|Ltd\.?|Limited|Group|Trading|Supply|Brands|Holdings|Imports|Stores))(?=[\s,.;)]|$)/;
  for (let i = 0; i < lines.length && !f.buyer_name; i++) {
    const t = lines[i].text;
    if (/^(to|cc|subject|date):/i.test(t)) continue;
    const m = corp.exec(t);
    if (m && !isExporter(m[1], ctx)) {
      const name = m[1].replace(/^(?:From|Dear|Hi|Hello|Regards|Team|at|of)\s+/i, '').trim();
      if (name.split(/\s+/).length >= 2) f.buyer_name = { value: name, line: i + 1, quote: name };
    }
  }
  if (!f.buyer_name && from) {
    const dom = /@([a-z0-9.-]+)\.[a-z]+/i.exec(from.value)?.[1];
    if (dom && !(ctx.exporterDomains ?? []).some((d) => from.value.toLowerCase().includes(d.toLowerCase()))) {
      const name = /^"?([^"<]+?)"?\s*</.exec(from.value)?.[1];
      f.buyer_name = { value: dom.split('.')[0], line: from.line, quote: dom.split('.')[0] };
      if (name && corp.test(name)) f.buyer_name = { value: name, line: from.line, quote: name };
    }
  }

  // Price pairs
  const items: Record<string, Hit>[] = [];
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].text;
    if (/^>/.test(t.trim()) && items.length) continue; // skip quoted repeats once we have prices
    for (const re of PAIR_RES) {
      const m = re.exec(t);
      if (!m) continue;
      const a = parseNumber(m[1]);
      const b = parseNumber(m[2]);
      if (a === null || b === null || a <= 0 || b <= 0 || a > 100000) continue;
      const key = `${a}|${b}`;
      if (items.some((it) => `${parseNumber(it.baseline_price.value)}|${parseNumber(it.revised_price.value)}` === key)) continue;
      const it: Record<string, Hit> = {
        baseline_price: { value: m[1], line: i + 1, quote: m[1] },
        revised_price: { value: m[2], line: i + 1, quote: m[2] },
      };
      const hs = /\b(?:hs|hsn|hts)\s*(?:code)?\s*[:#]?\s*(\d{4}[.\s]?\d{2}(?:[.\s]?\d{2,4})?)/i.exec(t);
      if (hs) it.hs_code = { value: hs[1], line: i + 1, quote: hs[1] };
      const before = t
        .slice(0, m.index)
        .replace(/\(?\b(?:hs|hsn|hts)\b[^)]*\)?/i, '')
        .split(':')[0]
        .replace(/[-•*:,]+\s*$/, '')
        .replace(/^[\s•*\-]*(?:\d{1,2}[.)]\s*)?/, '')
        .trim();
      const product = before.replace(/\b(price|prices|for|of|the|on|our|your|we|propose|to|revise|reduce|change|move|please|can|you|from)\b/gi, ' ').replace(/\s+/g, ' ').trim();
      if (product.length >= 3) it.product = { value: before.slice(0, 80), line: i + 1, quote: before.slice(0, 80) };
      items.push(it);
      break;
    }
  }
  // Separate-line pattern: "Previous price: $6.40" / "Revised price: $5.10"
  if (!items.length) {
    const prev = labelled(lines, /\b(?:previous|old|current|existing|original|earlier|contract)\s+(?:unit\s+)?price\b/i, acceptMoneyLast);
    const next = labelled(lines, /\b(?:revised|new|reduced|adjusted)\s+(?:unit\s+)?price\b/i, acceptMoneyLast);
    if (prev && next) items.push({ baseline_price: prev, revised_price: next });
  }
  items.forEach((it, idx) => {
    for (const [k, h] of Object.entries(it)) f[`items.${idx}.${k}`] = h;
  });

  // Applies to: invoice / PO references
  const refs: Hit[] = [];
  const refRe = /\b(?:invoices?|inv\.?|p\.?o\.?s?|purchase\s+orders?|orders?)\s*(?:no\.?s?|numbers?|#)?\s*:?\s*((?:[A-Z]{0,6}[A-Z0-9]*[/\-]?[A-Z0-9/\-]*\d[A-Z0-9/\-]*)(?:\s*(?:,|and|&)\s*(?:[A-Z]{0,6}[A-Z0-9]*[/\-]?[A-Z0-9/\-]*\d[A-Z0-9/\-]*))*)/gi;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].text;
    if (/^>/.test(t.trim())) continue;
    for (const m of t.matchAll(refRe)) {
      const v = m[1].replace(/[.,;]+$/, '').trim();
      if (v.length >= 3 && !/^\d{1,2}$/.test(v)) refs.push({ value: v, line: i + 1, quote: v });
    }
  }
  if (refs.length) {
    const uniq = [...new Map(refs.map((r) => [r.value, r])).values()];
    f.applies_to = { value: uniq.map((r) => r.value).join(', '), line: uniq[0].line, quote: uniq[0].quote };
  }

  put(f, 'effective_from', labelled(lines, /\b(?:effective|w\.?e\.?f\.?|with\s+effect\s+from|applicable\s+(?:from|for\s+shipments\s+from)|valid\s+from)\b(?:\s+(?:from|for|date|on))?/i, acceptDate));

  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].text;
    if (/^(from|to|cc|date|subject):/i.test(t.trim())) continue;
    if (/\b(tariffs?|duty|duties|ieepa|reciprocal)\b/i.test(t)) {
      const q = t.trim().slice(0, 300);
      f.tariff_reason = { value: q, line: i + 1, quote: q };
      break;
    }
  }
  const curLine = firstLineMatching(lines, /\bUSD\b|US\$|\$\s?\d/);
  if (curLine >= 0) {
    const m = /\bUSD\b|US\$|\$/.exec(lines[curLine].text)!;
    f.currency = { value: m[0], line: curLine + 1, quote: m[0] };
  }
  void meta;
  return { fields: f, itemCount: items.length };
}

function put(f: Record<string, Hit>, k: string, h: Hit | null) {
  if (h) f[k] = h;
}

// ---------------------------------------------------------------------------------------
// Bank realisation (e-BRC / FIRA / FIRC / CSV export)

const BANK_COLS: [string, RegExp, RegExp][] = [
  ['reference_no', /\b(irm\s*(no|number)?|e-?brc\s*(no|number)?|fira\s*no|utr|bank\s*ref(erence)?)\b/i, /\b(reference|ref\.?\s*no|transaction\s*(id|ref|no)|remittance\s*(no|ref))\b/i],
  ['realization_date', /\b(reali[sz]ation\s*date|date\s*of\s*reali[sz]ation|value\s*date|credit\s*date|date\s*of\s*credit)\b/i, /^\s*date\s*$/i],
  ['invoice_ref', /\b(invoice\s*(no|number|ref)|inv\.?\s*no)\b/i, /\b(invoice|inv)\b(?!.*date)/i],
  ['currency', /\b(currency|ccy|fcy\s*code)\b/i, /\bcur\b/i],
  ['fcy_amount', /\b(reali[sz]ed\s*(value|amount)\s*\(?(in\s*)?(fcy|usd)\)?|fcy\s*amount|amount\s*\(?(fcy|usd)\)?|amount\s*reali[sz]ed)\b/i, /\b(reali[sz]ed\s*(value|amount)|remittance\s*amount|amount)\b(?!.*\binr\b)/i],
  ['inr_amount', /\b(inr\s*(value|amount|equivalent)|amount\s*\(?inr\)?|value\s*\(?inr\)?|reali[sz]ed\s*value\s*\(?inr\)?)/i, /\b(inr|rupee)\b/i],
  ['remitter', /\b(remitter(\s*name)?|ordering\s*customer|buyer\s*name|importer\s*name)\b/i, /\b(buyer|importer)\b/i],
];

function mapColumns(cells: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  const taken = new Set<number>();
  for (const pass of [1, 2] as const) {
    for (const [key, strict, loose] of BANK_COLS) {
      if (map[key] !== undefined) continue;
      const re = pass === 1 ? strict : loose;
      const ci = cells.findIndex((c, i) => !taken.has(i) && re.test(c) && !(key === 'fcy_amount' && /\binr\b/i.test(c)));
      if (ci >= 0) {
        map[key] = ci;
        taken.add(ci);
      }
    }
  }
  return map;
}

function splitCells(t: string): string[] {
  if (t.includes('|')) return t.split('|').map((s) => s.trim());
  if (t.includes(',') && (t.match(/,/g) || []).length >= 3) {
    // CSV with quotes
    const out: string[] = [];
    let cur = '';
    let q = false;
    for (const ch of t) {
      if (ch === '"') q = !q;
      else if (ch === ',' && !q) {
        out.push(cur.trim());
        cur = '';
      } else cur += ch;
    }
    out.push(cur.trim());
    return out;
  }
  return t.split(/\s{3,}|\t/).map((s) => s.trim());
}

function bankTable(lines: DocLine[]): Record<string, Hit>[] | null {
  for (let i = 0; i < Math.min(lines.length, 40); i++) {
    const cells = splitCells(lines[i].text);
    if (cells.length < 4) continue;
    const map = mapColumns(cells);
    if (Object.keys(map).length < 3 || map.invoice_ref === undefined || map.fcy_amount === undefined) continue;
    const items: Record<string, Hit>[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      const row = splitCells(lines[j].text);
      if (row.length < Math.max(...Object.values(map)) + 1) continue;
      if (/\btotal\b/i.test(lines[j].text)) continue;
      const it: Record<string, Hit> = {};
      for (const [key, ci] of Object.entries(map)) {
        const v = (row[ci] ?? '').replace(/^"|"$/g, '').trim();
        if (!v) continue;
        const k = key === 'remitter' ? '_remitter' : key;
        it[k] = { value: v, line: j + 1, quote: v };
      }
      if (it.invoice_ref && it.fcy_amount && parseNumber(it.fcy_amount.value) !== null) items.push(it);
    }
    if (items.length) return items;
  }
  return null;
}

function extractBank(lines: DocLine[], ctx: RuleContext): RuleResult {
  const f: Record<string, Hit> = {};
  for (let i = 0; i < Math.min(lines.length, 10); i++) {
    const m = /([A-Z][A-Za-z&.' ]{2,60}\bBank\b(?:\s+(?:Ltd\.?|Limited))?)/.exec(lines[i].text);
    if (m) {
      f.bank_name = { value: m[1].trim(), line: i + 1, quote: m[1].trim() };
      break;
    }
  }
  const table = bankTable(lines);
  let items: Record<string, Hit>[] = [];
  if (table) {
    items = table;
    const r = items.find((it) => it._remitter)?._remitter;
    if (r && !isExporter(r.value, ctx)) f.remitter_name = r;
    items.forEach((it) => delete it._remitter);
  } else {
    put(f, 'document_ref', labelled(lines, /\b(?:e-?brc|fira|firc|certificate|advice)\s*(?:no|number|#|ref(?:erence)?)\.?/i, acceptRef));
    const rem = labelled(lines, /\b(?:remitter(?:'s)?\s*(?:name)?|ordering\s+customer|name\s+of\s+(?:the\s+)?remitter|foreign\s+buyer|buyer(?:'s)?\s*name|importer\s*name)\b\s*:?/i, acceptName);
    if (rem && !isExporter(rem.value, ctx)) f.remitter_name = rem;
    const it: Record<string, Hit> = {};
    const ref = labelled(lines, /\b(?:irm\s*(?:no|number)?|bank\s+ref(?:erence)?\s*(?:no)?|remittance\s+(?:ref(?:erence)?|no)|transaction\s+(?:ref(?:erence)?|id)|utr\s*(?:no)?)\b\.?/i, acceptRef);
    if (ref) it.reference_no = ref;
    const d = labelled(lines, /\b(?:date\s+of\s+reali[sz]ation|reali[sz]ation\s+date|value\s+date|credit\s+date|date\s+of\s+credit|remittance\s+date)\b/i, acceptDate);
    if (d) it.realization_date = d;
    const inv = labelled(lines, /\b(?:export\s+)?invoice\s*(?:no|number|ref(?:erence)?)?\.?/i, acceptRef);
    if (inv) it.invoice_ref = inv;
    const fcy = labelled(lines, /\b(?:reali[sz]ed\s+(?:value|amount)(?:\s+in\s+fcy)?|amount\s+reali[sz]ed|fcy\s+amount|amount\s+in\s+fcy|remittance\s+amount|amount\s+\(?(?:usd|fcy)\)?|amount\s+received)\b/i, acceptMoneyLast);
    if (fcy) it.fcy_amount = fcy;
    const inr = labelled(lines, /\b(?:inr\s+(?:equivalent|value|amount)|amount\s+in\s+inr|reali[sz]ed\s+value\s+in\s+inr|rupee\s+equivalent)\b/i, acceptMoneyLast);
    if (inr) it.inr_amount = inr;
    const cur = labelled(lines, /\b(?:currency|fcy\s+code)\b/i, (v) => (/\b[A-Z]{3}\b/.exec(v.toUpperCase())?.[0] ?? null));
    if (cur) it.currency = cur;
    if (Object.keys(it).length) items.push(it);
  }
  items.forEach((it, idx) => {
    for (const [k, h] of Object.entries(it)) f[`items.${idx}.${k}`] = h;
  });
  return { fields: f, itemCount: items.length };
}

// ---------------------------------------------------------------------------------------
// Refund notice

function extractRefund(lines: DocLine[], ctx: RuleContext): RuleResult {
  const f: Record<string, Hit> = {};
  const b = labelled(lines, /\b(?:importer(?:\s+of\s+record)?|ior|payee|company)\s*(?:name)?\s*:?/i, acceptName);
  if (b && !isExporter(b.value, ctx)) f.buyer_name = b;
  put(f, 'refund_date', labelled(lines, /\b(?:refund|payment|ach|disbursement)\s*(?:issue\s*)?date\b|\bdate\s+(?:paid|issued)\b/i, acceptDate));
  put(f, 'refund_amount', labelled(lines, /\b(?:refund(?:ed)?\s+(?:amount|principal)|amount\s+refunded|duty\s+refund(?:ed)?\s+amount|principal\s+refunded)\b/i, acceptMoneyLast));
  put(f, 'interest_amount', labelled(lines, /\binterest(?:\s+amount)?\b/i, acceptMoneyLast));
  put(f, 'cape_reference', labelled(lines, /\b(?:cape\s*(?:declaration)?\s*(?:no|number|id|ref(?:erence)?)|declaration\s*(?:no|id))\b\.?/i, acceptRef));
  return { fields: f, itemCount: 0 };
}

export function extractByRules(kind: DocKind, lines: DocLine[], ctx: RuleContext, meta: { emailFrom?: string; emailDate?: string; emailSubject?: string } = {}): RuleResult {
  switch (kind) {
    case 'invoice':
      return extractInvoice(lines, ctx);
    case 'price_revision':
      return extractRevision(lines, ctx, meta);
    case 'bank_realization':
      return extractBank(lines, ctx);
    case 'refund_notice':
      return extractRefund(lines, ctx);
    default:
      return { fields: {}, itemCount: 0 };
  }
}
