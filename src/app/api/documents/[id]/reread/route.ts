import { route, json, HttpError } from '@/lib/server/api';
import { mutate } from '@/lib/server/store';
import { enqueue } from '@/lib/server/pipeline';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

/** Re-read a document. Body (optional): { engine: "gemma" | "rules" }. */
export const POST = route<Ctx>(async (req, { params }) => {
  const { id } = await params;
  const b = (await req.json().catch(() => ({}))) as { engine?: 'gemma' | 'rules' };
  const engine = b.engine === 'gemma' || b.engine === 'rules' ? b.engine : undefined;
  await mutate((ws) => {
    const d = ws.documents[id];
    if (!d) throw new HttpError(404, 'Document not found.');
    d.status = 'queued';
    d.error = undefined;
  });
  enqueue([id], { forceEngine: engine });
  return json({ ok: true });
});
