#!/usr/bin/env node
// Health check: Node version, data folder, Ollama, Gemma model, and a live JSON extraction test.
// Usage: npm run doctor  [-- --model gemma4:12b] [-- --url http://127.0.0.1:11434]

import { promises as fs } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (k, d) => (args.indexOf(k) >= 0 ? args[args.indexOf(k) + 1] : d);
const MODEL = opt('--model', 'gemma4:e4b');
const URL = opt('--url', 'http://127.0.0.1:11434').replace(/\/+$/, '');
const ok = (s) => console.log(`  \x1b[32m✓\x1b[0m ${s}`);
const warn = (s) => console.log(`  \x1b[33m!\x1b[0m ${s}`);
const bad = (s) => console.log(`  \x1b[31m✕\x1b[0m ${s}`);

async function get(url, ms = 4000, init = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

console.log('\nClawBack doctor\n');
const major = Number(process.versions.node.split('.')[0]);
major >= 22 ? ok(`Node.js ${process.versions.node}`) : bad(`Node.js ${process.versions.node}: install Node.js 22 LTS or newer`);

const dataDir = process.env.CLAWBACK_DATA_DIR || path.join(process.cwd(), 'data');
try {
  await fs.mkdir(dataDir, { recursive: true });
  const probe = path.join(dataDir, '.write-test');
  await fs.writeFile(probe, 'ok');
  await fs.unlink(probe);
  ok(`Data folder is writable: ${dataDir}`);
} catch (e) {
  bad(`Cannot write to ${dataDir}: ${e.message}`);
}

try {
  const v = await (await get(`${URL}/api/version`)).json();
  ok(`Ollama ${v.version} at ${URL}`);
  const tags = await (await get(`${URL}/api/tags`)).json();
  const names = (tags.models ?? []).map((m) => m.name);
  if (!names.some((n) => n === MODEL || n === `${MODEL}:latest`)) {
    warn(`Model ${MODEL} not pulled. Run:  ollama pull ${MODEL}`);
    if (names.length) console.log(`    Installed: ${names.join(', ')}`);
    process.exit(0);
  }
  ok(`Model ${MODEL} is installed`);
  console.log(`    Running a live extraction test (the first call loads the model, allow up to a minute)…`);
  const t0 = Date.now();
  const r = await get(
    `${URL}/api/chat`,
    240000,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        stream: false,
        think: false,
        options: { temperature: 0, seed: 42 },
        format: { type: 'object', properties: { baseline: { type: 'string' }, revised: { type: 'string' }, line: { type: 'integer' } }, required: ['baseline', 'revised', 'line'] },
        messages: [
          { role: 'system', content: 'Copy values exactly. Output JSON only.' },
          { role: 'user', content: 'Find the old and new unit price and the line number.\n0001| Hi Senthil,\n0002| Bath towels: from USD 6.40 to USD 5.10 per pc\n0003| Regards' },
        ],
      }),
    },
  );
  if (!r.ok) {
    const txt = await r.text();
    if (/think/i.test(txt)) warn('This Ollama version does not accept the "think" option; ClawBack retries without it automatically.');
    else throw new Error(`HTTP ${r.status}: ${txt.slice(0, 200)}`);
  } else {
    const j = await r.json();
    const out = JSON.parse(j.message?.content ?? '{}');
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    if (String(out.baseline).includes('6.40') && String(out.revised).includes('5.10') && out.line === 2) ok(`Gemma read the test document correctly in ${secs}s: ${JSON.stringify(out)}`);
    else warn(`Gemma answered in ${secs}s but not exactly as expected: ${JSON.stringify(out)}. ClawBack's grounding check will flag such values for review.`);
  }
} catch (e) {
  warn(`Ollama not reachable at ${URL} (${e.message}).`);
  console.log('    ClawBack still works with its deterministic rules engine.');
  console.log('    To enable Gemma: install Ollama from https://ollama.com/download, then run:  ollama pull ' + MODEL);
}
console.log('');
