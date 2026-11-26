// The shot finder. It reads a shot's part of the script (and the shot's
// adjustment notes), works out what a matching photo would show and a few
// library searches for it, and proposes ten photos; "find more" adds ten
// more. The writer picks one as the frame, and can then have the AI recreate
// it with the film's characters and props.

import db from '../../../db/connection';
import { llmJson } from '../../influencers/llm';
import { getPhotoKeys } from '../../media/settings';
import * as store from '../store';
import { presentCharacters, shotSection, visualText } from '../script';
import { activeAdjustments, firstMoment } from '../prompts';
import type { Prop, Screenplay, Shot } from '../types';
import { searchOpenverseImages, searchPexels, searchUnsplash, type ImageCandidate, type SearchOpts } from './sources';

export interface FindPlan {
  /** One sentence: the photo we are looking for. */
  look: string;
  queries: string[];
  /** The adjustment notes the search followed. */
  notes: string[];
}

export interface ShotFind {
  id: number;
  screenplay_id: number;
  /** A shot id, or "prop:<id>" for a prop's reference photos. */
  shot_id: string;
  status: 'queued' | 'planning' | 'searching' | 'done' | 'failed';
  progress: string;
  plan: FindPlan;
  candidates: ImageCandidate[];
  page: number;
  error: string | null;
  created_at: string;
  finished_at: string | null;
}

type Row = Omit<ShotFind, 'plan' | 'candidates'> & { plan: string; candidates: string };
const parse = <T>(s: string, d: T): T => {
  try {
    return JSON.parse(s) as T;
  } catch {
    return d;
  }
};
const toFind = (r: Row): ShotFind => ({ ...r, plan: parse(r.plan, { look: '', queries: [], notes: [] }), candidates: parse(r.candidates, []) });

export function getFind(id: number): ShotFind | null {
  const r = db.prepare('SELECT * FROM screenplay_shot_finds WHERE id = ?').get(id) as Row | undefined;
  return r ? toFind(r) : null;
}

/** The newest search for a shot. */
export function latestFind(screenplayId: number, shotId: string): ShotFind | null {
  const r = db.prepare('SELECT * FROM screenplay_shot_finds WHERE screenplay_id = ? AND shot_id = ? ORDER BY id DESC LIMIT 1').get(screenplayId, shotId) as Row | undefined;
  return r ? toFind(r) : null;
}

