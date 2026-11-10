// Sharing medical cases with other members.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';
import type { Server } from 'http';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'deadchat-share-'));
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

const mk = (name: string, role = 'user', tabs: string | null = null) => {
  const id = Number(db.prepare('INSERT INTO users (username, email, password_hash, role, tabs) VALUES (?, ?, ?, ?, ?)').run(name, `${name}@t`, hashPassword('x'), role, tabs).lastInsertRowid);
  return { id, auth: `Bearer ${signAccessToken({ id, username: name, role: role as 'user' })}` };
};
const call = async (u: { auth: string }, method: string, path: string, body?: unknown) => {
  const r = await fetch(`${base}${path}`, { method, headers: { Authorization: u.auth, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
};

test('owners share cases as view-only or editable; access follows the role', async () => {
  void createToken;
  const ann = mk('ann');
  const bob = mk('bob');
  const cat = mk('cat');
  const dan = mk('dan', 'user', '["chat"]'); // no Medical cases section
  const c = (await call(ann, 'POST', '/api/cases', { title: 'Fontan' })).body.case;
  const path = `/api/cases/${c.id}`;

  // Not shared: invisible.
  assert.equal((await call(bob, 'GET', path)).status, 404);
  assert.equal((await call(bob, 'GET', '/api/cases')).body.cases.length, 0);

  // Who can be picked: members who can use Medical cases, not yourself.
  const members = (await call(ann, 'GET', '/api/cases/members?q=')).body.members.map((m: { username: string }) => m.username);
  assert.ok(members.includes('bob') && members.includes('cat'));
  assert.ok(!members.includes('ann') && !members.includes('dan'));
  assert.deepEqual((await call(ann, 'GET', '/api/cases/members?q=bo')).body.members.map((m: { username: string }) => m.username), ['bob']);

  // Share: bob views, cat edits.
  await call(ann, 'PUT', `${path}/shares/${bob.id}`, { role: 'viewer' });
  const d = (await call(ann, 'PUT', `${path}/shares/${cat.id}`, { role: 'editor' })).body;
  assert.deepEqual(d.shares.map((s: { username: string; role: string }) => [s.username, s.role]), [['bob', 'viewer'], ['cat', 'editor']]);
  assert.equal(d.access, 'owner');

  // Viewer: sees it in the list and in full, can't change anything.
  const list = (await call(bob, 'GET', '/api/cases')).body.cases;
  assert.deepEqual([list[0].title, list[0].sharedBy, list[0].role], ['Fontan', 'ann', 'viewer']);
  const seen = (await call(bob, 'GET', path)).body;
  assert.equal(seen.access, 'viewer');
  assert.equal(seen.owner, 'ann');
  assert.equal((await call(bob, 'PUT', path, { title: 'Mine now' })).status, 403);
  assert.match((await call(bob, 'PUT', path, { title: 'x' })).body.error, /view only/);
  assert.equal((await call(bob, 'POST', `${path}/reorder`, { ids: [] })).status, 403);
  assert.equal((await call(bob, 'PUT', `${path}/shares/${dan.id}`, { role: 'viewer' })).status, 403, 'can’t reshare');

  // Editor: can change the case, can't delete it or change sharing.
  assert.equal((await call(cat, 'PUT', path, { title: 'Fontan, 6y' })).status, 200);
  assert.equal((await call(cat, 'DELETE', path)).status, 403);
  assert.equal((await call(cat, 'DELETE', `${path}/shares/${bob.id}`)).status, 403);
  assert.equal((await call(ann, 'GET', path)).body.case.title, 'Fontan, 6y');

  // Change a role; a member can leave; the owner can remove.
  await call(ann, 'PUT', `${path}/shares/${bob.id}`, { role: 'editor' });
  assert.equal((await call(bob, 'PUT', path, { title: 'Fontan, 6 years' })).status, 200);
  assert.deepEqual((await call(bob, 'DELETE', `${path}/shares/${bob.id}`)).body, { left: true });
  assert.equal((await call(bob, 'GET', path)).status, 404);
  await call(ann, 'DELETE', `${path}/shares/${cat.id}`);
  assert.equal((await call(cat, 'GET', path)).status, 404);

  // Sharing with yourself or nobody is refused; a member without the section is flagged.
  assert.match((await call(ann, 'PUT', `${path}/shares/${ann.id}`, { role: 'viewer' })).body.error, /already has full access/);
  assert.match((await call(ann, 'PUT', `${path}/shares/99999`, { role: 'viewer' })).body.error, /No such member/);
  const withDan = (await call(ann, 'PUT', `${path}/shares/${dan.id}`, { role: 'viewer' })).body.shares;
  assert.equal(withDan.find((s: { username: string }) => s.username === 'dan').canOpen, false);
  assert.equal((await call(dan, 'GET', path)).status, 403, 'still needs the Medical cases section');

  // Deleting the case removes its shares.
  await call(ann, 'DELETE', path);
  assert.equal((db.prepare('SELECT COUNT(*) n FROM case_shares WHERE case_id = ?').get(c.id) as { n: number }).n, 0);
});
