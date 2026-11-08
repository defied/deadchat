// Turning uploads into case evidence: work out what each file is, keep the
// original, and make browser-ready versions (frames, display copies,
// thumbnails, table previews). Heavy work runs in a small background queue;
// items show "processing" until it finishes.

import fs from 'fs';
import path from 'path';
import { randomBytes } from 'crypto';
import sharp from 'sharp';
import {
  dicomTitle,
  encapsulatedDocument,
  fileWindow,
  frameJpeg,
  isDicom,
  parseDicom,
  sliceKey,
  stacksBySeries,
  type DicomMeta,
} from './dicom';
import * as store from './store';
import type { CaseItem, Category, ItemKind } from './store';

export const MAX_FRAMES = 1500;
const THUMB = 360;

const EXT_KIND: Record<string, ItemKind> = {
  dcm: 'dicom', dicom: 'dicom',
  png: 'image', jpg: 'image', jpeg: 'image', webp: 'image', gif: 'image', tif: 'image', tiff: 'image', bmp: 'image', avif: 'image', heic: 'image', heif: 'image',
  mp4: 'video', m4v: 'video', webm: 'video', mov: 'video', ogv: 'video', avi: 'video', mkv: 'video', wmv: 'video', mpg: 'video', mpeg: 'video',
  pdf: 'document', txt: 'document', md: 'document', rtf: 'document', doc: 'document', docx: 'document', ppt: 'document', pptx: 'document', html: 'document', htm: 'document',
  csv: 'data', tsv: 'data', json: 'data', xlsx: 'data', xls: 'data',
};
const PLAYABLE_VIDEO = new Set(['mp4', 'm4v', 'webm', 'mov', 'ogv']);
const SHOWABLE_DOC = new Set(['pdf', 'txt', 'md']);

function ext(name: string): string {
  return path.extname(name).slice(1).toLowerCase();
}

function readHead(file: string, n = 132): Buffer {
  const fd = fs.openSync(file, 'r');
  try {
    const b = Buffer.alloc(n);
    const read = fs.readSync(fd, b, 0, n, 0);
    return b.subarray(0, read);
  } finally {
    fs.closeSync(fd);
  }
}

export function classify(name: string, mime: string, head: Buffer): ItemKind {
  if (head.length >= 132 && head.toString('latin1', 128, 132) === 'DICM') return 'dicom';
  const byExt = EXT_KIND[ext(name)];
  if (byExt) return byExt;
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime === 'application/pdf' || mime.startsWith('text/')) return 'document';
  return 'other';
}

export function guessCategory(kind: ItemKind, name: string, dicom?: DicomMeta): Category {
  const n = name.toLowerCase();
  if (/\b(ecg|ekg|holter|rhythm)\b|ecg|ekg/.test(n)) return 'ecg';
  if (dicom) {
    if (dicom.documentMime) return 'reports';
    if (dicom.modality === 'ECG') return 'ecg';
    if ((dicom.modality === 'US' || dicom.modality === 'XA' || dicom.modality === 'RF') && dicom.frames > 1) return 'cine';
    return 'imaging';
  }
  if (/lab|cbc|bmp|cmp|panel|troponin|bnp|culture/.test(n)) return 'labs';
  if (/path|histo|biopsy|slide|cytology/.test(n)) return 'pathology';
  if (kind === 'video') return 'cine';
  if (kind === 'data') return 'labs';
  if (kind === 'document') return /note|letter|summary|consult/.test(n) ? 'notes' : 'reports';
  if (kind === 'image') return /photo|img_|dsc|pxl_|clinical/.test(n) ? 'photos' : 'imaging';
  return 'other';
}

function safeName(name: string): string {
  return (path.basename(name).replace(/[^\w.\- ]+/g, '_').slice(-120) || 'file').trim();
}

// ── background queue ─────────────────────────────────────────────────────────

let running = 0;
const waiting: Array<() => void> = [];
const CONCURRENCY = 2;

async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= CONCURRENCY) await new Promise<void>((r) => waiting.push(r));
  running++;
  try {
    return await fn();
  } finally {
    running--;
    waiting.shift()?.();
  }
}

