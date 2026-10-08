import { promises as fs } from 'node:fs';
import path from 'node:path';
import { route, json, HttpError } from '@/lib/server/api';
import { readWorkspace } from '@/lib/server/store';
import { ingest } from '@/lib/extraction/ingest';
import { classifyByRules, extractByRules } from '@/lib/extraction/rules';
import { gemmaExtract } from '@/lib/extraction/gemma';
import { mergeExtraction } from '@/lib/extraction/ground';
import { getEngineStatus } from '@/lib/server/pipeline';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const SAMPLES = ['demo/brightwater/price-revision-brightwater.eml', 'demo/brightwater/invoice-118.pdf'];

/** Run Gemma on two known demo documents and report agreement with the rules engine. */
export const POST = route(async () => {
  const ws = await readWorkspace();
  const st = await getEngineStatus(ws.settings.engine, true);
  if (!st.online) throw new HttpError(503, `Extraction engine offline: ${st.error ?? ''} ${st.hint ?? ''}`.trim());
  if (!st.modelAvailable) throw new HttpError(503, st.hint ?? 'Model not available.');
  const results = [];
  for (const rel of SAMPLES) {
    const file = path.join(process.cwd(), rel);
    const buf = await fs.readFile(file).catch(() => null);
    if (!buf) throw new HttpError(500, `Sample ${rel} is missing. Run: npm run demo:generate`);
    const ing = await ingest(buf, file);
    const c = classifyByRules(ing.lines, ing.format === 'eml');
    if (c.kind === 'other') continue;
    const ctx = { exporterName: 'Kaveri Looms Pvt Ltd', exporterDomains: ['kaveriloom.example'] };
    const rules = extractByRules(c.kind, ing.lines, ctx, ing.meta);
    const t0 = Date.now();
    const g = await gemmaExtract(ws.settings.engine, c.kind, ing.lines, ctx.exporterName);
    const merged = mergeExtraction(c.kind, 'selftest', ing.lines, rules, g.result);
    const fields = Object.values(merged.fields);
    results.push({
      file: path.basename(rel),
      kind: c.kind,
      seconds: Math.round((Date.now() - t0) / 100) / 10,
      fields: fields.length,
      agreed: fields.filter((f) => f.method === 'gemma+rules').length,
      gemmaOnly: fields.filter((f) => f.method === 'gemma').length,
      disagreements: fields.filter((f) => f.confidence === 'low').map((f) => f.note ?? '').slice(0, 5),
      grounded: merged.grounded,
    });
  }
  return json({ model: st.model, version: st.version, results });
});
