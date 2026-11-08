// Reading DICOM files for case presentations: clinical metadata only (no
// patient identifiers), every frame of a cine loop or slice as a JPEG, and
// documents embedded in DICOM (encapsulated PDF).

import * as dicomParser from 'dicom-parser';
import sharp from 'sharp';

export function isDicom(buf: Buffer): boolean {
  return buf.length > 132 && buf.toString('latin1', 128, 132) === 'DICM';
}

/**
 * The metadata kept for a DICOM object. Deliberately excludes names, IDs,
 * birth date, accession number, institution and physicians.
 */
export interface DicomMeta {
  modality?: string;
  sopClass?: string;
  transferSyntax?: string;
  studyDate?: string;
  seriesDate?: string;
  studyDescription?: string;
  seriesDescription?: string;
  protocol?: string;
  bodyPart?: string;
  viewPosition?: string;
  laterality?: string;
  imageType?: string;
  patientAge?: string;
  patientSex?: string;
  patientHeightM?: number;
  patientWeightKg?: number;
  manufacturer?: string;
  model?: string;
  studyUid?: string;
  seriesUid?: string;
  instanceNumber?: number;
  sliceLocation?: number;
  positionZ?: number;
  rows?: number;
  columns?: number;
  frames: number;
  fps?: number;
  heartRate?: number;
  pixelSpacing?: string;
  sliceThickness?: number;
  photometric?: string;
  burnedInAnnotation?: boolean;
  /** Present when the DICOM wraps a document (e.g. a PDF report). */
  documentMime?: string;
  /** Set when frames can't be decoded here, with the reason. */
  unsupported?: string;
}

const TS = {
  implicitLE: '1.2.840.10008.1.2',
  explicitLE: '1.2.840.10008.1.2.1',
  explicitBE: '1.2.840.10008.1.2.2',
  jpegBaseline: '1.2.840.10008.1.2.4.50',
  jpegExtended: '1.2.840.10008.1.2.4.51',
  rle: '1.2.840.10008.1.2.5',
};
const TS_NAMES: Record<string, string> = {
  '1.2.840.10008.1.2.4.57': 'JPEG Lossless',
  '1.2.840.10008.1.2.4.70': 'JPEG Lossless',
  '1.2.840.10008.1.2.4.80': 'JPEG-LS',
  '1.2.840.10008.1.2.4.81': 'JPEG-LS',
  '1.2.840.10008.1.2.4.90': 'JPEG 2000',
  '1.2.840.10008.1.2.4.91': 'JPEG 2000',
  '1.2.840.10008.1.2.4.100': 'MPEG-2',
  '1.2.840.10008.1.2.4.102': 'MPEG-4',
  '1.2.840.10008.1.2.4.103': 'MPEG-4',
  '1.2.840.10008.1.2.4.201': 'HTJ2K',
  '1.2.840.10008.1.2.4.202': 'HTJ2K',
  '1.2.840.10008.1.2.4.203': 'HTJ2K',
  '1.2.840.10008.1.2.1.99': 'Deflate',
};

/** DICOM DA "20240131" → "2024-01-31". */
function isoDate(da?: string): string | undefined {
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(da?.trim() ?? '');
  return m ? `${m[1]}-${m[2]}-${m[3]}` : undefined;
}

function clean(s?: string): string | undefined {
  const t = s?.replace(/\0/g, '').trim();
  return t ? t : undefined;
}

export interface ParsedDicom {
  meta: DicomMeta;
  ds: dicomParser.DataSet;
  buf: Buffer;
}