/** Resolves when nothing is being processed (tests). */
export async function idle(): Promise<void> {
  while (running > 0 || waiting.length > 0 || inflight.size > 0) await new Promise((r) => setTimeout(r, 20));
}
const inflight = new Set<Promise<unknown>>();
function background(p: Promise<unknown>): void {
  inflight.add(p);
  void p.finally(() => inflight.delete(p));
}

// ── upload entry point ───────────────────────────────────────────────────────

export interface Upload {
  /** Temporary file; moved into the item folder. */
  path: string;
  originalName: string;
  mime: string;
  size: number;
}

/**
 * Add an uploaded file to a case. Returns the item it went into (a new item,
 * or an existing slice stack from the same series). Processing continues in
 * the background.
 */
export function ingest(caseId: number, up: Upload, overrides: { category?: Category; title?: string } = {}): CaseItem {
  const head = readHead(up.path, 132);
  const kind = classify(up.originalName, up.mime, head);

  if (kind === 'dicom') {
    const buf = fs.readFileSync(up.path);
    if (!isDicom(buf)) {
      // A .dcm without the DICM preamble: keep it, can't preview.
      return storeOther(caseId, up, 'dicom', 'File isn’t a standard DICOM (Part 10) file');
    }
    const parsed = parseDicom(buf);
    const m = parsed.meta;
    if (stacksBySeries(m) && !m.unsupported) {
      // Slices of one CT/MR series share an item and become a scrollable stack.
      let item = store.findSeriesItem(caseId, m.seriesUid!);
      if (item) item = store.mutateItem(item.id, (it) => ({ pending: it.pending + 1, status: 'processing' }))!;
      else {
        item = store.addItem(caseId, {
          kind: 'dicom',
          category: overrides.category ?? guessCategory('dicom', up.originalName, m),
          title: overrides.title ?? dicomTitle(m),
          series_uid: m.seriesUid!,
          taken_at: m.seriesDate ?? m.studyDate ?? null,
          mime: 'application/dicom',
          pending: 1,
        });
      }
      const dest = moveOriginal(item, up);
      background(slot(() => addSlice(item!.id, dest, m)));
      return item;
    }
    const item = store.addItem(caseId, {
      kind: m.documentMime ? 'document' : 'dicom',
      category: overrides.category ?? guessCategory('dicom', up.originalName, m),
      title: overrides.title ?? (m.documentMime && m.modality !== 'DOC' ? `${dicomTitle(m)} (document)` : dicomTitle(m)),
      original_name: up.originalName,
      mime: 'application/dicom',
      size_bytes: up.size,
      series_uid: m.seriesUid ?? null,
      taken_at: m.seriesDate ?? m.studyDate ?? null,
    });
    const dest = moveOriginal(item, up);
    background(slot(() => processDicom(item.id, dest)));
    return item;
  }

  const item = store.addItem(caseId, {
    kind,
    category: overrides.category ?? guessCategory(kind, up.originalName),
    title: overrides.title ?? path.basename(up.originalName).replace(/\.[^.]+$/, ''),
    original_name: up.originalName,
    mime: up.mime,
    size_bytes: up.size,
  });
  const dest = moveOriginal(item, up);
  background(slot(() => processFile(item.id, dest)));
  return item;
}

function storeOther(caseId: number, up: Upload, kind: ItemKind, error: string): CaseItem {
  const item = store.addItem(caseId, {
    kind,
    category: 'other',
    title: path.basename(up.originalName),
    original_name: up.originalName,
    mime: up.mime,
    size_bytes: up.size,
    pending: 0,
  });
  moveOriginal(item, up);
  store.updateItem(item.id, { status: 'ready', error });
  return store.getItem(item.id)!;
}

function moveOriginal(item: CaseItem, up: Upload): string {
  const dir = store.itemPath(item, 'original');
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, `${Date.now().toString(36)}${randomBytes(3).toString('hex')}-${safeName(up.originalName)}`);
  try {
    fs.renameSync(up.path, dest);
  } catch {
    fs.copyFileSync(up.path, dest);
    fs.rmSync(up.path, { force: true });
  }
  const rel = path.relative(store.itemDir(item.case_id, item.id), dest);
  store.mutateItem(item.id, (it) => ({ meta: { ...it.meta, originals: [...(it.meta.originals ?? []), rel] } }));
  return dest;
}

