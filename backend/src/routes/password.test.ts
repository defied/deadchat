// Changing your own password, and the first-sign-in password change.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';
import type { Server } from 'http';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'deadchat-pw-'));
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

const post = (path: string, body: unknown, auth?: string) =>
  fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: auth } : {}) }, body: JSON.stringify(body) });
const login = async (username: string, password: string) => {
  const r = await post('/api/auth/login', { username, password });
  return { status: r.status, body: (await r.json()) as { accessToken: string; refreshToken: string; user: { mustChangePassword: boolean } } };
};

test('an admin-created user must choose a new password before using anything else', async () => {
  const adminId = Number(db.prepare("INSERT INTO users (username, email, password_hash, role) VALUES ('root', 'r@t', ?, 'admin')").run(hashPassword('adminpass1')).lastInsertRowid);
  const admin = `Bearer ${signAccessToken({ id: adminId, username: 'root', role: 'admin' })}`;
  const made = await post('/api/users', { username: 'newbie', email: 'n@t', password: 'temp1234' }, admin);
  assert.equal(made.status, 201);

  const first = await login('newbie', 'temp1234');
  assert.equal(first.status, 200);
  assert.equal(first.body.user.mustChangePassword, true);
  const auth = `Bearer ${first.body.accessToken}`;
  const me = (await (await fetch(`${base}/api/auth/me`, { headers: { Authorization: auth } })).json()) as { user: { mustChangePassword: boolean } };
  assert.equal(me.user.mustChangePassword, true);
  const blocked = await fetch(`${base}/api/cases`, { headers: { Authorization: auth } });
  assert.equal(blocked.status, 403);
  assert.equal(((await blocked.json()) as { code: string }).code, 'password_change_required');
  const uid = Number((db.prepare("SELECT id FROM users WHERE username = 'newbie'").get() as { id: number }).id);
  const { token } = createToken(uid, 't');
  assert.equal((await fetch(`${base}/v1/models`, { headers: { Authorization: `Bearer ${token}` } })).status, 403, 'API tokens wait too');

  // Bad attempts.
  const bad = async (body: unknown, field: string, msg: RegExp) => {
    const r = await post('/api/auth/change-password', body, auth);
    assert.equal(r.status, 400);
    const j = (await r.json()) as { error: string; field: string };
    assert.equal(j.field, field);
    assert.match(j.error, msg);
  };
  await bad({ currentPassword: 'nope', newPassword: 'whatever123' }, 'currentPassword', /current password is wrong/);
  await bad({ currentPassword: 'temp1234', newPassword: 'short' }, 'newPassword', /at least 8/);
  await bad({ currentPassword: 'temp1234', newPassword: 'temp1234' }, 'newPassword', /different/);
  await bad({ currentPassword: 'temp1234', newPassword: 'NEWBIE' }, 'newPassword', /at least 8/);

  const ok = await post('/api/auth/change-password', { currentPassword: 'temp1234', newPassword: 'my own secret' }, auth);
  assert.equal(ok.status, 200);
  const j = (await ok.json()) as { accessToken: string; refreshToken: string; user: { mustChangePassword: boolean } };
  assert.equal(j.user.mustChangePassword, false);
  assert.equal((await fetch(`${base}/api/cases`, { headers: { Authorization: `Bearer ${j.accessToken}` } })).status, 200);
  assert.equal((await login('newbie', 'temp1234')).status, 401, 'the temporary password stops working');
  assert.equal((await login('newbie', 'my own secret')).body.user.mustChangePassword, false);
  assert.equal((await post('/api/auth/refresh', { refreshToken: first.body.refreshToken })).status, 401, 'older sessions are signed out');
  assert.equal((await post('/api/auth/refresh', { refreshToken: j.refreshToken })).status, 200, 'this session continues');

  // An admin reset asks for a new password again (unless the admin opts out) and ends their sessions.
  await post(`/api/users/${uid}/reset-password`, { password: 'reset5678' }, admin);
  assert.equal((await login('newbie', 'reset5678')).body.user.mustChangePassword, true);
  await post(`/api/users/${uid}/reset-password`, { password: 'reset9999', mustChangePassword: false }, admin);
  assert.equal((await login('newbie', 'reset9999')).body.user.mustChangePassword, false);
  // Opting out at creation.
  await post('/api/users', { username: 'trusted', email: 'tr@t', password: 'given1234', mustChangePassword: false }, admin);
  assert.equal((await login('trusted', 'given1234')).body.user.mustChangePassword, false);
});

test('anyone can change their own password; it can’t be the username', async () => {
  const id = Number(db.prepare("INSERT INTO users (username, email, password_hash, role) VALUES ('casey', 'c@t', ?, 'user')").run(hashPassword('casey-old-1')).lastInsertRowid);
  const auth = `Bearer ${signAccessToken({ id, username: 'casey', role: 'user' })}`;
  db.prepare("UPDATE users SET username = 'caseyjones' WHERE id = ?").run(id);
  const r2 = await post('/api/auth/change-password', { currentPassword: 'casey-old-1', newPassword: 'CaseyJones' }, auth);
  assert.match(((await r2.json()) as { error: string }).error, /can’t be your username/);
  const r3 = await post('/api/auth/change-password', { currentPassword: 'casey-old-1', newPassword: 'a long new one' }, auth);
  assert.equal(r3.status, 200);
});
