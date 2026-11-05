// Source trust and claim verdicts (pure, unit-tested).
//
// A post passes the fact-check only if every factual claim in it is supported
// by at least `minSources` independent trusted sources and contradicted by
// none. "Independent" means different registrable domains, so two pages on
// apnews.com count once.

import type { ClaimCheck, FactCheck, Research } from './types';

/**
 * Built-in trusted sources: wire services, public broadcasters, major papers
 * of record across the spectrum, fact-checkers, and official / scientific
 * bodies. Each influencer can add domains or block any of these.
 */
export const DEFAULT_TRUSTED_DOMAINS = [
  // wire services & public broadcasters
  'apnews.com', 'reuters.com', 'afp.com', 'bbc.com', 'bbc.co.uk', 'npr.org', 'pbs.org', 'c-span.org', 'cbc.ca', 'abc.net.au',
  // papers of record & business press
  'nytimes.com', 'washingtonpost.com', 'wsj.com', 'ft.com', 'economist.com', 'bloomberg.com', 'theguardian.com',
  'latimes.com', 'usatoday.com', 'axios.com', 'politico.com', 'thehill.com', 'nationalreview.com', 'theatlantic.com',
  'cbsnews.com', 'nbcnews.com', 'abcnews.go.com', 'cnn.com', 'foxnews.com', 'propublica.org',
  // fact-checkers
  'factcheck.org', 'politifact.com', 'snopes.com', 'fullfact.org', 'apfactcheck.org',
  // research & official bodies
  'pewresearch.org', 'congress.gov', 'supremecourt.gov', 'whitehouse.gov', 'census.gov', 'bls.gov', 'cdc.gov', 'nih.gov',
  'who.int', 'un.org', 'imf.org', 'worldbank.org', 'oecd.org', 'europa.eu', 'nature.com', 'science.org', 'thelancet.com', 'nejm.org',
  'ballotpedia.org', 'vote.gov', 'eac.gov', 'fec.gov',
];

/** Suffixes that are trusted wholesale (government, military, education, intergovernmental). */
const TRUSTED_SUFFIXES = ['.gov', '.mil', '.edu', '.gov.uk', '.gc.ca', '.gov.au', '.int'];

const TWO_LEVEL_TLDS = new Set(['co.uk', 'org.uk', 'gov.uk', 'ac.uk', 'com.au', 'gov.au', 'net.au', 'org.au', 'co.nz', 'gc.ca', 'co.jp']);

/** "news.bbc.co.uk" → "bbc.co.uk", "www.apnews.com" → "apnews.com". */
export function rootDomain(host: string): string {
  const h = host.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
  const parts = h.split('.');
  if (parts.length <= 2) return h;
  const lastTwo = parts.slice(-2).join('.');
  return TWO_LEVEL_TLDS.has(lastTwo) ? parts.slice(-3).join('.') : lastTwo;
}

function matchesDomain(host: string, domain: string): boolean {
  const h = host.toLowerCase().replace(/^www\./, '');
  const d = domain.toLowerCase().replace(/^www\./, '').replace(/^\*\./, '');
  return h === d || h.endsWith(`.${d}`);
}

export function isTrusted(host: string, research: Research = {}): boolean {
  if (!host) return false;
  if ((research.blockedDomains ?? []).some((d) => matchesDomain(host, d))) return false;
  if ((research.trustedDomains ?? []).some((d) => matchesDomain(host, d))) return true;
  if (DEFAULT_TRUSTED_DOMAINS.some((d) => matchesDomain(host, d))) return true;
  const h = host.toLowerCase();
  return TRUSTED_SUFFIXES.some((s) => h.endsWith(s));
}

export type SourceVerdict = 'supports' | 'contradicts' | 'irrelevant';

export interface ClaimEvidence {
  claim: string;
  /** One entry per source the claim was checked against. */
  evidence: Array<{ domain: string; verdict: SourceVerdict; quote?: string }>;
}

/** Turn per-source verdicts into a per-claim result and an overall pass/fail. */
export function aggregateFactCheck(items: ClaimEvidence[], research: Research, now = new Date()): FactCheck {
  const minSources = Math.max(1, Math.min(5, research.minSources ?? 2));
  const claims: ClaimCheck[] = items.map((item) => {
    const trusted = item.evidence.filter((e) => isTrusted(e.domain, research));
    const supporting = [...new Set(trusted.filter((e) => e.verdict === 'supports').map((e) => rootDomain(e.domain)))];
    const contradicting = [...new Set(trusted.filter((e) => e.verdict === 'contradicts').map((e) => rootDomain(e.domain)))];
    if (contradicting.length > 0) {
      return { claim: item.claim, verdict: 'contradicted', supportingDomains: supporting, note: `Contradicted by ${contradicting.join(', ')}` };
    }
    if (supporting.length >= minSources) {
      return { claim: item.claim, verdict: 'supported', supportingDomains: supporting };
    }
    return {
      claim: item.claim,
      verdict: 'unsupported',
      supportingDomains: supporting,
      note: `Needs ${minSources} independent trusted sources, found ${supporting.length}`,
    };
  });
  const failed = claims.filter((c) => c.verdict !== 'supported');
  return {
    passed: failed.length === 0,
    claims,
    minSources,
    reason: failed.length ? `${failed.length} of ${claims.length} claims could not be verified` : undefined,
    checkedAt: now.toISOString(),
  };
}

/** Stable key for a story, so the same headline isn't covered twice. */
export function topicKey(title: string): string {
  const words = title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3)
    .slice(0, 8)
    .sort();
  return words.join('-').slice(0, 120);
}

export interface FeedItem {
  title: string;
  url: string;
  publishedAt?: string;
  summary?: string;
}

function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&');
}

function tag(block: string, name: string): string | undefined {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? decodeEntities(m[1]).replace(/<[^>]+>/g, '').trim() : undefined;
}

/** Parse RSS 2.0 or Atom into items. */
export function parseFeed(xml: string, limit = 30): FeedItem[] {
  const items: FeedItem[] = [];
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>|<entry[\s>][\s\S]*?<\/entry>/gi) ?? [];
  for (const b of blocks.slice(0, limit)) {
    const title = tag(b, 'title');
    let url = tag(b, 'link');
    if (!url) {
      const href = b.match(/<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i) ?? b.match(/<link[^>]*href=["']([^"']+)["']/i);
      url = href ? decodeEntities(href[1]) : undefined;
    }
    if (!title || !url || !/^https?:\/\//i.test(url)) continue;
    items.push({
      title,
      url: url.trim(),
      publishedAt: tag(b, 'pubDate') ?? tag(b, 'updated') ?? tag(b, 'published'),
      summary: (tag(b, 'description') ?? tag(b, 'summary'))?.slice(0, 400),
    });
  }
  return items;
}

/** Visible text of an HTML page (no scripts/styles/navigation), collapsed. */
export function htmlToText(html: string, maxChars = 8000): { title?: string; text: string; publishedAt?: string } {
  const title = tag(html, 'title');
  const published =
    html.match(/<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)["']/i)?.[1] ??
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']article:published_time["']/i)?.[1];
  const body = (html.match(/<article[\s\S]*?<\/article>/i)?.[0] ?? html.match(/<body[\s\S]*<\/body>/i)?.[0] ?? html)
    .replace(/<(script|style|noscript|svg|nav|header|footer|form|aside)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/p>|<\/h\d>|<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  const text = decodeEntities(body)
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim()
    .slice(0, maxChars);
  return { title, text, publishedAt: published };
}
