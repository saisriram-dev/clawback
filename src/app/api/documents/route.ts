import { promises as fs } from 'node:fs';
import path from 'node:path';
import { route, json, HttpError } from '@/lib/server/api';
import { mutate, newId, sha256, uploadPath, ensureDirs, logEvent } from '@/lib/server/store';
import { enqueue } from '@/lib/server/pipeline';
import { MAX_BYTES } from '@/lib/extraction/ingest';
import type { DocRecord } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const SAFE = /[^a-zA-Z0-9._-]+/g;

function blankDoc(id: string, filename: string, mime: string, buf: Buffer, origin: DocRecord['origin']): DocRecord {
  const ext = (path.extname(filename) || '.bin').toLowerCase().replace(SAFE, '').slice(0, 8);
  return {
    id,
    filename: filename.slice(0, 180),
    mime: mime || 'application/octet-stream',
    size: buf.length,
    sha256: sha256(buf),
    storedAs: `${id}${ext}`,
    uploadedAt: new Date().toISOString(),
    origin,
    status: 'queued',
    kind: 'other',
    kindConfidence: 'low',
    kindMethod: 'rules',
    lines: [],
    meta: {},
    fields: {},
    itemCount: 0,
    engine: { used: 'none', warnings: [] },
    buyerId: null,
  };
}

/** Upload files (multipart field "files") or paste text (JSON { text, title }). */
export const POST = route(async (req) => {
  await ensureDirs();
  const ct = req.headers.get('content-type') ?? '';
  const incoming: { name: string; mime: string; buf: Buffer; origin: DocRecord['origin'] }[] = [];

  if (ct.includes('multipart/form-data')) {
    const form = await req.formData();
    for (const v of form.getAll('files')) {
      if (typeof v === 'string') continue;
      const file = v as File;
      if (file.size > MAX_BYTES) throw new HttpError(413, `${file.name} is larger than 25 MB.`);
      if (file.size === 0) throw new HttpError(400, `${file.name} is empty.`);
      incoming.push({ name: file.name || 'upload', mime: file.type, buf: Buffer.from(await file.arrayBuffer()), origin: 'upload' });
    }
  } else {
    const b = (await req.json().catch(() => null)) as { text?: string; title?: string } | null;
    const text = (b?.text ?? '').trim();
    if (!text) throw new HttpError(400, 'Nothing to add: paste some text first.');
    if (text.length > 200_000) throw new HttpError(413, 'Pasted text is too long (max 200,000 characters).');
    const title = (b?.title ?? '').trim() || `Pasted text ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
    incoming.push({ name: `${title.replace(/[\\/:*?"<>|]+/g, ' ').slice(0, 80)}.txt`, mime: 'text/plain', buf: Buffer.from(text, 'utf8'), origin: 'paste' });
  }
  if (!incoming.length) throw new HttpError(400, 'No files received.');
  if (incoming.length > 200) throw new HttpError(413, 'Upload at most 200 files at a time.');

  const created: { id: string; filename: string; duplicateOf?: string }[] = [];
  await mutate(async (ws) => {
    for (const f of incoming) {
      const id = newId('d');
      const doc = blankDoc(id, f.name, f.mime, f.buf, f.origin);
      const dup = Object.values(ws.documents).find((d) => d.sha256 === doc.sha256);
      if (dup) {
        created.push({ id: dup.id, filename: f.name, duplicateOf: dup.id });
        continue;
      }
      await fs.writeFile(uploadPath(doc.storedAs), f.buf);
      ws.documents[id] = doc;
      logEvent(ws, 'uploaded', `${doc.filename} added`, { docId: id });
      created.push({ id, filename: f.name });
    }
  });
  enqueue(created.filter((c) => !c.duplicateOf).map((c) => c.id));
  return json({ created }, 201);
});
