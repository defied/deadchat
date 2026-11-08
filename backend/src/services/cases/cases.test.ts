// Medical cases: DICOM reading (cine, JPEG, RLE, slice stacks, embedded PDF,
// identifier stripping) and ingest of every evidence type. Uses synthetic
// DICOM files written here and a temp DB.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import sharp from 'sharp';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'deadchat-cases-'));
process.env.DB_PATH = path.join(tmp, 'test.db');
process.env.MEDIA_DIR = path.join(tmp, 'media');

/* eslint-disable @typescript-eslint/no-require-imports */
const { runMigrations } = require('../../db/migrate') as typeof import('../../db/migrate');
const dicom = require('./dicom') as typeof import('./dicom');
const store = require('./store') as typeof import('./store');
const ingest = require('./ingest') as typeof import('./ingest');
const { cleanProfile } = require('../../routes/cases') as typeof import('../../routes/cases');
const { oneLiner } = require('./ai') as typeof import('./ai');
/* eslint-enable @typescript-eslint/no-require-imports */

before(() => runMigrations());

// ── a tiny DICOM writer (explicit VR little endian) ──

type Val = string | number | number[] | Buffer;
interface El {
  tag: number; // 0xGGGGEEEE
  vr: string;
  value: Val;
}
const LONG_VR = new Set(['OB', 'OW', 'SQ', 'UN', 'UT']);

function encodeValue(vr: string, v: Val): Buffer {
  if (Buffer.isBuffer(v)) return v.length % 2 ? Buffer.concat([v, Buffer.from([0])]) : v;
  if (vr === 'US') {
    const b = Buffer.alloc(2);
    b.writeUInt16LE(v as number);
    return b;
  }
  if (vr === 'UL') {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(v as number);
    return b;
  }
  let s = Array.isArray(v) ? v.join('\\') : String(v);
  if (s.length % 2) s += vr === 'UI' ? '\0' : ' ';
  return Buffer.from(s, 'latin1');
}

function element(e: El): Buffer {
  const head = Buffer.alloc(LONG_VR.has(e.vr) ? 12 : 8);
  head.writeUInt16LE(e.tag >>> 16, 0);
  head.writeUInt16LE(e.tag & 0xffff, 2);
  head.write(e.vr, 4, 'latin1');
  const body = encodeValue(e.vr, e.value);
  if (LONG_VR.has(e.vr)) head.writeUInt32LE(body.length, 8);
  else head.writeUInt16LE(body.length, 6);
  return Buffer.concat([head, body]);
}

function encapsulated(fragments: Buffer[]): Buffer {
  const head = Buffer.alloc(12);
  head.writeUInt16LE(0x7fe0, 0);
  head.writeUInt16LE(0x0010, 2);
  head.write('OB', 4, 'latin1');
  head.writeUInt32LE(0xffffffff, 8);
  const item = (b: Buffer) => {
    const h = Buffer.alloc(8);
    h.writeUInt16LE(0xfffe, 0);
    h.writeUInt16LE(0xe000, 2);
    const body = b.length % 2 ? Buffer.concat([b, Buffer.from([0])]) : b;
    h.writeUInt32LE(body.length, 4);
    return Buffer.concat([h, body]);
  };
  const end = Buffer.alloc(8);
  end.writeUInt16LE(0xfffe, 0);
  end.writeUInt16LE(0xe0dd, 2);
  return Buffer.concat([head, item(Buffer.alloc(0)), ...fragments.map(item), end]);
}

function writeDicom(ts: string, els: El[], pixel?: Buffer | Buffer[]): Buffer {
  const meta = [element({ tag: 0x00020010, vr: 'UI', value: ts })];
  const metaLen = meta.reduce((a, b) => a + b.length, 0);
  const groupLen = element({ tag: 0x00020000, vr: 'UL', value: metaLen });
  const body = els.sort((a, b) => a.tag - b.tag).map(element);
  const px = pixel === undefined ? [] : Array.isArray(pixel) ? [encapsulated(pixel)] : [element({ tag: 0x7fe00010, vr: 'OW', value: pixel })];
  return Buffer.concat([Buffer.alloc(128), Buffer.from('DICM'), groupLen, ...meta, ...body, ...px]);
}

