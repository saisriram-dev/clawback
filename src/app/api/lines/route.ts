import { z } from 'zod';
import { route, json, body, HttpError } from '@/lib/server/api';
import { mutate, logEvent } from '@/lib/server/store';
import { isIsoDate } from '@/lib/engine/dates';
import type { LineOverride } from '@/lib/types';

export const dynamic = 'force-dynamic';

const num = z.number().finite().min(0).max(1e9).nullable();
const date = z
  .string()
  .nullable()
  .refine((v) => v === null || isIsoDate(v), 'must be a date (YYYY-MM-DD)');

const Patch = z.object({
  key: z.string().regex(/^d_[a-f0-9]+#\d+$|^d\d+#\d+$/),
  patch: z
    .object({
      entryDate: date.optional(),
      loadDate: date.optional(),
      ratePct: z.number().finite().min(0).max(200).nullable().optional(),
      exempt: z.boolean().optional(),
      baselinePrice: num.optional(),
      revisedPrice: num.optional(),
      discountMode: z.enum(['on_invoice', 'credit_note']).nullable().optional(),
      customsValue: num.optional(),
      excluded: z.boolean().optional(),
    })
    .strict(),
});

/** Set or clear (null) per-line overrides. */
export const PATCH = route(async (req) => {
  const p = Patch.parse(await body(req));
  const out = await mutate((ws) => {
    const docId = p.key.split('#')[0];
    if (!ws.documents[docId]) throw new HttpError(404, 'Ledger line not found.');
    const cur: LineOverride = { ...(ws.lineOverrides[p.key] ?? {}) };
    for (const [k, v] of Object.entries(p.patch) as [keyof LineOverride, unknown][]) {
      if (v === null || v === false) delete cur[k];
      else (cur as Record<string, unknown>)[k] = v;
    }
    if (Object.keys(cur).length) ws.lineOverrides[p.key] = cur;
    else delete ws.lineOverrides[p.key];
    logEvent(ws, 'override', `Line ${p.key}: ${JSON.stringify(p.patch)}`, { docId, buyerId: ws.documents[docId].buyerId ?? undefined });
    return cur;
  });
  return json(out);
});
