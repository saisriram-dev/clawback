import { route, json } from '@/lib/server/api';
import { readWorkspace } from '@/lib/server/store';
import { bootQueue, getEngineStatus, queueState } from '@/lib/server/pipeline';
import { todayIso } from '@/lib/engine/dates';

export const dynamic = 'force-dynamic';

export const GET = route(async (req, _ctx, session) => {
  await bootQueue();
  const url = new URL(req.url);
  const ws = await readWorkspace();
  const engine = await getEngineStatus(ws.settings.engine, url.searchParams.get('engine') === 'force');
  return json({ ws, engine, queue: queueState(), today: todayIso(), me: { uid: session.uid, email: session.email, name: session.name, role: session.role } });
});
