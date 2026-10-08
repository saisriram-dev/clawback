'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useWorkspace } from '@/components/workspace';
import { fmtINR, fmtPct, fmtUSD } from '@/lib/engine/money';
import { STAGE_LABEL } from '@/lib/types';
import { api } from '@/lib/client';

export default function BuyersPage() {
  const { portfolio, refresh, toast } = useWorkspace();
  const [name, setName] = useState('');
  if (!portfolio) return null;
  return (
    <div className="stack">
      <div className="row">
        <h1>Buyers</h1>
        <span className="spacer" />
        <input className="input" style={{ width: 260 }} placeholder="Add a buyer by name" value={name} onChange={(e) => setName(e.target.value)} />
        <button
          className="btn"
          disabled={name.trim().length < 2}
          onClick={async () => {
            try {
              await api('/api/buyers', { method: 'POST', json: { name: name.trim() } });
              setName('');
              await refresh();
            } catch (e) {
              toast((e as Error).message, true);
            }
          }}
        >
          Add
        </button>
      </div>
      <div className="card">
        <table className="tbl">
          <thead>
            <tr>
              <th>Buyer</th>
              <th>Route</th>
              <th className="n">Documents</th>
              <th className="n">Duty paid</th>
              <th className="n">Absorbed</th>
              <th className="n">Ratio</th>
              <th className="n">Fair claim (INR)</th>
              <th className="n">Direct CBP claim</th>
              <th>Stage</th>
            </tr>
          </thead>
          <tbody>
            {portfolio.buyers.map((b) => (
              <tr key={b.buyer.id}>
                <td>
                  <Link href={`/buyers/${b.buyer.id}`} style={{ fontWeight: 600 }}>{b.buyer.name}</Link>
                  {b.buyer.aliases.length > 0 && <div className="tiny muted">also: {b.buyer.aliases.slice(0, 3).join(', ')}</div>}
                </td>
                <td><span className="badge mono">{b.incoterms.join('/') || '—'}</span> <span className="small muted">{b.route.replace('_', ' ')}</span></td>
                <td className="n">{b.docCount}</td>
                <td className="n">{fmtUSD(b.totals.tariffPaid, 0)}</td>
                <td className="n">{fmtUSD(b.totals.absorbed, 0)}</td>
                <td className="n">{fmtPct(b.totals.ratio, 0)}</td>
                <td className="n" style={{ fontWeight: 600 }}>{fmtINR(b.totals.fairClaimINR)}</td>
                <td className="n">{b.totals.directClaim ? fmtUSD(b.totals.directClaim, 0) : '—'}</td>
                <td>{STAGE_LABEL[b.buyer.stage]}</td>
              </tr>
            ))}
            {!portfolio.buyers.length && <tr><td colSpan={9} className="muted" style={{ padding: 20 }}>Buyers appear automatically as documents are read.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
