// Grounding verifier: deterministic proof that a value is actually written in the document.
// A model's answer is only trusted after its quote is found on its cited line.
// Then the rules and the model are merged field by field into confidence levels.

import type { DocLine, Field, FieldType, Method, Confidence } from '../types';
import { DOC_FIELDS } from '../types';
import type { DocKind } from '../types';
import { findDates, normalizeValue, numericTokens, parseDate, parseNumber, normalizeCurrency } from '../engine/normalize';
import type { Hit, RuleResult } from './rules';
import type { LlmExtraction, Cite } from './gemma';

const norm = (s: string) => s.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim();

function valueInText(type: FieldType, value: string, text: string): string | null {
  const v = value.trim();
  if (!v) return null;
  switch (type) {
    case 'money':
    case 'number': {
      const n = parseNumber(v);
      if (n === null) return null;
      const tok = numericTokens(text).find((t) => Math.abs(t.value - n) < 1e-6 || Math.abs(Math.abs(t.value) - Math.abs(n)) < 1e-6);
      return tok ? tok.text : null;
    }
    case 'date': {
      const d = parseDate(v);
      if (!d) return null;
      const hit = findDates(text).find((x) => x.iso === d);
      return hit ? hit.text : null;
    }
    case 'hs': {
      const digits = v.replace(/\D/g, '');
      if (digits.length < 4) return null;
      const m = text.match(/\d[\d.\s]{3,14}\d/g) ?? [];
      const hit = m.find((s) => s.replace(/\D/g, '').startsWith(digits) || digits.startsWith(s.replace(/\D/g, '')) && s.replace(/\D/g, '').length >= 6);
      return hit ?? null;
    }
    case 'incoterm': {
      const code = normalizeValue('incoterm', v);
      if (!code) return null;
      const m = new RegExp(`\\b(${code}|${code === 'CFR' ? 'C&F|CNF' : code})\\b`, 'i').exec(text);
      return m ? m[0] : null;
    }
    case 'currency': {
      const c = normalizeCurrency(v);
      if (!c) return null;
      const m = /\bUSD\b|US\$|\$|\bEUR\b|€|\bGBP\b|£|\bINR\b|₹/i.exec(text);
      return m && normalizeCurrency(m[0]) === c ? m[0] : null;
    }
    case 'list': {
      const first = v.split(/,\s*/)[0];
      return norm(text).includes(norm(first)) ? first : null;
    }
    default: {
      const nv = norm(v);
      const nt = norm(text);
      if (nt.includes(nv)) {
        const idx = text.toLowerCase().replace(/\s+/g, ' ').indexOf(nv);
        return idx >= 0 ? text.replace(/\s+/g, ' ').slice(idx, idx + nv.length) : v;
      }
      return null;
    }
  }
}

export interface Grounded {
  ok: boolean;
  how: 'exact' | 'moved' | 'value' | 'none';
  line: number;
  quote: string;
}

/** Check a cited value against the document. Re-points the citation if the line was off. */
export function groundCite(lines: DocLine[], c: Cite, type: FieldType): Grounded {
  const value = c.value;
  // 1. cited line holds the value
  if (c.line >= 1 && c.line <= lines.length) {
    const q = valueInText(type, value, lines[c.line - 1].text);
    if (q) return { ok: true, how: 'exact', line: c.line, quote: q };
  }
  // 2. nearest other line holding the value
  let best: Grounded | null = null;
  let bestDist = Infinity;
  for (let i = 0; i < lines.length; i++) {
    const q = valueInText(type, value, lines[i].text);
    if (!q) continue;
    const dist = c.line > 0 ? Math.abs(i + 1 - c.line) : i;
    if (dist < bestDist) {
      bestDist = dist;
      best = { ok: true, how: c.line > 0 ? 'moved' : 'value', line: i + 1, quote: q };
    }
  }
  if (best) return best;
  return { ok: false, how: 'none', line: c.line, quote: c.quote };
}

// ---------------------------------------------------------------------------------------

function typeOf(kind: Exclude<DocKind, 'other'>, key: string): FieldType {
  const spec = DOC_FIELDS[kind];
  const m = /^items\.\d+\.(.+)$/.exec(key);
  const k = m ? m[1] : key;
  const f = (m ? spec.items : spec.fields).find((x) => x.key === k);
  return f?.type ?? 'text';
}

const NUMERIC_ITEM = /^items\.\d+\.(qty|unit_price|amount|list_price|fcy_amount|inr_amount|baseline_price|revised_price)$/;

function makeField(type: FieldType, raw: string, value: string | null, method: Method, confidence: Confidence, docId: string, line: number, quote: string, note?: string): Field {
  return { value, raw, type, method, confidence, source: line > 0 ? { docId, line, quote } : null, note };
}

