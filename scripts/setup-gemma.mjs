// One-time Gemma setup. Writes your choice to .env.local (never uploaded to GitHub).
//   Option 1: Google AI Studio (Gemini API) serving Gemma 4. Needs a free API key, no download.
//   Option 2: Ollama on this computer. Offline, about a 10 GB download.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import readline from 'node:readline/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(ROOT, '.env.local');
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const say = (s = '') => console.log(s);

function readEnv() {
  const out = {};
  if (!existsSync(FILE)) return out;
  for (const line of readFileSync(FILE, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function writeEnv(env) {
  const lines = ['# Written by setup-gemma. Keep this file private: it holds your API key.', ...Object.entries(env).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `${k}=${v}`), ''];
  writeFileSync(FILE, lines.join('\n'), 'utf8');
}

say('\n  ClawBack: set up Gemma\n');
say('  1) Google AI Studio (recommended for the hackathon): hosted Gemma 4, free key, nothing to download');
say('  2) Ollama on this computer: Gemma 4 runs offline, about 10 GB download, needs 16 GB RAM\n');
const choice = (await rl.question('  Choose 1 or 2: ')).trim();
const env = readEnv();
env.AUTH_SECRET ||= randomBytes(32).toString('hex');
env.CLAWBACK_ENGINE_MODE = 'auto';

if (choice === '1') {
  say('\n  Get a key: open https://aistudio.google.com/apikey , sign in with Google, click "Create API key", copy it.');
  const key = (await rl.question('  Paste the API key here: ')).trim();
  const model = (await rl.question('  Model [gemma-4-26b-a4b-it]: ')).trim() || 'gemma-4-26b-a4b-it';
  say('\n  Checking the key…');
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}`, { headers: { 'x-goog-api-key': key }, signal: AbortSignal.timeout(10000) });
    if (r.ok) say(`  OK: ${model} is available with this key.`);
    else say(`  Warning: Google answered ${r.status}. Check the key and model name (saving anyway).`);
  } catch (e) {
    say(`  Could not reach Google (${e.message}). Saving anyway; check your internet connection.`);
  }
  Object.assign(env, { GEMMA_PROVIDER: 'google', GEMMA_MODEL: model, GEMMA_API_KEY: key, GEMMA_BASE_URL: '' });
} else if (choice === '2') {
  const model = (await rl.question('  Model [gemma4:e4b]: ')).trim() || 'gemma4:e4b';
  Object.assign(env, { GEMMA_PROVIDER: 'ollama', GEMMA_MODEL: model, GEMMA_BASE_URL: 'http://127.0.0.1:11434', GEMMA_API_KEY: '' });
  const has = spawnSync('ollama', ['--version'], { encoding: 'utf8', shell: process.platform === 'win32' });
  if (has.status !== 0) {
    say('\n  Ollama is not installed. Install it from https://ollama.com/download , then run this again,');
    say(`  or run in a terminal:  ollama pull ${model}`);
  } else {
    say(`\n  Downloading ${model} with Ollama (this can take a while)…`);
    spawnSync('ollama', ['pull', model], { stdio: 'inherit', shell: process.platform === 'win32' });
  }
} else {
  say('  Nothing changed.');
  rl.close();
  process.exit(0);
}
writeEnv(env);
rl.close();
say(`\n  Saved to .env.local. Now start ClawBack with start.bat (or: npm start).\n`);
