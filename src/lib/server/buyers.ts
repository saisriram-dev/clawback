// Buyer matching: attach each document to a buyer by name, alias or email domain.

import type { Buyer, DocRecord, Workspace } from '../types';
import { companyKey, nameSimilarity } from '../engine/normalize';
import { newId, newToken } from './store';
import { currentUid } from './tenant';

export interface PendingProfile {
  name: string;
  profile: { revenueSharePct: number | null; relationshipSinceYear: number | null; openOrders: boolean | null };
  transitDays: number | null;
  contactName?: string;
  contactEmail?: string;
}
const gp = globalThis as typeof globalThis & { __cbPendingProfiles?: Map<string, PendingProfile[]> };
const pendingKey = () => currentUid() ?? '_root';

/** Profiles (revenue share, relationship, open orders) to apply when these buyers appear. Used by the demo loader. Kept per account. */
export function setPendingProfiles(list: PendingProfile[]): void {
  gp.__cbPendingProfiles ??= new Map();
  gp.__cbPendingProfiles.set(pendingKey(), list);
}

function applyPending(buyer: Buyer): void {
  const list = gp.__cbPendingProfiles?.get(pendingKey());
  if (!list?.length) return;
  const i = list.findIndex((p) => nameSimilarity(p.name, buyer.name) >= 0.8 || buyer.aliases.some((a) => nameSimilarity(p.name, a) >= 0.8));
  if (i < 0) return;
  const p = list[i];
  buyer.name = p.name;
  buyer.revenueSharePct = p.profile.revenueSharePct;
  buyer.relationshipSinceYear = p.profile.relationshipSinceYear;
  buyer.openOrders = p.profile.openOrders;
  buyer.transitDays = p.transitDays;
  if (p.contactName) buyer.contactName = p.contactName;
  if (p.contactEmail) buyer.contactEmail = p.contactEmail;
  list.splice(i, 1);
}

const FREE_MAIL = /^(gmail|yahoo|outlook|hotmail|live|icloud|aol|proton|protonmail|rediffmail|zoho)\./i;

function domainsIn(s: string | undefined): string[] {
  if (!s) return [];
  return [...s.matchAll(/@([a-z0-9.-]+\.[a-z]{2,})/gi)].map((m) => m[1].toLowerCase()).filter((d) => !FREE_MAIL.test(d));
}

export function candidateName(doc: DocRecord): string | null {
  return doc.fields['buyer_name']?.value ?? doc.fields['remitter_name']?.value ?? null;
}

function counterpartyDomains(doc: DocRecord, ws: Workspace): string[] {
  const mine = new Set(ws.company.emailDomains.map((d) => d.toLowerCase()));
  const all = [...domainsIn(doc.meta.emailFrom), ...domainsIn(doc.meta.emailTo)];
  return [...new Set(all.filter((d) => !mine.has(d)))];
}

function isExporterName(name: string, ws: Workspace): boolean {
  const a = companyKey(name);
  const b = companyKey(ws.company.name);
  return !!a && !!b && (a === b || a.includes(b) || b.includes(a));
}

export function newBuyer(name: string): Buyer {
  const now = new Date().toISOString();
  return {
    id: newId('b'),
    name,
    aliases: [],
    domains: [],
    country: 'United States',
    address: null,
    contactName: null,
    contactEmail: null,
    revenueSharePct: null,
    relationshipSinceYear: null,
    openOrders: null,
    stage: 'drafted',
    stageUpdatedAt: now,
    agreedOption: null,
    agreedUSD: null,
    recoveredUSD: null,
    portalToken: newToken(),
    portalEnabled: true,
    refundConfirmedDate: null,
    refundConfirmedUSD: null,
    refundConfirmedInterestUSD: null,
    transitDays: null,
    notes: '',
    responses: [],
    createdAt: now,
  };
}

