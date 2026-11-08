// Full analysis of one piece of case evidence:
//   1. frames      — a vision model reviews EVERY frame (or slice), a window of
//                    consecutive frames at a time, and returns timed observations
//   2. specialists — task-specific models on the GPU box's medical service
//                    (PanEcho, EchoAI-Peds, CineMA, TotalSegmentator)
//   3. report      — merges both into one draft, attributing each finding to
//                    the model that made it and flagging disagreements
//
// Each stage records progress (done/total), duration and an ETA. ETAs use the
// running average for this run and, before the first unit finishes, the
// average from earlier runs. Runs survive restarts (finished frame windows are
// kept) and can be canceled. One run at a time: they share one GPU.

import fs from 'fs';
import sharp from 'sharp';
import db from '../../db/connection';
import { getOllamaUrl } from '../appSettings';
import { getActiveModel, getModelCapabilities, listChatModels } from '../chatModels';
import * as store from './store';
import type { CaseItem, MedicalCase } from './store';
import { oneLiner } from './ai';
import { frameTime, frameWindows, pipelineById, PIPELINES, suggestPipeline, type Glance, type PipelineId, type Suggestion } from './pipelines';
import * as med from './medService';

export const PREFERRED_FRAME_MODEL = 'qwen3-vl:32b';
const WINDOW = 8;
const FRAME_PX = 512;
const LLM_TIMEOUT = 10 * 60_000;

// ── types ────────────────────────────────────────────────────────────────────

export type StageStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped' | 'canceled';

export interface Stage {
  id: string; // 'frames' | 'spec:<model>' | 'report'
  label: string;
  status: StageStatus;
  done: number;
  total: number;
  unit: string;
  startedAt?: string;
  finishedAt?: string;
  durationS?: number;
  /** Seconds per unit measured in this run. */
  secPerUnit?: number;
  error?: string;
}

export interface Observation {
  frame: number; // 0-based
  time?: string | null;
  finding: string;
}

export interface WindowResult {
  start: number;
  end: number;
  summary: string;
  observations: Observation[];
  durationS: number;
}

export interface Results {
  frameModel?: string;
  /** How frames are counted: frames of a loop or slices of a stack. */
  frameUnit?: 'frame' | 'slice' | 'image';
  frameCount?: number;
  fps?: number | null;
  windows?: WindowResult[];
  specialists?: Record<string, med.SpecialistResult | { error: string }>;
  report?: string;
  reportModel?: string;
}

export interface Analysis {
  id: number;
  case_id: number;
  item_id: number;
  pipeline: PipelineId;
  frame_model: string;
  status: 'queued' | 'running' | 'done' | 'failed' | 'canceled';
  stages: Stage[];
  results: Results;
  error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

type Row = Omit<Analysis, 'stages' | 'results'> & { stages: string; results: string };

const parse = <T>(s: string, d: T): T => {
  try {
    return JSON.parse(s) as T;
  } catch {
    return d;
  }
};
const toAnalysis = (r: Row): Analysis => ({ ...r, stages: parse<Stage[]>(r.stages, []), results: parse<Results>(r.results, {}) });

export function getAnalysis(id: number): Analysis | null {
  const r = db.prepare('SELECT * FROM case_analyses WHERE id = ?').get(id) as Row | undefined;
  return r ? toAnalysis(r) : null;
}

export function listAnalyses(itemId: number, limit = 10): Analysis[] {
  return (db.prepare('SELECT * FROM case_analyses WHERE item_id = ? ORDER BY id DESC LIMIT ?').all(itemId, limit) as Row[]).map(toAnalysis);
}

export function latestForItems(itemIds: number[]): Map<number, Analysis> {
  const out = new Map<number, Analysis>();
  if (!itemIds.length) return out;
  const rows = db
    .prepare(
      `SELECT a.* FROM case_analyses a JOIN (SELECT item_id, MAX(id) id FROM case_analyses WHERE item_id IN (${itemIds.map(() => '?').join(',')}) GROUP BY item_id) m ON m.id = a.id`,
    )
    .all(...itemIds) as Row[];
  for (const r of rows) out.set(r.item_id, toAnalysis(r));
  return out;
}

function save(a: Pick<Analysis, 'id'> & Partial<Analysis>): void {
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const [k, v] of Object.entries(a)) {
    if (k === 'id') continue;
    sets.push(`${k} = ?`);
    vals.push(k === 'stages' || k === 'results' ? JSON.stringify(v) : v);
  }
  if (sets.length) db.prepare(`UPDATE case_analyses SET ${sets.join(', ')} WHERE id = ?`).run(...vals, a.id);
}

