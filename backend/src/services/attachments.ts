// Chat attachments: normalize what the client sends, persist a stable shape,
// and turn files into model input (vision images / inlined text).

import fs from 'fs';
import path from 'path';
import { config } from '../config';

export interface StoredAttachment {
  /** Stored filename on disk (uuid + ext) — also the stable id. */
  id: string;
  /** Original filename shown to the user. */
  filename: string;
  /** URL the browser can fetch. */
  url: string;
  /** MIME type as reported at upload time (may be empty for legacy rows). */
  type: string;
}

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp']);
const TEXT_EXT = new Set([
  '.txt', '.md', '.csv', '.json', '.yaml', '.yml', '.xml', '.html', '.css', '.js', '.ts', '.tsx', '.jsx',
  '.py', '.sql', '.sh', '.rb', '.go', '.rs', '.java', '.cpp', '.c', '.h', '.toml', '.ini', '.log',
]);
const MAX_INLINE_TEXT = 100_000; // chars per text attachment
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

export const UPLOAD_URL_PREFIX = '/api/uploads/';

function storedPath(id: string): string | null {
  const base = path.basename(id); // strip any directory component
  if (!base || base !== id) return null;
  const full = path.resolve(config.uploadDir, base);
  return fs.existsSync(full) ? full : null;
}

function idFromUrl(url: string): string {
  return path.basename(url.split('?')[0]);
}

/** Accepts the client payload (objects or legacy strings) and returns validated attachments. */
export function normalizeAttachments(input: unknown): StoredAttachment[] {
  if (!Array.isArray(input)) return [];
  const out: StoredAttachment[] = [];
  for (const item of input) {
    let id = '';
    let filename = '';
    let type = '';
    if (typeof item === 'string') {
      id = idFromUrl(item);
    } else if (item && typeof item === 'object') {
      const o = item as Record<string, unknown>;
      const ref = (o.id ?? o.url ?? o.path ?? o.filename) as unknown;
      if (typeof ref === 'string') id = idFromUrl(ref);
      if (typeof o.url === 'string' || typeof o.path === 'string') {
        id = idFromUrl((o.url ?? o.path) as string);
      }
      filename = typeof o.filename === 'string' ? o.filename : typeof o.originalName === 'string' ? o.originalName : '';
      type = typeof o.type === 'string' ? o.type : typeof o.mimetype === 'string' ? o.mimetype : '';
    }
    if (!id || !storedPath(id)) continue;
    out.push({ id, filename: filename || id, url: UPLOAD_URL_PREFIX + id, type });
  }
  return out;
}

/** Parse the JSON stored in messages.attachments (handles legacy formats). */
export function parseStoredAttachments(json: string | null): StoredAttachment[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((x) => x !== null && x !== undefined)
      .map((x) => {
        if (typeof x === 'string') {
          const id = idFromUrl(x);
          return { id, filename: id, url: UPLOAD_URL_PREFIX + id, type: '' };
        }
        const o = x as StoredAttachment;
        return { id: o.id, filename: o.filename || o.id, url: o.url || UPLOAD_URL_PREFIX + o.id, type: o.type || '' };
      })
      .filter((a) => typeof a.id === 'string' && a.id.length > 0);
  } catch {
    return [];
  }
}

export function isImageAttachment(a: StoredAttachment): boolean {
  return a.type.startsWith('image/') || IMAGE_EXT.has(path.extname(a.id).toLowerCase());
}

function isTextAttachment(a: StoredAttachment): boolean {
  return a.type.startsWith('text/') || a.type === 'application/json' || TEXT_EXT.has(path.extname(a.id).toLowerCase());
}

/**
 * Expand a user turn with its attachments for the model:
 *  - images become base64 `images` when the model has vision
 *  - text/code files are inlined as fenced blocks
 *  - anything else is mentioned by name so the model knows it exists
 */
export function buildModelInput(
  content: string,
  attachments: StoredAttachment[],
  vision: boolean,
): { content: string; images: string[] } {
  const images: string[] = [];
  const notes: string[] = [];

  for (const a of attachments) {
    const file = storedPath(a.id);
    if (!file) continue;
    if (isImageAttachment(a)) {
      if (vision) {
        const stat = fs.statSync(file);
        if (stat.size <= MAX_IMAGE_BYTES) {
          images.push(fs.readFileSync(file).toString('base64'));
          continue;
        }
        notes.push(`[Image "${a.filename}" was attached but is too large to send to the model.]`);
      } else {
        notes.push(`[Image "${a.filename}" was attached, but the current model cannot view images.]`);
      }
    } else if (isTextAttachment(a)) {
      let text = fs.readFileSync(file, 'utf-8');
      let suffix = '';
      if (text.length > MAX_INLINE_TEXT) {
        text = text.slice(0, MAX_INLINE_TEXT);
        suffix = '\n… [truncated]';
      }
      const lang = path.extname(a.filename).slice(1);
      notes.push(`Attached file \`${a.filename}\`:\n\`\`\`${lang}\n${text}${suffix}\n\`\`\``);
    } else {
      notes.push(`[File "${a.filename}" (${a.type || 'unknown type'}) was attached; its contents can't be read here.]`);
    }
  }

  const merged = notes.length ? [content, ...notes].filter(Boolean).join('\n\n') : content;
  return { content: merged, images };
}
