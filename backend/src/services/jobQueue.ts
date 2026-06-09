// SQLite-backed job queue with serialization for heavy GPU jobs.
// Uses BEGIN IMMEDIATE transactions to guarantee that only one heavy=1 job
// runs at a time across any number of producers.

import db from '../db/connection';
import type { Job, JobType, JobStatus } from '../types/models';

export interface EnqueueOptions {
  userId?: number;
  providerId?: number;
  priority?: number;
  heavy?: boolean;
  agentRunId?: number;
}

// On startup, any job stuck in 'running' means the server crashed mid-job.
// Reset them to 'queued' so they get retried.
export function resetStaleRunningJobs(): void {
  const result = db.prepare(
    `UPDATE jobs SET status = 'queued', started_at = NULL WHERE status = 'running'`
  ).run();
  if (result.changes > 0) {
    console.log(`[jobQueue] Reset ${result.changes} stale running job(s) to queued.`);
  }
}

export function enqueue(
  type: JobType,
  params: Record<string, unknown>,
  opts: EnqueueOptions = {}
): number {
  const result = db.prepare(`
    INSERT INTO jobs (user_id, type, params, priority, heavy, provider_id, agent_run_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    opts.userId ?? null,
    type,
    JSON.stringify(params),
    opts.priority ?? 0,
    opts.heavy !== false ? 1 : 0,
    opts.providerId ?? null,
    opts.agentRunId ?? null
  );
  return result.lastInsertRowid as number;
}

// Claim the next queued job, enforcing that no other heavy job is running.
// Returns null if nothing is available or a heavy job is already in flight.
export function claimNext(): Job | null {
  return db.transaction((): Job | null => {
    // Check if any heavy job is running
    const running = db.prepare(
      `SELECT id FROM jobs WHERE status = 'running' AND heavy = 1 LIMIT 1`
    ).get();
    if (running) return null;

    // Find the highest-priority queued job
    const next = db.prepare(
      `SELECT * FROM jobs WHERE status = 'queued' ORDER BY priority DESC, id ASC LIMIT 1`
    ).get() as Job | undefined;
    if (!next) return null;

    db.prepare(
      `UPDATE jobs SET status = 'running', started_at = datetime('now'), attempts = attempts + 1 WHERE id = ?`
    ).run(next.id);

    return { ...next, status: 'running' as JobStatus };
  }).immediate();
}

export function updateProgress(id: number, progress: number): void {
  db.prepare('UPDATE jobs SET progress = ? WHERE id = ?').run(
    Math.max(0, Math.min(1, progress)),
    id
  );
}

export function setExternalRef(id: number, ref: string): void {
  db.prepare('UPDATE jobs SET external_ref = ? WHERE id = ?').run(ref, id);
}

export function complete(id: number, result: Record<string, unknown>): void {
  db.prepare(`
    UPDATE jobs
    SET status = 'succeeded', result = ?, progress = 1, finished_at = datetime('now')
    WHERE id = ?
  `).run(JSON.stringify(result), id);
}

export function fail(id: number, error: string): void {
  db.prepare(`
    UPDATE jobs
    SET status = 'failed', error = ?, finished_at = datetime('now')
    WHERE id = ?
  `).run(error, id);
}

export function cancel(id: number): boolean {
  const result = db.prepare(`
    UPDATE jobs SET status = 'canceled', finished_at = datetime('now')
    WHERE id = ? AND status IN ('queued', 'running')
  `).run(id);
  return result.changes > 0;
}

export function getJob(id: number): Job | null {
  return db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as Job | null;
}

export function listJobs(userId: number, limit = 50): Job[] {
  return db.prepare(
    'SELECT * FROM jobs WHERE user_id = ? ORDER BY created_at DESC LIMIT ?'
  ).all(userId, limit) as Job[];
}

// Block until a job reaches a terminal state (succeeded/failed/canceled).
// Used by the agent loop to await media generation results inline.
export async function awaitJob(
  id: number,
  timeoutMs = 300_000,
  intervalMs = 1_000
): Promise<Job> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const job = getJob(id);
    if (!job) throw new Error(`Job ${id} not found`);
    if (job.status === 'succeeded' || job.status === 'failed' || job.status === 'canceled') {
      return job;
    }
    await sleep(intervalMs);
  }
  throw new Error(`Job ${id} timed out after ${timeoutMs / 1000}s`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
