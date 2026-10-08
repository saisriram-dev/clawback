#!/usr/bin/env node
// One-command launcher: installs dependencies if needed, builds if the code changed,
// picks a free port, starts ClawBack on this computer only, checks Gemma, opens the browser.
// Usage: node scripts/launch.mjs [--lan] [--port 3000] [--no-open]

import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const LAN = args.includes('--lan');
const NO_OPEN = args.includes('--no-open');
const portArg = args.indexOf('--port') >= 0 ? Number(args[args.indexOf('--port') + 1]) : null;
const isWin = process.platform === 'win32';
const npm = isWin ? 'npm.cmd' : 'npm';

const c = { b: (s) => `\x1b[1m${s}\x1b[0m`, g: (s) => `\x1b[32m${s}\x1b[0m`, y: (s) => `\x1b[33m${s}\x1b[0m`, r: (s) => `\x1b[31m${s}\x1b[0m`, d: (s) => `\x1b[2m${s}\x1b[0m` };
const say = (s = '') => console.log(s);

function run(cmd, cmdArgs, label) {
  say(c.d(`> ${label}`));
  const r = spawnSync(cmd, cmdArgs, { cwd: ROOT, stdio: 'inherit', shell: isWin });
  if (r.status !== 0) {
    say(c.r(`\n${label} failed (exit code ${r.status}).`));
    process.exit(r.status ?? 1);
  }
}

function hashTree() {
  const h = createHash('sha256');
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const p = path.join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else h.update(`${path.relative(ROOT, p)}:${st.size}:${st.mtimeMs}`);
    }
  };
  walk(path.join(ROOT, 'src'));
  for (const f of ['package.json', 'next.config.mjs', 'tsconfig.json']) if (existsSync(path.join(ROOT, f))) h.update(readFileSync(path.join(ROOT, f)));
  return h.digest('hex');
}

function portFree(port, host) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(port, host);
  });
}

async function checkOllama(model, baseUrl) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2500);
    const r = await fetch(`${baseUrl}/api/tags`, { signal: ctrl.signal });
    clearTimeout(t);
    const j = await r.json();
    const names = (j.models ?? []).map((m) => m.name);
    const has = names.some((n) => n === model || n === `${model}:latest`);
    return { online: true, has, names };
  } catch {
    return { online: false, has: false, names: [] };
  }
}

function openBrowser(url) {
  if (NO_OPEN) return;
  const cmd = isWin ? 'rundll32' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const a = isWin ? ['url.dll,FileProtocolHandler', url] : [url];
  try {
    spawn(cmd, a, { detached: true, stdio: 'ignore' }).unref();
  } catch {
    /* the URL is printed anyway */
  }
}

