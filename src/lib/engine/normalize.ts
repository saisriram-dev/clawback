// Deterministic normalisation of values read from documents.
// The extraction engine locates values; these functions decide what they mean.

import { isIsoDate } from './dates';

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5,
  jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

function iso(y: number, m: number, d: number): string | null {
  if (y < 100) y += 2000;
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const s = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return isIsoDate(s) ? s : null;
}

/**
 * Parse a date as written in Indian and US trade documents. Slash/dot/dash numeric dates
 * are read day-first (Indian convention) unless that is impossible.
 */
export function parseDate(input: string | null | undefined): string | null {
  if (!input) return null;
  const s = input.trim().replace(/(\d)(st|nd|rd|th)\b/gi, '$1').replace(/,/g, ' ').replace(/\s+/g, ' ');

  let m = /\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?!\d)/.exec(s);
  if (m) return iso(+m[1], +m[2], +m[3]);

  m = /\b(\d{1,2})[-/. ]([A-Za-z]{3,9})\.?[-/. ](\d{2,4})\b/.exec(s);
  if (m && MONTHS[m[2].toLowerCase()]) return iso(+m[3], MONTHS[m[2].toLowerCase()], +m[1]);

  m = /\b([A-Za-z]{3,9})\.? (\d{1,2}) (\d{4})\b/.exec(s);
  if (m && MONTHS[m[1].toLowerCase()]) return iso(+m[3], MONTHS[m[1].toLowerCase()], +m[2]);

  m = /\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/.exec(s);
  if (m) {
    const a = +m[1];
    const b = +m[2];
    const y = +m[3];
    if (a > 12 && b <= 12) return iso(y, b, a);
    if (b > 12 && a <= 12) return iso(y, a, b);
    return iso(y, b, a); // day-first by default
  }
  return null;
}

/** Find every date-like token in a line, with the matched text. */
export function findDates(line: string): { iso: string; text: string }[] {
  const out: { iso: string; text: string }[] = [];
  const patterns = [
    /\b\d{4}[-/.]\d{1,2}[-/.]\d{1,2}(?!\d)/g,
    /\b\d{1,2}(?:st|nd|rd|th)?[-/. ][A-Za-z]{3,9}\.?,?[-/. ]\d{2,4}\b/g,
    /\b[A-Za-z]{3,9}\.? \d{1,2}(?:st|nd|rd|th)?,? \d{4}\b/g,
    /\b\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}\b/g,
  ];
  const seen = new Set<string>();
  for (const re of patterns) {
    for (const m of line.matchAll(re)) {
      const d = parseDate(m[0]);
      if (d && !seen.has(m[0])) {
        seen.add(m[0]);
        out.push({ iso: d, text: m[0] });
      }
    }
  }
  return out;
}

