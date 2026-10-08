'use client';

import { useEffect, useState } from 'react';

/**
 * Live counter of what your money is earning for your buyers while they hold your share of the refund.
 * baseUSD: holding value accrued up to today (from the refund clock).
 * owedUSD: the amount they are holding now. ratePct: annual holding rate from Settings.
 */
export function InterestTicker({ baseUSD, owedUSD, ratePct, fx, light }: { baseUSD: number; owedUSD: number; ratePct: number; fx: number; light?: boolean }) {
  const [t0] = useState(() => Date.now());
  const [now, setNow] = useState(t0);
  useEffect(() => {
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const id = setInterval(() => setNow(Date.now()), reduce ? 5000 : 100);
    return () => clearInterval(id);
  }, []);
  if (owedUSD <= 0) return null;
  const perSecUSD = (owedUSD * (ratePct / 100)) / (365 * 86400);
  const valueINR = (baseUSD + perSecUSD * ((now - t0) / 1000)) * fx;
  const perHourINR = perSecUSD * 3600 * fx;
  return (
    <div className={`ticker${light ? ' light' : ''}`} title={`${ratePct}% a year on the share they are holding. Change the rate in Settings.`}>
      <span className="pulse" aria-hidden="true" />
      <span className="tv">₹{valueINR.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
      <span className="tl">earned by your buyers on your money so far, about ₹{Math.round(perHourINR).toLocaleString('en-IN')} more every hour</span>
    </div>
  );
}