export function parseDicom(buf: Buffer): ParsedDicom {
  const ds = dicomParser.parseDicom(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
  const s = (t: string) => clean(ds.string(t));
  const n = (t: string) => {
    const v = ds.floatString(t);
    return v != null && Number.isFinite(v) ? v : undefined;
  };
  const u = (t: string) => ds.uint16(t);
  const frames = ds.intString('x00280008') ?? (ds.elements.x7fe00010 ? 1 : 0);
  const frameTime = n('x00181063');
  const fps = n('x00180040') ?? n('x00082144') ?? (frameTime ? 1000 / frameTime : undefined);
  const pos = ds.string('x00200032')?.split('\\').map(Number);
  const meta: DicomMeta = {
    modality: s('x00080060'),
    sopClass: s('x00080016'),
    transferSyntax: s('x00020010'),
    studyDate: isoDate(s('x00080020')),
    seriesDate: isoDate(s('x00080021') ?? s('x00080022') ?? s('x00080023')),
    studyDescription: s('x00081030'),
    seriesDescription: s('x0008103e'),
    protocol: s('x00181030'),
    bodyPart: s('x00180015'),
    viewPosition: s('x00185101'),
    laterality: s('x00200060') ?? s('x00200062'),
    imageType: s('x00080008'),
    patientAge: s('x00101010'),
    patientSex: s('x00100040'),
    patientHeightM: n('x00101020'),
    patientWeightKg: n('x00101030'),
    manufacturer: s('x00080070'),
    model: s('x00081090'),
    studyUid: s('x0020000d'),
    seriesUid: s('x0020000e'),
    instanceNumber: ds.intString('x00200013'),
    sliceLocation: n('x00201041'),
    positionZ: pos && pos.length === 3 && Number.isFinite(pos[2]) ? pos[2] : undefined,
    rows: u('x00280010'),
    columns: u('x00280011'),
    frames: frames > 0 ? frames : 0,
    fps: fps && fps > 0 && fps < 1000 ? Math.round(fps * 100) / 100 : undefined,
    heartRate: n('x00181088'),
    pixelSpacing: s('x00280030'),
    sliceThickness: n('x00180050'),
    photometric: s('x00280004'),
    burnedInAnnotation: s('x00280301')?.toUpperCase() === 'YES' || undefined,
    documentMime: s('x00420012'),
  };
  if (meta.frames > 0) {
    const reason = unsupportedReason(ds, meta);
    if (reason) meta.unsupported = reason;
  }
  return { meta, ds, buf };
}

function unsupportedReason(ds: dicomParser.DataSet, m: DicomMeta): string | undefined {
  const ts = m.transferSyntax ?? TS.explicitLE;
  if (TS_NAMES[ts] && ts !== TS.rle) return `${TS_NAMES[ts]} compression can’t be previewed yet`;
  if (m.photometric === 'PALETTE COLOR') return 'Palette-colour images can’t be previewed yet';
  if (ts === TS.explicitBE) return 'Big-endian DICOM can’t be previewed';
  const bits = ds.uint16('x00280100') ?? 8;
  if (bits !== 8 && bits !== 16) return `${bits}-bit pixels can’t be previewed`;
  if (!m.rows || !m.columns) return 'The image has no size';
  return undefined;
}

/** The document a DICOM wraps (Encapsulated PDF etc.), if any. */
export function encapsulatedDocument(p: ParsedDicom): { mime: string; bytes: Buffer } | null {
  const el = p.ds.elements.x00420011;
  if (!el || !el.length) return null;
  let bytes = p.buf.subarray(el.dataOffset, el.dataOffset + el.length);
  // Encapsulated documents are padded to even length with a trailing NUL.
  if (bytes.length && bytes[bytes.length - 1] === 0) bytes = bytes.subarray(0, bytes.length - 1);
  return { mime: p.meta.documentMime || 'application/pdf', bytes: Buffer.from(bytes) };
}

// ── frames ───────────────────────────────────────────────────────────────────

/** Decode DICOM RLE (PackBits per byte plane) into raw interleaved pixels. */
export function decodeRle(frame: Uint8Array, rows: number, cols: number, spp: number, bytesPerSample: number): Buffer {
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
  const segments = view.getUint32(0, true);
  const pixels = rows * cols;
  const out = Buffer.alloc(pixels * spp * bytesPerSample);
  for (let seg = 0; seg < segments; seg++) {
    const start = view.getUint32(4 + seg * 4, true);
    const end = seg + 1 < segments ? view.getUint32(8 + seg * 4, true) : frame.length;
    // Segment order: for each sample, most significant byte first.
    const sample = Math.floor(seg / bytesPerSample);
    const byteInSample = bytesPerSample - 1 - (seg % bytesPerSample);
    let p = start;
    let i = 0;
    const put = (b: number) => {
      if (i < pixels) out[(i * spp + sample) * bytesPerSample + byteInSample] = b;
      i++;
    };
    while (p < end && i < pixels) {
      const h = (frame[p++] << 24) >> 24;
      if (h >= 0) for (let k = 0; k <= h && p < end; k++) put(frame[p++]);
      else if (h > -128) {
        const b = frame[p++];
        for (let k = 0; k < 1 - h; k++) put(b);
      }
    }
  }
  return out;
}

function ybrToRgb(px: Buffer): Buffer {
  const out = Buffer.alloc(px.length);
  for (let i = 0; i < px.length; i += 3) {
    const y = px[i];
    const cb = px[i + 1] - 128;
    const cr = px[i + 2] - 128;
    out[i] = Math.max(0, Math.min(255, Math.round(y + 1.402 * cr)));
    out[i + 1] = Math.max(0, Math.min(255, Math.round(y - 0.344136 * cb - 0.714136 * cr)));
    out[i + 2] = Math.max(0, Math.min(255, Math.round(y + 1.772 * cb)));
  }
  return out;
}

export interface Windowing {
  center: number;
  width: number;
}

/** Window centre/width from the file, if it has one. */
export function fileWindow(p: ParsedDicom): Windowing | undefined {
  const c = p.ds.floatString('x00281050');
  const w = p.ds.floatString('x00281051');
  return c != null && w != null && w > 0 ? { center: c, width: w } : undefined;
}

/** Raw (uncompressed) samples of one frame. */
function rawFrame(p: ParsedDicom, index: number): Buffer {
  const { ds, meta, buf } = p;
  const el = ds.elements.x7fe00010;
  const spp = ds.uint16('x00280002') ?? 1;
  const bpp = (ds.uint16('x00280100') ?? 8) / 8;
  const rows = meta.rows!;
  const cols = meta.columns!;
  if (el.encapsulatedPixelData) {
    // RLE: with a basic offset table use it; otherwise one fragment per frame
    // (or every fragment for a single frame).
    const frags = el.fragments ?? [];
    const bytes = el.basicOffsetTable?.length
      ? dicomParser.readEncapsulatedImageFrame(ds, el, index)
      : meta.frames === 1
        ? dicomParser.readEncapsulatedPixelDataFromFragments(ds, el, 0, frags.length)
        : dicomParser.readEncapsulatedPixelDataFromFragments(ds, el, index, 1);
    return decodeRle(bytes as Uint8Array, rows, cols, spp, bpp);
  }
  const size = rows * cols * spp * bpp;
  const start = el.dataOffset + index * size;
  if (start + size > buf.length) throw new Error('Frame data is truncated');
  let px = Buffer.from(buf.subarray(start, start + size));
  const planar = ds.uint16('x00280006') === 1;
  if (spp === 3 && planar) {
    const n = rows * cols;
    const inter = Buffer.alloc(px.length);
    for (let i = 0; i < n; i++) {
      inter[i * 3] = px[i];
      inter[i * 3 + 1] = px[n + i];
      inter[i * 3 + 2] = px[2 * n + i];
    }
    px = inter;
  }
  return px;
}

/** Convert one frame's samples to 8-bit greyscale or RGB. */
function toDisplay(p: ParsedDicom, px: Buffer, win?: Windowing): { data: Buffer; channels: 1 | 3 } {
  const { ds, meta } = p;
  const spp = ds.uint16('x00280002') ?? 1;
  const bits = ds.uint16('x00280100') ?? 8;
  const photometric = meta.photometric ?? (spp === 3 ? 'RGB' : 'MONOCHROME2');
  if (spp === 3) {
    if (bits !== 8) throw new Error('16-bit colour isn’t supported');
    return { data: photometric.startsWith('YBR_FULL') ? ybrToRgb(px) : px, channels: 3 };
  }
  const n = (meta.rows ?? 0) * (meta.columns ?? 0);
  const signed = ds.uint16('x00280103') === 1;
  const slope = ds.floatString('x00281053') ?? 1;
  const intercept = ds.floatString('x00281052') ?? 0;
  const values = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const raw = bits === 16 ? (signed ? px.readInt16LE(i * 2) : px.readUInt16LE(i * 2)) : signed ? (px[i] << 24) >> 24 : px[i];
    values[i] = raw * slope + intercept;
  }
  let lo: number;
  let hi: number;
  if (win) {
    lo = win.center - win.width / 2;
    hi = win.center + win.width / 2;
  } else if (bits === 8 && slope === 1 && intercept === 0) {
    lo = 0;
    hi = 255;
  } else {
    lo = Infinity;
    hi = -Infinity;
    for (let i = 0; i < n; i++) {
      if (values[i] < lo) lo = values[i];
      if (values[i] > hi) hi = values[i];
    }
  }
  const range = hi - lo || 1;
  const out = Buffer.alloc(n);
  const invert = photometric === 'MONOCHROME1';
  for (let i = 0; i < n; i++) {
    const v = Math.max(0, Math.min(255, Math.round(((values[i] - lo) / range) * 255)));
    out[i] = invert ? 255 - v : v;
  }
  return { data: out, channels: 1 };
}

