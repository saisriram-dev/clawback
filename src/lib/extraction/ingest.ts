// Ingest: turn any supported file into numbered text lines. Server only.
// Every value the engine extracts points back to one of these lines.

import zlib from 'node:zlib';
import type { DocLine } from '../types';

export const MAX_LINES = 3000;
export const MAX_BYTES = 25 * 1024 * 1024;

export type Format = 'pdf' | 'eml' | 'docx' | 'xlsx' | 'csv' | 'html' | 'text' | 'image';

export interface Ingested {
  format: Format;
  lines: DocLine[];
  pages?: number;
  needsOcr: boolean;
  images?: { mime: string; base64: string; page: number }[];
  meta: { emailFrom?: string; emailTo?: string; emailDate?: string; emailSubject?: string; truncated?: boolean };
}

export class IngestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IngestError';
  }
}

export function detectFormat(buf: Buffer, filename: string): Format {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  if (buf.length >= 4 && buf.subarray(0, 4).toString('latin1') === '%PDF') return 'pdf';
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image';
  if (buf.length >= 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image';
  if (buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) {
    const head = buf.subarray(0, Math.min(buf.length, 64 * 1024)).toString('latin1');
    if (head.includes('word/') || ext === 'docx') return 'docx';
    if (head.includes('xl/') || ext === 'xlsx') return 'xlsx';
    if (ext === 'docx') return 'docx';
    if (ext === 'xlsx') return 'xlsx';
    throw new IngestError('This ZIP-based file is not a .docx or .xlsx document.');
  }
  if (ext === 'doc' || ext === 'xls') throw new IngestError(`Legacy .${ext} files are not supported. Save it as .${ext}x or PDF and upload again.`);
  if (ext === 'eml' || ext === 'msg') {
    if (ext === 'msg') throw new IngestError('Outlook .msg files are not supported. In Outlook use File → Save As → .eml (or print to PDF), or paste the email text.');
    return 'eml';
  }
  if (ext === 'csv' || ext === 'tsv') return 'csv';
  if (ext === 'html' || ext === 'htm') return 'html';
  const text = buf.subarray(0, 4096).toString('utf8');
  if (/\u0000/.test(text)) throw new IngestError('Unrecognised binary file. Upload PDF, email (.eml), Word (.docx), Excel (.xlsx), CSV, text or an image.');
  if (/^(Received|Return-Path|From|MIME-Version|Delivered-To|Message-ID):/im.test(text.slice(0, 2000)) && /^Subject:/im.test(text)) return 'eml';
  return 'text';
}

function mimeOfImage(buf: Buffer): string {
  if (buf[0] === 0x89) return 'image/png';
  if (buf[0] === 0xff) return 'image/jpeg';
  return 'image/webp';
}

export function textToLines(text: string, page = 1): DocLine[] {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, '    ')
    .replace(/ /g, ' ')
    .split('\n')
    .map((t) => ({ page, text: t.replace(/\s+$/g, '') }));
}

/** Drop runs of more than one blank line, keep everything else verbatim. */
function tidy(lines: DocLine[]): DocLine[] {
  const out: DocLine[] = [];
  for (const l of lines) {
    if (!l.text.trim() && (!out.length || !out[out.length - 1].text.trim())) continue;
    out.push(l);
  }
  while (out.length && !out[out.length - 1].text.trim()) out.pop();
  return out;
}