// ── frames of an item ────────────────────────────────────────────────────────

export interface FrameSource {
  files: string[];
  unit: 'frame' | 'slice' | 'image';
  fps: number | null;
}

/** Every frame the analysis should look at, in order. */
export function framesOf(item: CaseItem): FrameSource {
  const m = item.meta;
  if (m.frameFiles?.length) {
    const stack = !!item.series_uid && ['CT', 'MR', 'PT', 'NM'].includes(m.dicom?.modality ?? '') && m.frameFiles.length > 1 && !m.dicom?.fps;
    return {
      files: m.frameFiles.map((f) => store.itemPath(item, f.file)),
      unit: stack ? 'slice' : m.frameFiles.length > 1 ? 'frame' : 'image',
      fps: stack ? null : (m.fps ?? null),
    };
  }
  if (m.sampledFrames?.files.length) {
    return { files: m.sampledFrames.files.map((f) => store.itemPath(item, f)), unit: 'frame', fps: m.sampledFrames.fps };
  }
  if (item.kind === 'image' && m.display) return { files: [store.itemPath(item, m.display)], unit: 'image', fps: null };
  return { files: [], unit: 'image', fps: null };
}

async function small(file: string, px = FRAME_PX): Promise<string> {
  const b = await sharp(file).resize({ width: px, height: px, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
  return b.toString('base64');
}

// ── models ───────────────────────────────────────────────────────────────────

export interface FrameModelOption {
  name: string;
  installed: boolean;
  recommended: boolean;
  parameterSize: string | null;
  sizeBytes: number;
}

/** Vision models that can do the frame review; the recommended one is listed even when not installed. */
export async function frameModelOptions(): Promise<{ options: FrameModelOption[]; default: string; reachable: boolean }> {
  const { models, reachable } = await listChatModels();
  const vision = models.filter((m) => m.capabilities.includes('vision'));
  const options: FrameModelOption[] = vision.map((m) => ({
    name: m.name,
    installed: true,
    recommended: m.name === PREFERRED_FRAME_MODEL,
    parameterSize: m.parameterSize,
    sizeBytes: m.sizeBytes,
  }));
  if (!options.some((o) => o.recommended)) {
    options.unshift({ name: PREFERRED_FRAME_MODEL, installed: false, recommended: true, parameterSize: '33B', sizeBytes: 21e9 });
  }
  options.sort((a, b) => Number(b.recommended) - Number(a.recommended));
  const installed = options.filter((o) => o.installed);
  const active = getActiveModel();
  const def = installed.find((o) => o.recommended)?.name ?? installed.find((o) => o.name === active)?.name ?? installed[0]?.name ?? PREFERRED_FRAME_MODEL;
  return { options, default: def, reachable };
}

async function ollama(model: string, system: string, user: string, images: string[], json: boolean, signal: AbortSignal, numCtx = 16384): Promise<string> {
  const r = await fetch(`${getOllamaUrl()}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.any([signal, AbortSignal.timeout(LLM_TIMEOUT)]),
    body: JSON.stringify({
      model,
      stream: false,
      think: false,
      ...(json ? { format: 'json' } : {}),
      options: { temperature: 0.1, num_ctx: numCtx },
      // Stay loaded between windows; unloaded explicitly when the run ends.
      keep_alive: '10m',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user, ...(images.length ? { images } : {}) },
      ],
    }),
  });
  if (!r.ok) throw new Error(`Ollama ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const d = (await r.json()) as { message?: { content?: string } };
  return (d.message?.content ?? '').trim();
}

/** Free the GPU for ComfyUI. */
async function unload(model: string): Promise<void> {
  await fetch(`${getOllamaUrl()}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, keep_alive: 0 }),
    signal: AbortSignal.timeout(15_000),
  }).catch(() => undefined);
}

// ── suggestion (initial look) ────────────────────────────────────────────────

const GLANCE_SYSTEM =
  'You classify a medical image. Reply with JSON only: {"kind": one of "echo","angio","mri","ct","xray","photo","document","other", ' +
  '"modality": short text, "anatomy": short text, "view": short text or ""}. "echo" means ultrasound/echocardiography, ' +
  '"angio" means X-ray fluoroscopy or angiography (cath lab).';

/** Suggest a pipeline from metadata and, when that is not enough, a quick look at one frame. */
export async function suggest(item: CaseItem, c: MedicalCase): Promise<Suggestion & { glance?: Glance; model?: string }> {
  const fromMeta = suggestPipeline(item, c.profile);
  if (item.meta.dicom?.modality && fromMeta.pipeline !== 'general') return fromMeta;
  const src = framesOf(item);
  const file = src.files[Math.floor(src.files.length / 3)] ?? (item.meta.hasThumb ? store.itemPath(item, 'thumb.jpg') : null);
  if (!file || !fs.existsSync(file)) return fromMeta;
  try {
    const { default: def } = await frameModelOptions();
    const model = (await getModelCapabilities(def)).includes('vision') ? def : getActiveModel();
    const text = await ollama(model, GLANCE_SYSTEM, 'Classify this image.', [await small(file, 448)], true, AbortSignal.timeout(120_000), 4096);
    const g = parse<Glance>(text, {});
    return { ...suggestPipeline(item, c.profile, g), glance: g, model };
  } catch {
    return fromMeta;
  }
}

// ── estimates ────────────────────────────────────────────────────────────────

const DEFAULT_SEC: Record<string, number> = { frames: 25, spec: 90, report: 60 };
const kindOf = (stageId: string) => (stageId.startsWith('spec:') ? 'spec' : stageId);

/** Average seconds per unit for a stage from earlier finished runs (same model when it matters). */
function historicSecPerUnit(stageId: string, frameModel: string): number {
  const rows = db
    .prepare("SELECT stages, frame_model FROM case_analyses WHERE status IN ('done','failed','canceled') ORDER BY id DESC LIMIT 30")
    .all() as Array<{ stages: string; frame_model: string }>;
  const vals: number[] = [];
  for (const r of rows) {
    if (stageId === 'frames' && r.frame_model !== frameModel) continue;
    const s = parse<Stage[]>(r.stages, []).find((x) => x.id === stageId);
    if (s?.secPerUnit && s.secPerUnit > 0) vals.push(s.secPerUnit);
  }
  if (!vals.length) return DEFAULT_SEC[kindOf(stageId)] ?? 60;
  vals.sort((a, b) => a - b);
  return vals[Math.floor(vals.length / 2)];
}

export interface StageView extends Stage {
  etaS: number | null;
  elapsedS: number | null;
}

/** Stages with live ETA and elapsed time, plus the whole run's ETA. */
export function withEstimates(a: Analysis, now = Date.now()): { stages: StageView[]; etaS: number | null; elapsedS: number | null } {
  const ts = (s?: string | null) => (s ? Date.parse(s.endsWith('Z') || s.includes('T') ? s : `${s.replace(' ', 'T')}Z`) : NaN);
  const live = a.status === 'queued' || a.status === 'running';
  const stages = a.stages.map((s): StageView => {
    const started = ts(s.startedAt);
    const elapsedS = s.durationS ?? (s.status === 'running' && Number.isFinite(started) ? (now - started) / 1000 : null);
    let etaS: number | null = null;
    if (live && (s.status === 'pending' || s.status === 'running')) {
      const per = s.secPerUnit ?? historicSecPerUnit(s.id, a.frame_model);
      const left = Math.max(0, s.total - s.done) * per;
      // Time already spent on the unit in progress counts against it.
      const inUnit = s.status === 'running' && s.secPerUnit && elapsedS != null ? Math.max(0, elapsedS - s.done * s.secPerUnit) : 0;
      etaS = Math.max(0, left - Math.min(inUnit, per));
    }
    return { ...s, etaS, elapsedS };
  });
  const etaS = live ? stages.reduce((t, s) => t + (s.etaS ?? 0), 0) : null;
  const started = ts(a.started_at);
  const finished = ts(a.finished_at);
  const elapsedS = Number.isFinite(started) ? ((Number.isFinite(finished) ? finished : now) - started) / 1000 : null;
  return { stages, etaS, elapsedS };
}

// ── create / cancel ──────────────────────────────────────────────────────────

export function planStages(pipeline: PipelineId, frameCount: number, specialists: med.SpecialistModel[], skipSpecialists = false): Stage[] {
  const p = pipelineById(pipeline)!;
  const windows = frameWindows(frameCount, WINDOW).length;
  const stages: Stage[] = [{ id: 'frames', label: 'Frame-by-frame review', status: 'pending', done: 0, total: windows, unit: 'window' }];
  for (const id of p.specialists) {
    const m = specialists.find((x) => x.id === id);
    stages.push({ id: `spec:${id}`, label: m?.label ?? id, status: skipSpecialists ? 'skipped' : 'pending', done: 0, total: 1, unit: 'run' });
  }
  stages.push({ id: 'report', label: 'Combined report', status: 'pending', done: 0, total: 1, unit: 'run' });
  return stages;
}

export async function createAnalysis(item: CaseItem, pipeline: PipelineId, frameModel: string, opts: { skipSpecialists?: boolean } = {}): Promise<Analysis> {
  if (!pipelineById(pipeline)) throw new Error('Unknown pipeline');
  const src = framesOf(item);
  if (!src.files.length) throw new Error(item.kind === 'video' ? 'Sample the video frames first' : 'This item has no frames or image to analyse');
  const caps = await getModelCapabilities(frameModel);
  if (!caps.length) throw new Error(`${frameModel} is not installed on the GPU box`);
  if (!caps.includes('vision')) throw new Error(`${frameModel} can’t see images`);
  const busy = db.prepare("SELECT id FROM case_analyses WHERE item_id = ? AND status IN ('queued','running')").get(item.id);
  if (busy) throw new Error('This item is already being analysed');
  const h = await med.health();
  const stages = planStages(pipeline, src.files.length, h.models, !!opts.skipSpecialists);
  const results: Results = { frameModel, frameUnit: src.unit, frameCount: src.files.length, fps: src.fps };
  const r = db
    .prepare('INSERT INTO case_analyses (case_id, item_id, pipeline, frame_model, stages, results) VALUES (?, ?, ?, ?, ?, ?)')
    .run(item.case_id, item.id, pipeline, frameModel, JSON.stringify(stages), JSON.stringify(results));
  kick();
  return getAnalysis(Number(r.lastInsertRowid))!;
}

export function cancelAnalysis(id: number): Analysis | null {
  const a = getAnalysis(id);
  if (!a || (a.status !== 'queued' && a.status !== 'running')) return a;
  save({
    id,
    status: 'canceled',
    finished_at: new Date().toISOString(),
    stages: a.stages.map((s) => (s.status === 'pending' || s.status === 'running' ? { ...s, status: 'canceled' as const } : s)),
  });
  if (current?.id === id) current.abort.abort();
  return getAnalysis(id);
}

// ── runner ───────────────────────────────────────────────────────────────────

let current: { id: number; abort: AbortController } | null = null;
let running = false;

/** Start the runner if it isn't already going. */
export function kick(): void {
  if (running) return;
  running = true;
  void loop().finally(() => {
    running = false;
  });
}

/** On startup: runs interrupted by a restart go back in the queue and resume. */
export function resumeAnalyses(): void {
  db.prepare("UPDATE case_analyses SET status = 'queued' WHERE status = 'running'").run();
  kick();
}

async function loop(): Promise<void> {
  for (;;) {
    const row = db.prepare("SELECT id FROM case_analyses WHERE status = 'queued' ORDER BY id LIMIT 1").get() as { id: number } | undefined;
    if (!row) return;
    // Claim it; a second process (or a cancel) can't take the same row.
    const claimed = db.prepare("UPDATE case_analyses SET status = 'running', started_at = COALESCE(started_at, ?) WHERE id = ? AND status = 'queued'").run(new Date().toISOString(), row.id);
    if (!claimed.changes) continue;
    current = { id: row.id, abort: new AbortController() };
    try {
      await run(row.id, current.abort.signal);
    } catch (e) {
      const a = getAnalysis(row.id);
      if (a && a.status === 'running') save({ id: row.id, status: 'failed', error: (e as Error).message, finished_at: new Date().toISOString() });
    } finally {
      const a = getAnalysis(row.id);
      if (a) await unload(a.frame_model);
      current = null;
    }
  }
}

class Canceled extends Error {}

async function run(id: number, signal: AbortSignal): Promise<void> {
  let a = getAnalysis(id)!;
  const item = store.getItem(a.item_id);
  const c = item && store.getCase(item.case_id);
  if (!item || !c) throw new Error('The evidence was deleted');
  const pipeline = pipelineById(a.pipeline)!;

  const stillRunning = () => {
    if (signal.aborted || getAnalysis(id)?.status !== 'running') throw new Canceled();
  };
  const setStage = (sid: string, patch: Partial<Stage>) => {
    a = getAnalysis(id)!;
    a.stages = a.stages.map((s) => (s.id === sid ? { ...s, ...patch } : s));
    save({ id, stages: a.stages });
  };
  const setResults = (patch: Partial<Results>) => {
    a = getAnalysis(id)!;
    a.results = { ...a.results, ...patch };
    save({ id, results: a.results });
  };
  const stageRun = async (sid: string, fn: () => Promise<void>) => {
    const s = a.stages.find((x) => x.id === sid);
    if (!s || s.status === 'done' || s.status === 'skipped') return;
    const t0 = Date.now();
    const prior = s.status === 'running' && s.durationS ? s.durationS : 0;
    setStage(sid, { status: 'running', startedAt: s.startedAt ?? new Date().toISOString(), error: undefined });
    try {
      await fn();
      setStage(sid, { status: 'done', finishedAt: new Date().toISOString(), durationS: prior + (Date.now() - t0) / 1000 });
    } catch (e) {
      if (e instanceof Canceled || signal.aborted) throw new Canceled();
      setStage(sid, { status: 'failed', error: (e as Error).message, finishedAt: new Date().toISOString(), durationS: prior + (Date.now() - t0) / 1000 });
    }
  };

  try {
    // 1. Every frame.
    await stageRun('frames', () => framePass(item, c, a, pipeline.focus, signal, stillRunning, setStage, setResults));
    stillRunning();

    // 2. Specialists.
    for (const sid of pipeline.specialists) {
      await stageRun(`spec:${sid}`, async () => {
        const t0 = Date.now();
        const h = await med.health();
        const m = h.models.find((x) => x.id === sid);
        if (!h.reachable) throw new Error(`The medical model service isn’t reachable at ${h.url}`);
        if (!m) throw new Error(`${sid} isn’t installed on the medical model service`);
        if (!m.ready) throw new Error(`${m.label} isn’t ready: ${m.error ?? 'loading'}`);
        const src = framesOf(item);
        const d = item.meta.dicom;
        const out = await med.analyze(
          sid,
          { fps: src.fps, unit: src.unit, modality: d?.modality, age: d?.patientAge ?? c.profile.age, sex: d?.patientSex ?? c.profile.sex, heartRate: d?.heartRate, pixelSpacing: d?.pixelSpacing, sliceThickness: d?.sliceThickness, view: d?.viewPosition },
          src.files,
          AbortSignal.any([signal, AbortSignal.timeout(30 * 60_000)]),
        );
        setResults({ specialists: { ...(a.results.specialists ?? {}), [sid]: out } });
        setStage(`spec:${sid}`, { done: 1, secPerUnit: (Date.now() - t0) / 1000 });
      });
      const st = getAnalysis(id)!.stages.find((s) => s.id === `spec:${sid}`);
      if (st?.status === 'failed') setResults({ specialists: { ...(a.results.specialists ?? {}), [sid]: { error: st.error ?? 'failed' } } });
      stillRunning();
    }

    // 3. Report.
    await stageRun('report', async () => {
      const t0 = Date.now();
      const { model, text } = await report(item, c, getAnalysis(id)!, pipeline.label, signal);
      setResults({ report: text, reportModel: model });
      setStage('report', { done: 1, secPerUnit: (Date.now() - t0) / 1000 });
    });

    a = getAnalysis(id)!;
    const frames = a.stages.find((s) => s.id === 'frames');
    const failed = frames?.status === 'failed' && a.stages.find((s) => s.id === 'report')?.status !== 'done';
    save({ id, status: failed ? 'failed' : 'done', error: failed ? frames?.error ?? 'Frame review failed' : null, finished_at: new Date().toISOString() });
  } catch (e) {
    if (!(e instanceof Canceled)) throw e;
    // cancelAnalysis already marked it.
  }
}

// ── stage 1: frames ──────────────────────────────────────────────────────────

const FRAME_SYSTEM = (focus: string, unit: string) =>
  'You are reviewing medical imaging for a physician preparing a case presentation. ' +
  `${focus} You are given consecutive ${unit}s from one study, each labelled with its ${unit} number` +
  `${unit === 'frame' ? ' and time' : ''}. Look at every ${unit}. Report only what you can actually see; say when ` +
  'something is uncertain or not assessable. Do not guess a diagnosis that the images don’t show, and never identify the patient. ' +
  'Reply with JSON only: {"summary": "1-3 sentences on this stretch", "observations": [{"frame": <number as labelled>, "finding": "short, specific"}]}. ' +
  `Include an observation for each ${unit} where something is visible or changes (start/end of contrast, valve opening, ` +
  'a jet appearing, a device, peak contraction), not a line per frame when nothing changes.';

interface WindowJson {
  summary?: string;
  observations?: Array<{ frame?: number; finding?: string }>;
}

async function framePass(
  item: CaseItem,
  c: MedicalCase,
  a0: Analysis,
  focus: string,
  signal: AbortSignal,
  stillRunning: () => void,
  setStage: (sid: string, patch: Partial<Stage>) => void,
  setResults: (patch: Partial<Results>) => void,
): Promise<void> {
  const src = framesOf(item);
  const windows = frameWindows(src.files.length, WINDOW);
  const done = new Map((a0.results.windows ?? []).map((w) => [`${w.start}-${w.end}`, w]));
  const results: WindowResult[] = windows.map(([s, e]) => done.get(`${s}-${e}`)).filter((w): w is WindowResult => !!w);
  const label = (i: number) => `${src.unit} ${i + 1}${src.unit === 'frame' && src.fps ? ` (t=${frameTime(i, src.fps)})` : ''}`;
  const context = [
    `Case: ${oneLiner(c.profile) || 'no profile given'}.`,
    c.profile.question ? `Clinical question: ${c.profile.question}` : '',
    `Evidence: "${item.title}"${item.meta.dicom?.modality ? `, DICOM ${item.meta.dicom.modality}` : ''}${item.meta.dicom?.seriesDescription ? ` (${item.meta.dicom.seriesDescription})` : ''}, ${src.files.length} ${src.unit}s${src.fps ? ` at ${src.fps} fps` : ''}.`,
  ].filter(Boolean).join('\n');
  setStage('frames', { total: windows.length, done: results.length });

  let measured = 0;
  let measuredN = 0;
  let prevSummary = results.at(-1)?.summary ?? '';
  for (const [start, end] of windows) {
    if (done.has(`${start}-${end}`)) continue;
    stillRunning();
    const t0 = Date.now();
    const idx = Array.from({ length: end - start + 1 }, (_, k) => start + k);
    const images = await Promise.all(idx.map((i) => small(src.files[i])));
    const user =
      `${context}\n` +
      (prevSummary ? `Previous stretch: ${prevSummary}\n` : '') +
      `Attached in order: ${idx.map(label).join(', ')}.`;
    let parsed: WindowJson = {};
    let text = '';
    for (let attempt = 0; attempt < 2; attempt++) {
      text = await ollama(a0.frame_model, FRAME_SYSTEM(focus, src.unit), user, images, true, signal);
      parsed = parse<WindowJson>(text, {});
      if (parsed.summary || parsed.observations?.length) break;
    }
    const observations: Observation[] = (parsed.observations ?? [])
      .filter((o) => typeof o?.finding === 'string' && o.finding.trim())
      .map((o) => {
        // Frames are labelled 1-based for the model; clamp into this window.
        const f = Math.min(end, Math.max(start, (Number.isFinite(o.frame) ? Number(o.frame) : start + 1) - 1));
        return { frame: f, time: src.unit === 'frame' ? frameTime(f, src.fps) : null, finding: o.finding!.trim().slice(0, 400) };
      });
    const w: WindowResult = {
      start,
      end,
      summary: (parsed.summary ?? (observations.length ? '' : text)).trim().slice(0, 1200),
      observations,
      durationS: (Date.now() - t0) / 1000,
    };
    results.push(w);
    results.sort((x, y) => x.start - y.start);
    prevSummary = w.summary;
    measured += w.durationS;
    measuredN++;
    setResults({ windows: results });
    setStage('frames', { done: results.length, secPerUnit: measured / measuredN });
  }
}

// ── stage 3: report ──────────────────────────────────────────────────────────

const REPORT_SYSTEM =
  'You help a physician prepare a case presentation. Several models analysed the same study. Write a combined ' +
  'draft in Markdown with these sections: **Study** (what it is), **Findings** (bullets; after each, in brackets, ' +
  'which model reported it and the frame or time range), **Measurements** (from specialist models, with units and ' +
  'any probability), **Agreements and disagreements** between models, and **Limits** (what could not be assessed, ' +
  'models trained on other populations such as adult models on a child). Use only what the analyses say; do not add ' +
  'findings. No final diagnosis or treatment advice. 200-450 words.';

function fmtFinding(f: med.Finding): string {
  const v = f.value === undefined || f.value === null ? '' : ` ${String(f.value)}${f.unit ? ` ${f.unit}` : ''}`;
  const p = typeof f.probability === 'number' ? ` (p=${f.probability.toFixed(2)})` : '';
  const fr = f.frames ? ` [frames ${f.frames[0] + 1}-${f.frames[1] + 1}]` : '';
  return `${f.label}${v}${p}${fr}${f.note ? `; ${f.note}` : ''}`;
}

async function report(item: CaseItem, c: MedicalCase, a: Analysis, pipelineLabel: string, signal: AbortSignal): Promise<{ model: string; text: string }> {
  const r = a.results;
  const unit = r.frameUnit ?? 'frame';
  const frames = (r.windows ?? [])
    .map((w) => {
      const range = `${unit}s ${w.start + 1}-${w.end + 1}${unit === 'frame' && r.fps ? ` (${frameTime(w.start, r.fps)}-${frameTime(w.end, r.fps)})` : ''}`;
      const obs = w.observations.map((o) => `  - ${unit} ${o.frame + 1}${o.time ? ` @${o.time}` : ''}: ${o.finding}`).join('\n');
      return `${range}: ${w.summary}${obs ? `\n${obs}` : ''}`;
    })
    .join('\n');
  const specs = Object.entries(r.specialists ?? {})
    .map(([id, s]) => ('error' in s ? `${id}: did not run (${s.error})` : `${id}${s.version ? ` ${s.version}` : ''}:\n${s.findings.map((f) => `  - ${fmtFinding(f)}`).join('\n')}${s.warnings?.length ? `\n  warnings: ${s.warnings.join('; ')}` : ''}`))
    .join('\n');
  const user = [
    `Case: ${oneLiner(c.profile) || 'no profile given'}.`,
    c.profile.question ? `Clinical question: ${c.profile.question}` : '',
    `Evidence: "${item.title}". Pipeline: ${pipelineLabel}. ${r.frameCount} ${unit}s${r.fps ? ` at ${r.fps} fps` : ''}.`,
    `Frame-by-frame review by ${r.frameModel}:\n${frames || '(none)'}`,
    specs ? `Specialist models:\n${specs}` : 'No specialist models ran.',
  ].filter(Boolean).join('\n\n');
  // The frame model writes the report too, so only one model sits on the GPU.
  const text = await ollama(a.frame_model, REPORT_SYSTEM, user.slice(0, 60000), [], false, signal, 32768);
  return { model: a.frame_model, text };
}

export { PIPELINES };