async function main() {
  say(c.b('\n  ClawBack · tariff refund recovery\n'));
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 22) {
    say(c.r(`  Node.js ${process.versions.node} is too old. Install Node.js 22 LTS or newer from https://nodejs.org and run this again.`));
    process.exit(1);
  }
  if (/onedrive/i.test(ROOT)) {
    say(c.y('  Note: this folder is inside OneDrive. Installing and building creates many files that OneDrive will try to sync.'));
    say(c.y('  For a faster, quieter setup, move the ClawBack folder to C:\\ClawBack (or pause OneDrive while it installs).\n'));
  }

  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const missing = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).filter((d) => !existsSync(path.join(ROOT, 'node_modules', d, 'package.json')));
  if (missing.length) {
    say(existsSync(path.join(ROOT, 'node_modules', 'next')) ? `  Installing new dependencies (${missing.join(', ')})…` : '  First run: installing dependencies (one time, needs internet, ~1–3 minutes)…');
    run(npm, ['install', '--no-audit', '--no-fund'], 'npm install');
  }

  const stampFile = path.join(ROOT, '.next', 'clawback-build-stamp');
  const want = hashTree();
  const have = existsSync(stampFile) ? readFileSync(stampFile, 'utf8') : '';
  if (want !== have || !existsSync(path.join(ROOT, '.next', 'BUILD_ID'))) {
    say('  Building the app (first run or code changed, ~1 minute)…');
    run(npm, ['run', 'build'], 'npm run build');
    writeFileSync(stampFile, want);
  }

  const host = LAN ? '0.0.0.0' : '127.0.0.1';
  let port = portArg || Number(process.env.PORT) || 3000;
  if (!portArg) {
    for (let p = port; p < port + 20; p++) {
      if (await portFree(p, host)) {
        port = p;
        break;
      }
    }
  }

  // Gemma: read the choice made with setup-gemma.bat (.env.local), then check it is reachable.
  const envFile = {};
  for (const f of ['.env', '.env.local']) {
    try {
      for (const line of readFileSync(path.join(ROOT, f), 'utf8').split(/\r?\n/)) {
        const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
        if (m) envFile[m[1]] = m[2].replace(/^["']|["']$/g, '');
      }
    } catch {
      /* no file */
    }
  }
  const genv = { ...envFile, ...process.env };
  if (genv.GEMMA_PROVIDER === 'google') {
    const model = genv.GEMMA_MODEL || 'gemma-4-26b-a4b-it';
    const base = (genv.GEMMA_BASE_URL || 'https://generativelanguage.googleapis.com').replace(/\/+$/, '');
    let ok = false;
    let why = 'no API key';
    if (genv.GEMMA_API_KEY) {
      try {
        const r = await fetch(`${base}/v1beta/models/${model}`, { headers: { 'x-goog-api-key': genv.GEMMA_API_KEY }, signal: AbortSignal.timeout(8000) });
        ok = r.ok;
        why = r.ok ? '' : r.status === 404 ? `model ${model} not offered` : `Google answered ${r.status} (check the API key)`;
      } catch (e) {
        why = `cannot reach Google AI Studio (${e.message})`;
      }
    }
    if (ok) say(c.g(`  Gemma is ready through Google AI Studio (${model}).`));
    else say(c.r(`  Gemma via Google AI Studio is not working: ${why}. Run setup-gemma.bat again.`));
  } else {
    const model = genv.GEMMA_MODEL || 'gemma4:e4b';
    const baseUrl = (genv.GEMMA_BASE_URL || 'http://127.0.0.1:11434').replace(/\/+$/, '');
    const engine = await checkOllama(model, baseUrl);
    if (!engine.online) {
      say(c.r('  Gemma is not set up yet. ClawBack needs Gemma to read documents.'));
      say(c.y('  Run setup-gemma.bat (2 minutes with a free Google AI Studio key), or install Ollama from'));
      say(c.y(`  https://ollama.com/download and run:  ollama pull ${model}`));
      say(c.d('  Until then the deterministic rules engine reads documents on its own (photos and scans need Gemma).'));
    } else if (!engine.has) {
      say(c.y(`  Ollama is running but ${model} is not downloaded. Run:  ollama pull ${model}`));
      if (engine.names.length) say(c.d(`  Installed models: ${engine.names.join(', ')} (you can pick one in Settings)`));
    } else {
      say(c.g(`  Gemma is ready in Ollama (${model}).`));
    }
  }

  const url = `http://localhost:${port}`;
  say(`\n  Starting on ${c.b(url)}${LAN ? c.y('  (shared on your network)') : ''}`);
  if (LAN) {
    const ips = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
    if (ips.length) say(c.d(`  Others on your network can open: ${ips.map((ip) => `http://${ip}:${port}`).join('  ')}`));
  }
  say(c.d('  Press Ctrl+C to stop.\n'));

  const nextBin = path.join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next');
  const child = spawn(process.execPath, [nextBin, 'start', '-H', host, '-p', String(port)], { cwd: ROOT, stdio: 'inherit', env: { ...process.env, NODE_ENV: 'production' } });
  let opened = false;
  const poll = setInterval(async () => {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (r.ok && !opened) {
        opened = true;
        clearInterval(poll);
        openBrowser(url);
      }
    } catch {
      /* not up yet */
    }
  }, 700);
  const stop = () => {
    clearInterval(poll);
    child.kill();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  child.on('exit', (code) => {
    clearInterval(poll);
    process.exit(code ?? 0);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