const PHI: El[] = [
  { tag: 0x00100010, vr: 'PN', value: 'DOE^JANE' },
  { tag: 0x00100020, vr: 'LO', value: 'MRN123456' },
  { tag: 0x00100030, vr: 'DA', value: '20190314' },
  { tag: 0x00080080, vr: 'LO', value: 'St Example Childrens' },
];

function image(rows: number, cols: number, spp: number, bits: number, photometric: string, frames = 1): El[] {
  return [
    { tag: 0x00280002, vr: 'US', value: spp },
    { tag: 0x00280004, vr: 'CS', value: photometric },
    { tag: 0x00280008, vr: 'IS', value: frames },
    { tag: 0x00280010, vr: 'US', value: rows },
    { tag: 0x00280011, vr: 'US', value: cols },
    { tag: 0x00280100, vr: 'US', value: bits },
    { tag: 0x00280101, vr: 'US', value: bits },
    { tag: 0x00280102, vr: 'US', value: bits - 1 },
    { tag: 0x00280103, vr: 'US', value: 0 },
    ...(spp === 3 ? [{ tag: 0x00280006, vr: 'US', value: 0 } as El] : []),
  ];
}

const EXPLICIT = '1.2.840.10008.1.2.1';
const JPEG = '1.2.840.10008.1.2.4.50';
const RLE = '1.2.840.10008.1.2.5';

function echoCine(): Buffer {
  const rows = 48;
  const cols = 64;
  const frames = 5;
  const px = Buffer.alloc(rows * cols * frames);
  for (let f = 0; f < frames; f++) for (let i = 0; i < rows * cols; i++) px[f * rows * cols + i] = (f * 50 + (i % cols)) % 256;
  return writeDicom(
    EXPLICIT,
    [
      ...PHI,
      { tag: 0x00080060, vr: 'CS', value: 'US' },
      { tag: 0x00080020, vr: 'DA', value: '20261101' },
      { tag: 0x0008103e, vr: 'LO', value: 'A4C' },
      { tag: 0x00101010, vr: 'AS', value: '006Y' },
      { tag: 0x00100040, vr: 'CS', value: 'F' },
      { tag: 0x0020000e, vr: 'UI', value: '1.2.3.4.5' },
      { tag: 0x00180040, vr: 'IS', value: 50 },
      { tag: 0x00181088, vr: 'IS', value: 112 },
      { tag: 0x00280301, vr: 'CS', value: 'YES' },
      ...image(rows, cols, 1, 8, 'MONOCHROME2', frames),
    ],
    px,
  );
}

async function upload(caseId: number, name: string, bytes: Buffer, mime = 'application/octet-stream') {
  const f = path.join(tmp, `up-${Math.random().toString(36).slice(2)}`);
  fs.writeFileSync(f, bytes);
  return ingest.ingest(caseId, { path: f, originalName: name, mime, size: bytes.length });
}

// ── DICOM reading ──

test('metadata keeps clinical fields and drops patient identifiers', () => {
  const p = dicom.parseDicom(echoCine());
  const m = p.meta;
  assert.deepEqual(
    [m.modality, m.seriesDescription, m.studyDate, m.patientAge, m.patientSex, m.frames, m.fps, m.heartRate, m.burnedInAnnotation],
    ['US', 'A4C', '2026-11-01', '006Y', 'F', 5, 50, 112, true],
  );
  const json = JSON.stringify(m);
  for (const phi of ['DOE', 'MRN123456', '20190314', 'St Example']) assert.ok(!json.includes(phi), `leaked ${phi}`);
  assert.equal(dicom.dicomTitle(m), 'Ultrasound · A4C');
});

