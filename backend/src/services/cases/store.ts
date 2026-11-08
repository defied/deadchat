// Medical cases: database rows and on-disk files.
//
// Files live under MEDIA_DIR/cases/<caseId>/<itemId>/:
//   original/<n>-<name>   what was uploaded (each instance of a slice stack)
//   display.<ext>         browser-ready copy (images, extracted PDFs)
//   frames/<key>.jpg      one JPEG per cine frame or slice
//   thumb.jpg             card thumbnail

import fs from 'fs';
import path from 'path';
import db from '../../db/connection';
import { config } from '../../config';
import type { DicomMeta } from './dicom';

export type ItemKind = 'dicom' | 'image' | 'video' | 'document' | 'data' | 'other';
export const CATEGORIES = ['imaging', 'cine', 'ecg', 'labs', 'reports', 'pathology', 'photos', 'notes', 'other'] as const;
export type Category = (typeof CATEGORIES)[number];

export interface LabRow {
  id: string;
  date?: string;
  test: string;
  value: string;
  unit?: string;
  low?: string;
  high?: string;
}

export interface TimelineEvent {
  id: string;
  date?: string;
  title: string;
  detail?: string;
}

/** Everything optional: a case can be just evidence. */
export interface CaseProfile {
  age?: string;
  sex?: string;
  weightKg?: number;
  heightCm?: number;
  specialty?: string;
  chiefComplaint?: string;
  hpi?: string;
  pmh?: string;
  diagnoses?: string;
  procedures?: string;
  medications?: string;
  allergies?: string;
  familyHistory?: string;
  socialHistory?: string;
  exam?: string;
  vitals?: { hr?: string; bp?: string; rr?: string; spo2?: string; temp?: string };
  question?: string;
  teachingPoints?: string;
  labs?: LabRow[];
  events?: TimelineEvent[];
}

export interface MedicalCase {
  id: number;
  userId: number;
  title: string;
  profile: CaseProfile;
  summary: string | null;
  summarySource: 'ai' | 'user' | null;
  createdAt: string;
  updatedAt: string;
}

export interface FrameRef {
  file: string;
  key: number;
}

export interface ItemMeta {
  dicom?: DicomMeta;
  /** Per-frame files for cine loops and slice stacks, in display order. */
  frameFiles?: FrameRef[];
  /** Browser-ready file name inside the item folder. */
  display?: string;
  displayMime?: string;
  hasThumb?: boolean;
  fps?: number;
  width?: number;
  height?: number;
  durationS?: number;
  /** Data files: first rows for preview. */
  table?: { columns: string[]; rows: string[][]; total: number };
  originals?: string[];
  playable?: boolean;
}

export interface CaseItem {
  id: number;
  case_id: number;
  kind: ItemKind;
  category: Category;
  title: string;
  notes: string | null;
  taken_at: string | null;
  original_name: string | null;
  mime: string | null;
  size_bytes: number;
  meta: ItemMeta;
  frames: number;
  series_uid: string | null;
  status: 'processing' | 'ready' | 'failed';
  pending: number;
  error: string | null;
  ai_notes: string | null;
  ai_status: 'running' | 'done' | 'failed' | null;
  ai_error: string | null;
  mask_top: number;
  include: number;
  sort: number;
  created_at: string;
}

type ItemRow = Omit<CaseItem, 'meta'> & { meta: string };

function toItem(r: ItemRow): CaseItem {
  let meta: ItemMeta = {};
  try {
    meta = JSON.parse(r.meta) as ItemMeta;
  } catch {
    /* empty */
  }
  return { ...r, meta };
}

interface CaseRow {
  id: number;
  user_id: number;
  title: string;
  profile: string;
  summary: string | null;
  summary_source: 'ai' | 'user' | null;
  created_at: string;
  updated_at: string;
}

