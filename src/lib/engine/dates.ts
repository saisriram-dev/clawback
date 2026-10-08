// Date helpers. All dates in ClawBack are calendar dates as ISO strings (YYYY-MM-DD).
// No time zones, no clocks: the same input always produces the same output.

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isIsoDate(s: unknown): s is string {
  if (typeof s !== 'string') return false;
  const m = ISO_RE.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

export function toUtc(iso: string): number {
  const m = ISO_RE.exec(iso);
  if (!m) throw new Error(`Not an ISO date: ${iso}`);
  return Date.UTC(+m[1], +m[2] - 1, +m[3]);
}

export function fromUtc(ms: number): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
  const da = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${mo}-${da}`;
}

export function addDays(iso: string, days: number): string {
  return fromUtc(toUtc(iso) + Math.round(days) * 86_400_000);
}

/** Whole days from a to b (b − a). */
export function diffDays(a: string, b: string): number {
  return Math.round((toUtc(b) - toUtc(a)) / 86_400_000);
}

export function minDate(a: string, b: string): string {
  return a <= b ? a : b;
}
export function maxDate(a: string, b: string): string {
  return a >= b ? a : b;
}

export function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** "14 Aug 2025" */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso || !isIsoDate(iso)) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** "14 August 2025" */
export function fmtDateLong(iso: string | null | undefined): string {
  if (!iso || !isIsoDate(iso)) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS_LONG[m - 1]} ${y}`;
}

/** "July 2026" */
export function fmtMonth(iso: string | null | undefined): string {
  if (!iso || !isIsoDate(iso)) return '—';
  const [y, m] = iso.split('-').map(Number);
  return `${MONTHS_LONG[m - 1]} ${y}`;
}

/** Today's date in India (the user's home market), as ISO. */
export function todayIso(now: Date = new Date()): string {
  // IST is UTC+05:30 with no DST.
  return fromUtc(now.getTime() + 330 * 60_000 - ((now.getTime() + 330 * 60_000) % 86_400_000));
}
