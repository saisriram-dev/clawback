'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/client';
import { useWorkspace } from '@/components/workspace';
import { Labeled, EnginePill } from '@/components/ui';
import type { Company, Settings } from '@/lib/types';

export default function SettingsPage() {
  const { ws, engine, patchSettings, refresh, resetAll, loadDemo } = useWorkspace();
  const [c, setC] = useState<Company | null>(null);
  const [s, setS] = useState<Settings | null>(null);
  const [checking, setChecking] = useState(false);
  const [testing, setTesting] = useState(false);
  const [selftest, setSelftest] = useState<{ model: string; results: { file: string; seconds: number; fields: number; agreed: number; gemmaOnly: number; grounded: number; disagreements: string[] }[] } | { error: string } | null>(null);
  useEffect(() => {
    if (ws && !c) setC(structuredClone(ws.company));
    if (ws && !s) setS(structuredClone(ws.settings));
  }, [ws, c, s]);
  if (!ws || !c || !s) return null;

  const setCo = (k: keyof Company) => (e: { target: { value: string } }) => setC({ ...c, [k]: e.target.value });
  const setNum = (k: keyof Settings) => (e: { target: { value: string } }) => setS({ ...s, [k]: Number(e.target.value) });
  const setEng = (k: keyof Settings['engine'], num = false) => (e: { target: { value: string } }) => setS({ ...s, engine: { ...s.engine, [k]: num ? Number(e.target.value) : e.target.value } });

  const models = engine?.models ?? [];

  return (
    <div className="stack" style={{ maxWidth: 1100 }}>
      <h1>Settings</h1>
      <div className="grid2">
        <div className="card card-b">
          <h2 style={{ marginBottom: 12 }}>Your company</h2>
          <Labeled label="Company name" help="Used on the claim pack, and so the engine never mistakes you for the buyer."><input className="input" value={c.name} onChange={setCo('name')} /></Labeled>
          <div className="grid2">
            <Labeled label="IEC"><input className="input mono" value={c.iec} onChange={setCo('iec')} /></Labeled>
            <Labeled label="GSTIN"><input className="input mono" value={c.gstin} onChange={setCo('gstin')} /></Labeled>
          </div>
          <Labeled label="Address"><input className="input" value={c.address} onChange={setCo('address')} /></Labeled>
          <div className="grid2">
            <Labeled label="Signatory"><input className="input" value={c.signatoryName} onChange={setCo('signatoryName')} /></Labeled>
            <Labeled label="Title"><input className="input" value={c.signatoryTitle} onChange={setCo('signatoryTitle')} /></Labeled>
          </div>
          <div className="grid2">
            <Labeled label="Email"><input className="input" value={c.email} onChange={setCo('email')} /></Labeled>
            <Labeled label="Phone"><input className="input" value={c.phone} onChange={setCo('phone')} /></Labeled>
          </div>
          <Labeled label="Your email domains" help="Comma separated, e.g. yourcompany.com. Helps tell your emails from the buyer’s.">
            <input className="input mono" value={c.emailDomains.join(', ')} onChange={(e) => setC({ ...c, emailDomains: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} />
          </Labeled>
          <button className="btn primary" onClick={() => patchSettings({ company: c })}>Save company</button>
        </div>

        <div className="card card-b">
          <h2 style={{ marginBottom: 12 }}>Claim assumptions</h2>
          <div className="grid2">
            <Labeled label="USD → INR rate" help="Used for INR figures only; claims are in USD."><input className="input mono" type="number" step="0.01" value={s.fxUsdInr} onChange={setNum('fxUsdInr')} /></Labeled>
            <Labeled label="Rate as of"><input className="input mono" type="date" value={s.fxAsOf} onChange={(e) => setS({ ...s, fxAsOf: e.target.value })} /></Labeled>
          </div>
          <div className="grid2">
            <Labeled label="Default transit days" help="Loading date + transit = estimated US entry date."><input className="input mono" type="number" value={s.transitDaysDefault} onChange={setNum('transitDaysDefault')} /></Labeled>
            <Labeled label="Duty deposit lag (days)" help="Entry to duty payment, for CBP interest."><input className="input mono" type="number" value={s.depositLagDays} onChange={setNum('depositLagDays')} /></Labeled>
          </div>
          <div className="grid2">
            <Labeled label="Buyer’s interest basis" help="CBP pays the IRS overpayment rate.">
              <select className="input" value={s.interestBasis} onChange={(e) => setS({ ...s, interestBasis: e.target.value as Settings['interestBasis'] })}>
                <option value="corporate">Corporate</option>
                <option value="non_corporate">Non-corporate</option>
              </select>
            </Labeled>
            <Labeled label="Holding interest (% p.a.)" help="Shown on the refund clock."><input className="input mono" type="number" step="0.25" value={s.holdingRatePct} onChange={setNum('holdingRatePct')} /></Labeled>
          </div>
          <div className="grid3">
            <Labeled label="Option B split (%)"><input className="input mono" type="number" value={s.splitPct} onChange={setNum('splitPct')} /></Labeled>
            <Labeled label="Option C orders"><input className="input mono" type="number" min={1} max={6} value={s.nextOrders} onChange={setNum('nextOrders')} /></Labeled>
            <Labeled label="Payment days"><input className="input mono" type="number" value={s.paymentDays} onChange={setNum('paymentDays')} /></Labeled>
          </div>
          <Labeled label="Success fee (%)" help="ClawBack’s fee on amounts recovered (shown on the pipeline)."><input className="input mono" type="number" step="0.5" value={s.successFeePct} onChange={setNum('successFeePct')} /></Labeled>
          <button className="btn primary" onClick={() => patchSettings({ settings: { ...s, engine: undefined } as never })}>Save assumptions</button>
        </div>
      </div>

      <div className="card card-b" id="engine">
        <div className="row" style={{ marginBottom: 12 }}>
          <h2>Extraction engine</h2>
          <span className="spacer" />
          <EnginePill engine={engine} mode={ws.settings.engine.mode} />
        </div>
        <div className="grid2">
          <div>
            <Labeled label="Mode">
              <select className="input" value={s.engine.mode} onChange={setEng('mode')}>
                <option value="auto">Auto: Gemma when running, rules otherwise</option>
                <option value="gemma">Gemma required</option>
                <option value="rules">Deterministic rules only</option>
              </select>
            </Labeled>
            <Labeled label="Server">
              <select
                className="input"
                value={s.engine.provider}
                onChange={(e) => {
                  const provider = e.target.value as typeof s.engine.provider;
                  const preset =
                    provider === 'google'
                      ? { baseUrl: 'https://generativelanguage.googleapis.com', model: 'gemma-4-26b-a4b-it' }
                      : provider === 'ollama'
                        ? { baseUrl: 'http://127.0.0.1:11434', model: 'gemma4:e4b' }
                        : {};
                  setS({ ...s, engine: { ...s.engine, provider, ...preset } });
                }}
              >
                <option value="ollama">Ollama on this computer (Gemma 4, offline)</option>
                <option value="google">Google AI Studio / Gemini API (hosted Gemma 4)</option>
                <option value="openai">OpenAI-compatible (llama.cpp, LM Studio, vLLM, OpenRouter)</option>
              </select>
            </Labeled>
            <Labeled label="Server URL"><input className="input mono" value={s.engine.baseUrl} onChange={setEng('baseUrl')} /></Labeled>
            <Labeled label="Gemma model" help={s.engine.provider === 'google' ? 'gemma-4-26b-a4b-it (fast) or gemma-4-31b-it (most accurate).' : 'gemma4:e4b runs on an 8 GB GPU or 16 GB RAM laptop. gemma4:26b is more accurate; gemma4:e2b is lighter.'}>
              <input className="input mono" list="models" value={s.engine.model} onChange={setEng('model')} />
              <datalist id="models">
                {[...(s.engine.provider === 'google' ? ['gemma-4-26b-a4b-it', 'gemma-4-31b-it'] : ['gemma4:e4b', 'gemma4:e2b', 'gemma4:26b', 'gemma4:31b', 'gemma3:4b', 'gemma3:12b']), ...models].filter((v, i, a) => a.indexOf(v) === i).map((m) => <option key={m} value={m} />)}
              </datalist>
            </Labeled>
            {s.engine.provider !== 'ollama' && <Labeled label={s.engine.provider === 'google' ? 'Google AI Studio API key (leave empty if the server already has one)' : 'API key (if your server needs one)'}><input className="input mono" type="password" value={s.engine.apiKey} onChange={setEng('apiKey')} /></Labeled>}
            <div className="grid2">
              <Labeled label="Timeout per document (s)"><input className="input mono" type="number" value={s.engine.timeoutSec} onChange={setEng('timeoutSec', true)} /></Labeled>
              <Labeled label="Context window (tokens)"><input className="input mono" type="number" step={1024} value={s.engine.numCtx} onChange={setEng('numCtx', true)} /></Labeled>
            </div>
            <div className="row">
              <button className="btn primary" onClick={() => patchSettings({ settings: { engine: s.engine } })}>Save engine</button>
              <button
                className="btn"
                disabled={checking}
                onClick={async () => {
                  setChecking(true);
                  await refresh({ engine: true });
                  setChecking(false);
                }}
              >
                {checking ? 'Checking…' : 'Test connection'}
              </button>
              <button
                className="btn"
                disabled={testing || !(engine?.online && engine?.modelAvailable)}
                title="Reads two demo documents with Gemma and compares the result with the rules engine"
                onClick={async () => {
                  setTesting(true);
                  setSelftest(null);
                  try {
                    setSelftest(await api('/api/engine/selftest', { method: 'POST' }));
                  } catch (e) {
                    setSelftest({ error: (e as Error).message });
                  } finally {
                    setTesting(false);
                  }
                }}
              >
                {testing ? 'Gemma is reading…' : 'Run Gemma self-test'}
              </button>
            </div>
            {selftest && 'error' in selftest && <div className="flag error" style={{ marginTop: 10 }}><span className="mono">✕</span><span>{selftest.error}</span></div>}
            {selftest && 'results' in selftest && (
              <div className="callout ok small" style={{ marginTop: 10 }}>
                <b>Self-test with {selftest.model}:</b>
                {selftest.results.map((r) => (
                  <div key={r.file} style={{ marginTop: 4 }}>
                    <span className="mono">{r.file}</span>: {r.fields} values in {r.seconds}s · {r.agreed} confirmed by the rules engine · {r.grounded} grounded on their line
                    {r.disagreements.length > 0 && <div className="tiny muted">To check: {r.disagreements.join(' · ')}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="stack">
            {engine && (
              <div className={`callout ${engine.online && engine.modelAvailable ? 'ok' : ''}`}>
                <div className="small">
                  {engine.online ? (
                    <>Connected to {engine.provider === 'ollama' ? `Ollama ${engine.version ?? ''}` : 'server'} at <span className="mono">{engine.baseUrl}</span>. {engine.modelAvailable ? <>Model <b className="mono">{engine.model}</b> is ready.</> : engine.hint}</>
                  ) : (
                    <>Not connected: {engine.error}</>
                  )}
                </div>
                {engine.models.length > 0 && <div className="tiny muted" style={{ marginTop: 4 }}>Installed: {engine.models.join(', ')}</div>}
              </div>
            )}
            <div className="callout navy small">
              <b>Set up Gemma, option 1: Google AI Studio (2 minutes, no download):</b>
              <ol style={{ paddingLeft: 18, margin: '6px 0 8px' }}>
                <li>Get a free API key at <span className="mono">aistudio.google.com/apikey</span>.</li>
                <li>Choose <b>Google AI Studio</b> above, paste the key, keep model <span className="mono">gemma-4-26b-a4b-it</span>, then <b>Save engine</b> and <b>Test connection</b>.</li>
              </ol>
              <b>Option 2: on this computer with Ollama (offline, about 10 minutes):</b>
              <ol style={{ paddingLeft: 18, margin: '6px 0 0' }}>
                <li>Install Ollama from <span className="mono">ollama.com/download</span> (Windows, macOS, Linux).</li>
                <li>Open a terminal and run <span className="mono">ollama pull {s.engine.model}</span>.</li>
                <li>Press <b>Test connection</b>. New documents are then read by Gemma; existing ones can be re-read.</li>
              </ol>
              <div style={{ marginTop: 6 }}>With Ollama everything runs on this computer and documents never leave it.</div>
            </div>
            <div className="callout small">
              <b>What Gemma does here:</b> classifies documents when the keyword rules are unsure, reads values and cites the line each one is on, and transcribes photos and scans. <b>What it never does:</b> any arithmetic, rate lookups or claim amounts. Every value it returns is checked against the document text before it is used.
            </div>
          </div>
        </div>
      </div>

      <div className="card card-b">
        <h2 style={{ marginBottom: 12 }}>Data</h2>
        <div className="row wrap">
          <a className="btn" href="/api/export">Download workspace backup (JSON)</a>
          <a className="btn" href="/api/export?format=csv">Download ledger (CSV)</a>
          <button className="btn" onClick={() => window.confirm('Replace the current workspace with the demo exporter?') && loadDemo('rules')}>Load demo workspace</button>
          <button className="btn danger" onClick={() => window.confirm('Remove all documents, buyers and history? Settings are kept.') && resetAll()}>Clear workspace</button>
        </div>
        <div className="help" style={{ marginTop: 8 }}>Your data is stored in the <span className="mono">data</span> folder next to the app (or the folder set in <span className="mono">CLAWBACK_DATA_DIR</span>).</div>
      </div>
    </div>
  );
}