test('uncompressed frames decode to JPEG; MONOCHROME1 is inverted; windowing applies', async () => {
  const p = dicom.parseDicom(echoCine());
  const jpg = await dicom.frameJpeg(p, 2);
  const meta = await sharp(jpg).metadata();
  assert.deepEqual([meta.format, meta.width, meta.height], ['jpeg', 64, 48]);

  const mono1 = dicom.parseDicom(writeDicom(EXPLICIT, image(4, 4, 1, 8, 'MONOCHROME1'), Buffer.alloc(16, 0)));
  const raw = await sharp(await dicom.frameJpeg(mono1, 0)).raw().toBuffer();
  assert.ok(raw[0] > 240, 'black in MONOCHROME1 shows as white');

  // 16-bit CT: HU = raw - 1024, window 40/400 maps 40 HU to mid-grey.
  const ct = writeDicom(
    EXPLICIT,
    [...image(2, 2, 1, 16, 'MONOCHROME2'), { tag: 0x00281052, vr: 'DS', value: -1024 }, { tag: 0x00281053, vr: 'DS', value: 1 }, { tag: 0x00281050, vr: 'DS', value: 40 }, { tag: 0x00281051, vr: 'DS', value: 400 }],
    Buffer.from(new Uint16Array([1064, 1064, 1064, 1064]).buffer),
  );
  const cp = dicom.parseDicom(ct);
  const g = await sharp(await dicom.frameJpeg(cp, 0, dicom.fileWindow(cp))).raw().toBuffer();
  assert.ok(Math.abs(g[0] - 128) < 6, `40 HU at window 40/400 is mid-grey, got ${g[0]}`);
});

test('JPEG-compressed colour cine frames decode', async () => {
  const colours = [[255, 0, 0], [0, 255, 0], [0, 0, 255]];
  const frags = await Promise.all(colours.map(([r, g, b]) => sharp({ create: { width: 32, height: 24, channels: 3, background: { r, g, b } } }).jpeg().toBuffer()));
  const buf = writeDicom(JPEG, [{ tag: 0x00080060, vr: 'CS', value: 'US' }, ...image(24, 32, 3, 8, 'YBR_FULL_422', 3)], frags);
  const p = dicom.parseDicom(buf);
  assert.equal(p.meta.unsupported, undefined);
  const px = await sharp(await dicom.frameJpeg(p, 1)).raw().toBuffer();
  assert.ok(px[1] > 200 && px[0] < 60 && px[2] < 60, 'frame 2 is green');
});

test('RLE decodes, and unsupported compression is reported, not crashed on', async () => {
  // 1 row of 6 pixels: literal run "1 2 3", then 3 repeats of 9.
  const seg = Buffer.from([2, 1, 2, 3, 0xfe, 9]);
  const header = Buffer.alloc(64);
  header.writeUInt32LE(1, 0);
  header.writeUInt32LE(64, 4);
  const p = dicom.parseDicom(writeDicom(RLE, image(1, 6, 1, 8, 'MONOCHROME2'), [Buffer.concat([header, seg])]));
  assert.deepEqual([...dicom.decodeRle(Buffer.concat([header, seg]), 1, 6, 1, 1)], [1, 2, 3, 9, 9, 9]);
  const m = await sharp(await dicom.frameJpeg(p, 0)).metadata();
  assert.deepEqual([m.width, m.height], [6, 1]);

  const j2k = dicom.parseDicom(writeDicom('1.2.840.10008.1.2.4.90', image(8, 8, 1, 8, 'MONOCHROME2'), [Buffer.alloc(10)]));
  assert.match(j2k.meta.unsupported!, /JPEG 2000/);
});

// ── ingest ──

test('a cine loop becomes one item with every frame, a thumbnail and its frame rate', async () => {
  const c = store.createCase(1, 'Peds echo');
  const item = await upload(c.id, 'IM0001', echoCine());
  await ingest.idle();
  const it = store.getItem(item.id)!;
  assert.deepEqual([it.kind, it.category, it.status, it.frames, it.meta.fps, it.taken_at, it.title], ['dicom', 'cine', 'ready', 5, 50, '2026-11-01', 'Ultrasound · A4C']);
  assert.ok(fs.existsSync(store.itemPath(it, 'thumb.jpg')));
  assert.equal(it.meta.frameFiles!.length, 5);
  assert.ok(!JSON.stringify(it).includes('DOE'), 'no identifiers stored');
});

