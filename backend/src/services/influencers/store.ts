// Database access for influencer projects.

import db from '../../db/connection';
import { DEFAULT_DISCLOSURE } from './compliance';
import type {
  Attestation,
  FactCheck,
  ComplianceResult,
  Influencer,
  InfluencerKind,
  InfluencerMedia,
  InfluencerRow,
  Look,
  MediaRole,
  MediaStatus,
  Persona,
  Plan,
  PostStatus,
  Research,
  Source,
} from './types';

function parse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return { ...fallback, ...(JSON.parse(raw) as T) };
  } catch {
    return fallback;
  }
}

function parseArray<T>(raw: string | null | undefined): T[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
}

export const DEFAULT_PLAN: Plan = {
  postsPerWeek: 3,
  days: [1, 2, 3, 4, 5],
  windowStart: 9,
  windowEnd: 20,
  timezone: 'America/Los_Angeles',
  themes: [],
  videoShare: 0,
  autoPublish: false,
  platforms: [],
};

export const DEFAULT_RESEARCH: Research = {
  topics: [],
  feeds: [],
  useBlueskyTrends: true,
  trustedDomains: [],
  blockedDomains: [],
  minSources: 2,
  political: false,
};

function rowToInfluencer(r: InfluencerRow): Influencer {
  return {
    id: r.id,
    userId: r.user_id,
    name: r.name,
    kind: r.kind,
    status: r.status,
    step: r.step,
    persona: parse<Persona>(r.persona, { disclosure: DEFAULT_DISCLOSURE, language: 'English' }),
    look: parse<Look>(r.look, { ratio: '3:4' }),
    research: parse<Research>(r.research, DEFAULT_RESEARCH),
    plan: parse<Plan>(r.plan, DEFAULT_PLAN),
    attestation: parse<Attestation>(r.attestation, {}),
    lastPostAt: r.last_post_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function createInfluencer(userId: number, name: string, kind: InfluencerKind): Influencer {
  const res = db
    .prepare('INSERT INTO influencers (user_id, name, kind) VALUES (?, ?, ?)')
    .run(userId, name, kind);
  return getInfluencer(Number(res.lastInsertRowid))!;
}

export function getInfluencer(id: number): Influencer | null {
  const r = db.prepare('SELECT * FROM influencers WHERE id = ?').get(id) as InfluencerRow | undefined;
  return r ? rowToInfluencer(r) : null;
}

export function listInfluencers(userId: number): Influencer[] {
  return (db.prepare('SELECT * FROM influencers WHERE user_id = ? ORDER BY updated_at DESC').all(userId) as InfluencerRow[]).map(
    rowToInfluencer,
  );
}

export function listActiveInfluencers(): Influencer[] {
  return (db.prepare("SELECT * FROM influencers WHERE status = 'active'").all() as InfluencerRow[]).map(rowToInfluencer);
}

export interface InfluencerPatch {
  name?: string;
  step?: string;
  status?: Influencer['status'];
  persona?: Persona;
  look?: Look;
  research?: Research;
  plan?: Plan;
  attestation?: Attestation;
  lastPostAt?: string | null;
}

export function updateInfluencer(id: number, patch: InfluencerPatch): Influencer {
  const sets: string[] = [];
  const vals: unknown[] = [];
  const put = (col: string, v: unknown) => {
    sets.push(`${col} = ?`);
    vals.push(v);
  };
  if (patch.name !== undefined) put('name', patch.name);
  if (patch.step !== undefined) put('step', patch.step);
  if (patch.status !== undefined) put('status', patch.status);
  if (patch.persona !== undefined) put('persona', JSON.stringify(patch.persona));
  if (patch.look !== undefined) put('look', JSON.stringify(patch.look));
  if (patch.research !== undefined) put('research', JSON.stringify(patch.research));
  if (patch.plan !== undefined) put('plan', JSON.stringify(patch.plan));
  if (patch.attestation !== undefined) put('attestation', JSON.stringify(patch.attestation));
  if (patch.lastPostAt !== undefined) put('last_post_at', patch.lastPostAt);
  if (sets.length) {
    sets.push("updated_at = datetime('now')");
    db.prepare(`UPDATE influencers SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id);
  }
  return getInfluencer(id)!;
}

export function deleteInfluencer(id: number): void {
  db.prepare('DELETE FROM influencers WHERE id = ?').run(id);
}

// ── media ──────────────────────────────────────────────────────────────────

export function addMedia(
  influencerId: number,
  role: MediaRole,
  fields: { jobId?: number | null; mediaId?: number | null; prompt?: string; scene?: string; status?: MediaStatus },
): InfluencerMedia {
  const res = db
    .prepare(
      'INSERT INTO influencer_media (influencer_id, role, status, job_id, media_id, prompt, scene) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .run(
      influencerId,
      role,
      fields.status ?? 'pending',
      fields.jobId ?? null,
      fields.mediaId ?? null,
      fields.prompt ?? null,
      fields.scene ?? null,
    );
  return getMediaRow(Number(res.lastInsertRowid))!;
}

export function getMediaRow(id: number): InfluencerMedia | null {
  return (db.prepare('SELECT * FROM influencer_media WHERE id = ?').get(id) as InfluencerMedia | undefined) ?? null;
}

export function listMediaRows(influencerId: number, role?: MediaRole): InfluencerMedia[] {
  return (
    role
      ? db.prepare('SELECT * FROM influencer_media WHERE influencer_id = ? AND role = ? ORDER BY id DESC').all(influencerId, role)
      : db.prepare('SELECT * FROM influencer_media WHERE influencer_id = ? ORDER BY id DESC').all(influencerId)
  ) as InfluencerMedia[];
}

export function updateMediaRow(
  id: number,
  fields: { status?: MediaStatus; mediaId?: number | null; error?: string | null },
): void {
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (fields.status !== undefined) (sets.push('status = ?'), vals.push(fields.status));
  if (fields.mediaId !== undefined) (sets.push('media_id = ?'), vals.push(fields.mediaId));
  if (fields.error !== undefined) (sets.push('error = ?'), vals.push(fields.error));
  if (sets.length) db.prepare(`UPDATE influencer_media SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id);
}

export function countMedia(influencerId: number, role: MediaRole, status: MediaStatus): number {
  return (
    db
      .prepare('SELECT COUNT(*) AS n FROM influencer_media WHERE influencer_id = ? AND role = ? AND status = ?')
      .get(influencerId, role, status) as { n: number }
  ).n;
}

// ── accounts ───────────────────────────────────────────────────────────────

export interface AccountRow {
  id: number;
  influencer_id: number;
  platform: string;
  handle: string | null;
  credentials: string | null;
  checklist: string;
  status: 'pending' | 'connected' | 'manual' | 'error';
  last_error: string | null;
  updated_at: string;
}

export function listAccounts(influencerId: number): AccountRow[] {
  return db.prepare('SELECT * FROM influencer_accounts WHERE influencer_id = ? ORDER BY platform').all(influencerId) as AccountRow[];
}

export function getAccount(influencerId: number, platform: string): AccountRow | null {
  return (
    (db
      .prepare('SELECT * FROM influencer_accounts WHERE influencer_id = ? AND platform = ?')
      .get(influencerId, platform) as AccountRow | undefined) ?? null
  );
}

export function upsertAccount(
  influencerId: number,
  platform: string,
  fields: { handle?: string | null; credentials?: string | null; checklist?: Record<string, boolean>; status?: AccountRow['status']; lastError?: string | null },
): AccountRow {
  const existing = getAccount(influencerId, platform);
  if (!existing) {
    db.prepare('INSERT INTO influencer_accounts (influencer_id, platform) VALUES (?, ?)').run(influencerId, platform);
  }
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (fields.handle !== undefined) (sets.push('handle = ?'), vals.push(fields.handle));
  if (fields.credentials !== undefined) (sets.push('credentials = ?'), vals.push(fields.credentials));
  if (fields.checklist !== undefined) (sets.push('checklist = ?'), vals.push(JSON.stringify(fields.checklist)));
  if (fields.status !== undefined) (sets.push('status = ?'), vals.push(fields.status));
  if (fields.lastError !== undefined) (sets.push('last_error = ?'), vals.push(fields.lastError));
  sets.push("updated_at = datetime('now')");
  db.prepare(`UPDATE influencer_accounts SET ${sets.join(', ')} WHERE influencer_id = ? AND platform = ?`).run(
    ...vals,
    influencerId,
    platform,
  );
  return getAccount(influencerId, platform)!;
}

export function deleteAccount(influencerId: number, platform: string): void {
  db.prepare('DELETE FROM influencer_accounts WHERE influencer_id = ? AND platform = ?').run(influencerId, platform);
}

export function parseChecklist(row: AccountRow | null): Record<string, boolean> {
  if (!row) return {};
  try {
    return JSON.parse(row.checklist) as Record<string, boolean>;
  } catch {
    return {};
  }
}

// ── posts ──────────────────────────────────────────────────────────────────

interface PostRow {
  id: number;
  influencer_id: number;
  status: PostStatus;
  origin: 'auto' | 'manual';
  topic: string | null;
  topic_key: string | null;
  text: string;
  media_ids: string;
  sources: string;
  fact_check: string | null;
  compliance: string | null;
  checked_text: string | null;
  scheduled_for: string | null;
  results: string;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface Post {
  id: number;
  influencerId: number;
  status: PostStatus;
  origin: 'auto' | 'manual';
  topic: string | null;
  topicKey: string | null;
  text: string;
  mediaIds: number[];
  sources: Source[];
  factCheck: FactCheck | null;
  compliance: ComplianceResult | null;
  /** Text as it was when last fact-checked; edits after that need a re-check. */
  checkedText: string | null;
  scheduledFor: string | null;
  results: Record<string, { ok: boolean; url?: string; error?: string; at: string; manual?: boolean }>;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

function rowToPost(r: PostRow): Post {
  let factCheck: FactCheck | null = null;
  let compliance: ComplianceResult | null = null;
  try { factCheck = r.fact_check ? (JSON.parse(r.fact_check) as FactCheck) : null; } catch { /* ignore */ }
  try { compliance = r.compliance ? (JSON.parse(r.compliance) as ComplianceResult) : null; } catch { /* ignore */ }
  let results: Post['results'] = {};
  try { results = JSON.parse(r.results || '{}'); } catch { /* ignore */ }
  return {
    id: r.id,
    influencerId: r.influencer_id,
    status: r.status,
    origin: r.origin,
    topic: r.topic,
    topicKey: r.topic_key,
    text: r.text,
    mediaIds: parseArray<number>(r.media_ids),
    sources: parseArray<Source>(r.sources),
    factCheck,
    compliance,
    checkedText: r.checked_text,
    scheduledFor: r.scheduled_for,
    results,
    error: r.error,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function createPost(
  influencerId: number,
  p: Omit<Post, 'id' | 'influencerId' | 'createdAt' | 'updatedAt' | 'results'> & { results?: Post['results'] },
): Post {
  const res = db
    .prepare(
      `INSERT INTO influencer_posts
        (influencer_id, status, origin, topic, topic_key, text, media_ids, sources, fact_check, compliance, checked_text, scheduled_for, results, error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      influencerId,
      p.status,
      p.origin,
      p.topic,
      p.topicKey,
      p.text,
      JSON.stringify(p.mediaIds),
      JSON.stringify(p.sources),
      p.factCheck ? JSON.stringify(p.factCheck) : null,
      p.compliance ? JSON.stringify(p.compliance) : null,
      p.checkedText,
      p.scheduledFor,
      JSON.stringify(p.results ?? {}),
      p.error,
    );
  return getPost(Number(res.lastInsertRowid))!;
}

export function getPost(id: number): Post | null {
  const r = db.prepare('SELECT * FROM influencer_posts WHERE id = ?').get(id) as PostRow | undefined;
  return r ? rowToPost(r) : null;
}

export function listPosts(influencerId: number, limit = 100): Post[] {
  return (
    db.prepare('SELECT * FROM influencer_posts WHERE influencer_id = ? ORDER BY id DESC LIMIT ?').all(influencerId, limit) as PostRow[]
  ).map(rowToPost);
}

export function updatePost(
  id: number,
  f: Partial<Pick<Post, 'status' | 'text' | 'scheduledFor' | 'results' | 'error' | 'compliance' | 'factCheck' | 'checkedText' | 'sources'>>,
): Post {
  const sets: string[] = [];
  const vals: unknown[] = [];
  const put = (c: string, v: unknown) => (sets.push(`${c} = ?`), vals.push(v));
  if (f.status !== undefined) put('status', f.status);
  if (f.text !== undefined) put('text', f.text);
  if (f.scheduledFor !== undefined) put('scheduled_for', f.scheduledFor);
  if (f.results !== undefined) put('results', JSON.stringify(f.results));
  if (f.error !== undefined) put('error', f.error);
  if (f.compliance !== undefined) put('compliance', f.compliance ? JSON.stringify(f.compliance) : null);
  if (f.factCheck !== undefined) put('fact_check', f.factCheck ? JSON.stringify(f.factCheck) : null);
  if (f.checkedText !== undefined) put('checked_text', f.checkedText);
  if (f.sources !== undefined) put('sources', JSON.stringify(f.sources));
  if (sets.length) {
    sets.push("updated_at = datetime('now')");
    db.prepare(`UPDATE influencer_posts SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id);
  }
  return getPost(id)!;
}

/** Approved posts whose time has come, oldest first. */
export function duePosts(nowIso: string): Post[] {
  return (
    db
      .prepare(
        `SELECT * FROM influencer_posts WHERE status = 'approved' AND (scheduled_for IS NULL OR scheduled_for <= ?) ORDER BY id ASC LIMIT 20`,
      )
      .all(nowIso) as PostRow[]
  ).map(rowToPost);
}

/** Publish times of recent posts (for rate caps). */
export function recentPublishTimes(influencerId: number): string[] {
  const rows = db
    .prepare(
      `SELECT results FROM influencer_posts WHERE influencer_id = ? AND status = 'published' ORDER BY id DESC LIMIT 20`,
    )
    .all(influencerId) as Array<{ results: string }>;
  const times: string[] = [];
  for (const r of rows) {
    try {
      for (const v of Object.values(JSON.parse(r.results) as Record<string, { at?: string; ok?: boolean }>)) {
        if (v?.ok && v.at) times.push(v.at);
      }
    } catch { /* ignore */ }
  }
  return times;
}

/** Topic keys already covered recently, so the same story isn't posted twice. */
export function recentTopicKeys(influencerId: number, limit = 50): Set<string> {
  const rows = db
    .prepare(
      `SELECT topic_key FROM influencer_posts WHERE influencer_id = ? AND topic_key IS NOT NULL ORDER BY id DESC LIMIT ?`,
    )
    .all(influencerId, limit) as Array<{ topic_key: string }>;
  return new Set(rows.map((r) => r.topic_key));
}

/** Is a post already being generated or waiting for review? */
export function hasOpenPost(influencerId: number): boolean {
  return !!db
    .prepare(`SELECT 1 FROM influencer_posts WHERE influencer_id = ? AND status IN ('review', 'approved', 'publishing') LIMIT 1`)
    .get(influencerId);
}
