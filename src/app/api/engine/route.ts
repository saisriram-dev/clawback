import { route, json } from '@/lib/server/api';
import { readWorkspace } from '@/lib/server/store';
import { getEngineStatus } from '@/lib/server/pipeline';

export const dynamic = 'force-dynamic';

export const GET = route(async () => {
  const ws = await readWorkspace();
  return json(await getEngineStatus(ws.settings.engine, true));
});
