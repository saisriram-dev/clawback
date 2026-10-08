// India IEEPA duty timeline as a dated lookup table. No model is involved here.
// The rate that applies to a shipment depends on the US entry date and, for the
// in-transit exceptions, on the date the goods were loaded on the vessel.
//
// Facts verified October 2026 against the sources listed in RATE_SOURCES. Effective times
// were 12:01 a.m. US Eastern; ClawBack works in calendar dates, so an entry dated on the
// effective day is treated as subject to the new rate.

export interface RateSource {
  id: string;
  title: string;
  url: string;
}

export const RATE_SOURCES: RateSource[] = [
  { id: 'eo14257', title: 'EO 14257 (2 Apr 2025): 10% baseline reciprocal duty from 5 Apr 2025 (in-transit: loaded before 5 Apr, entered before 27 May 2025)', url: 'https://www.thompsonhinesmartrade.com/2026/02/president-trump-lowers-ieepa-based-tariffs-on-india-and-announces-framework-for-bilateral-interim-trade-agreement/' },
  { id: 'eo14326', title: 'EO 14326 (31 Jul 2025): India country rate 25% from 7 Aug 2025, HTSUS 9903.02.26 (in-transit: loaded before 7 Aug, entered before 5 Oct 2025)', url: 'https://www.unisco.com/hts/99030226' },
  { id: 'eo14329', title: 'EO 14329 (6 Aug 2025): additional 25% on India from 27 Aug 2025 (in-transit: loaded before 27 Aug, entered before 17 Sep 2025)', url: 'https://www.chrobinson.com/en-sg/resources/insights-and-advisories/client-advisories/2025q3/08-06-2025-client-advisory-additional-25-tariff-on-india-for-use-russian-oil/' },
  { id: 'feb2026', title: 'EO of 6 Feb 2026 / CSMS #67702087: additional 25% removed for entries on or after 7 Feb 2026; reciprocal stays 25% until the interim agreement enters into force', url: 'https://www.chrobinson.com/en-gb/resources/insights-and-advisories/client-advisories/2026q1/02-10-2026-client-advisory-us-india-interim-trade-agreement-russian-oil-tariff-reduction-update' },
  { id: 'scotus', title: 'Learning Resources, Inc. v. Trump (US Supreme Court, 20 Feb 2026); IEEPA duties terminated 12:00 a.m. ET, 24 Feb 2026', url: 'https://www.whitecase.com/insight-alert/united-states-terminates-ieepa-based-tariffs-following-supreme-court-decision' },
  { id: 'agri', title: 'CSMS #66814923: agricultural products added to Annex II, entries on or after 13 Nov 2025 (HTSUS 9903.01.32 / 9903.02.78)', url: 'https://compliance.tandom.ai/adcvd-catalog/csms/66814923' },
];

export interface RateWindow {
  id: string;
  component: 'reciprocal' | 'additional';
  label: string;
  rate: number; // decimal, 0.25 = 25%
  from: string; // inclusive ISO entry date
  to: string | null; // exclusive ISO entry date
  sourceId: string;
  inTransit?: { loadedBefore: string; enteredBefore: string; fallbackRate: number; fallbackLabel: string };
}

// The table. Ordered by component then date.
export const INDIA_IEEPA_TIMELINE: RateWindow[] = [
  {
    id: 'reciprocal-baseline',
    component: 'reciprocal',
    label: 'Reciprocal baseline (EO 14257)',
    rate: 0.10,
    from: '2025-04-05',
    to: '2025-08-07',
    sourceId: 'eo14257',
    inTransit: { loadedBefore: '2025-04-05', enteredBefore: '2025-05-27', fallbackRate: 0, fallbackLabel: 'In transit before 5 Apr 2025: no reciprocal duty' },
  },
  {
    id: 'reciprocal-india',
    component: 'reciprocal',
    label: 'Reciprocal, India rate (EO 14326)',
    rate: 0.25,
    from: '2025-08-07',
    to: '2026-02-24',
    sourceId: 'eo14326',
    inTransit: { loadedBefore: '2025-08-07', enteredBefore: '2025-10-05', fallbackRate: 0.10, fallbackLabel: 'In transit before 7 Aug 2025: baseline 10% applies' },
  },
  {
    id: 'additional-india',
    component: 'additional',
    label: 'Additional duty on India (EO 14329)',
    rate: 0.25,
    from: '2025-08-27',
    to: '2026-02-07',
    sourceId: 'eo14329',
    inTransit: { loadedBefore: '2025-08-27', enteredBefore: '2025-09-17', fallbackRate: 0, fallbackLabel: 'In transit before 27 Aug 2025: additional duty not applied' },
  },
];

export const IEEPA_START = '2025-04-05';
export const IEEPA_END_EXCLUSIVE = '2026-02-24';