/** Parse a number such as "1,23,456.78", "$4.20", "USD 4,20" (comma-decimal) or "(12.00)". */
export function parseNumber(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  if (typeof input === 'number') return Number.isFinite(input) ? input : null;
  let s = input.trim();
  if (!s) return null;
  const negative = /^\(.*\)$/.test(s) || /^[-−–]/.test(s);
  const m = /\d[\d,.' ]*\d|\d/.exec(s.replace(/[−–]/g, '-'));
  if (!m) return null;
  s = m[0].replace(/[' ]/g, '');
  // European style 1.234,56 or 4,20
  if (/^\d{1,3}(\.\d{3})+,\d{1,4}$/.test(s) || /^\d+,\d{1,2}$/.test(s)) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else {
    s = s.replace(/,/g, '');
  }
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

export function numStr(n: number | null): string | null {
  if (n === null || !Number.isFinite(n)) return null;
  return String(Math.round(n * 1e6) / 1e6);
}

/** Extract all numeric tokens in a line with their positions. */
export function numericTokens(line: string): { value: number; text: string; index: number }[] {
  const out: { value: number; text: string; index: number }[] = [];
  const re = /(?<![\w.])\(?[$₹€£]?\s?\d{1,3}(?:,\d{2,3})+(?:\.\d+)?\)?(?![\w])|(?<![\w.])\(?[$₹€£]?\s?\d+(?:\.\d+)?\)?(?![\w])/g;
  for (const m of line.matchAll(re)) {
    const v = parseNumber(m[0]);
    if (v !== null) out.push({ value: v, text: m[0].trim(), index: m.index ?? 0 });
  }
  return out;
}

export function normalizeHS(input: string | null | undefined): string | null {
  if (!input) return null;
  const digits = input.replace(/\D/g, '');
  if (digits.length < 4 || digits.length > 10) return null;
  return digits;
}

export function fmtHS(digits: string | null | undefined): string {
  if (!digits) return '—';
  if (digits.length <= 4) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 4)}.${digits.slice(4)}`;
  return `${digits.slice(0, 4)}.${digits.slice(4, 6)}.${digits.slice(6)}`;
}

export function normalizeCurrency(input: string | null | undefined): string | null {
  if (!input) return null;
  const s = input.toUpperCase();
  if (/USD|US\$|U\.S\.\s?DOLLAR|\bDOLLARS?\b|^\$|\s\$/.test(s) || s.trim() === '$') return 'USD';
  if (/EUR|€/.test(s)) return 'EUR';
  if (/GBP|£/.test(s)) return 'GBP';
  if (/INR|₹|\bRS\.?\b|RUPEE/.test(s)) return 'INR';
  if (/\bAED\b/.test(s)) return 'AED';
  const m = /\b[A-Z]{3}\b/.exec(s);
  return m ? m[0] : null;
}

/** Canonical form of an invoice / PO number for matching across documents. */
export function normRef(input: string | null | undefined): string {
  if (!input) return '';
  return input
    .toUpperCase()
    .replace(/^\s*(?:(?:COMMERCIAL\s+)?INVOICE|INV|PO|P\.O|NO|NUMBER|REF|#)(?:[\s.:#-]+|(?=\d))/g, '')
    .replace(/^\s*(?:NO|NUMBER|#)(?:[\s.:#-]+|(?=\d))/, '')
    .replace(/[^A-Z0-9]/g, '');
}

export function splitList(input: string | null | undefined): string[] {
  if (!input) return [];
  return input
    .split(/[,;]|\band\b|\s&\s/i)
    .map((s) => s.trim())
    .filter((s) => s.length >= 3);
}

// Company names ------------------------------------------------------------------------

const SUFFIXES = /\b(inc|incorporated|llc|l\.l\.c|ltd|limited|corp|corporation|co|company|pvt|private|plc|lp|llp|gmbh|the|usa|us|america)\b\.?/g;

export function companyKey(name: string | null | undefined): string {
  if (!name) return '';
  return name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(SUFFIXES, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function nameSimilarity(a: string, b: string): number {
  const ka = companyKey(a);
  const kb = companyKey(b);
  if (!ka || !kb) return 0;
  if (ka === kb) return 1;
  if (ka.includes(kb) || kb.includes(ka)) return 0.9;
  const ta = new Set(ka.split(' ').filter((t) => t.length > 1));
  const tb = new Set(kb.split(' ').filter((t) => t.length > 1));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}

export function tokens(s: string | null | undefined): Set<string> {
  return new Set(
    (s ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 2 && !/^\d+$/.test(t)),
  );
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Normalise a value of a given field type to the stored string form. */
export function normalizeValue(type: string, raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (!s || /^(null|none|n\/a|na|-|—)$/i.test(s)) return null;
  switch (type) {
    case 'money':
    case 'number':
      return numStr(parseNumber(s));
    case 'date':
      return parseDate(s);
    case 'hs':
      return normalizeHS(s);
    case 'currency':
      return normalizeCurrency(s);
    case 'incoterm': {
      const u = s.toUpperCase();
      const m = /\b(EXW|FCA|FAS|FOB|CFR|CNF|C&F|CIF|CPT|CIP|DAP|DPU|DAT|DDP)\b/.exec(u);
      if (!m) return null;
      if (m[1] === 'CNF' || m[1] === 'C&F') return 'CFR';
      if (m[1] === 'DAT') return 'DPU';
      return m[1];
    }
    case 'list':
      return splitList(s).join(', ') || null;
    default:
      return s.replace(/\s+/g, ' ');
  }
}
