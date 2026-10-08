import { promises as fs } from 'node:fs';
import { route, HttpError } from '@/lib/server/api';
import { readWorkspace, uploadPath } from '@/lib/server/store';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

const TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  txt: 'text/plain; charset=utf-8',
  csv: 'text/plain; charset=utf-8',
  eml: 'text/plain; charset=utf-8',
  html: 'text/plain; charset=utf-8',
  htm: 'text/plain; charset=utf-8',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

export const GET = route<Ctx>(async (_req, { params }) => {
  const { id } = await params;
  const ws = await readWorkspace();
  const d = ws.documents[id];
  if (!d) throw new HttpError(404, 'Document not found.');
  const buf = await fs.readFile(uploadPath(d.storedAs)).catch(() => null);
  if (!buf) throw new HttpError(404, 'The stored file is missing.');
  const ext = d.storedAs.split('.').pop()?.toLowerCase() ?? '';
  const type = TYPES[ext] ?? 'application/octet-stream';
  const inline = type.startsWith('application/pdf') || type.startsWith('image/') || type.startsWith('text/');
  return new Response(new Uint8Array(buf), {
    headers: {
      'Content-Type': type,
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${encodeURIComponent(d.filename)}"`,
      'Cache-Control': 'private, max-age=60',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:",
    },
  });
});
