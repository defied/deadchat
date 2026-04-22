import crypto from 'crypto';
import db from '../db/connection';

const TOKEN_PREFIX = 'dc_live_';
const RAW_BYTES = 32;

export interface ApiTokenRow {
  id: number;
  user_id: number;
  name: string;
  prefix: string;
  token_hash: string;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function generateToken(): { token: string; prefix: string; hash: string } {
  const raw = crypto.randomBytes(RAW_BYTES).toString('hex');
  const token = `${TOKEN_PREFIX}${raw}`;
  return {
    token,
    prefix: token.slice(0, TOKEN_PREFIX.length + 4),
    hash: hashToken(token),
  };
}

export function createToken(userId: number, name: string): { token: string; row: ApiTokenRow } {
  const { token, prefix, hash } = generateToken();
  const result = db.prepare(
    'INSERT INTO api_tokens (user_id, name, prefix, token_hash) VALUES (?, ?, ?, ?)'
  ).run(userId, name, prefix, hash);
  const row = db.prepare('SELECT * FROM api_tokens WHERE id = ?').get(result.lastInsertRowid) as ApiTokenRow;
  return { token, row };
}

export function listTokens(userId: number): ApiTokenRow[] {
  return db.prepare(
    'SELECT * FROM api_tokens WHERE user_id = ? AND revoked_at IS NULL ORDER BY created_at DESC'
  ).all(userId) as ApiTokenRow[];
}

export function revokeToken(userId: number, id: number): boolean {
  const result = db.prepare(
    "UPDATE api_tokens SET revoked_at = datetime('now') WHERE id = ? AND user_id = ? AND revoked_at IS NULL"
  ).run(id, userId);
  return result.changes > 0;
}

export function verifyToken(token: string): ApiTokenRow | null {
  if (!token.startsWith(TOKEN_PREFIX)) return null;
  const hash = hashToken(token);
  const row = db.prepare(
    'SELECT * FROM api_tokens WHERE token_hash = ? AND revoked_at IS NULL'
  ).get(hash) as ApiTokenRow | undefined;
  if (!row) return null;
  db.prepare("UPDATE api_tokens SET last_used_at = datetime('now') WHERE id = ?").run(row.id);
  return row;
}
