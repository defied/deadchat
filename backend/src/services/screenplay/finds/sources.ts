// Photo libraries the shot finder searches. Openverse needs no key (openly
// licensed photos from Flickr, Wikimedia Commons and others); Pexels and
// Unsplash join in when an admin adds their free API keys.

import { allowed, licenseOf, stockLicense, type LicenseInfo } from '../sounds/licenses';

export interface ImageCandidate {
  /** Unique across sources: "<source>:<id>". */
  key: string;
  source: 'openverse' | 'pexels' | 'unsplash';
  /** Where it really comes from, e.g. "Flickr", "Wikimedia Commons", "Pexels". */
  sourceName: string;
  title: string;
  creator: string | null;
  license: LicenseInfo;
  /** Page to credit and to open. */
  landingUrl: string;
  /** Full-size image to keep. */
  imageUrl: string;
  /** Small image for the grid (loaded by the browser straight from the source). */
  thumbUrl: string;
  width: number | null;
  height: number | null;
  tags: string[];
  /** The search that found it. */
  query: string;
  /** Rank in that search, 0..1 (higher is better). */
  sourceScore: number;
  /** Unsplash asks to be told when a photo is used. */
  downloadPing?: string;
  /** The vision model's look at the photo, when it ran. */
  check?: { score: number; sees: string; missing: string };
}

export interface SearchOpts {
  page: number;
  /** Prefer wide/landscape pictures. */
  wide: boolean;
  /** Admin API keys, when set. */
  keys: { pexels?: string | null; unsplash?: string | null };
}

const UA = 'DeadChat/1.0 (self-hosted screenplay tool; shot search)';
const TIMEOUT = 20_000;

async function getJson<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json', ...headers }, signal: AbortSignal.timeout(TIMEOUT) });
  if (!r.ok) {
    const body = (await r.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 160);
    throw Object.assign(new Error(`${new URL(url).host} answered ${r.status}${body ? `: ${body}` : ''}`), { status: r.status });
  }
  return (await r.json()) as T;
}

// ── Openverse ────────────────────────────────────────────────────────────────

interface OvImage {
  id: string;
  title?: string;
  creator?: string;
  license?: string;
  license_version?: string;
  license_url?: string;
  foreign_landing_url?: string;
  url?: string;
  thumbnail?: string;
  width?: number;
  height?: number;
  source?: string;
  tags?: Array<{ name: string }>;
  mature?: boolean;
}

const OV_SOURCES: Record<string, string> = {
  flickr: 'Flickr',
  wikimedia: 'Wikimedia Commons',
  nappy: 'Nappy',
  rawpixel: 'rawpixel',
  stocksnap: 'StockSnap',
  geographorguk: 'Geograph',
};

export async function searchOpenverseImages(q: string, opts: SearchOpts): Promise<ImageCandidate[]> {
  // Anonymous requests may ask for up to 20 a page.
  const p = new URLSearchParams({ q, page: String(opts.page), page_size: '20', mature: 'false', license_type: 'commercial,modification', category: 'photograph' });
  if (opts.wide) p.set('aspect_ratio', 'wide');
  let d: { results?: OvImage[] };
  try {
    d = await getJson<{ results?: OvImage[] }>(`https://api.openverse.org/v1/images/?${p}`);
  } catch (e) {
    if ((e as { status?: number }).status !== 400) throw e;
    // Past the last page Openverse answers 400. On page 1 it's a refused
    // filter: try once more without the optional ones.
    if (opts.page > 1) return [];
    p.delete('category');
    p.delete('aspect_ratio');
    try {
      d = await getJson<{ results?: OvImage[] }>(`https://api.openverse.org/v1/images/?${p}`);
    } catch (e2) {
      if ((e2 as { status?: number }).status === 400) return [];
      throw e2;
    }
  }
  const rows = (d.results ?? []).filter((r) => r.url && !r.mature);
  return rows
    .map((r, i) => ({
      key: `openverse:${r.id}`,
      source: 'openverse' as const,
      sourceName: OV_SOURCES[r.source ?? ''] ?? (r.source ? r.source.replace(/_/g, ' ') : 'Openverse'),
      title: (r.title ?? 'Untitled').trim().slice(0, 200),
      creator: r.creator?.trim() || null,
      license: licenseOf(r.license_url || r.license, r.license_version),
      landingUrl: r.foreign_landing_url ?? `https://openverse.org/image/${r.id}`,
      imageUrl: r.url!,
      thumbUrl: `https://api.openverse.org/v1/images/${r.id}/thumb/`,
      width: r.width ?? null,
      height: r.height ?? null,
      tags: (r.tags ?? []).map((t) => t.name).slice(0, 20),
      query: q,
      sourceScore: 1 - i / Math.max(1, rows.length),
    }))
    .filter((c) => allowed(c.license));
}