export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6]|table|blockquote)>/gi, '\n')
    .replace(/<\/(td|th)>/gi, '    ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

async function pdfLines(buf: Buffer): Promise<{ lines: DocLine[]; pages: number }> {
  const { getDocumentProxy, extractTextItems } = await import('unpdf');
  let pdf;
  try {
    pdf = await getDocumentProxy(new Uint8Array(buf));
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    if (/password/i.test(msg)) throw new IngestError('This PDF is password-protected. Remove the password (print to PDF) and upload again.');
    throw new IngestError(`Could not read this PDF (${msg.slice(0, 120)}).`);
  }
  const { totalPages, items } = await extractTextItems(pdf);
  const lines: DocLine[] = [];
  items.forEach((pageItems, p) => {
    const rows: { y: number; size: number; parts: { x: number; w: number; s: string }[] }[] = [];
    for (const it of pageItems) {
      if (!it.str || !it.str.trim()) continue;
      const size = it.fontSize || it.height || 10;
      let row = rows.find((r) => Math.abs(r.y - it.y) <= Math.max(2, Math.min(r.size, size) * 0.45));
      if (!row) {
        row = { y: it.y, size, parts: [] };
        rows.push(row);
      }
      row.parts.push({ x: it.x, w: it.width, s: it.str });
    }
    rows.sort((a, b) => b.y - a.y);
    // Layout mode: place each text run near its horizontal position so columns line up
    // in the proof viewer and labelled values sit under their labels.
    const CHAR_W = 4.6;
    for (const r of rows) {
      r.parts.sort((a, b) => a.x - b.x);
      let text = '';
      let end = -Infinity;
      for (const part of r.parts) {
        const col = Math.max(0, Math.round(part.x / CHAR_W) - 8);
        if (text) {
          const gap = part.x - end;
          if (gap > r.size * 1.2) {
            const pad = Math.max(3, col - text.length);
            text += ' '.repeat(pad);
          } else if (gap > r.size * 0.15 && !text.endsWith(' ') && !part.s.startsWith(' ')) text += ' ';
        } else if (col > 0) {
          text = ' '.repeat(col);
        }
        text += part.s;
        end = part.x + (part.w || part.s.length * r.size * 0.5);
      }
      lines.push({ page: p + 1, text: text.replace(/\s+$/g, '') });
    }
    if (p < items.length - 1) lines.push({ page: p + 1, text: '' });
  });
  try {
    await (pdf as unknown as { destroy?: () => Promise<void> }).destroy?.();
  } catch {
    /* ignore */
  }
  return { lines, pages: totalPages };
}

// ---------------------------------------------------------------------------------------
// Scanned PDFs: pull the page images out (no native canvas needed) and encode them as PNG
// so Gemma can transcribe them.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

export function encodePng(data: Uint8Array | Uint8ClampedArray, width: number, height: number, channels: number): Buffer {
  // Downsample very large scans (Gemma does not need more than ~1600 px).
  let w = width;
  let h = height;
  let px = data;
  const step = Math.max(1, Math.ceil(width / 1600));
  if (step > 1) {
    w = Math.floor(width / step);
    h = Math.floor(height / step);
    const out = new Uint8Array(w * h * channels);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        for (let c = 0; c < channels; c++) out[(y * w + x) * channels + c] = data[(y * step * width + x * step) * channels + c];
    px = out;
  }
  const colorType = channels === 1 ? 0 : channels === 3 ? 2 : 6;
  const raw = Buffer.alloc((w * channels + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * channels + 1)] = 0;
    Buffer.from(px.buffer, px.byteOffset + y * w * channels, w * channels).copy(raw, y * (w * channels + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = colorType;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

async function pdfPageImages(buf: Buffer, maxPages = 5): Promise<{ mime: string; base64: string; page: number }[]> {
  const { getDocumentProxy, extractImages } = await import('unpdf');
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const out: { mime: string; base64: string; page: number }[] = [];
  for (let p = 1; p <= Math.min(pdf.numPages, maxPages); p++) {
    try {
      const imgs = await extractImages(pdf, p);
      if (!imgs.length) continue;
      const big = imgs.sort((a, b) => b.width * b.height - a.width * a.height)[0];
      if (big.width * big.height < 300 * 300) continue;
      out.push({ mime: 'image/png', base64: encodePng(big.data, big.width, big.height, big.channels).toString('base64'), page: p });
    } catch {
      /* skip unreadable page images */
    }
  }
  return out;
}

async function emlLines(buf: Buffer): Promise<{ lines: DocLine[]; meta: Ingested['meta'] }> {
  const PostalMime = (await import('postal-mime')).default;
  const email = await PostalMime.parse(buf);
  const fmtAddr = (a?: { name?: string; address?: string } | null) => (a ? (a.name ? `${a.name} <${a.address ?? ''}>` : a.address ?? '') : '');
  const from = fmtAddr(email.from as { name?: string; address?: string } | undefined);
  const to = (email.to ?? []).map((a) => fmtAddr(a as { name?: string; address?: string })).join(', ');
  const body = email.text && email.text.trim() ? email.text : email.html ? htmlToText(email.html) : '';
  // Keep the Date header as written (postal-mime normalises it to ISO/UTC).
  const rawDate = (email.headers ?? []).find((h: { key: string; value: string }) => h.key === 'date')?.value ?? email.date ?? '';
  const header = [`From: ${from}`, `To: ${to}`, `Date: ${rawDate}`, `Subject: ${email.subject ?? ''}`, ''];
  const lines = [...header.map((t) => ({ page: 1, text: t })), ...textToLines(body)];
  return {
    lines,
    meta: { emailFrom: from, emailTo: to, emailDate: rawDate || undefined, emailSubject: email.subject ?? undefined },
  };
}

async function docxLines(buf: Buffer): Promise<DocLine[]> {
  const mammoth = await import('mammoth');
  const res = await (mammoth.default ?? mammoth).extractRawText({ buffer: buf });
  return textToLines(res.value);
}

async function xlsxLines(buf: Buffer): Promise<DocLine[]> {
  const mod = await import('read-excel-file/node');
  const readXlsxFile = mod.default;
  const sheets = await readXlsxFile(buf);
  const lines: DocLine[] = [];
  sheets.forEach((sheet, i) => {
    lines.push({ page: i + 1, text: `[Sheet: ${sheet.sheet}]` });
    for (const row of sheet.data) {
      const cells = row.map((c) => (c === null || c === undefined ? '' : c instanceof Date ? c.toISOString().slice(0, 10) : String(c)));
      while (cells.length && !cells[cells.length - 1]) cells.pop();
      lines.push({ page: i + 1, text: cells.join(' | ') });
    }
  });
  return lines;
}

export async function ingest(buf: Buffer, filename: string): Promise<Ingested> {
  if (buf.length === 0) throw new IngestError('The file is empty.');
  if (buf.length > MAX_BYTES) throw new IngestError(`The file is larger than ${MAX_BYTES / 1024 / 1024} MB.`);
  const format = detectFormat(buf, filename);
  let lines: DocLine[] = [];
  let pages: number | undefined;
  let meta: Ingested['meta'] = {};
  let needsOcr = false;
  let images: Ingested['images'];

  switch (format) {
    case 'pdf': {
      const r = await pdfLines(buf);
      lines = r.lines;
      pages = r.pages;
      const chars = lines.reduce((a, l) => a + l.text.replace(/\s/g, '').length, 0);
      if (chars < 25) {
        needsOcr = true;
        images = await pdfPageImages(buf);
      }
      break;
    }
    case 'eml': {
      const r = await emlLines(buf);
      lines = r.lines;
      meta = r.meta;
      break;
    }
    case 'docx':
      lines = await docxLines(buf);
      break;
    case 'xlsx':
      lines = await xlsxLines(buf);
      break;
    case 'html':
      lines = textToLines(htmlToText(buf.toString('utf8')));
      break;
    case 'csv':
    case 'text':
      lines = textToLines(buf.toString('utf8').replace(/^﻿/, ''));
      break;
    case 'image':
      needsOcr = true;
      images = [{ mime: mimeOfImage(buf), base64: buf.toString('base64'), page: 1 }];
      break;
  }

  lines = tidy(lines);
  if (lines.length > MAX_LINES) {
    lines = lines.slice(0, MAX_LINES);
    meta.truncated = true;
  }
  return { format, lines, pages, needsOcr, images, meta };
}
