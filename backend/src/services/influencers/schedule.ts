// Posting cadence (pure, unit-tested).
//
// A plan has posting days, a local posting window and a weekly post count.
// Posts are spread evenly across the plan's active hours: with 5 posts over
// 5 days × 8 hours, one is due every 8 active hours. Hours outside the
// window don't count, so posts never bunch up at the start of a window.

import type { Plan } from './types';

const HOUR = 3600_000;
/** Don't scan further than this looking for active hours. */
const MAX_SCAN_HOURS = 24 * 21;

export interface LocalTime {
  /** 0 = Sunday */
  weekday: number;
  hour: number;
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function localTime(date: Date, timeZone: string): LocalTime {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(date);
  const weekday = WEEKDAYS[parts.find((p) => p.type === 'weekday')?.value ?? 'Sun'] ?? 0;
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0) % 24;
  return { weekday, hour };
}

export function inWindow(plan: Plan, date: Date): boolean {
  const tz = plan.timezone || 'UTC';
  const { weekday, hour } = localTime(date, tz);
  const days = plan.days ?? [];
  const start = plan.windowStart ?? 9;
  const end = plan.windowEnd ?? 21;
  return days.includes(weekday) && hour >= start && hour < end;
}

export function activeHoursPerWeek(plan: Plan): number {
  const days = new Set(plan.days ?? []).size;
  const span = Math.max(0, (plan.windowEnd ?? 21) - (plan.windowStart ?? 9));
  return days * span;
}

/** Active hours between a post and the next one, or null if the plan can't post. */
export function intervalHours(plan: Plan): number | null {
  const perWeek = plan.postsPerWeek ?? 0;
  const active = activeHoursPerWeek(plan);
  if (perWeek <= 0 || active <= 0) return null;
  return active / perWeek;
}

/** Active (in-window) hours from `from` to `to`, counted hour by hour. */
export function activeHoursBetween(plan: Plan, from: Date, to: Date): number {
  let count = 0;
  let t = from.getTime();
  const end = to.getTime();
  let steps = 0;
  while (t + HOUR <= end && steps < MAX_SCAN_HOURS) {
    // Sample the middle of each hour so DST shifts don't double-count.
    if (inWindow(plan, new Date(t + HOUR / 2))) count++;
    t += HOUR;
    steps++;
  }
  if (steps >= MAX_SCAN_HOURS) count = Number.POSITIVE_INFINITY;
  return count;
}

/** Is a new post due right now? */
export function isPostDue(plan: Plan, lastPostAt: string | null, now: Date): boolean {
  if (!inWindow(plan, now)) return false;
  const interval = intervalHours(plan);
  if (interval == null) return false;
  if (!lastPostAt) return true;
  const last = new Date(lastPostAt);
  if (!Number.isFinite(last.getTime())) return true;
  return activeHoursBetween(plan, last, now) >= Math.max(1, Math.floor(interval));
}

/** The next moment inside the posting window (now, if already inside). */
export function nextWindowStart(plan: Plan, from: Date): Date | null {
  if ((plan.days ?? []).length === 0) return null;
  let t = from.getTime();
  for (let i = 0; i < MAX_SCAN_HOURS * 4; i++) {
    const d = new Date(t);
    if (inWindow(plan, d)) return d;
    // Step to the next quarter hour.
    t = Math.floor(t / (15 * 60_000)) * 15 * 60_000 + 15 * 60_000;
  }
  return null;
}
