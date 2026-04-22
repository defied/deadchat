import db from '../db/connection';
import type { UsageRecord } from '../types/models';

export function logUsage(
  userId: number,
  sessionId: number | null,
  endpoint: string,
  tokensIn: number,
  tokensOut: number,
  durationMs: number
): void {
  db.prepare(
    `INSERT INTO usage (user_id, session_id, endpoint, tokens_in, tokens_out, duration_ms)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(userId, sessionId, endpoint, tokensIn, tokensOut, durationMs);
}

export function getUserUsage(userId: number, days: number = 30): UsageRecord[] {
  return db.prepare(
    `SELECT * FROM usage
     WHERE user_id = ? AND created_at >= datetime('now', ?)
     ORDER BY created_at DESC`
  ).all(userId, `-${days} days`) as UsageRecord[];
}

export function getAllUsage(days: number = 30): {
  userId: number;
  username: string;
  totalRequests: number;
  totalTokensIn: number;
  totalTokensOut: number;
  totalDurationMs: number;
}[] {
  return db.prepare(
    `SELECT
       u.id as userId,
       u.username,
       COUNT(us.id) as totalRequests,
       COALESCE(SUM(us.tokens_in), 0) as totalTokensIn,
       COALESCE(SUM(us.tokens_out), 0) as totalTokensOut,
       COALESCE(SUM(us.duration_ms), 0) as totalDurationMs
     FROM users u
     LEFT JOIN usage us ON u.id = us.user_id AND us.created_at >= datetime('now', ?)
     GROUP BY u.id
     ORDER BY totalTokensOut DESC`
  ).all(`-${days} days`) as any[];
}