export interface AppliedComponent {
  id: string;
  label: string;
  rate: number;
  sourceId: string;
  note?: string;
}

export interface RateResult {
  rate: number;
  components: AppliedComponent[];
  trail: string[]; // human-readable explanation of each rule applied
}

/**
 * IEEPA duty rate on an Indian-origin entry.
 * @param entryDate US entry (or warehouse withdrawal) date, ISO
 * @param loadDate date loaded on the vessel at the port of loading, ISO (for in-transit exceptions)
 */
export function indiaIeepaRate(entryDate: string, loadDate?: string | null): RateResult {
  const trail: string[] = [];
  const components: AppliedComponent[] = [];

  if (entryDate < IEEPA_START) {
    trail.push(`Entry ${entryDate} is before ${IEEPA_START}: no IEEPA duty applied.`);
    return { rate: 0, components, trail };
  }
  if (entryDate >= IEEPA_END_EXCLUSIVE) {
    trail.push(`Entry ${entryDate} is on or after ${IEEPA_END_EXCLUSIVE}: IEEPA duties were no longer collected (Supreme Court ruling of 20 Feb 2026). Later duties under other statutes are not IEEPA refunds.`);
    return { rate: 0, components, trail };
  }

  for (const w of INDIA_IEEPA_TIMELINE) {
    const inWindow = entryDate >= w.from && (w.to === null || entryDate < w.to);
    if (!inWindow) continue;
    const t = w.inTransit;
    if (t && loadDate && loadDate < t.loadedBefore && entryDate < t.enteredBefore) {
      trail.push(`${w.label}: goods loaded ${loadDate} (before ${t.loadedBefore}) and entered ${entryDate} (before ${t.enteredBefore}). ${t.fallbackLabel}.`);
      if (t.fallbackRate > 0) {
        components.push({ id: `${w.id}-in-transit`, label: t.fallbackLabel, rate: t.fallbackRate, sourceId: w.sourceId, note: 'in-transit exception' });
      }
      continue;
    }
    components.push({ id: w.id, label: w.label, rate: w.rate, sourceId: w.sourceId });
    trail.push(`${w.label}: ${(w.rate * 100).toFixed(0)}% for entries from ${w.from}${w.to ? ` to before ${w.to}` : ''}.`);
  }

  const rate = Math.round(components.reduce((a, c) => a + c.rate, 0) * 10000) / 10000;
  return { rate, components, trail };
}

// ---------------------------------------------------------------------------------------
// Exemption warnings by HS code. These are flags for a human to check, never silent
// adjustments: exemption lists were long and changed over time.

export interface ExemptionFlag {
  code: string;
  text: string;
}

const EXEMPTION_RULES: { test: (hs: string) => boolean; code: string; text: string }[] = [
  { test: (h) => h.startsWith('30'), code: 'annex2-pharma', text: 'Chapter 30 pharmaceuticals were listed in Annex II (exempt from the reciprocal duty). Check the HTSUS line.' },
  { test: (h) => /^(72|73|76)/.test(h), code: 's232-metals', text: 'Steel and aluminium articles under Section 232 were excluded from IEEPA duties. Check whether this line was a 232 article.' },
  { test: (h) => h.startsWith('74'), code: 's232-copper', text: 'Copper articles may have been under Section 232 from 1 Aug 2025 and so outside IEEPA duties. Check the HTSUS line.' },
  { test: (h) => /^(8703|8704|8708)/.test(h), code: 's232-autos', text: 'Autos and auto parts under Section 232 were excluded from IEEPA duties. Check the HTSUS line.' },
  { test: (h) => /^(09|08|0801|2101)/.test(h), code: 'agri-nov2025', text: 'Several tea, coffee, spice, fruit and nut lines became exempt for entries on or after 13 Nov 2025 (CSMS #66814923). Check the HTSUS line.' },
  { test: (h) => /^(2709|2710|2711|2716)/.test(h), code: 'annex2-energy', text: 'Energy products were listed in Annex II (exempt from the reciprocal duty).' },
  { test: (h) => /^(8541|8542)/.test(h), code: 'annex2-semis', text: 'Semiconductors were listed in Annex II (exempt from the reciprocal duty).' },
  { test: (h) => /^(4407|4408|4409|9401|9403)/.test(h), code: 's232-wood', text: 'Timber, lumber and some furniture lines moved under Section 232 from 14 Oct 2025. Check whether IEEPA still applied.' },
];

export function exemptionFlags(hs: string | null | undefined): ExemptionFlag[] {
  if (!hs) return [];
  const h = hs.replace(/\D/g, '');
  if (h.length < 4) return [];
  return EXEMPTION_RULES.filter((r) => r.test(h)).map(({ code, text }) => ({ code, text }));
}

export function rateSource(id: string): RateSource | undefined {
  return RATE_SOURCES.find((s) => s.id === id);
}
