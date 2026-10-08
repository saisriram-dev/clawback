// Money helpers. Amounts are carried as numbers in major units (USD, INR) and rounded
// half-away-from-zero to cents at every step that produces a reported figure.

export function round2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  const s = Math.sign(n);
  return (s * Math.round(Math.abs(n) * 100 + 1e-9)) / 100;
}

export function round4(n: number): number {
  if (!Number.isFinite(n)) return 0;
  const s = Math.sign(n);
  return (s * Math.round(Math.abs(n) * 10000 + 1e-9)) / 10000;
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

export function sum(xs: number[]): number {
  return round2(xs.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0));
}

const usd2 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 });
const inr0 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const inr2 = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 });

export function fmtUSD(n: number | null | undefined, digits: 0 | 2 = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return digits === 0 ? usd0.format(n) : usd2.format(n);
}

/** Unit prices can carry more precision than cents (e.g. $4.125). */
export function fmtPrice(n: number | null | undefined, currency = 'USD'): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  const digits = Math.abs(n * 100 - Math.round(n * 100)) > 1e-6 ? 4 : 2;
  const s = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: digits }).format(n);
  return currency === 'USD' ? `$${s}` : `${currency} ${s}`;
}

export function fmtINR(n: number | null | undefined, withDecimals = false): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return `₹${withDecimals ? inr2.format(n) : inr0.format(Math.round(n))}`;
}

/** Indian short scale: ₹2.84 Cr, ₹38.4 L, ₹92,400 */
export function fmtINRShort(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  const a = Math.abs(n);
  const sign = n < 0 ? '−' : '';
  if (a >= 1e7) return `${sign}₹${trim(a / 1e7, 2)} Cr`;
  if (a >= 1e5) return `${sign}₹${trim(a / 1e5, 2)} L`;
  return `${sign}₹${inr0.format(Math.round(a))}`;
}

function trim(n: number, digits: number): string {
  return n.toFixed(digits).replace(/\.?0+$/, '');
}

export function fmtNum(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return num.format(n);
}

export function fmtPct(ratio: number | null | undefined, digits = 1): string {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return '—';
  return `${(ratio * 100).toFixed(digits).replace(/\.0+$/, '')}%`;
}

export function usdToInr(usd: number, fx: number): number {
  return round2(usd * fx);
}