// ── Pexels ───────────────────────────────────────────────────────────────────

interface PxPhoto {
  id: number;
  width?: number;
  height?: number;
  url?: string;
  photographer?: string;
  alt?: string;
  src?: { original?: string; large2x?: string; large?: string; medium?: string };
}

export async function searchPexels(q: string, opts: SearchOpts): Promise<ImageCandidate[]> {
  const key = opts.keys.pexels;
  if (!key) return [];
  const p = new URLSearchParams({ query: q, page: String(opts.page), per_page: '20' });
  if (opts.wide) p.set('orientation', 'landscape');
  const d = await getJson<{ photos?: PxPhoto[] }>(`https://api.pexels.com/v1/search?${p}`, { Authorization: key });
  const rows = (d.photos ?? []).filter((r) => r.src?.large2x || r.src?.original);
  return rows.map((r, i) => ({
    key: `pexels:${r.id}`,
    source: 'pexels' as const,
    sourceName: 'Pexels',
    title: (r.alt || 'Untitled').trim().slice(0, 200),
    creator: r.photographer?.trim() || null,
    license: stockLicense('pexels'),
    landingUrl: r.url ?? `https://www.pexels.com/photo/${r.id}/`,
    imageUrl: r.src?.large2x ?? r.src!.original!,
    thumbUrl: r.src?.medium ?? r.src?.large ?? r.src!.original!,
    width: r.width ?? null,
    height: r.height ?? null,
    tags: [],
    query: q,
    sourceScore: 1 - i / Math.max(1, rows.length),
  }));
}

// ── Unsplash ─────────────────────────────────────────────────────────────────

interface UsPhoto {
  id: string;
  width?: number;
  height?: number;
  description?: string | null;
  alt_description?: string | null;
  urls?: { full?: string; regular?: string; small?: string };
  links?: { html?: string; download_location?: string };
  user?: { name?: string };
  tags?: Array<{ title?: string }>;
}

export async function searchUnsplash(q: string, opts: SearchOpts): Promise<ImageCandidate[]> {
  const key = opts.keys.unsplash;
  if (!key) return [];
  const p = new URLSearchParams({ query: q, page: String(opts.page), per_page: '20', content_filter: 'high' });
  if (opts.wide) p.set('orientation', 'landscape');
  const d = await getJson<{ results?: UsPhoto[] }>(`https://api.unsplash.com/search/photos?${p}`, { Authorization: `Client-ID ${key}`, 'Accept-Version': 'v1' });
  const rows = (d.results ?? []).filter((r) => r.urls?.regular);
  return rows.map((r, i) => ({
    key: `unsplash:${r.id}`,
    source: 'unsplash' as const,
    sourceName: 'Unsplash',
    title: (r.alt_description || r.description || 'Untitled').trim().slice(0, 200),
    creator: r.user?.name?.trim() || null,
    license: stockLicense('unsplash'),
    landingUrl: r.links?.html ?? `https://unsplash.com/photos/${r.id}`,
    // ~2000 px wide is plenty for a frame and to recreate from.
    imageUrl: r.urls?.full ? `${r.urls.full}${r.urls.full.includes('?') ? '&' : '?'}w=2400` : r.urls!.regular!,
    thumbUrl: r.urls?.small ?? r.urls!.regular!,
    width: r.width ?? null,
    height: r.height ?? null,
    tags: (r.tags ?? []).map((t) => t.title ?? '').filter(Boolean),
    query: q,
    sourceScore: 1 - i / Math.max(1, rows.length),
    downloadPing: r.links?.download_location,
  }));
}