test('CT slices uploaded out of order stack into one item, ordered by position', async () => {
  const c = store.createCase(1, 'CT');
  const slice = (z: number, inst: number, value: number) =>
    writeDicom(
      EXPLICIT,
      [
        { tag: 0x00080060, vr: 'CS', value: 'CT' },
        { tag: 0x0008103e, vr: 'LO', value: 'Chest' },
        { tag: 0x0020000e, vr: 'UI', value: '9.9.9' },
        { tag: 0x00200013, vr: 'IS', value: inst },
        { tag: 0x00200032, vr: 'DS', value: [0, 0, z] },
        ...image(4, 4, 1, 8, 'MONOCHROME2'),
      ],
      Buffer.alloc(16, value),
    );
  const a = await upload(c.id, 's3.dcm', slice(30, 3, 200));
  const b = await upload(c.id, 's1.dcm', slice(10, 1, 20));
  const d = await upload(c.id, 's2.dcm', slice(20, 2, 110));
  assert.equal(a.id, b.id);
  assert.equal(a.id, d.id);
  await ingest.idle();
  const it = store.getItem(a.id)!;
  assert.deepEqual([it.frames, it.status, it.pending, it.title], [3, 'ready', 0, 'CT · Chest']);
  assert.deepEqual(it.meta.frameFiles!.map((f) => f.key), [10, 20, 30]);
  const first = await sharp(store.itemPath(it, it.meta.frameFiles![0].file)).raw().toBuffer();
  assert.ok(first[0] < 40, 'lowest slice first');
  assert.equal(store.listItems(c.id).length, 1);
});

test('a PDF inside a DICOM becomes a report document', async () => {
  const c = store.createCase(1, 'Doc');
  const pdf = Buffer.from('%PDF-1.4\n% fake report\n%%EOF');
  const buf = writeDicom(EXPLICIT, [
    { tag: 0x00080060, vr: 'CS', value: 'DOC' },
    { tag: 0x00081030, vr: 'LO', value: 'Echo report' },
    { tag: 0x00420012, vr: 'LO', value: 'application/pdf' },
    { tag: 0x00420011, vr: 'OB', value: pdf },
  ]);
  const item = await upload(c.id, 'report.dcm', buf);
  await ingest.idle();
  const it = store.getItem(item.id)!;
  assert.deepEqual([it.kind, it.category, it.meta.displayMime], ['document', 'reports', 'application/pdf']);
  assert.ok(fs.readFileSync(store.itemPath(it, it.meta.display!)).equals(pdf));
});

test('photos are re-encoded without metadata; video, PDF and CSV are classified and previewed', async () => {
  const c = store.createCase(1, 'Mixed');
  const png = await sharp({ create: { width: 40, height: 30, channels: 3, background: '#c33' } })
    .withMetadata({ exif: { IFD0: { Copyright: 'Clinic' } } })
    .jpeg()
    .toBuffer();
  const img = await upload(c.id, 'IMG_2041.jpg', png, 'image/jpeg');
  const vid = await upload(c.id, 'cath-run.mp4', Buffer.from('not really video'), 'video/mp4');
  const avi = await upload(c.id, 'old-echo.avi', Buffer.from('x'), 'video/x-msvideo');
  const pdf = await upload(c.id, 'discharge summary.pdf', Buffer.from('%PDF-1.4'), 'application/pdf');
  const csv = await upload(c.id, 'labs.csv', Buffer.from('date,test,value,unit\n2026-11-01,"BNP, plasma",1200,pg/mL\n2026-11-03,BNP,640,pg/mL\n'), 'text/csv');
  await ingest.idle();
  const i = store.getItem(img.id)!;
  assert.deepEqual([i.kind, i.category, i.meta.displayMime, i.meta.hasThumb], ['image', 'photos', 'image/jpeg', true]);
  assert.equal((await sharp(store.itemPath(i, i.meta.display!)).metadata()).exif, undefined, 'EXIF stripped from the display copy');
  assert.deepEqual([store.getItem(vid.id)!.category, store.getItem(vid.id)!.meta.playable], ['cine', true]);
  assert.match(store.getItem(avi.id)!.error!, /convert it to MP4/);
  assert.deepEqual([store.getItem(pdf.id)!.category, store.getItem(pdf.id)!.meta.displayMime], ['notes', 'application/pdf']);
  const t = store.getItem(csv.id)!;
  assert.equal(t.category, 'labs');
  assert.deepEqual(t.meta.table, { columns: ['date', 'test', 'value', 'unit'], rows: [['2026-11-01', 'BNP, plasma', '1200', 'pg/mL'], ['2026-11-03', 'BNP', '640', 'pg/mL']], total: 2 });
});