/** Align model items to rule items by amount / prices so their fields can be compared. */
function alignItems(kind: Exclude<DocKind, 'other'>, rules: Record<string, Hit>[], llm: Record<string, Cite>[]): { r: Record<string, Hit> | null; g: Record<string, Cite> | null }[] {
  const keyNums = kind === 'invoice' ? ['amount', 'unit_price', 'qty'] : kind === 'price_revision' ? ['revised_price', 'baseline_price'] : ['fcy_amount', 'invoice_ref'];
  const used = new Set<number>();
  const pairs: { r: Record<string, Hit> | null; g: Record<string, Cite> | null }[] = [];
  for (const g of llm) {
    let match = -1;
    for (let i = 0; i < rules.length && match < 0; i++) {
      if (used.has(i)) continue;
      for (const k of keyNums) {
        const a = g[k]?.value;
        const b = rules[i][k]?.value;
        if (!a || !b) continue;
        const na = parseNumber(a);
        const nb = parseNumber(b);
        if ((na !== null && nb !== null && Math.abs(na - nb) < 1e-6) || norm(a) === norm(b)) {
          match = i;
          break;
        }
      }
    }
    if (match >= 0) used.add(match);
    pairs.push({ r: match >= 0 ? rules[match] : null, g });
  }
  rules.forEach((r, i) => {
    if (!used.has(i)) pairs.push({ r, g: null });
  });
  return pairs;
}

function splitItems(fields: Record<string, Hit>, count: number): Record<string, Hit>[] {
  const out: Record<string, Hit>[] = [];
  for (let i = 0; i < count; i++) {
    const it: Record<string, Hit> = {};
    for (const [k, v] of Object.entries(fields)) {
      const m = /^items\.(\d+)\.(.+)$/.exec(k);
      if (m && Number(m[1]) === i) it[m[2]] = v;
    }
    out.push(it);
  }
  return out;
}

function mergeOne(kind: Exclude<DocKind, 'other'>, key: string, r: Hit | undefined, g: Cite | undefined, lines: DocLine[], docId: string): Field | null {
  const type = typeOf(kind, key);
  const rv = r ? normalizeValue(type, r.value) : null;
  let gv: string | null = null;
  let gg: Grounded | null = null;
  if (g) {
    gv = normalizeValue(type, g.value);
    if (gv !== null) gg = groundCite(lines, g, type);
  }
  if (rv === null && gv === null) return null;

  if (rv !== null && gv !== null) {
    if (rv === gv) {
      const src = gg?.ok ? gg : { line: r!.line, quote: r!.quote };
      return makeField(type, g!.value, gv, 'gemma+rules', 'high', docId, src.line, src.quote);
    }
    // Disagreement. Arithmetic-checked item numbers favour the rules; otherwise the grounded model reading.
    const preferRules = NUMERIC_ITEM.test(key) || !gg?.ok;
    if (preferRules) {
      const f = makeField(type, r!.value, rv, 'rules', 'low', docId, r!.line, r!.quote, `Gemma read “${g!.value}”${gg?.ok ? ` on line ${gg.line}` : ' (not found in the document)'}. Check which is right.`);
      f.alt = { value: gv, source: gg?.ok ? { docId, line: gg.line, quote: gg.quote } : null, method: 'gemma' };
      return f;
    }
    const f = makeField(type, g!.value, gv, 'gemma', 'low', docId, gg!.line, gg!.quote, `Rules read “${r!.value}” on line ${r!.line}. Check which is right.`);
    f.alt = { value: rv, source: { docId, line: r!.line, quote: r!.quote }, method: 'rules' };
    return f;
  }
  if (gv !== null && g) {
    if (gg?.ok) return makeField(type, g.value, gv, 'gemma', 'medium', docId, gg.line, gg.quote);
    return makeField(type, g.value, gv, 'gemma', 'low', docId, g.line > 0 && g.line <= lines.length ? g.line : 0, g.quote, 'Not found verbatim in the document. Confirm before relying on it.');
  }
  // rules only
  return makeField(type, r!.value, rv, 'rules', 'medium', docId, r!.line, r!.quote);
}

export interface Merged {
  fields: Record<string, Field>;
  itemCount: number;
  grounded: number;
  total: number;
}

export function mergeExtraction(kind: DocKind, docId: string, lines: DocLine[], rules: RuleResult, llm: LlmExtraction | null): Merged {
  if (kind === 'other') return { fields: {}, itemCount: 0, grounded: 0, total: 0 };
  const spec = DOC_FIELDS[kind];
  const fields: Record<string, Field> = {};

  for (const f of spec.fields) {
    const m = mergeOne(kind, f.key, rules.fields[f.key], llm?.fields[f.key], lines, docId);
    if (m) fields[f.key] = m;
  }

  const ruleItems = splitItems(rules.fields, rules.itemCount);
  const pairs = llm && llm.items.length ? alignItems(kind, ruleItems, llm.items) : ruleItems.map((r) => ({ r, g: null }));
  let idx = 0;
  for (const p of pairs) {
    const itemFields: Record<string, Field> = {};
    for (const f of spec.items) {
      const m = mergeOne(kind, `items.${idx}.${f.key}`, p.r?.[f.key], p.g?.[f.key] ?? undefined, lines, docId);
      if (m) itemFields[`items.${idx}.${f.key}`] = m;
    }
    if (Object.keys(itemFields).length) {
      Object.assign(fields, itemFields);
      idx++;
    }
  }

  let grounded = 0;
  let total = 0;
  for (const f of Object.values(fields)) {
    total++;
    if (f.source && f.confidence !== 'low') grounded++;
  }
  return { fields, itemCount: idx, grounded, total };
}
