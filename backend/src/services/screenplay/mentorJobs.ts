// Shot mentor turns as background tasks: one at a time, queued behind renders
// when the model isn't loaded. Results wait until the writer's page applies
// them to the shot.

import db from '../../db/connection';
import * as store from './store';
import { withWaitListener } from './llm';
import { mentorTurn } from './mentor';
import type { MentorState } from './types';

export interface MentorJob {
  id: number;
  screenplay_id: number;
  shot_id: string;
  message: string | null;
  status: 'queued' | 'running' | 'done' | 'failed';
  progress: string;
  result: MentorState | null;
  error: string | null;
  applied: number;
}

type Row = Omit<MentorJob, 'result'> & { result: string | null; finished_at: string | null };
const toJob = (r: Row): MentorJob => ({ ...r, result: r.result ? (JSON.parse(r.result) as MentorState) : null });

export function getMentorJob(id: number): MentorJob | null {
  const r = db.prepare('SELECT * FROM screenplay_mentor_jobs WHERE id = ?').get(id) as Row | undefined;
  return r ? toJob(r) : null;
}

/** Turns not yet applied to the screenplay (running, or finished and waiting). */
export function openMentorJobs(screenplayId: number): MentorJob[] {
  return (db.prepare('SELECT * FROM screenplay_mentor_jobs WHERE screenplay_id = ? AND applied = 0 ORDER BY id').all(screenplayId) as Row[]).map(toJob);
}

export function markApplied(id: number): void {
  db.prepare('UPDATE screenplay_mentor_jobs SET applied = 1 WHERE id = ?').run(id);
}

export function createMentorJob(screenplayId: number, shotId: string, message?: string): MentorJob {
  const busy = db
    .prepare("SELECT id FROM screenplay_mentor_jobs WHERE screenplay_id = ? AND shot_id = ? AND status IN ('queued', 'running') LIMIT 1")
    .get(screenplayId, shotId) as { id: number } | undefined;
  if (busy) return getMentorJob(busy.id)!;
  const r = db.prepare('INSERT INTO screenplay_mentor_jobs (screenplay_id, shot_id, message) VALUES (?, ?, ?)').run(screenplayId, shotId, message?.trim() || null);
  kick();
  return getMentorJob(Number(r.lastInsertRowid))!;
}

function save(id: number, patch: Partial<Pick<Row, 'status' | 'progress' | 'result' | 'error' | 'finished_at'>>): void {
  const keys = Object.keys(patch) as Array<keyof typeof patch>;
  db.prepare(`UPDATE screenplay_mentor_jobs SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => patch[k] as unknown), id);
}

let running = false;
export function kick(): void {
  if (running) return;
  running = true;
  void (async () => {
    try {
      for (;;) {
        const row = db.prepare("SELECT id FROM screenplay_mentor_jobs WHERE status = 'queued' ORDER BY id LIMIT 1").get() as { id: number } | undefined;
        if (!row) break;
        await run(row.id).catch((e) => save(row.id, { status: 'failed', error: (e as Error).message, finished_at: new Date().toISOString() }));
      }
    } finally {
      running = false;
    }
  })();
}

export function resumeMentorJobs(): void {
  db.prepare("UPDATE screenplay_mentor_jobs SET status = 'queued' WHERE status = 'running'").run();
  kick();
}

async function run(id: number): Promise<void> {
  const job = getMentorJob(id)!;
  const sp = store.getScreenplay(job.screenplay_id);
  if (!sp) throw new Error('The screenplay was deleted');
  const shot = sp.doc.shots.find((s) => s.id === job.shot_id);
  if (!shot) throw new Error('That shot no longer exists');
  save(id, { status: 'running', progress: 'The mentor is reading the shot…' });
  const result = await withWaitListener(
    (why) => save(id, { progress: why }),
    () => mentorTurn(sp, shot, job.message ?? undefined),
  );
  save(id, { status: 'done', progress: '', result: JSON.stringify(result), finished_at: new Date().toISOString() });
}