test('item paths cannot escape their folder; deleting a case removes its files', async () => {
  const c = store.createCase(1, 'Gone');
  const item = await upload(c.id, 'x.txt', Buffer.from('hello'), 'text/plain');
  await ingest.idle();
  assert.throws(() => store.itemPath(store.getItem(item.id)!, '../../other'), /Bad path/);
  store.deleteCase(c.id);
  assert.equal(fs.existsSync(store.caseDir(c.id)), false);
  assert.equal(store.getItem(item.id), null);
});

test('profiles are cleaned and summarised', () => {
  const p = cleanProfile({ age: '6 years', sex: 'Female', weightKg: 9999, chiefComplaint: 'Exercise intolerance', diagnoses: 'Tetralogy of Fallot\nPulmonary atresia', labs: [{ test: 'BNP', value: '1200', bogus: 1 }], junk: 'x' });
  assert.equal(p.weightKg, 500);
  assert.equal((p as Record<string, unknown>).junk, undefined);
  assert.equal(p.labs![0].test, 'BNP');
  assert.equal(oneLiner(p), '6 years Female patient, presenting with Exercise intolerance, known: Tetralogy of Fallot; Pulmonary atresia');
});

// ── AI notes and summary (local model mocked) ──

test('AI notes send sampled cine frames to the vision model; the summary uses only the case', async () => {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const ai = require('./ai') as typeof import('./ai');
  const { getActiveModel } = require('../chatModels') as typeof import('../chatModels');
  /* eslint-enable @typescript-eslint/no-require-imports */
  const model = getActiveModel();
  const sent: Array<{ system: string; user: string; images: number }> = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    if (u.endsWith('/api/tags')) return new Response(JSON.stringify({ models: [{ name: model, digest: 'd' }] }));
    if (u.endsWith('/api/show')) return new Response(JSON.stringify({ capabilities: ['completion', 'vision'], model_info: {} }));
    if (u.endsWith('/api/chat')) {
      const body = JSON.parse(String(init?.body));
      sent.push({ system: body.messages[0].content, user: body.messages[1].content, images: body.messages[1].images?.length ?? 0 });
      return new Response(JSON.stringify({ message: { content: 'Apical four-chamber view; RV appears dilated.' } }));
    }
    return new Response('{}', { status: 404 });
  }) as typeof fetch;
  try {
    const c = store.updateCase(store.createCase(1, 'AI').id, { profile: { age: '6 years', sex: 'F', chiefComplaint: 'fatigue', question: 'PVR now?' } });
    const item = await upload(c.id, 'IM0002', echoCine());
    await ingest.idle();
    await ai.describeItem(store.getItem(item.id)!, c);
    const done = store.getItem(item.id)!;
    assert.deepEqual([done.ai_status, done.ai_notes], ['done', 'Apical four-chamber view; RV appears dilated.']);
    assert.equal(sent[0].images, 4, 'four frames sampled from the loop');
    assert.match(sent[0].user, /6 years F patient, presenting with fatigue/);
    assert.match(sent[0].user, /Clinical question: PVR now\?/);
    assert.match(sent[0].system, /Do not give a\s+final diagnosis/);
    assert.ok(!sent[0].user.includes('DOE'));

    const summary = await ai.summarizeCase(store.getCase(c.id)!, store.listItems(c.id));
    assert.ok(summary);
    assert.match(sent[1].system, /do not invent/);
    assert.match(sent[1].user, /AI notes: Apical four-chamber view/);
    assert.equal(sent[1].images, 0);
  } finally {
    globalThis.fetch = realFetch;
  }
});
