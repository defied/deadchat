// The sound gatherer. From what the writer asks for (or what a shot, scene or
// the whole script implies), the local model works out the separate sounds
// wanted and the library search terms for each; the gatherer searches the
// free libraries and returns one collection of candidates per sound, ranked
// by match, freedom of licence and length. The writer listens and picks.

import db from '../../../db/connection';
import { llmJson } from '../../influencers/llm';
import * as store from '../store';
import { shotSection } from '../script';
import type { Screenplay } from '../types';
import { allowed, type LicensePolicy } from './licenses';
import { searchArchive, searchOpenverse, type Candidate } from './sources';

export type WantKind = 'ambience' | 'effect' | 'foley' | 'music';

export interface Want {
  id: string;
  want: string;
  kind: WantKind;
  queries: string[];
  candidates: Candidate[];
  /** Sources that failed for this want (shown, not fatal). */
  errors: string[];
}

export interface Hunt {
  id: number;
  screenplay_id: number;
  scope: string;
  request: string;
  options: LicensePolicy;
  status: 'queued' | 'planning' | 'searching' | 'done' | 'failed';
  progress: string;
  wants: Want[];
  error: string | null;
  created_at: string;
  finished_at: string | null;
}

type Row = Omit<Hunt, 'options' | 'wants'> & { options: string; wants: string };
const parse = <T>(s: string, d: T): T => {
  try {
    return JSON.parse(s) as T;
  } catch {
    return d;
  }
};
const toHunt = (r: Row): Hunt => ({ ...r, options: parse(r.options, {}), wants: parse(r.wants, []) });

export function getHunt(id: number): Hunt | null {
  const r = db.prepare('SELECT * FROM screenplay_sound_hunts WHERE id = ?').get(id) as Row | undefined;
  return r ? toHunt(r) : null;
}

export function listHunts(screenplayId: number, limit = 10): Hunt[] {
  return (db.prepare('SELECT * FROM screenplay_sound_hunts WHERE screenplay_id = ? ORDER BY id DESC LIMIT ?').all(screenplayId, limit) as Row[]).map(toHunt);
}

