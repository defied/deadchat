// Cron scheduler for autonomous recurring agent runs.
// Each schedule fires by enqueuing an 'agent' job — no inline execution,
// so all GPU work still serializes through the worker.

import cron from 'node-cron';
import db from '../db/connection';
import { enqueue } from './jobQueue';
import type { Schedule } from '../types/models';

const registered = new Map<number, ReturnType<typeof cron.schedule>>();

export function startScheduler(): void {
  loadAndRegister();
  console.log('[scheduler] Started.');
}

function loadAndRegister(): void {
  const schedules = db.prepare(
    'SELECT * FROM schedules WHERE enabled = 1'
  ).all() as Schedule[];

  for (const s of schedules) {
    registerSchedule(s);
  }
  console.log(`[scheduler] Registered ${schedules.length} schedule(s).`);
}

export function registerSchedule(s: Schedule): void {
  if (!cron.validate(s.cron)) {
    console.warn(`[scheduler] Invalid cron expression for schedule ${s.id}: "${s.cron}"`);
    return;
  }

  // Cancel any existing registration for this ID
  unregisterSchedule(s.id);

  const task = cron.schedule(s.cron, () => {
    console.log(`[scheduler] Firing schedule ${s.id} "${s.name}"`);
    const jobId = enqueue('agent', {
      goal: s.goal,
      agentId: s.agent_id,
      agentSource: s.agent_source,
      scheduleId: s.id,
    }, {
      userId: s.user_id,
      heavy: false,
    });

    db.prepare(
      "UPDATE schedules SET last_run_at = datetime('now') WHERE id = ?"
    ).run(s.id);

    console.log(`[scheduler] Enqueued agent job ${jobId} for schedule ${s.id}`);
  });

  registered.set(s.id, task);
}

export function unregisterSchedule(id: number): void {
  const existing = registered.get(id);
  if (existing) {
    existing.stop();
    registered.delete(id);
  }
}

export function reloadSchedule(id: number): void {
  const s = db.prepare('SELECT * FROM schedules WHERE id = ?').get(id) as Schedule | undefined;
  if (!s) {
    unregisterSchedule(id);
    return;
  }
  if (s.enabled) {
    registerSchedule(s);
  } else {
    unregisterSchedule(id);
  }
}

export function stopScheduler(): void {
  for (const task of registered.values()) task.stop();
  registered.clear();
}
