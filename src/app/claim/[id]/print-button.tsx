'use client';

export function PrintButton() {
  return (
    <button className="pack-btn" onClick={() => window.print()}>
      Print / Save as PDF
    </button>
  );
}
