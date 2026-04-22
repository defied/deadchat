import db from '../db/connection';
import type { UsageRecord, ModelPricing } from '../types/models';

export function logUsage(
  userId: number,
  sessionId: number | null,
  endpoint: string,
  model: string | null,
  tokensIn: number,
  tokensOut: number,
  durationMs: number
): void {
  db.prepare(
    `INSERT INTO usage (user_id, session_id, endpoint, model, tokens_in, tokens_out, duration_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(userId, sessionId, endpoint, model, tokensIn, tokensOut, durationMs);
}

export function getUserUsage(userId: number, days: number = 30): UsageRecord[] {
  return db.prepare(
    `SELECT * FROM usage
     WHERE user_id = ? AND created_at >= datetime('now', ?)
     ORDER BY created_at DESC`
  ).all(userId, `-${days} days`) as UsageRecord[];
}

export interface PerUserUsage {
  userId: number;
  username: string;
  tokensIn: number;
  tokensOut: number;
  tokens: number;
  requests: number;
  durationMs: number;
  estimatedCost: number;
}

export interface DailyUsage {
  date: string;
  tokensIn: number;
  tokensOut: number;
  tokens: number;
  requests: number;
  estimatedCost: number;
}

export interface PerModelUsage {
  model: string;
  tokensIn: number;
  tokensOut: number;
  tokens: number;
  requests: number;
  durationMs: number;
  estimatedCost: number;
}

export interface UsageSummary {
  days: number;
  totalTokens: number;
  totalTokensIn: number;
  totalTokensOut: number;
  totalRequests: number;
  totalDurationMs: number;
  estimatedCost: number;
  currency: string;
  dailyUsage: DailyUsage[];
  perUser: PerUserUsage[];
  perModel: PerModelUsage[];
}

export function listModelPricing(): ModelPricing[] {
  return db.prepare(
    `SELECT * FROM model_pricing ORDER BY model ASC`
  ).all() as ModelPricing[];
}

export function upsertModelPricing(
  model: string,
  inputPerMtok: number,
  outputPerMtok: number,
  notes: string | null
): ModelPricing {
  db.prepare(
    `INSERT INTO model_pricing (model, input_per_mtok, output_per_mtok, notes, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(model) DO UPDATE SET
       input_per_mtok = excluded.input_per_mtok,
       output_per_mtok = excluded.output_per_mtok,
       notes = excluded.notes,
       updated_at = datetime('now')`
  ).run(model, inputPerMtok, outputPerMtok, notes);
  return db.prepare('SELECT * FROM model_pricing WHERE model = ?').get(model) as ModelPricing;
}

export function deleteModelPricing(model: string): boolean {
  if (model === '*') return false;
  const result = db.prepare('DELETE FROM model_pricing WHERE model = ?').run(model);
  return result.changes > 0;
}

interface PricingMap {
  [model: string]: { input: number; output: number };
}

function loadPricingMap(): { map: PricingMap; fallback: { input: number; output: number }; currency: string } {
  const rows = listModelPricing();
  const map: PricingMap = {};
  let fallback = { input: 0, output: 0 };
  let currency = 'USD';
  for (const row of rows) {
    map[row.model] = { input: row.input_per_mtok, output: row.output_per_mtok };
    if (row.model === '*') {
      fallback = { input: row.input_per_mtok, output: row.output_per_mtok };
      currency = row.currency;
    }
  }
  return { map, fallback, currency };
}

function costFor(model: string | null, tokensIn: number, tokensOut: number, pricing: ReturnType<typeof loadPricingMap>): number {
  const rate = (model && pricing.map[model]) || pricing.fallback;
  return (tokensIn / 1_000_000) * rate.input + (tokensOut / 1_000_000) * rate.output;
}

export function getUsageSummary(days: number = 30): UsageSummary {
  const sinceArg = `-${days} days`;
  const pricing = loadPricingMap();

  const perUserRaw = db.prepare(
    `SELECT
       u.id as userId,
       u.username,
       COALESCE(SUM(us.tokens_in), 0) as tokensIn,
       COALESCE(SUM(us.tokens_out), 0) as tokensOut,
       COUNT(us.id) as requests,
       COALESCE(SUM(us.duration_ms), 0) as durationMs
     FROM users u
     LEFT JOIN usage us ON u.id = us.user_id AND us.created_at >= datetime('now', ?)
     GROUP BY u.id, u.username`
  ).all(sinceArg) as Array<{ userId: number; username: string; tokensIn: number; tokensOut: number; requests: number; durationMs: number }>;

  const perModelCostRows = db.prepare(
    `SELECT
       COALESCE(model, '') as model,
       user_id as userId,
       COALESCE(SUM(tokens_in), 0) as tokensIn,
       COALESCE(SUM(tokens_out), 0) as tokensOut
     FROM usage
     WHERE created_at >= datetime('now', ?)
     GROUP BY model, user_id`
  ).all(sinceArg) as Array<{ model: string; userId: number; tokensIn: number; tokensOut: number }>;

  const userCost = new Map<number, number>();
  for (const row of perModelCostRows) {
    const c = costFor(row.model || null, row.tokensIn, row.tokensOut, pricing);
    userCost.set(row.userId, (userCost.get(row.userId) || 0) + c);
  }

  const perUser: PerUserUsage[] = perUserRaw
    .map((r) => ({
      userId: r.userId,
      username: r.username,
      tokensIn: r.tokensIn,
      tokensOut: r.tokensOut,
      tokens: r.tokensIn + r.tokensOut,
      requests: r.requests,
      durationMs: r.durationMs,
      estimatedCost: userCost.get(r.userId) || 0,
    }))
    .sort((a, b) => b.tokens - a.tokens);

  const dailyRaw = db.prepare(
    `SELECT
       date(created_at) as date,
       COALESCE(model, '') as model,
       COALESCE(SUM(tokens_in), 0) as tokensIn,
       COALESCE(SUM(tokens_out), 0) as tokensOut,
       COUNT(id) as requests
     FROM usage
     WHERE created_at >= datetime('now', ?)
     GROUP BY date, model
     ORDER BY date ASC`
  ).all(sinceArg) as Array<{ date: string; model: string; tokensIn: number; tokensOut: number; requests: number }>;

  const dailyMap = new Map<string, DailyUsage>();
  for (const row of dailyRaw) {
    const key = row.date;
    const cost = costFor(row.model || null, row.tokensIn, row.tokensOut, pricing);
    const entry = dailyMap.get(key) || {
      date: key,
      tokensIn: 0,
      tokensOut: 0,
      tokens: 0,
      requests: 0,
      estimatedCost: 0,
    };
    entry.tokensIn += row.tokensIn;
    entry.tokensOut += row.tokensOut;
    entry.tokens += row.tokensIn + row.tokensOut;
    entry.requests += row.requests;
    entry.estimatedCost += cost;
    dailyMap.set(key, entry);
  }
  const dailyUsage = Array.from(dailyMap.values());

  const perModelRaw = db.prepare(
    `SELECT
       COALESCE(model, '') as model,
       COALESCE(SUM(tokens_in), 0) as tokensIn,
       COALESCE(SUM(tokens_out), 0) as tokensOut,
       COUNT(id) as requests,
       COALESCE(SUM(duration_ms), 0) as durationMs
     FROM usage
     WHERE created_at >= datetime('now', ?)
     GROUP BY model
     ORDER BY (SUM(tokens_in) + SUM(tokens_out)) DESC`
  ).all(sinceArg) as Array<{ model: string; tokensIn: number; tokensOut: number; requests: number; durationMs: number }>;

  const perModel: PerModelUsage[] = perModelRaw.map((r) => ({
    model: r.model || 'unknown',
    tokensIn: r.tokensIn,
    tokensOut: r.tokensOut,
    tokens: r.tokensIn + r.tokensOut,
    requests: r.requests,
    durationMs: r.durationMs,
    estimatedCost: costFor(r.model || null, r.tokensIn, r.tokensOut, pricing),
  }));

  const totalTokensIn = perUser.reduce((s, u) => s + u.tokensIn, 0);
  const totalTokensOut = perUser.reduce((s, u) => s + u.tokensOut, 0);
  const totalRequests = perUser.reduce((s, u) => s + u.requests, 0);
  const totalDurationMs = perUser.reduce((s, u) => s + u.durationMs, 0);
  const estimatedCost = perUser.reduce((s, u) => s + u.estimatedCost, 0);

  return {
    days,
    totalTokens: totalTokensIn + totalTokensOut,
    totalTokensIn,
    totalTokensOut,
    totalRequests,
    totalDurationMs,
    estimatedCost,
    currency: pricing.currency,
    dailyUsage,
    perUser,
    perModel,
  };
}
