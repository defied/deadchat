// Free audio libraries the gatherer searches. No API keys: Archive.org's
// search and metadata APIs, and Openverse (openly licensed audio from
// Freesound, Wikimedia Commons, Jamendo, ccMixter and others).

import { licenseOf, type LicenseInfo } from './licenses';

export interface Candidate {
  /** Unique across sources: "<source>:<id>[:<file>]". */
  key: string;
  source: 'archive' | 'openverse';
  /** Where it really comes from, e.g. "Freesound", "Internet Archive". */
  sourceName: string;
  title: string;
  creator: string | null;
  license: LicenseInfo;
  /** Page to credit and to open. */
  landingUrl: string;
  /** Direct audio file (also used for previews). */
  audioUrl: string;
  durationS: number | null;
  tags: string[];
  /** 'sound_effect' | 'music' | 'audiobook' | … when the source says. */
  category: string | null;
  /** Relevance from the source (higher is better), 0..1 after normalising. */
  sourceScore: number;
}

const UA = 'DeadChat/1.0 (self-hosted screenplay tool; sound search)';
const TIMEOUT = 20_000;

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT) });
  if (!r.ok) throw new Error(`${new URL(url).host} answered ${r.status}`);
  return (await r.json()) as T;
}

/** "12:34" / "1:02:03" / "83.5" → seconds. */
export function parseLength(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string' || !v.trim()) return null;
  if (/^\d+(\.\d+)?$/.test(v.trim())) return Number(v);
  const parts = v.trim().split(':').map(Number);
  if (parts.some((n) => !Number.isFinite(n))) return null;
  return parts.reduce((t, n) => t * 60 + n, 0);
}

// ── Openverse ────────────────────────────────────────────────────────────────

interface OvAudio {
  id: string;
  title?: string;
  creator?: string;
  license?: string;
  license_version?: string;
  license_url?: string;
  foreign_landing_url?: string;
  url?: string;
  duration?: number; // ms
  source?: string;
  provider?: string;
  category?: string;
  tags?: Array<{ name: string }>;
  mature?: boolean;
}

const OV_SOURCE_NAMES: Record<string, string> = {
  freesound: 'Freesound',
  wikimedia_audio: 'Wikimedia Commons',
  jamendo: 'Jamendo',
  ccmixter: 'ccMixter',
};

export async function searchOpenverse(q: string, opts: { nonCommercial?: boolean; category?: 'sound_effect' | 'music' | null; max?: number }): Promise<Candidate[]> {
  const p = new URLSearchParams({ q, page_size: String(Math.min(20, opts.max ?? 20)), mature: 'false' });
  // Openverse can filter to licences that allow modification (and commercial use).
  p.set('license_type', opts.nonCommercial ? 'modification' : 'commercial,modification');
  if (opts.category) p.set('category', opts.category);
  const d = await getJson<{ results?: OvAudio[] }>(`https://api.openverse.org/v1/audio/?${p}`);
  const rows = (d.results ?? []).filter((r) => r.url && !r.mature);
  return rows.map((r, i) => ({
    key: `openverse:${r.id}`,
    source: 'openverse' as const,
    sourceName: OV_SOURCE_NAMES[r.source ?? ''] ?? (r.source ? r.source.replace(/_/g, ' ') : 'Openverse'),
    title: (r.title ?? 'Untitled').trim(),
    creator: r.creator?.trim() || null,
    license: licenseOf(r.license_url || r.license, r.license_version),
    landingUrl: r.foreign_landing_url ?? `https://openverse.org/audio/${r.id}`,
    audioUrl: r.url!,
    durationS: typeof r.duration === 'number' ? r.duration / 1000 : null,
    tags: (r.tags ?? []).map((t) => t.name).slice(0, 20),
    category: r.category ?? null,
    sourceScore: 1 - i / Math.max(1, rows.length),
  }));
}

// ── Internet Archive ─────────────────────────────────────────────────────────

