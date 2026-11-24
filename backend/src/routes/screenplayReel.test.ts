// Rip reel uploads for the screenplay pitch.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';
import type { Server } from 'http';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'deadchat-pitch-'));
process.env.DB_PATH = path.join(tmp, 'test.db');
process.env.MEDIA_DIR = path.join(tmp, 'media');
fs.mkdirSync(process.env.MEDIA_DIR, { recursive: true });

/* eslint-disable @typescript-eslint/no-require-imports */
const { runMigrations } = require('../db/migrate') as typeof import('../db/migrate');
const db = (require('../db/connection') as typeof import('../db/connection')).default;
const { signAccessToken, hashPassword } = require('../services/auth') as typeof import('../services/auth');
const { createToken } = require('../services/apiTokens') as typeof import('../services/apiTokens');
/* eslint-enable @typescript-eslint/no-require-imports */

let server: Server;
let base = '';
before(async () => {
  runMigrations();
  const app = (require('../app') as typeof import('../app')).default; // eslint-disable-line @typescript-eslint/no-require-imports
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

test('rip reel files upload, list, rename and delete; other types are refused', async () => {
  void createToken;
  const uid = Number(db.prepare("INSERT INTO users (username, email, password_hash, role) VALUES ('dir', 'd@t', ?, 'user')").run(hashPassword('x')).lastInsertRowid);
  const auth = `Bearer ${signAccessToken({ id: uid, username: 'dir', role: 'user' })}`;
  const other = Number(db.prepare("INSERT INTO users (username, email, password_hash, role) VALUES ('nosy', 'n@t', ?, 'user')").run(hashPassword('x')).lastInsertRowid);
  const nosy = `Bearer ${signAccessToken({ id: other, username: 'nosy', role: 'user' })}`;
  const sp = (await (await fetch(`${base}/api/screenplays`, { method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Lighthouse' }) })).json()) as { screenplay: { id: number } };
  const id = sp.screenplay.id;
  const up = (bytes: Buffer, name: string, type: string, who = auth) => {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(bytes)], { type }), name);
    return fetch(`${base}/api/screenplays/${id}/reel`, { method: 'POST', headers: { Authorization: who }, body: form });
  };
  const clip = await up(Buffer.from('fake mp4 bytes'), 'storm.mp4', 'video/mp4');
  assert.equal(clip.status, 200);
  const j = (await clip.json()) as { added: number; media: { other: Array<{ id: number; role: string; target: string; label: string; media_id: number }> } };
  const row = j.media.other.find((m) => m.id === j.added)!;
  assert.deepEqual([row.role, row.target, row.label], ['reel', 'video', 'storm.mp4']);
  const m = db.prepare('SELECT type, mime, size_bytes, filename FROM media WHERE id = ?').get(row.media_id) as { type: string; mime: string; size_bytes: number; filename: string };
  assert.deepEqual([m.type, m.mime, m.size_bytes], ['video', 'video/mp4', 14]);
  assert.ok(fs.existsSync(path.join(process.env.MEDIA_DIR!, m.filename)), 'moved into the media folder');
  const song = (await (await up(Buffer.from('id3'), 'theme.mp3', 'audio/mpeg')).json()) as { added: number; media: { other: Array<{ id: number; target: string }> } };
  assert.equal(song.media.other.find((x) => x.id === song.added)!.target, 'audio');

  const bad = await up(Buffer.from('MZ'), 'setup.exe', 'application/octet-stream');
  assert.equal(bad.status, 400);
  assert.match(((await bad.json()) as { error: string }).error, /MP4, WebM or MOV/);
  assert.equal((await up(Buffer.from('x'), 'a.mp4', 'video/mp4', nosy)).status, 404, 'someone else’s screenplay');

  const patch = await fetch(`${base}/api/screenplays/${id}/media/${j.added}`, { method: 'PATCH', headers: { Authorization: auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ label: 'Storm, wide' }) });
  assert.equal(((await patch.json()) as { media: { other: Array<{ id: number; label: string }> } }).media.other.find((x) => x.id === j.added)!.label, 'Storm, wide');
  const del = await fetch(`${base}/api/screenplays/${id}/media/${j.added}`, { method: 'DELETE', headers: { Authorization: auth } });
  assert.equal(((await del.json()) as { media: { other: Array<{ id: number }> } }).media.other.some((x) => x.id === j.added), false);
});
