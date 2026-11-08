// Database access for screenplays and their generated / uploaded media.

import db from '../../db/connection';
import { emptyDoc, type MediaRole, type MediaStatus, type Screenplay, type ScreenplayDoc, type ScreenplayMedia } from './types';

interface Row {
  id: number;
  user_id: number;
  title: string;
  doc: string;
  version: number;
  created_at: string;
  updated_at: string;
}

function parseDoc(raw: string): ScreenplayDoc {
  const base = emptyDoc();
  try {
    const d = JSON.parse(raw) as Partial<ScreenplayDoc>;
    return {
      ...base,
      ...d,
      elements: Array.isArray(d.elements) && d.elements.length ? d.elements : base.elements,
      shots: Array.isArray(d.shots) ? d.shots : [],
      characters: Array.isArray(d.characters) ? d.characters : [],
      plans: d.plans && typeof d.plans === 'object' ? d.plans : {},
      settings: { ...base.settings, ...(d.settings ?? {}) },
    };
  } catch {
    return base;
  }
}

function toScreenplay(r: Row): Screenplay {
  return {
    id: r.id,
    userId: r.user_id,
    title: r.title,
    doc: parseDoc(r.doc),
    version: r.version,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function createScreenplay(userId: number, title: string, doc: ScreenplayDoc = emptyDoc()): Screenplay {
  const r = db.prepare('INSERT INTO screenplays (user_id, title, doc) VALUES (?, ?, ?)').run(userId, title, JSON.stringify(doc));
  return getScreenplay(r.lastInsertRowid as number)!;
}

export function getScreenplay(id: number): Screenplay | null {
  const r = db.prepare('SELECT * FROM screenplays WHERE id = ?').get(id) as Row | undefined;
  return r ? toScreenplay(r) : null;
}

export interface ScreenplaySummary {
  id: number;
  title: string;
  updatedAt: string;
  scenes: number;
  shots: number;
  characters: number;
}

export function listScreenplays(userId: number): ScreenplaySummary[] {
  const rows = db.prepare('SELECT * FROM screenplays WHERE user_id = ? ORDER BY updated_at DESC').all(userId) as Row[];
  return rows.map((r) => {
    const d = parseDoc(r.doc);
    return {
      id: r.id,
      title: r.title,
      updatedAt: r.updated_at,
      scenes: d.elements.filter((e) => e.type === 'scene' && e.text.trim()).length,
      shots: d.shots.length,
      characters: d.characters.length,
    };
  });
}

export class VersionConflict extends Error {
  constructor(public current: Screenplay) {
    super('This screenplay was changed somewhere else');
  }
}

/** Save the document if `version` is current; returns the new version. */
export function saveScreenplay(id: number, version: number, patch: { title?: string; doc?: ScreenplayDoc }): Screenplay {
  const cur = getScreenplay(id);
  if (!cur) throw new Error('Screenplay not found');
  if (cur.version !== version) throw new VersionConflict(cur);
  db.prepare(
    "UPDATE screenplays SET title = ?, doc = ?, version = version + 1, updated_at = datetime('now') WHERE id = ? AND version = ?",
  ).run(patch.title ?? cur.title, JSON.stringify(patch.doc ?? cur.doc), id, version);
  return getScreenplay(id)!;
}

export function deleteScreenplay(id: number): void {
  db.prepare('DELETE FROM screenplays WHERE id = ?').run(id);
}

// ── media ────────────────────────────────────────────────────────────────────

export function addMedia(
  screenplayId: number,
  role: MediaRole,
  target: string,
  fields: Partial<Pick<ScreenplayMedia, 'status' | 'hash' | 'prompt' | 'caption' | 'label' | 'job_id' | 'media_id' | 'error'>>,
): ScreenplayMedia {
  const r = db
    .prepare(
      `INSERT INTO screenplay_media (screenplay_id, role, target, status, hash, prompt, caption, label, job_id, media_id, error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      screenplayId,
      role,
      target,
      fields.status ?? 'pending',
      fields.hash ?? null,
      fields.prompt ?? null,
      fields.caption ?? null,
      fields.label ?? null,
      fields.job_id ?? null,
      fields.media_id ?? null,
      fields.error ?? null,
    );
  return getMedia(r.lastInsertRowid as number)!;
}

export function getMedia(id: number): ScreenplayMedia | null {
  return (db.prepare('SELECT * FROM screenplay_media WHERE id = ?').get(id) as ScreenplayMedia | undefined) ?? null;
}

export function listMedia(screenplayId: number, role?: MediaRole): ScreenplayMedia[] {
  return role
    ? (db.prepare('SELECT * FROM screenplay_media WHERE screenplay_id = ? AND role = ? ORDER BY id').all(screenplayId, role) as ScreenplayMedia[])
    : (db.prepare('SELECT * FROM screenplay_media WHERE screenplay_id = ? ORDER BY id').all(screenplayId) as ScreenplayMedia[]);
}

/** Newest non-superseded row for a role/target. */
export function latestMedia(screenplayId: number, role: MediaRole, target: string): ScreenplayMedia | null {
  return (
    (db
      .prepare(
        "SELECT * FROM screenplay_media WHERE screenplay_id = ? AND role = ? AND target = ? AND status != 'superseded' ORDER BY id DESC LIMIT 1",
      )
      .get(screenplayId, role, target) as ScreenplayMedia | undefined) ?? null
  );
}

export function updateMedia(
  id: number,
  patch: Partial<Pick<ScreenplayMedia, 'status' | 'caption' | 'label' | 'media_id' | 'error' | 'target'>>,
): void {
  const keys = Object.keys(patch) as Array<keyof typeof patch>;
  if (!keys.length) return;
  db.prepare(`UPDATE screenplay_media SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(
    ...keys.map((k) => (patch[k] === undefined ? null : patch[k])),
    id,
  );
}

export function setStatus(id: number, status: MediaStatus, error?: string | null): void {
  updateMedia(id, { status, error: error ?? null });
}

export function deleteMedia(id: number): void {
  db.prepare('DELETE FROM screenplay_media WHERE id = ?').run(id);
}
