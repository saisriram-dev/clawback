'use client';

import { useState } from 'react';

const FX = 96.4; // ₹ per USD, same default as Settings
const INTEREST = 1.045; // CBP pays interest: roughly 6% a year for ~9 months on the refund

function inr(v: number): string {
  if (v >= 1e7) return `₹${(v / 1e7).toFixed(2)} Cr`;
  if (v >= 1e5) return `₹${(v / 1e5).toFixed(1)} L`;
  return `₹${Math.round(v).toLocaleString('en-IN')}`;
}

/**
 * Quick estimate from four answers. Uses the same chain as the ledger, at portfolio level:
 * duty = value × rate; absorbed = min(discount given, duty); claim = absorbed ÷ duty × refund with interest.
 */
export function Estimator() {
  const [sales, setSales] = useState(800_000); // USD shipped at the revised prices
  const [disc, setDisc] = useState(12); // % price cut given
  const [rate, setRate] = useState(50); // IEEPA rate on those entries
  const [fob, setFob] = useState(90); // % shipped where the buyer is importer of record (FOB/CIF)

  const duty = sales * (rate / 100);
  const discountGiven = (sales * (disc / 100)) / (1 - disc / 100);
  const absorbed = Math.min(discountGiven, duty);
  const ratio = duty > 0 ? absorbed / duty : 0;
  const claimUSD = ratio * duty * INTEREST * (fob / 100);
  const claimINR = claimUSD * FX;

  return (
    <div className="est" aria-label="Refund estimator">
      <div className="est-out">
        <div className="est-label">You could ask your buyers for about</div>
        <div className="est-num" aria-live="polite">{inr(claimINR)}</div>
        <div className="est-sub">${Math.round(claimUSD).toLocaleString('en-US')} · your discounts covered {Math.round(ratio * 100)}% of the duty they paid</div>
      </div>
      <div className="est-in">
        <label>
          <span>US sales during the tariff period <b>${(sales / 1000).toLocaleString('en-US')}k</b></span>
          <input type="range" min={50_000} max={5_000_000} step={50_000} value={sales} onChange={(e) => setSales(Number(e.target.value))} />
        </label>
        <label>
          <span>Average price cut you gave <b>{disc}%</b></span>
          <input type="range" min={1} max={40} step={1} value={disc} onChange={(e) => setDisc(Number(e.target.value))} />
        </label>
        <label>
          <span>Tariff rate on those shipments</span>
          <span className="est-seg" role="radiogroup" aria-label="Tariff rate">
            {[10, 25, 50].map((r) => (
              <button key={r} type="button" role="radio" aria-checked={rate === r} className={rate === r ? 'on' : ''} onClick={() => setRate(r)}>{r}%</button>
            ))}
          </span>
        </label>
        <label>
          <span>Shipped FOB, CIF or CFR (buyer imports) <b>{fob}%</b></span>
          <input type="range" min={0} max={100} step={5} value={fob} onChange={(e) => setFob(Number(e.target.value))} />
        </label>
        <div className="est-note">A rough estimate at ₹{FX}/USD. Your real figure comes from your invoices, line by line, with the exact dated tariff rates and CBP interest.</div>
      </div>
    </div>
  );
}
