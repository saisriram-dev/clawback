'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useWorkspace } from '@/components/workspace';
import { STAGES, STAGE_LABEL, type Stage } from '@/lib/types';
import { fmtINR, fmtINRShort, fmtUSD, usdToInr } from '@/lib/engine/money';

export default function PipelinePage() {
  const { ws, portfolio, patchBuyer } = useWorkspace();
  const [over, setOver] = useState<Stage | null>(null);
  if (!ws || !portfolio) return null;
  const fx = ws.settings.fxUsdInr;
  const buyers = portfolio.buyers.filter((b) => b.route !== 'claim_direct' && b.route !== 'empty');
  const recoveredUSD = buyers.reduce((a, b) => a + (b.buyer.recoveredUSD ?? 0), 0);
  const agreedUSD = buyers.reduce((a, b) => a + (b.buyer.stage === 'settled' ? b.buyer.agreedUSD ?? 0 : 0), 0);
  const fee = (recoveredUSD * ws.settings.successFeePct) / 100;

  const move = (id: string, stage: Stage) => patchBuyer(id, { stage });

  return (
    <div className="stack">
      <div className="row">
        <h1>Recovery pipeline</h1>
        <span className="spacer" />
        <div className="kpis" style={{ gridTemplateColumns: 'repeat(3, auto)' }}>
          <div className="kpi"><div className="kicker">Recovered</div><div className="v">{fmtINRShort(usdToInr(recoveredUSD, fx))}</div><div className="s">{fmtUSD(recoveredUSD, 0)} received</div></div>
          <div className="kpi"><div className="kicker">Agreed</div><div className="v">{fmtINRShort(usdToInr(agreedUSD, fx))}</div><div className="s">settled, awaiting payment</div></div>
          <div className="kpi"><div className="kicker">Open claims</div><div className="v">{fmtINRShort(usdToInr(buyers.filter((b) => b.buyer.stage !== 'settled').reduce((a, b) => a + b.totals.fairClaim, 0), fx))}</div><div className="s">drafted, sent or countered</div></div>
        </div>
      </div>

      <div className="kanban">
        {STAGES.map((stage) => {
          const col = buyers.filter((b) => b.buyer.stage === stage);
          const sum = col.reduce((a, b) => a + (stage === 'settled' ? b.buyer.agreedUSD ?? b.totals.fairClaim : b.totals.fairClaim), 0);
          return (
            <div
              key={stage}
              className={`col${over === stage ? ' over' : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(stage);
              }}
              onDragLeave={() => setOver(null)}
              onDrop={(e) => {
                e.preventDefault();
                setOver(null);
                const id = e.dataTransfer.getData('text/plain');
                if (id) void move(id, stage);
              }}
            >
              <div className="col-h">
                <h3>{STAGE_LABEL[stage]}</h3>
                <span className="badge mono">{col.length}</span>
                <span className="spacer" />
                <span className="mono small">{fmtINRShort(usdToInr(sum, fx))}</span>
              </div>
              <div className="col-b">
                {col.map((b) => (
                  <div key={b.buyer.id} className="kcard" draggable onDragStart={(e) => e.dataTransfer.setData('text/plain', b.buyer.id)}>
                    <Link href={`/buyers/${b.buyer.id}?tab=negotiation`} style={{ fontWeight: 600 }}>{b.buyer.name}</Link>
                    <div className="amt">{fmtINR(b.totals.fairClaimINR)}</div>
                    <div className="tiny muted mono">{fmtUSD(b.totals.fairClaim, 0)} · leverage {b.leverage.score}</div>
                    {b.buyer.agreedOption && (
                      <div className="small" style={{ marginTop: 4 }}>
                        Agreed option {b.buyer.agreedOption}: <span className="mono">{fmtUSD(b.buyer.agreedUSD ?? 0, 0)}</span>
                      </div>
                    )}
                    {stage === 'settled' && (
                      <div className="small" style={{ marginTop: 4 }}>
                        Recovered: <span className="mono">{b.buyer.recoveredUSD !== null ? `${fmtINR(usdToInr(b.buyer.recoveredUSD, fx))}` : 'pending'}</span>{' '}
                        <button
                          className="btn ghost sm"
                          onClick={() => {
                            const v = window.prompt('Amount received from the buyer (USD)', String(b.buyer.recoveredUSD ?? b.buyer.agreedUSD ?? ''));
                            if (v === null) return;
                            const n = Number(v.replace(/[,$\s]/g, ''));
                            if (Number.isFinite(n) && n >= 0) void patchBuyer(b.buyer.id, { recoveredUSD: n });
                          }}
                        >
                          edit
                        </button>
                      </div>
                    )}
                    {b.buyer.responses.length > 0 && <div className="tiny" style={{ marginTop: 4, color: 'var(--navy-600)' }}>Buyer responded via link · {new Date(b.buyer.responses.at(-1)!.at).toLocaleDateString('en-IN')}</div>}
                    <select className="input" style={{ marginTop: 8, fontSize: 12, padding: '3px 6px' }} value={stage} onChange={(e) => move(b.buyer.id, e.target.value as Stage)} aria-label="Move to stage">
                      {STAGES.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
                    </select>
                  </div>
                ))}
                {!col.length && <div className="tiny muted" style={{ textAlign: 'center', padding: 16 }}>Drag a buyer here</div>}
              </div>
            </div>
          );
        })}
      </div>
      <div className="small muted">
        ClawBack success fee at {ws.settings.successFeePct}% of amounts recovered: <span className="mono">{fmtINR(usdToInr(fee, fx))}</span> ({fmtUSD(fee, 0)}).
      </div>
    </div>
  );
}
