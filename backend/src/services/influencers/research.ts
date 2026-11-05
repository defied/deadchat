// Web research for text influencers: search providers, page fetching, RSS
// feeds and (optionally) what people are posting about a topic on Bluesky.

import db from '../../db/connection';
import { decrypt, encrypt } from '../secrets';
import { domainOf } from './compliance';
import { htmlToText, parseFeed, type FeedItem } from './factcheck';

const SEARXNG_KEY = 'research_searxng_url';
const BRAVE_KEY = 'research_brave_key';
const UA = 'DeadChat-Research/1.0 (+https://deadchat.deadplanet.net)';

function setting(key: string): string | null {
  const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return r?.value || null;
}

function putSetting(key: string, value: string | null): void {
  if (!value) {
    db.prepare('DELETE FROM settings WHERE key = ?').run(key);
    return;
  }
  const exists = db.prepare('SELECT 1 FROM settings WHERE key = ?').get(key);
  if (exists) db.prepare("UPDATE settings SET value = ?, updated_at = datetime('now') WHERE key = ?").run(value, key);
  else db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(key, value);
}

export interface ResearchSettings {
  searxngUrl: string | null;
  braveKeySet: boolean;
}

export function getResearchSettings(): ResearchSettings {
  return { searxngUrl: process.env.SEARXNG_URL || setting(SEARXNG_KEY), braveKeySet: !!braveKey() };
}

function braveKey(): string | null {
  if (process.env.BRAVE_SEARCH_API_KEY) return process.env.BRAVE_SEARCH_API_KEY;
  const enc = setting(BRAVE_KEY);
  if (!enc) return null;
  try {
    return decrypt(enc);
  } catch {
    return null;
  }
}

export function setResearchSettings(p: { searxngUrl?: string | null; braveKey?: string | null }): ResearchSettings {
  if (p.searxngUrl !== undefined) {
    const v = p.searxngUrl?.trim().replace(/\/+$/, '') || null;
    if (v && !/^https?:\/\//i.test(v)) throw new Error('SearXNG URL must start with http:// or https://');
    putSetting(SEARXNG_KEY, v);
  }
  if (p.braveKey !== undefined) putSetting(BRAVE_KEY, p.braveKey ? encrypt(p.braveKey.trim()) : null);
  return getResearchSettings();
}

export function researchConfigured(): boolean {
  const s = getResearchSettings();
  return !!s.searxngUrl || s.braveKeySet;
}

export interface SearchResult {
  url: string;
  title: string;
  snippet: string;
  domain: string;
  publishedAt?: string;
}

/** Web/news search via SearXNG (preferred, self-hosted) or Brave Search. */
export async function webSearch(query: string, count = 10): Promise<SearchResult[]> {
  const s = getResearchSettings();
  if (s.searxngUrl) {
    const u = new URL(`${s.searxngUrl}/search`);
    u.searchParams.set('q', query);
    u.searchParams.set('format', 'json');
    u.searchParams.set('categories', 'news,general');
    u.searchParams.set('language', 'en');
    const r = await fetch(u, { signal: AbortSignal.timeout(20_000), headers: { 'User-Agent': UA } });
    if (!r.ok) throw new Error(`SearXNG ${r.status}`);
    const data = (await r.json()) as { results?: Array<{ url: string; title?: string; content?: string; publishedDate?: string }> };
    return (data.results ?? []).slice(0, count).map((x) => ({
      url: x.url,
      title: x.title ?? x.url,
      snippet: x.content ?? '',
      domain: domainOf(x.url),
      publishedAt: x.publishedDate,
    }));
  }
  const key = braveKey();
  if (key) {
    const u = new URL('https://api.search.brave.com/res/v1/web/search');
    u.searchParams.set('q', query);
    u.searchParams.set('count', String(Math.min(20, count)));
    u.searchParams.set('freshness', 'pw');
    const r = await fetch(u, {
      signal: AbortSignal.timeout(20_000),
      headers: { Accept: 'application/json', 'X-Subscription-Token': key },
    });
    if (!r.ok) throw new Error(`Brave Search ${r.status}`);
    const data = (await r.json()) as {
      web?: { results?: Array<{ url: string; title?: string; description?: string; page_age?: string }> };
    };
    return (data.web?.results ?? []).slice(0, count).map((x) => ({
      url: x.url,
      title: x.title ?? x.url,
      snippet: (x.description ?? '').replace(/<[^>]+>/g, ''),
      domain: domainOf(x.url),
      publishedAt: x.page_age,
    }));
  }
  throw new Error('No web search provider is configured');
}

export interface Page {
  url: string;
  domain: string;
  title?: string;
  text: string;
  publishedAt?: string;
}

/** Fetch a page and return its readable text. */
export async function fetchPage(url: string, maxChars = 6000): Promise<Page> {
  const r = await fetch(url, {
    signal: AbortSignal.timeout(20_000),
    redirect: 'follow',
    headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const type = r.headers.get('content-type') ?? '';
  if (!/html|xml|text/i.test(type)) throw new Error(`Unsupported content type ${type}`);
  const html = (await r.text()).slice(0, 2_000_000);
  const parsed = htmlToText(html, maxChars);
  const finalUrl = r.url || url;
  return { url: finalUrl, domain: domainOf(finalUrl), ...parsed };
}

export async function fetchFeed(url: string): Promise<FeedItem[]> {
  const r = await fetch(url, {
    signal: AbortSignal.timeout(15_000),
    headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' },
  });
  if (!r.ok) throw new Error(`Feed ${r.status}`);
  return parseFeed(await r.text());
}

/**
 * What people are saying about a topic on Bluesky (public search). Used only
 * as a signal of what's being discussed: handles are dropped, and posts are
 * never replied to or quoted.
 */
export async function blueskyConversation(topic: string, limit = 8): Promise<string[]> {
  const u = new URL('https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts');
  u.searchParams.set('q', topic);
  u.searchParams.set('sort', 'top');
  u.searchParams.set('limit', String(limit));
  try {
    const r = await fetch(u, { signal: AbortSignal.timeout(15_000), headers: { 'User-Agent': UA } });
    if (!r.ok) return [];
    const data = (await r.json()) as { posts?: Array<{ record?: { text?: string } }> };
    return (data.posts ?? [])
      .map((p) => (p.record?.text ?? '').replace(/@[\w.-]+/g, '@someone').replace(/\s+/g, ' ').trim())
      .filter((t) => t.length > 20)
      .slice(0, limit);
  } catch {
    return [];
  }
}