function save(id: number, patch: Partial<Pick<ShotFind, 'status' | 'progress' | 'plan' | 'candidates' | 'page' | 'error' | 'finished_at'>>): void {
  const keys = Object.keys(patch) as Array<keyof typeof patch>;
  db.prepare(`UPDATE screenplay_shot_finds SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(
    ...keys.map((k) => (k === 'plan' || k === 'candidates' ? JSON.stringify(patch[k]) : (patch[k] as unknown))),
    id,
  );
}

// ── what to look for ─────────────────────────────────────────────────────────

/** The shot in plain words for the search planner. Characters by look, never by name. */
export function shotBrief(sp: Screenplay, shot: Shot): string {
  const doc = sp.doc;
  const sec = shotSection(doc, shot);
  if (!sec) return '';
  const h = sec.heading;
  const action = visualText(sec.elements);
  const people = presentCharacters(sec.elements, doc.characters).map((p) => {
    const c = p.character;
    const who = [c?.age, c?.gender, c?.kind && c.kind !== 'human' ? c.species || c.kind : ''].filter(Boolean).join(' ').trim();
    return `${p.name} = ${who || 'a person'}${c?.appearance ? ` (${c.appearance.slice(0, 160)})` : ''}`;
  });
  return [
    shot.type ? `Shot type: ${shot.type}${shot.lens ? `, ${shot.lens}mm lens` : ''}` : '',
    h ? `Setting: ${[h.setting, h.location, h.time].filter(Boolean).join(', ')}` : sec.scene?.text ? `Setting: ${sec.scene.text}` : '',
    action ? `Moment: ${firstMoment(action, 40)}` : '',
    people.length ? `People (use their look, never their names): ${people.join('; ')}` : '',
    doc.settings.style?.trim() ? `Film style: ${doc.settings.style.trim()}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

const PLAN_SYSTEM =
  'You find reference photos for a storyboard frame in free stock photo libraries (Flickr, Wikimedia, Pexels). Their search matches ' +
  'words in photo titles and tags, so write queries the way a photographer titles a photo: 3 or 4 plain words naming a SUBJECT and a ' +
  'PLACE or SITUATION that are both visible, e.g. "young man smartphone street", "woman kitchen night", "lightning city skyline". ' +
  'People are generic ("young man", "old woman", "girl", "couple"): no names, ages, numbers, hair or eye colour, and never a famous person. ' +
  'Never a lone verb, adjective or emotion ("sneer", "lean", "angry"), never film or camera words ("shot", "close-up", "lens"). ' +
  'Mix: two queries for the whole moment (subject in its place), one for the subject alone, one for the place alone. ' +
  'Follow the adjustment notes first: they override the script where they conflict. ' +
  'Example. Shot: a young man in a hoodie sneers at his phone on a stormy city street. Queries: ["young man smartphone street", ' +
  '"man phone city night", "young man hoodie smartphone", "stormy city street"]. ' +
  'Return {"look": "one sentence: the photo we want, people described generically", "queries": ["4 queries"]}.';

export async function planFind(brief: string, notes: string[], names: string[] = []): Promise<FindPlan> {
  const strip = (q: string) => names.reduce((s, n) => s.replace(new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'), ''), q).replace(/\s+/g, ' ').trim();
  try {
    const out = await llmJson<{ look?: unknown; queries?: unknown }>(
      PLAN_SYSTEM,
      `${brief || '(no script for this shot)'}${notes.length ? `\n\nAdjustment notes:\n${notes.map((n) => `- ${n}`).join('\n')}` : ''}`,
      { temperature: 0.3 },
    );
    const queries = (Array.isArray(out.queries) ? out.queries : [])
      .map((q) => strip(String(q)).toLowerCase().replace(/[^\p{L}\p{N}\s'-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 60))
      .filter((q) => q.split(' ').length >= 1 && q.length > 2);
    const unique = [...new Set(queries)].slice(0, 5);
    const look = strip(typeof out.look === 'string' ? out.look : '').replace(/^[\s,;:.-]+/, '').slice(0, 300);
    if (unique.length) return { look, queries: unique, notes };
  } catch {
    /* fall back to words from the script */
  }
  return { look: '', queries: ruleQueries(brief, notes, names), notes };
}

const STOP = new Set(
  'a an the and or but of to in on at by for with from into onto over under up down out off is are was were be been his her their its he she they them him it this that these those as then than very just shot type lens setting moment people film style interior exterior day night'.split(
    ' ',
  ),
);

/** No model: the setting and the first nouns of the moment, plus the notes. */
export function ruleQueries(brief: string, notes: string[], names: string[] = []): string[] {
  const line = (label: string) => new RegExp(`^${label}: (.*)$`, 'mi').exec(brief)?.[1] ?? '';
  const lower = names.map((n) => n.toLowerCase());
  const words = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP.has(w) && !lower.includes(w) && !/\d/.test(w));
  const setting = words(line('Setting').replace(/^(interior|exterior|interior\/exterior),?\s*/i, ''));
  const moment = words(line('Moment'));
  const time = /\bnight\b/i.test(line('Setting')) ? ['night'] : [];
  const out = [
    [...moment.slice(0, 2), ...setting.slice(0, 2)].join(' '),
    [...setting.slice(0, 3), ...time].join(' '),
    moment.slice(0, 3).join(' '),
    ...notes.map((n) => words(n).slice(0, 3).join(' ')),
  ].filter((q) => q.length > 2);
  return [...new Set(out)].slice(0, 5);
}

// ── ranking ──────────────────────────────────────────────────────────────────

const tokens = (s: string) => new Set(s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)));

/** Rough stem, so "storm"/"stormy" and "phone"/"phones" match ("lightning"/"lighting" too, which is fine for photos). */
const stem = (w: string) => w.slice(0, Math.min(w.length, w.length > 6 ? 5 : 4));

/** Share of the query's words found in the photo's title and tags. */
export function relevance(c: Pick<ImageCandidate, 'title' | 'tags' | 'query'>): number {
  const want = [...tokens(c.query)].map(stem);
  if (!want.length) return 0;
  const have = new Set([...tokens(`${c.title} ${c.tags.join(' ')}`)].map(stem));
  return want.filter((w) => have.has(w)).length / want.length;
}

/** Real, named public figures don't belong in a storyboard of invented people. */
const PUBLIC_FIGURE = /\b(president|senator|governor|mayor|minister|prime minister|congress(?:man|woman)?|king|queen|prince|princess|pope|celebrity|actor|actress|rapper|singer)\b/i;

const RATIO: Record<string, number> = { '21:9': 2.39, '16:9': 16 / 9, '4:3': 4 / 3, '1:1': 1, '9:16': 9 / 16 };

export function scoreImage(c: ImageCandidate, plan: FindPlan, ratio: number): number {
  const want = [...tokens(plan.look)].map(stem);
  const have = new Set([...tokens(`${c.title} ${c.tags.join(' ')}`)].map(stem));
  const lookOverlap = want.length ? want.filter((w) => have.has(w)).length / want.length : 0;
  const overlap = 0.7 * relevance(c) + 0.3 * Math.min(1, lookOverlap * 3);
  const aspect = c.width && c.height ? Math.max(0, 1 - Math.abs(Math.log((c.width / c.height) / ratio)) / 1.2) : 0.5;
  const size = c.width ? Math.min(1, c.width / 1600) : 0.5;
  return 0.35 * Math.min(1, overlap * 2) + 0.25 * c.sourceScore + 0.2 * aspect + 0.15 * size + 0.05 * (1 - c.license.rank / 10);
}

const PER_ROUND = 10;

const PROP_PREFIX = 'prop:';
export const propTarget = (propId: string) => `${PROP_PREFIX}${propId}`;
const propIdOf = (target: string) => (target.startsWith(PROP_PREFIX) ? target.slice(PROP_PREFIX.length) : null);

/** Props are searched by what they are: their name, then with their description. */
export function planPropFind(p: Prop): FindPlan {
  const clean = (x: string) => x.toLowerCase().replace(/[^\p{L}\p{N}\s'-]/gu, ' ').replace(/\s+/g, ' ').trim();
  const name = clean(p.name);
  const desc = clean(p.description ?? '')
    .split(' ')
    .filter((w) => w.length > 2 && !STOP.has(w))
    .slice(0, 4);
  const queries = [desc.length ? `${desc.slice(0, 2).join(' ')} ${name}` : '', name, desc.length >= 2 ? desc.join(' ') : ''].map((q) => q.trim()).filter((q) => q.length > 2);
  return { look: p.description?.trim() || p.name, queries: [...new Set(queries)].slice(0, 3), notes: [] };
}

// ── running ──────────────────────────────────────────────────────────────────

export function createFind(sp: Screenplay, shotId: string): ShotFind {
  const r = db.prepare('INSERT INTO screenplay_shot_finds (screenplay_id, shot_id) VALUES (?, ?)').run(sp.id, shotId);
  kick();
  return getFind(Number(r.lastInsertRowid))!;
}

/** Ten more from the same plan (the next page of each search). */
export function findMore(f: ShotFind): ShotFind {
  if (f.status !== 'done' && f.status !== 'failed') return f;
  save(f.id, { status: 'queued', progress: 'Looking for more…', error: null });
  kick();
  return getFind(f.id)!;
}

let running = false;
export function kick(): void {
  if (running) return;
  running = true;
  void (async () => {
    try {
      for (;;) {
        const row = db.prepare("SELECT id FROM screenplay_shot_finds WHERE status = 'queued' ORDER BY id LIMIT 1").get() as { id: number } | undefined;
        if (!row) break;
        await run(row.id).catch((e) => save(row.id, { status: 'failed', error: (e as Error).message, finished_at: new Date().toISOString() }));
      }
    } finally {
      running = false;
    }
  })();
}

/** After a restart: unfinished searches start again. */
export function resumeFinds(): void {
  db.prepare("UPDATE screenplay_shot_finds SET status = 'queued' WHERE status IN ('planning', 'searching')").run();
  kick();
}

/** Injected in tests. */
export const deps = { planFind, searchOpenverseImages, searchPexels, searchUnsplash, keys: getPhotoKeys };

async function run(id: number): Promise<void> {
  const f = getFind(id)!;
  const sp = store.getScreenplay(f.screenplay_id);
  if (!sp) throw new Error('The screenplay was deleted');
  const propId = propIdOf(f.shot_id);
  const prop = propId ? (sp.doc.props ?? []).find((p) => p.id === propId) : undefined;
  const shot = propId ? undefined : sp.doc.shots.find((s) => s.id === f.shot_id);
  if (propId && !prop) throw new Error('That prop no longer exists');
  if (!propId && !shot) throw new Error('That shot no longer exists');

  let plan = f.plan;
  if (!plan.queries?.length) {
    save(id, { status: 'planning', progress: prop ? 'Reading the prop…' : 'Reading the shot…' });
    plan = prop ? planPropFind(prop) : await deps.planFind(shotBrief(sp, shot!), activeAdjustments(shot!), sp.doc.characters.map((c) => c.name).filter(Boolean));
    if (!plan.queries.length) throw new Error(prop ? 'Name the prop first.' : 'Nothing to search for yet. Write the action for this shot, or add an adjustment note.');
    save(id, { plan });
  }

  // Props: any shape (the object matters, not the framing). Shots: the film's frame.
  const ratio = prop ? 1 : (RATIO[sp.doc.settings.ratio ?? '21:9'] ?? 16 / 9);
  const opts = (page: number): SearchOpts => ({ page, wide: ratio > 1.2, keys: deps.keys() });
  const seen = new Set(f.candidates.map((c) => c.key));
  const found = new Map<string, ImageCandidate>();
  const errors: string[] = [];
  let page = f.page;
  // Keep paging until there are ten new photos, or the libraries run dry.
  for (let tries = 0; tries < 3 && found.size < PER_ROUND * 2; tries++) {
    page += 1;
    let any = false;
    for (const q of plan.queries) {
      save(id, { status: 'searching', progress: `Searching for “${q}”…` });
      const results = await Promise.allSettled([deps.searchOpenverseImages(q, opts(page)), deps.searchPexels(q, opts(page)), deps.searchUnsplash(q, opts(page))]);
      results.forEach((r, i) => {
        if (r.status === 'rejected') {
          const msg = `${['Openverse', 'Pexels', 'Unsplash'][i]}: ${(r.reason as Error)?.message ?? 'failed'}`;
          if (!errors.includes(msg)) errors.push(msg);
          return;
        }
        for (const c of r.value) {
          any = true;
          // Off-topic matches (the library matched one word, or the description only) and public figures are dropped.
          const keyed = c.source !== 'openverse' || relevance(c) >= 0.6;
          if (keyed && !PUBLIC_FIGURE.test(c.title) && !seen.has(c.key) && !found.has(c.key)) found.set(c.key, c);
        }
      });
    }
    if (!any) break;
  }
  // Best first, but no more than four from one search so the ten stay varied.
  const ranked = [...found.values()].sort((a, b) => scoreImage(b, plan, ratio) - scoreImage(a, plan, ratio));
  const perQuery = new Map<string, number>();
  const picked: ImageCandidate[] = [];
  for (const c of ranked) {
    if (picked.length >= PER_ROUND) break;
    const n = perQuery.get(c.query) ?? 0;
    if (n >= 4) continue;
    perQuery.set(c.query, n + 1);
    picked.push(c);
  }
  for (const c of ranked) if (picked.length < PER_ROUND && !picked.includes(c)) picked.push(c);

  const candidates = [...f.candidates, ...picked];
  if (!picked.length && !f.candidates.length && errors.length) throw new Error(errors.join(' · '));
  save(id, {
    status: 'done',
    candidates,
    page,
    progress: picked.length ? `${candidates.length} photos` : f.candidates.length ? 'No more photos for these searches. Try an adjustment note and search again.' : 'No photos found. Try an adjustment note and search again.',
    error: errors.length ? errors.join(' · ') : null,
    finished_at: new Date().toISOString(),
  });
}

// ── keeping a pick ───────────────────────────────────────────────────────────

const MAX_BYTES = 30 * 1024 * 1024;

/**
 * Download a photo this search found and keep it with the screenplay as an
 * image for the shot ('reference' row, details in meta). Returns the row id.
 */
export async function keepFound(
  sp: Screenplay,
  f: ShotFind,
  key: string,
  saveImage: (bytes: Buffer, mime: string, filename: string) => number,
): Promise<number> {
  const c = f.candidates.find((x) => x.key === key);
  if (!c) throw new Error('That photo isn’t in this search');
  const propId = propIdOf(f.shot_id);
  const role = propId ? 'prop' : 'reference';
  const target = propId ?? f.shot_id;
  const existing = store.listMedia(sp.id, role).find((m) => parse<{ found?: { key?: string } }>(m.meta ?? '{}', {}).found?.key === key);
  if (existing) {
    if (existing.target !== target) store.updateMedia(existing.id, { target });
    return existing.id;
  }
  const url = new URL(c.imageUrl);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Unsupported link');
  const r = await fetch(url, { headers: { 'User-Agent': 'DeadChat/1.0 (self-hosted screenplay tool)' }, redirect: 'follow', signal: AbortSignal.timeout(60_000) });
  if (!r.ok) throw new Error(`${url.host} answered ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new Error('That photo is too large (over 30 MB)');
  const mime = (r.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (!/^image\/(jpeg|png|webp|gif)$/.test(mime)) throw new Error('That link isn’t a photo');
  if (c.downloadPing) {
    const keys = deps.keys();
    if (keys.unsplash) void fetch(c.downloadPing, { headers: { Authorization: `Client-ID ${keys.unsplash}` } }).catch(() => undefined);
  }
  const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : mime === 'image/gif' ? 'gif' : 'jpg';
  const mediaId = saveImage(buf, mime, `${c.title.replace(/[^\w .-]+/g, '_').slice(0, 80) || 'photo'}.${ext}`);
  const row = store.addMedia(sp.id, role, target, { status: 'ready', media_id: mediaId, label: c.title.slice(0, 200) });
  store.updateMedia(row.id, {
    meta: JSON.stringify({
      found: {
        key,
        source: c.source,
        sourceName: c.sourceName,
        title: c.title,
        creator: c.creator,
        landingUrl: c.landingUrl,
        imageUrl: c.imageUrl,
        license: c.license,
      },
    }),
  });
  return row.id;
}
