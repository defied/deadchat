import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import db from '../db/connection';
import { config } from '../config';
import type { Media, MediaType } from '../types/models';

function ensureMediaDir(): void {
  fs.mkdirSync(config.mediaDir, { recursive: true });
}

export interface SaveMediaOptions {
  userId?: number;
  jobId?: number;
  type: MediaType;
  bytes: Buffer;
  mime: string;
  originalFilename?: string;
  width?: number;
  height?: number;
  durationS?: number;
  prompt?: string;
  providerId?: number;
  meta?: Record<string, unknown>;
}

function extFromMime(mime: string): string {
  const map: Record<string, string> = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/webp': '.webp',
    'image/gif': '.gif',
    'video/mp4': '.mp4',
    'video/webm': '.webm',
  };
  return map[mime] ?? '.bin';
}

export function saveMedia(opts: SaveMediaOptions): Media {
  ensureMediaDir();

  const ext = opts.originalFilename
    ? path.extname(opts.originalFilename)
    : extFromMime(opts.mime);
  const filename = `${randomUUID()}${ext}`;
  const filePath = path.join(config.mediaDir, filename);

  fs.writeFileSync(filePath, opts.bytes);

  const result = db.prepare(`
    INSERT INTO media (user_id, job_id, type, filename, mime, size_bytes,
                       width, height, duration_s, prompt, provider_id, meta)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    opts.userId ?? null,
    opts.jobId ?? null,
    opts.type,
    filename,
    opts.mime,
    opts.bytes.length,
    opts.width ?? null,
    opts.height ?? null,
    opts.durationS ?? null,
    opts.prompt ?? null,
    opts.providerId ?? null,
    opts.meta ? JSON.stringify(opts.meta) : null
  );

  return db.prepare('SELECT * FROM media WHERE id = ?')
    .get(result.lastInsertRowid) as Media;
}

export function getMedia(id: number): Media | null {
  return db.prepare('SELECT * FROM media WHERE id = ?').get(id) as Media | null;
}

export function getMediaPath(filename: string): string {
  return path.join(config.mediaDir, filename);
}

export function listMedia(userId: number, limit = 50, offset = 0): Media[] {
  return db.prepare(
    'SELECT * FROM media WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
  ).all(userId, limit, offset) as Media[];
}

export function deleteMedia(id: number, requestingUserId: number, isAdmin: boolean): boolean {
  const media = getMedia(id);
  if (!media) return false;
  if (!isAdmin && media.user_id !== requestingUserId) return false;

  const filePath = getMediaPath(media.filename);
  try { fs.unlinkSync(filePath); } catch { /* file already gone — still remove DB row */ }

  db.prepare('DELETE FROM media WHERE id = ?').run(id);
  return true;
}
