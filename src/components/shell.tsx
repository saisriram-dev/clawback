'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { useWorkspace } from './workspace';
import { EnginePill, Logo } from './ui';
import { fmtINRShort } from '@/lib/engine/money';

const I = {
  portfolio: 'M3 13h4v8H3zM10 8h4v13h-4zM17 3h4v18h-4z',
  intake: 'M12 16V4m0 0l-5 5m5-5l5 5M4 16v3a2 2 0 002 2h12a2 2 0 002-2v-3',
  buyers: 'M16 11a4 4 0 10-8 0M4 21a8 8 0 0116 0M12 7a3 3 0 110-6 3 3 0 010 6z',
  pipeline: 'M4 6h10M4 12h14M4 18h7M17 4l3 2-3 2M20 16l-3 2 3 2',
  method: 'M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h5',
  settings: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.6 1.6 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.6 1.6 0 00-2.7 1.1V21a2 2 0 11-4 0v-.1a1.6 1.6 0 00-2.7-1.1l-.1.1a2 2 0 11-2.8-2.8l.1-.1A1.6 1.6 0 004.6 15H4.5a2 2 0 110-4h.1a1.6 1.6 0 001.1-2.7l-.1-.1a2 2 0 112.8-2.8l.1.1A1.6 1.6 0 0011 4.6V4.5a2 2 0 114 0v.1a1.6 1.6 0 002.7 1.1l.1-.1a2 2 0 112.8 2.8l-.1.1a1.6 1.6 0 001.1 2.7h.1a2 2 0 110 4h-.1z',
};

function Icon({ d }: { d: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

const NAV = [
  { href: '/', label: 'Portfolio', icon: I.portfolio },
  { href: '/intake', label: 'Intake', icon: I.intake },
  { href: '/buyers', label: 'Buyers', icon: I.buyers },
  { href: '/pipeline', label: 'Recovery pipeline', icon: I.pipeline },
  { href: '/method', label: 'Method & sources', icon: I.method },
  { href: '/settings', label: 'Settings', icon: I.settings },
];

export function Shell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const { ws, engine, portfolio, busy, queue, error, me, logout } = useWorkspace();
  const docCount = ws ? Object.keys(ws.documents).length : 0;
  const buyerCount = portfolio?.buyers.length ?? 0;
  const active = (href: string) => (href === '/' ? path === '/' : path.startsWith(href));
  const initials = (me?.name ?? '?').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  return (
    <div className="shell">
      <aside className="side">
        <Link href="/" className="brand" style={{ textDecoration: 'none' }}>
          <Logo size={30} />
          <div>
            <div className="brand-word">ClawBack</div>
            <div className="brand-sub">Tariff refund recovery</div>
          </div>
        </Link>
        <nav className="nav">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className={active(n.href) ? 'active' : ''} title={n.label}>
              <Icon d={n.icon} />
              <span className="lbl">{n.label}</span>
              {n.href === '/intake' && docCount > 0 && <span className="count">{docCount}</span>}
              {n.href === '/buyers' && buyerCount > 0 && <span className="count">{buyerCount}</span>}
            </Link>
          ))}
        </nav>
        <div className="side-foot">
          {ws && <div><b>{ws.company.name}</b></div>}
          {portfolio && portfolio.totals.fairClaimUSD > 0 && <div className="side-money">{fmtINRShort(portfolio.totals.fairClaimINR)}</div>}
          {portfolio && portfolio.totals.fairClaimUSD > 0 && <div>recoverable from your buyers</div>}
          <div style={{ marginTop: 12 }}>Gemma reads the documents. Deterministic code does the math. You approve every number.</div>
        </div>
      </aside>
      <div className="main">
        {me?.role === 'guest' && (
          <div className="guest-bar">
            <span>
              <b>You are in a private demo sandbox</b> with a fictional exporter. Nothing here is shared with other visitors.
            </span>
            <span className="spacer" />
            <a href="/signup">Create your free account</a>
          </div>
        )}
        <div className="topbar">
          <EnginePill engine={engine} mode={ws?.settings.engine.mode} />
          {(busy || queue.pending > 0) && (
            <span className="pill">
              <span className="spinner" /> Reading documents{queue.pending ? `, ${queue.pending} waiting` : ''}
            </span>
          )}
          {error && <span className="badge bad">Server: {error}</span>}
          <span className="spacer" />
          <span className="disclaimer">Negotiation support, not legal advice.</span>
          {me && (
            <span className="user-chip" title={me.email}>
              <span className="av">{initials}</span>
              <span>{me.role === 'guest' ? 'Demo visitor' : me.name}</span>
              <button type="button" onClick={() => void logout()}>Sign out</button>
            </span>
          )}
        </div>
        <div className="content">{children}</div>
        <div className="footer-note">
          ClawBack prepares negotiation material for exporters whose US buyers received IEEPA duty refunds. It is negotiation support, not legal advice. Rates and CBP processes are summarised from public sources listed under Method &amp; sources; confirm them for your entries.
        </div>
      </div>
    </div>
  );
}