function save(id: number, patch: Partial<Pick<Hunt, 'status' | 'progress' | 'wants' | 'error' | 'finished_at'>>): void {
  const keys = Object.keys(patch) as Array<keyof typeof patch>;
  db.prepare(`UPDATE screenplay_sound_hunts SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(
    ...keys.map((k) => (k === 'wants' ? JSON.stringify(patch[k]) : (patch[k] as unknown))),
    id,
  );
}

// ── what the hunt is about ───────────────────────────────────────────────────

/** The script text a hunt draws on: a shot's block, a scene, or the whole script (trimmed). */
export function scopeText(sp: Screenplay, scope: string): { label: string; text: string } {
  const doc = sp.doc;
  const shot = doc.shots.find((s) => s.id === scope);
  if (shot) {
    const sec = shotSection(doc, shot);
    const lines = sec ? [sec.scene?.text, ...sec.elements.map((e) => e.text)].filter(Boolean) : [];
    if (shot.music) lines.push(`Music cue: ${shot.music}`);
    return { label: `Shot ${doc.shots.indexOf(shot) + 1}`, text: lines.join('\n') };
  }
  const i = doc.elements.findIndex((e) => e.id === scope && e.type === 'scene');
  if (i >= 0) {
    const out: string[] = [doc.elements[i].text];
    for (let j = i + 1; j < doc.elements.length && doc.elements[j].type !== 'scene'; j++) out.push(doc.elements[j].text);
    return { label: doc.elements[i].text || 'Scene', text: out.join('\n') };
  }
  if (scope === 'script') return { label: 'Whole script', text: doc.elements.map((e) => e.text).join('\n').slice(0, 8000) };
  return { label: 'Your request', text: '' };
}

const PLAN_SYSTEM =
  'You are a sound researcher for a film. From the request and the script excerpt, list the separate sounds a sound ' +
  'designer would gather: background ambience, sound effects, foley (body movement, handled objects) and music. ' +
  'Follow the request first; use the script only to understand it, or to choose sounds when the request is empty. ' +
  'Return {"wants":[{"want":"short plain description, e.g. heavy rain on a window at night","kind":"ambience|effect|foley|music",' +
  '"queries":["2 to 4 short library search phrases, 1-3 words each, most specific first, e.g. rain window, heavy rain, rain glass"]}]}. ' +
  'At most 8 wants, no duplicates, no dialogue or voices of named characters.';

interface Planned {
  wants?: Array<{ want?: string; kind?: string; queries?: string[] }>;
}

export async function planWants(request: string, context: string): Promise<Array<Pick<Want, 'want' | 'kind' | 'queries'>>> {
  const kinds: WantKind[] = ['ambience', 'effect', 'foley', 'music'];
  try {
    const out = await llmJson<Planned>(PLAN_SYSTEM, `Request: ${request || '(none: choose from the script)'}\n\nScript excerpt:\n${context || '(none)'}`, { temperature: 0.2 });
    const wants = (out.wants ?? [])
      .map((w) => ({
        want: String(w.want ?? '').trim().slice(0, 160),
        kind: (kinds.includes(w.kind as WantKind) ? w.kind : 'effect') as WantKind,
        queries: (Array.isArray(w.queries) ? w.queries : []).map((q) => String(q).trim().slice(0, 60)).filter(Boolean).slice(0, 4),
      }))
      .filter((w) => w.want);
    for (const w of wants) if (!w.queries.length) w.queries = [w.want];
    if (wants.length) return wants.slice(0, 8);
  } catch {
    /* fall through to the literal request */
  }
  const text = (request || context).trim();
  if (!text) return [];
  // No model: search the request as written, one want per line or comma.
  return text
    .split(/\n|,|;/)
    .map((s) => s.trim())
    .filter((s) => s.length > 2)
    .slice(0, 6)
    .map((s) => ({ want: s.slice(0, 160), kind: /music|score|song|piano|strings|guitar/i.test(s) ? 'music' : 'effect', queries: [s.slice(0, 60)] }));
}

// ── ranking ──────────────────────────────────────────────────────────────────

const tokens = (s: string) => new Set(s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((w) => w.length > 2));

/** Ideal lengths: effects short, ambience long enough to sit under a scene, music a cue. */
function lengthFit(kind: WantKind, d: number | null): number {
  if (d == null) return 0.5;
  const [lo, hi] = kind === 'effect' || kind === 'foley' ? [0.3, 30] : kind === 'ambience' ? [15, 600] : [20, 420];
  if (d >= lo && d <= hi) return 1;
  return d < lo ? Math.max(0, d / lo) : Math.max(0, 1 - (d - hi) / hi);
}

export function score(c: Candidate, want: Pick<Want, 'want' | 'kind' | 'queries'>): number {
  const wantWords = tokens(`${want.want} ${want.queries.join(' ')}`);
  const have = tokens(`${c.title} ${c.tags.join(' ')}`);
  const overlap = wantWords.size ? [...wantWords].filter((w) => have.has(w)).length / wantWords.size : 0;
  const kindFit = !c.category ? 0.5 : (want.kind === 'music') === (c.category === 'music') ? 1 : 0;
  return 0.4 * Math.min(1, overlap * 1.5) + 0.2 * c.sourceScore + 0.2 * (1 - c.license.rank / 10) + 0.1 * lengthFit(want.kind, c.durationS) + 0.1 * kindFit;
}

const PER_WANT = 10;

// ── running ──────────────────────────────────────────────────────────────────

export function createHunt(sp: Screenplay, scope: string, request: string, options: LicensePolicy): Hunt {
  const r = db
    .prepare('INSERT INTO screenplay_sound_hunts (screenplay_id, scope, request, options) VALUES (?, ?, ?, ?)')
    .run(sp.id, scope, request.slice(0, 2000), JSON.stringify({ allowNonCommercial: !!options.allowNonCommercial }));
  kick();
  return getHunt(Number(r.lastInsertRowid))!;
}

let running = false;
export function kick(): void {
  if (running) return;
  running = true;
  void (async () => {
    try {
      for (;;) {
        const row = db.prepare("SELECT id FROM screenplay_sound_hunts WHERE status = 'queued' ORDER BY id LIMIT 1").get() as { id: number } | undefined;
        if (!row) break;
        await run(row.id).catch((e) => save(row.id, { status: 'failed', error: (e as Error).message, finished_at: new Date().toISOString() }));
      }
    } finally {
      running = false;
    }
  })();
}

/** After a restart: unfinished hunts start again. */
export function resumeHunts(): void {
  db.prepare("UPDATE screenplay_sound_hunts SET status = 'queued' WHERE status IN ('planning', 'searching')").run();
  kick();
}

/** Injected in tests. */
export const deps = { searchArchive, searchOpenverse, planWants };

async function run(id: number): Promise<void> {
  const h = getHunt(id)!;
  const sp = store.getScreenplay(h.screenplay_id);
  if (!sp) throw new Error('The screenplay was deleted');
  save(id, { status: 'planning', progress: 'Working out what to look for…' });
  const ctx = scopeText(sp, h.scope);
  const planned = await deps.planWants(h.request, ctx.text);
  if (!planned.length) throw new Error('Nothing to look for. Describe the sounds you want.');
  const wants: Want[] = planned.map((w, i) => ({ id: `w${i + 1}`, ...w, candidates: [], errors: [] }));
  save(id, { status: 'searching', wants, progress: `Looking for ${wants.length} sound${wants.length === 1 ? '' : 's'}…` });

  const nonCommercial = !!h.options.allowNonCommercial;
  for (const w of wants) {
    const found = new Map<string, Candidate>();
    for (const q of w.queries) {
      save(id, { progress: `“${w.want}”: searching for “${q}”…` });
      const maxDurationS = w.kind === 'effect' || w.kind === 'foley' ? 120 : 900;
      const results = await Promise.allSettled([
        deps.searchOpenverse(q, { nonCommercial, category: w.kind === 'music' ? 'music' : 'sound_effect', max: 20 }),
        deps.searchArchive(q, { nonCommercial, max: 6, maxDurationS }),
      ]);
      results.forEach((r, i) => {
        const name = i === 0 ? 'Openverse' : 'Internet Archive';
        if (r.status === 'rejected') {
          const msg = `${name}: ${(r.reason as Error)?.message ?? 'failed'}`;
          console.warn(`[sounds] hunt ${id} “${q}”: ${msg}`);
          if (!w.errors.includes(msg)) w.errors.push(msg);
          return;
        }
        for (const c of r.value) if (allowed(c.license, h.options) && !found.has(c.key)) found.set(c.key, c);
      });
      if (found.size >= PER_WANT * 2) break;
    }
    w.candidates = [...found.values()].sort((a, b) => score(b, w) - score(a, w)).slice(0, PER_WANT);
    save(id, { wants });
  }
  const total = wants.reduce((t, w) => t + w.candidates.length, 0);
  save(id, { status: 'done', progress: `Found ${total} sound${total === 1 ? '' : 's'}`, finished_at: new Date().toISOString() });
}

// ── keeping a pick ───────────────────────────────────────────────────────────

const MAX_BYTES = 80 * 1024 * 1024;

/** Download a chosen candidate (only ones this hunt found) and keep it with the screenplay. */
export async function keepCandidate(sp: Screenplay, hunt: Hunt, key: string, target: string, saveAudio: (bytes: Buffer, mime: string, filename: string) => number): Promise<number> {
  let c: Candidate | undefined;
  let want: Want | undefined;
  for (const w of hunt.wants) {
    c = w.candidates.find((x) => x.key === key);
    if (c) {
      want = w;
      break;
    }
  }
  if (!c || !want) throw new Error('That sound isn’t in this search');
  const existing = store.listMedia(sp.id, 'sound').find((m) => parse<{ key?: string }>(m.meta ?? '{}', {}).key === key);
  if (existing) {
    if (target !== existing.target) store.updateMedia(existing.id, { target });
    return existing.id;
  }
  const url = new URL(c.audioUrl);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Unsupported link');
  const r = await fetch(url, { headers: { 'User-Agent': 'DeadChat/1.0 (self-hosted screenplay tool)' }, redirect: 'follow', signal: AbortSignal.timeout(120_000) });
  if (!r.ok) throw new Error(`${url.host} answered ${r.status}`);
  const len = Number(r.headers.get('content-length') ?? 0);
  if (len > MAX_BYTES) throw new Error('That file is too large (over 80 MB)');
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new Error('That file is too large (over 80 MB)');
  let mime = (r.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  const ext = (/\.([a-z0-9]{2,4})(?:$|\?)/i.exec(url.pathname)?.[1] ?? 'mp3').toLowerCase();
  if (!mime.startsWith('audio/')) mime = ({ mp3: 'audio/mpeg', ogg: 'audio/ogg', oga: 'audio/ogg', wav: 'audio/wav', flac: 'audio/flac', m4a: 'audio/mp4' } as Record<string, string>)[ext] ?? '';
  if (!mime) throw new Error('That link isn’t an audio file');
  const mediaId = saveAudio(buf, mime, `${c.title.replace(/[^\w .-]+/g, '_').slice(0, 80)}.${ext}`);
  const row = store.addMedia(sp.id, 'sound', target, { status: 'ready', media_id: mediaId, label: c.title.slice(0, 200) });
  store.updateMedia(row.id, {
    meta: JSON.stringify({
      key,
      want: want.want,
      kind: want.kind,
      source: c.source,
      sourceName: c.sourceName,
      creator: c.creator,
      landingUrl: c.landingUrl,
      audioUrl: c.audioUrl,
      durationS: c.durationS,
      license: c.license,
    }),
  });
  return row.id;
}
