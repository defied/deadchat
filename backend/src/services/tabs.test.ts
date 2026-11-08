// Tab permissions: assignments, the API gates, the public API and admin edits.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';
import type { Server } from 'http';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'deadchat-tabs-'));
process.env.DB_PATH = path.join(tmp, 'test.db');
process.env.MEDIA_DIR = path.join(tmp, 'media');
fs.mkdirSync(process.env.MEDIA_DIR, { recursive: true });

/* eslint-disable @typescript-eslint/no-require-imports */
const { runMigrations } = require('../db/migrate') as typeof import('../db/migrate');
const db = (require('../db/connection') as typeof import('../db/connection')).default;
const tabs = require('./tabs') as typeof import('./tabs');
const { signAccessToken } = require('./auth') as typeof import('./auth');
const { createToken } = require('./apiTokens') as typeof import('./apiTokens');
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

function makeUser(name: string, role: 'user' | 'admin', t: string | null): { id: number; auth: string } {
  const id = Number(db.prepare("INSERT INTO users (username, email, password_hash, role, tabs) VALUES (?, ?, 'x', ?, ?)").run(name, `${name}@t`, role, t).lastInsertRowid);
  return { id, auth: `Bearer ${signAccessToken({ id, username: name, role })}` };
}

test('assignments: null is every tab, admins always have every tab, junk is rejected', () => {
  assert.deepEqual(tabs.parseTabs(null), null);
  assert.deepEqual(tabs.parseTabs('["cases","chat","nope"]'), ['chat', 'cases']);
  assert.equal(tabs.cleanTabs('all'), null);
  assert.equal(tabs.cleanTabs(['cases', 'chat']), '["chat","cases"]');
  assert.equal(tabs.cleanTabs([]), '[]');
  assert.throws(() => tabs.cleanTabs(['admin']), /tabs must be/);
  const legacy = makeUser('legacy', 'user', null);
  const admin = makeUser('boss', 'admin', '[]');
  const doc = makeUser('doc', 'user', '["cases"]');
  assert.deepEqual(tabs.userTabs(legacy.id), tabs.ALL_TABS);
  assert.deepEqual(tabs.userTabs(admin.id), tabs.ALL_TABS);
  assert.deepEqual(tabs.userTabs(doc.id), ['cases']);
});

test('gates: only assigned sections answer; shared plumbing stays open; changes apply at once', async () => {
  const u = makeUser('casesonly', 'user', '["cases"]');
  const get = (p: string) => fetch(`${base}${p}`, { headers: { Authorization: u.auth } });
  assert.equal((await get('/api/cases')).status, 200);
  for (const p of ['/api/screenplays', '/api/influencers', '/api/chat/sessions', '/api/tokens', '/api/characters', '/api/generate/models']) {
    const r = await get(p);
    assert.equal(r.status, 403, p);
    assert.equal(((await r.json()) as { code: string }).code, 'tab_forbidden');
  }
  const me = (await (await get('/api/auth/me')).json()) as { user: { tabs: string[] } };
  assert.deepEqual(me.user.tabs, ['cases']);
  assert.equal((await fetch(`${base}/api/cases`)).status, 401, 'still needs sign-in');

  // Screenplay needs the model catalog from /api/generate.
  db.prepare('UPDATE users SET tabs = ? WHERE id = ?').run('["screenplays"]', u.id);
  assert.notEqual((await get('/api/generate/models')).status, 403);
  assert.equal((await get('/api/cases')).status, 403);
});

test('API tokens need the API tab', async () => {
  const u = makeUser('notoken', 'user', '["chat"]');
  const { token } = createToken(u.id, 't');
  const r = await fetch(`${base}/v1/models`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(r.status, 403);
  db.prepare('UPDATE users SET tabs = ? WHERE id = ?').run('["api"]', u.id);
  const ok = await fetch(`${base}/v1/models`, { headers: { Authorization: `Bearer ${token}` } });
  assert.notEqual(ok.status, 403);
});

test('admins assign tabs when creating and editing users', async () => {
  const admin = makeUser('admin2', 'admin', null);
  const h = { Authorization: admin.auth, 'Content-Type': 'application/json' };
  const made = (await (await fetch(`${base}/api/users`, { method: 'POST', headers: h, body: JSON.stringify({ username: 'nurse', email: 'n@t', password: 'pw123456', tabs: ['cases'] }) })).json()) as { user: { id: number; tabs: string[] } };
  assert.deepEqual(made.user.tabs, ['cases']);
  const put = (body: unknown) => fetch(`${base}/api/users/${made.user.id}`, { method: 'PUT', headers: h, body: JSON.stringify(body) });
  assert.deepEqual(((await (await put({ tabs: ['chat', 'cases'] })).json()) as { user: { tabs: string[] } }).user.tabs, ['chat', 'cases']);
  assert.equal(((await (await put({ tabs: 'all' })).json()) as { user: { tabs: null } }).user.tabs, null);
  assert.equal((await put({ tabs: ['root'] })).status, 400);
  const list = (await (await fetch(`${base}/api/users`, { headers: h })).json()) as { tabs: Array<{ id: string }> };
  assert.equal(list.tabs.length, tabs.ALL_TABS.length);
});