/** Find or create the buyer for a document. Returns the buyer id or null. */
export function assignBuyer(ws: Workspace, doc: DocRecord): string | null {
  if (doc.buyerMethod === 'manual' && doc.buyerId && ws.buyers[doc.buyerId]) return doc.buyerId;
  const name = candidateName(doc);
  const doms = counterpartyDomains(doc, ws);
  const buyers = Object.values(ws.buyers);

  let best: { b: Buyer; s: number } | null = null;
  if (name && !isExporterName(name, ws)) {
    for (const b of buyers) {
      const s = Math.max(nameSimilarity(name, b.name), ...b.aliases.map((a) => nameSimilarity(name, a)));
      if (s >= 0.6 && (!best || s > best.s)) best = { b, s };
    }
  }
  if (!best && doms.length) {
    const b = buyers.find((x) => x.domains.some((d) => doms.includes(d)));
    if (b) best = { b, s: 1 };
  }
  if (!best && doms.length && name === null) {
    // e.g. an email whose company name was not found: match on the domain stem
    for (const b of buyers) {
      const stem = doms[0].split('.')[0];
      if (companyKey(b.name).replace(/\s/g, '').includes(stem) || stem.includes(companyKey(b.name).split(' ')[0] ?? '~')) {
        best = { b, s: 0.7 };
        break;
      }
    }
  }

  let buyer: Buyer;
  if (best) buyer = best.b;
  else if (name && !isExporterName(name, ws) && companyKey(name).length >= 3) {
    // A bare domain stem ("brightwaterhome") is a weak name; title-case it.
    const clean = /\s/.test(name) ? name : name.charAt(0).toUpperCase() + name.slice(1);
    buyer = newBuyer(clean);
    ws.buyers[buyer.id] = buyer;
  } else return null;

  if (name && !isExporterName(name, ws) && name !== buyer.name && !buyer.aliases.includes(name) && buyer.aliases.length < 8) {
    // Prefer a proper company name over a domain stem as the display name.
    if (!/\s/.test(buyer.name) && /\s/.test(name)) {
      buyer.aliases.push(buyer.name);
      buyer.name = name;
    } else buyer.aliases.push(name);
  }
  for (const d of doms) if (!buyer.domains.includes(d) && buyer.domains.length < 6) buyer.domains.push(d);
  if (doc.kind === 'price_revision' && !buyer.contactEmail && doc.meta.emailFrom && doms.length) {
    const addr = /<([^>]+)>/.exec(doc.meta.emailFrom)?.[1] ?? doc.meta.emailFrom;
    if (doms.some((d) => addr.toLowerCase().endsWith(d))) {
      buyer.contactEmail = addr;
      buyer.contactName = /^"?([^"<]+?)"?\s*</.exec(doc.meta.emailFrom)?.[1]?.trim() ?? buyer.contactName;
    }
  }
  if (doc.kind === 'invoice' && !buyer.address) {
    const bl = doc.fields['buyer_name']?.source?.line;
    if (bl && doc.lines[bl]) {
      const next = doc.lines.slice(bl, bl + 2).map((l) => l.text.split(/\s{3,}/)[0].trim()).filter(Boolean);
      if (next.length) buyer.address = next.join(', ').slice(0, 160);
    }
  }
  applyPending(buyer);
  return buyer.id;
}

/** Merge buyer `fromId` into `intoId` (documents, aliases, domains). */
export function mergeBuyers(ws: Workspace, fromId: string, intoId: string): void {
  const from = ws.buyers[fromId];
  const into = ws.buyers[intoId];
  if (!from || !into || fromId === intoId) return;
  for (const d of Object.values(ws.documents)) if (d.buyerId === fromId) d.buyerId = intoId;
  into.aliases = [...new Set([...into.aliases, from.name, ...from.aliases])].filter((a) => a !== into.name).slice(0, 12);
  into.domains = [...new Set([...into.domains, ...from.domains])];
  delete ws.buyers[fromId];
}

/** Remove buyers that no longer have any documents (and no negotiation history). */
export function pruneBuyers(ws: Workspace): void {
  const used = new Set(Object.values(ws.documents).map((d) => d.buyerId).filter(Boolean));
  for (const b of Object.values(ws.buyers)) {
    if (!used.has(b.id) && b.stage === 'drafted' && !b.responses.length && b.recoveredUSD === null) delete ws.buyers[b.id];
  }
}
