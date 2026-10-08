'use client';

import Link from 'next/link';
import { useWorkspace } from '@/components/workspace';
import { Bar } from '@/components/ui';
import { InterestTicker } from '@/components/ticker';
import { fmtINR, fmtINRShort, fmtPct, fmtUSD } from '@/lib/engine/money';
import { fmtMonth } from '@/lib/engine/dates';
import { STAGE_LABEL } from '@/lib/types';

export default function PortfolioPage() {
  const { ws, portfolio, loading, loadDemo, busy, engine } = useWorkspace();
  if (loading && !ws) return <div className="muted">Loading workspace…</div>;
  if (!ws || !portfolio) return null;

  const docs = Object.values(ws.documents);
  if (!docs.length) return <Onboarding onDemo={loadDemo} gemmaReady={!!engine?.online && !!engine.modelAvailable} />;

  const t = portfolio.totals;
  const fx = ws.settings.fxUsdInr;
  const negotiable = portfolio.buyers.filter((b) => b.route !== 'claim_direct' && b.route !== 'empty');
  const direct = portfolio.buyers.filter((b) => b.route === 'claim_direct' || b.route === 'mixed');
  const maxPriority = Math.max(1, ...negotiable.map((b) => b.priority));
  const groundedPct = t.fieldsTotal ? t.fieldsGrounded / t.fieldsTotal : 0;
  const holding = negotiable.filter((b) => b.clock.landed && b.buyer.stage !== 'settled');
  const holdingBase = holding.reduce((a, b) => a + b.clock.holdingInterest, 0);
  const holdingOwed = holding.reduce((a, b) => a + b.totals.fairClaim, 0);

  return (
    <div>
      <div className="hero">
        <div className="hero-main">
          <div className="hero-rule" />
          <div className="kicker">Recoverable from your buyers</div>
          <div className="hero-num">
            {fmtINRShort(t.fairClaimINR).replace(/ (Cr|L)$/, '')}
            <span className="unit">{/ (Cr|L)$/.exec(fmtINRShort(t.fairClaimINR))?.[0] ?? ''}</span>
          </div>
          <div className="hero-sub">
            recoverable across <b>{t.buyersWithClaim}</b> buyer{t.buyersWithClaim === 1 ? '' : 's'}
            {busy && <span className="muted"> · still reading documents…</span>}
          </div>
          <div className="hero-meta">
            {fmtUSD(t.fairClaimUSD)} at ₹{fx.toFixed(2)}/USD · {t.lines} ledger lines · {docs.length} documents
            {t.directClaimUSD > 0 && <> · plus {fmtUSD(t.directClaimUSD, 0)} to claim directly from CBP</>}
          </div>
          <InterestTicker baseUSD={holdingBase} owedUSD={holdingOwed} ratePct={ws.settings.holdingRatePct} fx={fx} />
        </div>
        <div className="kpis">
          <div className="kpi">
            <div className="kicker">Duty paid by buyers</div>
            <div className="v">{fmtUSD(t.tariffPaidUSD, 0)}</div>
            <div className="s">IEEPA duty on your shipments, now refundable to them</div>
          </div>
          <div className="kpi">
            <div className="kicker">Absorbed by you</div>
            <div className="v">{fmtUSD(t.absorbedUSD, 0)}</div>
            <div className="s">price cuts that paid for that duty · {fmtPct(t.ratio)} of it</div>
          </div>
          <div className="kpi">
            <div className="kicker">Recovered so far</div>
            <div className="v">{fmtINRShort(t.recoveredINR)}</div>
            <div className="s">{t.agreedUSD > 0 ? `${fmtUSD(t.agreedUSD, 0)} agreed` : 'nothing settled yet'}</div>
          </div>
          <div className="kpi">
            <div className="kicker">Values grounded</div>
            <div className="v">{fmtPct(groundedPct, 0)}</div>
            <div className="s">{t.fieldsGrounded} of {t.fieldsTotal} values traced to a source line{t.needsReview ? ` · ${t.needsReview} to check` : ''}</div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-h">
          <h2>Buyers ranked by recoverable amount × leverage</h2>
          <span className="spacer" />
          <Link className="btn sm" href="/method#leverage">How leverage is scored</Link>
          <a className="btn sm" href="/api/export?format=csv">Export ledger (CSV)</a>
        </div>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ width: 28 }}>#</th>
                <th>Buyer</th>
                <th>Terms</th>
                <th className="n">Fair claim</th>
                <th className="n">USD</th>
                <th className="n">Absorbed</th>
                <th style={{ width: 120 }}>Leverage</th>
                <th style={{ width: 140 }}>Priority</th>
                <th>Refund clock</th>
                <th>Stage</th>
              </tr>
            </thead>
            <tbody>
              {negotiable.map((b, i) => (
                <tr key={b.buyer.id}>
                  <td className="mono muted">{i + 1}</td>
                  <td>
                    <Link href={`/buyers/${b.buyer.id}`} style={{ fontWeight: 600 }}>{b.buyer.name}</Link>
                    <div className="tiny muted">{b.docCount} documents · {b.totals.lines} lines{b.flags.some((f) => f.level === 'warn') ? ' · needs attention' : ''}</div>
                  </td>
                  <td>
                    <span className="badge mono">{b.incoterms.filter((x) => x !== 'DDP').join('/') || '—'}</span>
                    {b.route === 'mixed' && <span className="badge warn" style={{ marginLeft: 4 }}>+DDP</span>}
                    {b.route === 'confirm' && <span className="badge warn" style={{ marginLeft: 4 }}>confirm</span>}
                  </td>
                  <td className="n" style={{ fontWeight: 600 }}>{fmtINR(b.totals.fairClaimINR)}</td>
                  <td className="n muted">{fmtUSD(b.totals.fairClaim, 0)}</td>
                  <td className="n">{fmtPct(b.totals.ratio, 0)}</td>
                  <td>
                    <div className="row"><Bar value={b.leverage.score} /><span className="mono small">{b.leverage.score}</span></div>
                  </td>
                  <td>
                    <div className="row"><Bar value={(b.priority / maxPriority) * 100} accent /><span className="mono small">{fmtUSD(b.priority, 0)}</span></div>
                  </td>
                  <td className="small">
                    {b.clock.landed ? (
                      <>held ~{b.clock.daysHeld} d{b.clock.window.basis === 'confirmed' ? ' (confirmed)' : ` since ~${fmtMonth(b.clock.window.likely)}`}</>
                    ) : (
                      <>expected ~{fmtMonth(b.clock.window.likely)}</>
                    )}
                  </td>
                  <td><span className={`badge ${b.buyer.stage === 'settled' ? 'ok' : b.buyer.stage === 'countered' ? 'warn' : b.buyer.stage === 'sent' ? 'navy' : ''}`}>{STAGE_LABEL[b.buyer.stage]}</span></td>
                </tr>
              ))}
              {!negotiable.length && (
                <tr><td colSpan={10} className="muted" style={{ padding: 20 }}>No buyers with a negotiable claim yet. Upload invoices and price-revision emails on the Intake page.</td></tr>
              )}
            </tbody>
            {negotiable.length > 0 && (
              <tfoot>
                <tr>
                  <td />
                  <td>Total</td>
                  <td />
                  <td className="n">{fmtINR(t.fairClaimINR)}</td>
                  <td className="n">{fmtUSD(t.fairClaimUSD, 0)}</td>
                  <td className="n">{fmtPct(t.ratio, 0)}</td>
                  <td colSpan={4} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {direct.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-h">
            <h2>You were the importer of record: claim directly from CBP</h2>
          </div>
          <div className="card-b">
            <p className="small muted">These shipments were DDP, so the refund is paid to you, not the buyer. File a CAPE Declaration in the ACE Portal or ask your customs broker. No negotiation needed.</p>
            <table className="tbl">
              <thead><tr><th>Buyer</th><th className="n">Lines</th><th className="n">Est. duty + interest</th><th className="n">INR</th></tr></thead>
              <tbody>
                {direct.map((b) => (
                  <tr key={b.buyer.id}>
                    <td><Link href={`/buyers/${b.buyer.id}`}>{b.buyer.name}</Link></td>
                    <td className="n">{b.directLines.length}</td>
                    <td className="n">{fmtUSD(b.totals.directClaim)}</td>
                    <td className="n">{fmtINR(b.totals.directClaimINR)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {portfolio.unassigned.length > 0 && (
        <div className="callout" style={{ marginTop: 16 }}>
          {portfolio.unassigned.length} document{portfolio.unassigned.length > 1 ? 's are' : ' is'} not linked to a buyer.{' '}
          <Link href="/intake">Assign on the Intake page →</Link>
        </div>
      )}
    </div>
  );
}

function Onboarding({ onDemo, gemmaReady }: { onDemo: (e: 'rules' | 'auto') => Promise<void>; gemmaReady: boolean }) {
  return (
    <div className="stack" style={{ maxWidth: 920 }}>
      <div className="hero-main">
        <div className="kicker">ClawBack</div>
        <h1 style={{ color: '#fff', fontSize: 30, marginTop: 6, fontWeight: 600 }}>Your buyers got the tariff refund. Part of it is yours.</h1>
        <p style={{ color: '#e2dcff', marginTop: 10, maxWidth: 680, fontSize: 15 }}>
          In 2025 you cut prices so US buyers could absorb IEEPA tariffs. In February 2026 the Supreme Court struck those tariffs down, and the US government is now refunding them, with interest, to the importer of record. ClawBack proves how much of that refund your discounts paid for and builds the claim pack to get it back.
        </p>
      </div>
      <div className="grid2">
        <div className="card card-b">
          <div className="kicker">Start with your documents</div>
          <h2 style={{ margin: '6px 0' }}>Upload invoices, price-revision emails and bank realisations</h2>
          <p className="small muted">PDF, .eml, Word, Excel, CSV, text or photos. The extraction engine reads them, every value is traced to its line, and you approve each number.</p>
          <Link className="btn primary" href="/intake">Go to Intake →</Link>
        </div>
        <div className="card card-b">
          <div className="kicker">Or explore a worked example</div>
          <h2 style={{ margin: '6px 0' }}>Kaveri Looms: a home-textile exporter with 7 US buyers</h2>
          <p className="small muted">30 realistic documents (all companies fictional). Loads in seconds with the rules engine{gemmaReady ? ', or let Gemma read them all.' : '.'}</p>
          <div className="row">
            <button className="btn accent" onClick={() => onDemo('rules')}>Load demo workspace</button>
            {gemmaReady && <button className="btn" onClick={() => onDemo('auto')}>Load and read with Gemma</button>}
          </div>
        </div>
      </div>
      <div className="callout navy small">
        <b>How it works.</b> AI reads the documents, deterministic code does the math, and a human approves every number. Same input, same output, every time.
      </div>
    </div>
  );
}