interface IaDoc {
  identifier: string;
  title?: string | string[];
  creator?: string | string[];
  licenseurl?: string;
  downloads?: number;
}
interface IaFile {
  name: string;
  format?: string;
  length?: string | number;
  size?: string;
  title?: string;
  source?: string;
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';
const AUDIO_FORMATS = /^(vbr mp3|128kbps mp3|64kbps mp3|mp3|ogg vorbis|flac|wave)$/i;
const PREFERRED = ['VBR MP3', '128Kbps MP3', 'MP3', 'Ogg Vorbis', '64Kbps MP3'];

/** Free (or, if asked, non-commercial) licences, by URL pattern. */
function iaLicenseClause(nonCommercial: boolean): string {
  const free = ['*publicdomain*', '*creativecommons.org/licenses/by/*', '*creativecommons.org/licenses/by-sa/*'];
  const nc = ['*creativecommons.org/licenses/by-nc/*', '*creativecommons.org/licenses/by-nc-sa/*'];
  return `(${[...free, ...(nonCommercial ? nc : [])].map((p) => `licenseurl:${p}`).join(' OR ')})`;
}

/** Lucene-safe words. */
const words = (q: string) => q.toLowerCase().replace(/[^\p{L}\p{N}\s'-]/gu, ' ').split(/\s+/).filter((w) => w.length > 1).slice(0, 8);

export async function searchArchive(q: string, opts: { nonCommercial?: boolean; max?: number; maxDurationS?: number }): Promise<Candidate[]> {
  const w = words(q);
  if (!w.length) return [];
  const text = w.map((x) => `"${x}"`).join(' AND ');
  const query = `(title:(${text}) OR subject:(${text}) OR description:(${text})) AND mediatype:audio AND ${iaLicenseClause(!!opts.nonCommercial)}`;
  const p = new URLSearchParams({ q: query, rows: String(Math.min(12, opts.max ?? 8)), output: 'json', 'sort[]': 'downloads desc' });
  for (const f of ['identifier', 'title', 'creator', 'licenseurl', 'downloads']) p.append('fl[]', f);
  const d = await getJson<{ response?: { docs?: IaDoc[] } }>(`https://archive.org/advancedsearch.php?${p}`);
  const docs = d.response?.docs ?? [];
  const out: Candidate[] = [];
  // Items can hold hundreds of files: take the few whose names best match.
  await Promise.all(
    docs.map(async (doc, rank) => {
      try {
        const meta = await getJson<{ files?: IaFile[]; metadata?: { title?: string; creator?: string | string[]; licenseurl?: string } }>(`https://archive.org/metadata/${encodeURIComponent(doc.identifier)}`);
        const license = licenseOf(meta.metadata?.licenseurl ?? doc.licenseurl);
        const files = (meta.files ?? []).filter((f) => f.format && AUDIO_FORMATS.test(f.format));
        // One encoding per recording: prefer MP3, then Ogg.
        const byBase = new Map<string, IaFile>();
        for (const f of files) {
          const base = f.name.replace(/\.[^.]+$/, '').replace(/_(vbr|64kb|128kb)$/i, '');
          const cur = byBase.get(base);
          const pri = (x: IaFile) => { const i = PREFERRED.findIndex((p) => p.toLowerCase() === (x.format ?? '').toLowerCase()); return i < 0 ? 99 : i; };
          if (!cur || pri(f) < pri(cur)) byBase.set(base, f);
        }
        const scored = [...byBase.values()]
          .map((f) => {
            const name = `${f.title ?? ''} ${f.name}`.toLowerCase();
            const hits = w.filter((x) => name.includes(x)).length;
            return { f, hits, len: parseLength(f.length) };
          })
          .filter((x) => !opts.maxDurationS || x.len == null || x.len <= opts.maxDurationS)
          .sort((a, b) => b.hits - a.hits)
          .slice(0, byBase.size > 3 ? 3 : byBase.size);
        const itemTitle = (meta.metadata?.title ?? first(doc.title)) || doc.identifier;
        const creator = first(meta.metadata?.creator ?? doc.creator) || null;
        for (const { f, len, hits } of scored) {
          const fileTitle = f.title?.trim() || f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
          out.push({
            key: `archive:${doc.identifier}:${f.name}`,
            source: 'archive',
            sourceName: 'Internet Archive',
            title: byBase.size > 1 ? `${fileTitle} (${itemTitle})` : itemTitle,
            creator,
            license,
            landingUrl: `https://archive.org/details/${encodeURIComponent(doc.identifier)}`,
            audioUrl: `https://archive.org/download/${encodeURIComponent(doc.identifier)}/${f.name.split('/').map(encodeURIComponent).join('/')}`,
            durationS: len,
            tags: [],
            category: null,
            sourceScore: (1 - rank / Math.max(1, docs.length)) * (hits ? 1 : 0.6),
          });
        }
      } catch {
        /* skip items whose metadata won't load */
      }
    }),
  );
  return out;
}
