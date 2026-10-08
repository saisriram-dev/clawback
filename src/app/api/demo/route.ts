import { z } from 'zod';
import { route, json } from '@/lib/server/api';
import { mutate, emptyWorkspace } from '@/lib/server/store';
import { clearUploads, loadDemoWorkspace } from '@/lib/server/demo';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Reset the workspace and load the demo exporter. Body: { engine?: "rules" | "auto" } */
export const POST = route(async (req) => {
  const { engine } = z.object({ engine: z.enum(['rules', 'auto']).default('rules') }).parse(await req.json().catch(() => ({})));
  const documents = await loadDemoWorkspace(engine);
  return json({ ok: true, documents });
});

/** Clear everything (documents, buyers, uploads). Settings and company profile are kept. */
export const DELETE = route(async () => {
  await clearUploads();
  await mutate((ws) => {
    const keep = { settings: ws.settings, company: ws.company };
    Object.assign(ws, emptyWorkspace(), keep);
  });
  return json({ ok: true });
});
