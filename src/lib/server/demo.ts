// Demo exporter loader, shared by the "Load demo" button and one-click guest accounts. Server only.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { HttpError } from './api';
import { mutate, newId, sha256, uploadPath, ensureDirs, emptyWorkspace, logEvent, uploadDir } from './store';
import { enqueue } from './pipeline';
import { setPendingProfiles, type PendingProfile } from './buyers';
import type { DocRecord } from '../types';

const DEMO_DIR = path.join(process.cwd(), 'demo');

interface Manifest {
  exporter: { name: string; address: string[]; iec: string; gstin: string; email: string; signatory: string; title: string };
  buyers: (PendingProfile & { slug: string; files: string[] })[];
}

export async function clearUploads(): Promise<void> {
  const files = await fs.readdir(uploadDir()).catch(() => [] as string[]);
  await Promise.all(files.map((f) => fs.unlink(path.join(uploadDir(), f)).catch(() => {})));
}

/** Reset the current account's workspace and load the demo exporter. Returns the number of documents queued. */
export async function loadDemoWorkspace(engine: 'rules' | 'auto'): Promise<number> {
  await ensureDirs();
  const manifest = JSON.parse(await fs.readFile(path.join(DEMO_DIR, 'manifest.json'), 'utf8').catch(() => {
    throw new HttpError(500, 'Demo files are missing. Run: npm run demo:generate');
  })) as Manifest;
  await clearUploads();
  setPendingProfiles(manifest.buyers.map((b) => ({ name: b.name, profile: b.profile, transitDays: b.transitDays, contactName: b.contactName, contactEmail: b.contactEmail })));

  const ids: string[] = [];
  await mutate(async (ws) => {
    const fresh = emptyWorkspace();
    fresh.settings = ws.settings; // keep engine and claim settings
    Object.assign(ws, fresh);
    ws.company = {
      name: manifest.exporter.name,
      iec: manifest.exporter.iec,
      gstin: manifest.exporter.gstin,
      address: manifest.exporter.address.join(', '),
      signatoryName: manifest.exporter.signatory,
      signatoryTitle: manifest.exporter.title,
      email: manifest.exporter.email,
      phone: '+91 4324 000 000',
      emailDomains: [manifest.exporter.email.split('@')[1]],
    };
    let t = Date.now();
    for (const b of manifest.buyers) {
      for (const rel of b.files) {
        const src = path.join(DEMO_DIR, rel);
        const buf = await fs.readFile(src);
        const id = newId('d');
        const ext = path.extname(rel).toLowerCase();
        const doc: DocRecord = {
          id,
          filename: path.basename(rel),
          mime: '',
          size: buf.length,
          sha256: sha256(buf),
          storedAs: `${id}${ext}`,
          uploadedAt: new Date(t++).toISOString(),
          origin: 'demo',
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
        await fs.writeFile(uploadPath(doc.storedAs), buf);
        ws.documents[id] = doc;
        ids.push(id);
      }
    }
    logEvent(ws, 'demo', `Demo workspace loaded (${ids.length} documents, ${engine === 'rules' ? 'rules engine' : 'Gemma when available'})`);
  });
  enqueue(ids, { forceEngine: engine === 'rules' ? 'rules' : undefined });
  return ids.length;
}

