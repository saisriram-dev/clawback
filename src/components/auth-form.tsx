'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Logo } from './ui';
import './public.css';

function safeNext(): string {
  if (typeof window === 'undefined') return '/';
  const n = new URLSearchParams(window.location.search).get('next') ?? '/';
  return n.startsWith('/') && !n.startsWith('//') ? n : '/';
}

async function post(path: string, json?: unknown): Promise<void> {
  const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(json ?? {}) });
  if (!r.ok) {
    const j = (await r.json().catch(() => null)) as { error?: string } | null;
    throw new Error(j?.error?.replace(/^Invalid input: /, '').replace(/\w+: /g, '') ?? `Request failed (${r.status})`);
  }
}

export function DemoButton({ className = 'btn accent', label = 'Try the live demo' }: { className?: string; label?: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  return (
    <>
      <button
        type="button"
        className={className}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setErr('');
          try {
            await post('/api/auth/guest');
            window.location.href = '/';
          } catch (e) {
            setErr((e as Error).message);
            setBusy(false);
          }
        }}
      >
        {busy ? 'Setting up your sandbox…' : label}
      </button>
      {err && <span className="auth-err" role="alert">{err}</span>}
    </>
  );
}

export function AuthForm({ mode }: { mode: 'login' | 'signup' }) {
  const [f, setF] = useState({ name: '', company: '', email: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [me, setMe] = useState<{ name: string; role: string } | null>(null);
  useEffect(() => {
    fetch('/api/auth/me', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j?.user && setMe(j.user))
      .catch(() => {});
  }, []);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      await post(mode === 'login' ? '/api/auth/login' : '/api/auth/signup', mode === 'login' ? { email: f.email, password: f.password } : f);
      window.location.href = mode === 'login' ? safeNext() : '/';
    } catch (e2) {
      setErr((e2 as Error).message);
      setBusy(false);
    }
  };
  return (
    <div className="auth">
      <div className="auth-side">
        <Link href="/welcome" className="auth-brand"><Logo size={34} /> <span>ClawBack</span></Link>
        <div className="auth-pitch">
          <h1>Your US buyer got the tariff refund. Part of it is yours.</h1>
          <p>Upload your invoices, price-revision emails and bank certificates. ClawBack proves, line by line, how much of the refund your discounts paid for, and builds the claim your buyer can say yes to.</p>
          <ul>
            <li>Every number traced to the line it came from</li>
            <li>Claim pack, settlement options and rebuttals in minutes</li>
            <li>Your workspace is private to your company</li>
          </ul>
        </div>
        <div className="auth-foot">Negotiation support, not legal advice.</div>
      </div>
      <div className="auth-main">
        <form className="auth-card" onSubmit={submit} noValidate>
          <h2>{mode === 'login' ? 'Sign in to ClawBack' : 'Create your free account'}</h2>
          <p className="muted">{mode === 'login' ? 'Welcome back. Your claims are where you left them.' : 'One account per export company. Takes 30 seconds.'}</p>
          {me && (
            <div className="auth-note">
              You are signed in as <b>{me.role === 'guest' ? 'a demo visitor' : me.name}</b>. <Link href="/">Continue to your workspace</Link>
            </div>
          )}
          {mode === 'signup' && (
            <>
              <label className="f" htmlFor="name">Your name</label>
              <input id="name" className="input" autoComplete="name" value={f.name} onChange={set('name')} required />
              <label className="f" htmlFor="company">Export company</label>
              <input id="company" className="input" autoComplete="organization" placeholder="e.g. Kaveri Looms Pvt Ltd" value={f.company} onChange={set('company')} required />
            </>
          )}
          <label className="f" htmlFor="email">Work email</label>
          <input id="email" className="input" type="email" autoComplete="email" value={f.email} onChange={set('email')} required />
          <label className="f" htmlFor="password">Password</label>
          <input id="password" className="input" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={8} value={f.password} onChange={set('password')} required />
          {mode === 'signup' && <div className="help">At least 8 characters. Stored as a salted scrypt hash, never in plain text.</div>}
          {err && <div className="auth-err" role="alert">{err}</div>}
          <button className="btn primary auth-submit" disabled={busy} type="submit">
            {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
          <div className="auth-alt">
            {mode === 'login' ? (
              <>New to ClawBack? <Link href="/signup">Create a free account</Link></>
            ) : (
              <>Already have an account? <Link href="/login">Sign in</Link></>
            )}
          </div>
          <div className="auth-or"><span>or</span></div>
          <div className="auth-demo">
            <DemoButton className="btn auth-demo-btn" label="Explore a live demo without signing up" />
          </div>
        </form>
      </div>
    </div>
  );
}
