import { z } from 'zod';
import { route, json, body } from '@/lib/server/api';
import { mutate } from '@/lib/server/store';
import { getEngineStatus } from '@/lib/server/pipeline';
import { isIsoDate } from '@/lib/engine/dates';

export const dynamic = 'force-dynamic';

const Company = z
  .object({
    name: z.string().trim().min(2).max(160),
    iec: z.string().max(20),
    gstin: z.string().max(20),
    address: z.string().max(400),
    signatoryName: z.string().max(120),
    signatoryTitle: z.string().max(120),
    email: z.string().max(200),
    phone: z.string().max(40),
    emailDomains: z.array(z.string().trim().toLowerCase().max(120)).max(10),
  })
  .partial();

const Engine = z
  .object({
    mode: z.enum(['auto', 'gemma', 'rules']),
    provider: z.enum(['ollama', 'openai', 'google']),
    baseUrl: z.string().url().max(300),
    model: z.string().trim().min(1).max(120),
    apiKey: z.string().max(300),
    timeoutSec: z.number().int().min(30).max(1800),
    numCtx: z.number().int().min(2048).max(262144),
  })
  .partial();

const Settings = z
  .object({
    fxUsdInr: z.number().finite().min(1).max(1000),
    fxAsOf: z.string().refine(isIsoDate, 'must be YYYY-MM-DD'),
    transitDaysDefault: z.number().int().min(1).max(120),
    depositLagDays: z.number().int().min(0).max(60),
    interestBasis: z.enum(['corporate', 'non_corporate']),
    holdingRatePct: z.number().finite().min(0).max(50),
    successFeePct: z.number().finite().min(0).max(50),
    splitPct: z.number().finite().min(1).max(99),
    nextOrders: z.number().int().min(1).max(6),
    paymentDays: z.number().int().min(1).max(180),
    engine: Engine,
  })
  .partial();

export const PATCH = route(async (req) => {
  const p = z.object({ company: Company.optional(), settings: Settings.optional() }).parse(await body(req));
  const ws = await mutate((ws) => {
    if (p.company) Object.assign(ws.company, p.company);
    if (p.settings) {
      const { engine, ...rest } = p.settings;
      Object.assign(ws.settings, rest);
      if (engine) Object.assign(ws.settings.engine, engine);
    }
    return ws;
  });
  const engine = await getEngineStatus(ws.settings.engine, true);
  return json({ company: ws.company, settings: ws.settings, engine });
});