function toCase(r: CaseRow): MedicalCase {
  let profile: CaseProfile = {};
  try {
    profile = JSON.parse(r.profile) as CaseProfile;
  } catch {
    /* empty */
  }
  return {
    id: r.id,
    userId: r.user_id,
    title: r.title,
    profile,
    summary: r.summary,
    summarySource: r.summary_source,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// ── cases ────────────────────────────────────────────────────────────────────

export function createCase(userId: number, title: string): MedicalCase {
  const r = db.prepare('INSERT INTO medical_cases (user_id, title) VALUES (?, ?)').run(userId, title);
  return getCase(r.lastInsertRowid as number)!;
}

export function getCase(id: number): MedicalCase | null {
  const r = db.prepare('SELECT * FROM medical_cases WHERE id = ?').get(id) as CaseRow | undefined;
  return r ? toCase(r) : null;
}

export function listCases(userId: number): Array<MedicalCase & { items: number; thumbItem: number | null }> {
  const rows = db.prepare('SELECT * FROM medical_cases WHERE user_id = ? ORDER BY updated_at DESC').all(userId) as CaseRow[];
  return rows.map((r) => {
    const c = db
      .prepare("SELECT COUNT(*) AS n, MIN(CASE WHEN json_extract(meta, '$.hasThumb') THEN id END) AS thumb FROM case_items WHERE case_id = ?")
      .get(r.id) as { n: number; thumb: number | null };
    return { ...toCase(r), items: c.n, thumbItem: c.thumb };
  });
}

export function updateCase(id: number, patch: { title?: string; profile?: CaseProfile; summary?: string | null; summarySource?: 'ai' | 'user' | null }): MedicalCase {
  const cur = getCase(id);
  if (!cur) throw new Error('Case not found');
  db.prepare(
    "UPDATE medical_cases SET title = ?, profile = ?, summary = ?, summary_source = ?, updated_at = datetime('now') WHERE id = ?",
  ).run(
    patch.title ?? cur.title,
    JSON.stringify(patch.profile ?? cur.profile),
    patch.summary !== undefined ? patch.summary : cur.summary,
    patch.summarySource !== undefined ? patch.summarySource : cur.summarySource,
    id,
  );
  return getCase(id)!;
}

export function touchCase(id: number): void {
  db.prepare("UPDATE medical_cases SET updated_at = datetime('now') WHERE id = ?").run(id);
}

export function deleteCase(id: number): void {
  db.prepare('DELETE FROM medical_cases WHERE id = ?').run(id);
  fs.rmSync(caseDir(id), { recursive: true, force: true });
}

// ── items ────────────────────────────────────────────────────────────────────

export function listItems(caseId: number): CaseItem[] {
  return (db.prepare('SELECT * FROM case_items WHERE case_id = ? ORDER BY sort, id').all(caseId) as ItemRow[]).map(toItem);
}

export function getItem(id: number): CaseItem | null {
  const r = db.prepare('SELECT * FROM case_items WHERE id = ?').get(id) as ItemRow | undefined;
  return r ? toItem(r) : null;
}

export function findSeriesItem(caseId: number, seriesUid: string): CaseItem | null {
  const r = db.prepare('SELECT * FROM case_items WHERE case_id = ? AND series_uid = ? ORDER BY id LIMIT 1').get(caseId, seriesUid) as ItemRow | undefined;
  return r ? toItem(r) : null;
}

export function addItem(
  caseId: number,
  fields: Pick<CaseItem, 'kind' | 'category' | 'title'> & Partial<Pick<CaseItem, 'original_name' | 'mime' | 'size_bytes' | 'series_uid' | 'taken_at' | 'pending'>>,
): CaseItem {
  const sort = (db.prepare('SELECT COALESCE(MAX(sort), 0) + 1 AS s FROM case_items WHERE case_id = ?').get(caseId) as { s: number }).s;
  const r = db
    .prepare(
      `INSERT INTO case_items (case_id, kind, category, title, original_name, mime, size_bytes, series_uid, taken_at, pending, sort)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      caseId,
      fields.kind,
      fields.category,
      fields.title,
      fields.original_name ?? null,
      fields.mime ?? null,
      fields.size_bytes ?? 0,
      fields.series_uid ?? null,
      fields.taken_at ?? null,
      fields.pending ?? 1,
      sort,
    );
  touchCase(caseId);
  return getItem(r.lastInsertRowid as number)!;
}

type Patchable = Partial<
  Pick<
    CaseItem,
    'kind' | 'category' | 'title' | 'notes' | 'taken_at' | 'mime' | 'size_bytes' | 'frames' | 'status' | 'pending' | 'error' | 'ai_notes' | 'ai_status' | 'ai_error' | 'mask_top' | 'include' | 'sort'
  >
> & { meta?: ItemMeta };

export function updateItem(id: number, patch: Patchable): void {
  const keys = Object.keys(patch) as Array<keyof Patchable>;
  if (!keys.length) return;
  db.prepare(`UPDATE case_items SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(
    ...keys.map((k) => (k === 'meta' ? JSON.stringify(patch.meta) : (patch[k] ?? null))),
    id,
  );
}

/** Read-modify-write an item atomically (better-sqlite3 transactions are synchronous). */
export function mutateItem(id: number, fn: (item: CaseItem) => Patchable): CaseItem | null {
  return db.transaction(() => {
    const item = getItem(id);
    if (!item) return null;
    updateItem(id, fn(item));
    return getItem(id);
  })();
}

export function deleteItem(item: CaseItem): void {
  db.prepare('DELETE FROM case_items WHERE id = ?').run(item.id);
  fs.rmSync(itemDir(item.case_id, item.id), { recursive: true, force: true });
  touchCase(item.case_id);
}

export function reorder(caseId: number, ids: number[]): void {
  const stmt = db.prepare('UPDATE case_items SET sort = ? WHERE id = ? AND case_id = ?');
  db.transaction(() => ids.forEach((id, i) => stmt.run(i + 1, id, caseId)))();
}

// ── files ────────────────────────────────────────────────────────────────────

export function caseDir(caseId: number): string {
  return path.join(config.mediaDir, 'cases', String(caseId));
}

export function itemDir(caseId: number, itemId: number): string {
  return path.join(caseDir(caseId), String(itemId));
}

/** A path inside an item's folder; refuses anything that escapes it. */
export function itemPath(item: Pick<CaseItem, 'case_id' | 'id'>, rel: string): string {
  const base = itemDir(item.case_id, item.id);
  const p = path.resolve(base, rel);
  if (p !== base && !p.startsWith(base + path.sep)) throw new Error('Bad path');
  return p;
}
