'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Opt {
  id: 'A' | 'B' | 'C';
  title: string;
  amountUSD: number;
  summary: string;
  terms: string[];
}

const usd = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

export function Respond({ token, options, exporter }: { token: string; options: Opt[]; exporter: string }) {
  const router = useRouter();
  const [pick, setPick] = useState<Opt['id'] | 'counter' | null>(null);
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async () => {
    if (!pick) return;
    if (name.trim().length < 2) return setErr('Please enter your name.');
    const amountUSD = pick === 'counter' && amount.trim() ? Number(amount.replace(/[,$\s]/g, '')) : null;
    if (pick === 'counter' && amountUSD !== null && !Number.isFinite(amountUSD)) return setErr('Enter the amount as a number.');
    setBusy(true);
    setErr('');
    try {
      const r = await fetch(`/api/portal/${token}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ option: pick, name, note, amountUSD }) });
      if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? 'Could not send your response.');
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-card">
      <h2>Choose how to settle</h2>
      <div className="p-opts">
        {options.map((o) => (
          <button key={o.id} className={`p-opt${pick === o.id ? ' on' : ''}${o.id === 'C' ? ' rec' : ''}`} onClick={() => setPick(o.id)}>
            <span className="p-oid">Option {o.id}</span>
            <span className="p-otitle">{o.title}</span>
            <span className="p-oamt">{usd(o.amountUSD)}</span>
            <span className="p-osum">{o.summary}</span>
          </button>
        ))}
      </div>
      <button className={`p-link${pick === 'counter' ? ' on' : ''}`} onClick={() => setPick('counter')}>Propose something else</button>
      {pick && (
        <div className="p-form">
          <label>Your name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" /></label>
          {pick === 'counter' && <label>Amount you propose (USD, optional)<input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 20000" /></label>}
          <label>Message to {exporter} (optional)<textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></label>
          {err && <div className="p-err">{err}</div>}
          <button className="p-submit" disabled={busy} onClick={submit}>
            {busy ? 'Sending…' : pick === 'counter' ? 'Send counter-proposal' : `Accept option ${pick}`}
          </button>
        </div>
      )}
    </div>
  );
}