async function writeThumb(item: CaseItem, source: Buffer | string): Promise<void> {
  await sharp(source, { animated: false })
    .rotate()
    .resize({ width: THUMB, height: THUMB, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toFile(store.itemPath(item, 'thumb.jpg'));
}

function fail(id: number, e: unknown): void {
  store.mutateItem(id, (it) => ({ status: 'failed', pending: Math.max(0, it.pending - 1), error: (e as Error).message || 'Processing failed' }));
}

// ── DICOM ────────────────────────────────────────────────────────────────────

async function processDicom(id: number, file: string): Promise<void> {
  const item = store.getItem(id);
  if (!item) return;
  try {
    const parsed = parseDicom(fs.readFileSync(file));
    const m = parsed.meta;
    const doc = encapsulatedDocument(parsed);
    if (doc) {
      const name = doc.mime === 'application/pdf' ? 'display.pdf' : 'display.bin';
      fs.writeFileSync(store.itemPath(item, name), doc.bytes);
      store.mutateItem(id, (it) => ({
        meta: { ...it.meta, dicom: m, display: name, displayMime: doc.mime },
        status: 'ready',
        pending: 0,
      }));
      return;
    }
    if (m.unsupported || m.frames === 0) {
      store.mutateItem(id, (it) => ({
        meta: { ...it.meta, dicom: m },
        status: 'ready',
        pending: 0,
        error: m.unsupported ?? 'No image in this DICOM file',
      }));
      return;
    }
    const count = Math.min(m.frames, MAX_FRAMES);
    const dir = store.itemPath(item, 'frames');
    fs.mkdirSync(dir, { recursive: true });
    const win = fileWindow(parsed);
    const frameFiles: store.FrameRef[] = [];
    for (let i = 0; i < count; i++) {
      const name = `frames/${String(i).padStart(5, '0')}.jpg`;
      fs.writeFileSync(store.itemPath(item, name), await frameJpeg(parsed, i, win));
      frameFiles.push({ file: name, key: i });
    }
    // Cine: thumbnail from a third of the way in (usually mid-cycle); stills: the frame.
    await writeThumb(item, store.itemPath(item, frameFiles[Math.floor(count / 3)].file));
    const first = await sharp(store.itemPath(item, frameFiles[0].file)).metadata();
    store.mutateItem(id, (it) => ({
      meta: { ...it.meta, dicom: m, frameFiles, fps: m.fps ?? (count > 1 ? 30 : undefined), hasThumb: true, width: first.width, height: first.height },
      frames: count,
      status: 'ready',
      pending: 0,
      error: m.frames > MAX_FRAMES ? `Showing the first ${MAX_FRAMES} of ${m.frames} frames` : null,
    }));
  } catch (e) {
    fail(id, e);
  }
}

async function addSlice(id: number, file: string, m: DicomMeta): Promise<void> {
  const item = store.getItem(id);
  if (!item) return;
  try {
    const parsed = parseDicom(fs.readFileSync(file));
    const jpg = await frameJpeg(parsed, 0, fileWindow(parsed));
    const name = `frames/${randomBytes(6).toString('hex')}.jpg`;
    fs.mkdirSync(store.itemPath(item, 'frames'), { recursive: true });
    fs.writeFileSync(store.itemPath(item, name), jpg);
    const done = store.mutateItem(id, (it) => {
      const frameFiles = [...(it.meta.frameFiles ?? []), { file: name, key: sliceKey(m) }].sort((a, b) => a.key - b.key);
      const pending = Math.max(0, it.pending - 1);
      return {
        meta: { ...it.meta, dicom: it.meta.dicom ?? m, frameFiles },
        frames: frameFiles.length,
        size_bytes: it.size_bytes + fs.statSync(file).size,
        pending,
        status: pending ? 'processing' : 'ready',
      };
    });
    if (done && done.pending === 0) {
      const files = done.meta.frameFiles ?? [];
      const mid = files[Math.floor(files.length / 2)];
      if (mid) {
        await writeThumb(done, store.itemPath(done, mid.file));
        const meta = await sharp(store.itemPath(done, mid.file)).metadata();
        store.mutateItem(id, (it) => ({ meta: { ...it.meta, hasThumb: true, width: meta.width, height: meta.height } }));
      }
    }
  } catch (e) {
    fail(id, e);
  }
}

// ── everything else ──────────────────────────────────────────────────────────

/** Split one CSV/TSV line, honouring quotes. */
export function splitDelimited(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === sep) {
      out.push(cur.trim());
      cur = '';
    } else cur += c;
  }
  out.push(cur.trim());
  return out;
}