const MAX_SIDE = 1280;

/** One frame as a browser-ready JPEG (longest side ≤ 1280 px). */
export async function frameJpeg(p: ParsedDicom, index: number, win?: Windowing): Promise<Buffer> {
  const { ds, meta } = p;
  if (meta.unsupported) throw new Error(meta.unsupported);
  const el = ds.elements.x7fe00010;
  if (!el) throw new Error('No image data');
  const ts = meta.transferSyntax ?? TS.explicitLE;
  let img: sharp.Sharp;
  if (el.encapsulatedPixelData && (ts === TS.jpegBaseline || ts === TS.jpegExtended)) {
    const bytes = dicomParser.readEncapsulatedImageFrame(
      ds,
      el,
      index,
      el.basicOffsetTable?.length ? undefined : dicomParser.createJPEGBasicOffsetTable(ds, el),
    );
    img = sharp(Buffer.from(bytes as Uint8Array));
  } else {
    const { data, channels } = toDisplay(p, rawFrame(p, index), win);
    img = sharp(data, { raw: { width: meta.columns!, height: meta.rows!, channels } });
  }
  return img
    .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer();
}

/** How to order slices in a stack: position along the patient axis, then instance number. */
export function sliceKey(m: DicomMeta): number {
  if (m.positionZ != null) return m.positionZ;
  if (m.sliceLocation != null) return m.sliceLocation;
  return m.instanceNumber ?? 0;
}

/** Cross-sectional series whose single-frame files belong together as one scrollable stack. */
export function stacksBySeries(m: DicomMeta): boolean {
  return m.frames === 1 && !!m.seriesUid && ['CT', 'MR', 'PT', 'NM'].includes(m.modality ?? '');
}

/** A short human label: "Echo · A4C", "CT · Chest w/ contrast". */
export function dicomTitle(m: DicomMeta): string {
  const modality: Record<string, string> = {
    US: 'Ultrasound', CT: 'CT', MR: 'MRI', XA: 'Angiography', CR: 'X-ray', DX: 'X-ray', MG: 'Mammogram',
    NM: 'Nuclear medicine', PT: 'PET', ECG: 'ECG', OT: 'Image', SR: 'Structured report', DOC: 'Report', RF: 'Fluoroscopy',
  };
  const kind = modality[m.modality ?? ''] ?? m.modality ?? 'DICOM';
  const what = m.seriesDescription || m.studyDescription || m.protocol || m.bodyPart || m.viewPosition;
  return what ? `${kind} · ${what}` : kind;
}