export function previewTable(text: string, sep: string, limit = 200): { columns: string[]; rows: string[][]; total: number } {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  const [head, ...rest] = lines;
  return { columns: head ? splitDelimited(head, sep) : [], rows: rest.slice(0, limit).map((l) => splitDelimited(l, sep)), total: rest.length };
}

async function processFile(id: number, file: string): Promise<void> {
  const item = store.getItem(id);
  if (!item) return;
  const e = ext(item.original_name ?? file);
  try {
    if (item.kind === 'image') {
      const src = sharp(file, { animated: e === 'gif' || e === 'webp' });
      const info = await src.metadata();
      let display: string;
      let displayMime: string;
      if ((e === 'gif' || e === 'webp') && (info.pages ?? 1) > 1) {
        // Animations stay as they are; browsers play them.
        display = `display.${e}`;
        displayMime = `image/${e}`;
        fs.copyFileSync(file, store.itemPath(item, display));
      } else {
        // Re-encode: browser-safe format, upright, and no EXIF (location etc.).
        display = info.hasAlpha ? 'display.png' : 'display.jpg';
        displayMime = info.hasAlpha ? 'image/png' : 'image/jpeg';
        const img = sharp(file).rotate().resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true });
        await (info.hasAlpha ? img.png() : img.jpeg({ quality: 90 })).toFile(store.itemPath(item, display));
      }
      await writeThumb(item, file);
      const size = await sharp(store.itemPath(item, display)).metadata();
      store.mutateItem(id, (it) => ({
        meta: { ...it.meta, display, displayMime, hasThumb: true, width: size.width, height: size.pageHeight ?? size.height },
        status: 'ready',
        pending: 0,
      }));
    } else if (item.kind === 'video') {
      store.mutateItem(id, (it) => ({
        meta: { ...it.meta, display: it.meta.originals?.[0], displayMime: item.mime || `video/${e}`, playable: PLAYABLE_VIDEO.has(e) },
        status: 'ready',
        pending: 0,
        error: PLAYABLE_VIDEO.has(e) ? null : `.${e} video can’t play in a browser; convert it to MP4 to show it`,
      }));
    } else if (item.kind === 'document') {
      const showable = SHOWABLE_DOC.has(e) || item.mime === 'application/pdf';
      store.mutateItem(id, (it) => ({
        meta: {
          ...it.meta,
          display: showable ? it.meta.originals?.[0] : undefined,
          displayMime: e === 'pdf' || item.mime === 'application/pdf' ? 'application/pdf' : 'text/plain',
        },
        status: 'ready',
        pending: 0,
        error: showable ? null : `.${e} files can be downloaded but not shown here; export to PDF to show it`,
      }));
    } else if (item.kind === 'data' && (e === 'csv' || e === 'tsv' || e === 'txt')) {
      const text = fs.readFileSync(file, 'utf8');
      store.mutateItem(id, (it) => ({ meta: { ...it.meta, table: previewTable(text, e === 'tsv' ? '\t' : ',') }, status: 'ready', pending: 0 }));
    } else {
      store.mutateItem(id, () => ({ status: 'ready', pending: 0 }));
    }
  } catch (err) {
    fail(id, err);
  }
}

/** A browser-made poster frame for a video (the server has no video decoder). */
export async function setThumb(item: CaseItem, bytes: Buffer): Promise<void> {
  await writeThumb(item, bytes);
  const m = await sharp(bytes).metadata();
  store.mutateItem(item.id, (it) => ({ meta: { ...it.meta, hasThumb: true, width: it.meta.width ?? m.width, height: it.meta.height ?? m.height } }));
}
