import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateFactCheck, htmlToText, isTrusted, parseFeed, rootDomain, topicKey } from './factcheck';
import { buildFacets, fitText, graphemeLength, sourcesReply, checklistDone, getPlatform } from './platforms';

// ── trust ──────────────────────────────────────────────────────────────────

test('rootDomain collapses subdomains, including two-level TLDs', () => {
  assert.equal(rootDomain('www.apnews.com'), 'apnews.com');
  assert.equal(rootDomain('news.bbc.co.uk'), 'bbc.co.uk');
  assert.equal(rootDomain('sos.wa.gov'), 'wa.gov');
});

test('trusted list, suffixes, per-influencer additions and blocks', () => {
  assert.equal(isTrusted('apnews.com'), true);
  assert.equal(isTrusted('elections.sos.wa.gov'), true);
  assert.equal(isTrusted('stanford.edu'), true);
  assert.equal(isTrusted('randomblog.example'), false);
  assert.equal(isTrusted('localpaper.com', { trustedDomains: ['localpaper.com'] }), true);
  assert.equal(isTrusted('cnn.com', { blockedDomains: ['cnn.com'] }), false);
  assert.equal(isTrusted('evilapnews.com'), false);
});

// ── verdicts ───────────────────────────────────────────────────────────────

const research = { minSources: 2 };

test('a claim needs two independent trusted domains', () => {
  const fc = aggregateFactCheck(
    [{ claim: 'X passed', evidence: [{ domain: 'apnews.com', verdict: 'supports' }, { domain: 'npr.org', verdict: 'supports' }] }],
    research,
  );
  assert.equal(fc.passed, true);
  assert.equal(fc.claims[0].verdict, 'supported');
});

test('two pages from the same outlet count once', () => {
  const fc = aggregateFactCheck(
    [{ claim: 'X', evidence: [{ domain: 'apnews.com', verdict: 'supports' }, { domain: 'www.apnews.com', verdict: 'supports' }] }],
    research,
  );
  assert.equal(fc.passed, false);
  assert.equal(fc.claims[0].verdict, 'unsupported');
});

test('untrusted support does not count and any trusted contradiction fails', () => {
  const untrusted = aggregateFactCheck(
    [{ claim: 'X', evidence: [{ domain: 'apnews.com', verdict: 'supports' }, { domain: 'blog.example', verdict: 'supports' }] }],
    research,
  );
  assert.equal(untrusted.passed, false);
  const contradicted = aggregateFactCheck(
    [{ claim: 'X', evidence: [
      { domain: 'apnews.com', verdict: 'supports' },
      { domain: 'npr.org', verdict: 'supports' },
      { domain: 'reuters.com', verdict: 'contradicts' },
    ] }],
    research,
  );
  assert.equal(contradicted.passed, false);
  assert.equal(contradicted.claims[0].verdict, 'contradicted');
});

test('every claim must pass', () => {
  const ok = { domain: 'apnews.com', verdict: 'supports' as const };
  const ok2 = { domain: 'npr.org', verdict: 'supports' as const };
  const fc = aggregateFactCheck(
    [{ claim: 'A', evidence: [ok, ok2] }, { claim: 'B', evidence: [ok] }],
    research,
  );
  assert.equal(fc.passed, false);
  assert.match(fc.reason ?? '', /1 of 2/);
});

test('topicKey ignores word order and small words', () => {
  assert.equal(topicKey('Senate passes the transit bill'), topicKey('Transit bill passes Senate'));
});

// ── parsing ────────────────────────────────────────────────────────────────

test('parseFeed reads RSS and Atom', () => {
  const rss = `<rss><channel><item><title><![CDATA[Budget deal &amp; vote]]></title><link>https://npr.org/a</link><pubDate>Tue, 03 Nov 2026 10:00:00 GMT</pubDate></item></channel></rss>`;
  const atom = `<feed><entry><title>Court ruling</title><link rel="alternate" href="https://apnews.com/b"/><updated>2026-11-03T10:00:00Z</updated></entry></feed>`;
  assert.deepEqual(parseFeed(rss)[0], { title: 'Budget deal & vote', url: 'https://npr.org/a', publishedAt: 'Tue, 03 Nov 2026 10:00:00 GMT', summary: undefined });
  assert.equal(parseFeed(atom)[0].url, 'https://apnews.com/b');
});

test('htmlToText keeps article text and drops scripts and navigation', () => {
  const html = `<html><head><title>Story</title><meta property="article:published_time" content="2026-11-03"></head>
    <body><nav>Menu</nav><article><h1>Headline</h1><p>First fact.</p><script>evil()</script><p>Second fact.</p></article></body></html>`;
  const out = htmlToText(html);
  assert.equal(out.title, 'Story');
  assert.equal(out.publishedAt, '2026-11-03');
  assert.match(out.text, /Headline\nFirst fact\.\nSecond fact\./);
  assert.doesNotMatch(out.text, /evil|Menu/);
});

// ── platform text ──────────────────────────────────────────────────────────

test('fitText shortens to the limit on a word boundary', () => {
  const out = fitText('word '.repeat(100), 300);
  assert.ok(graphemeLength(out) <= 300, `length ${graphemeLength(out)}`);
  assert.match(out, /word…$/);
  assert.equal(fitText('short post', 300), 'short post');
});

test('Bluesky facets use UTF-8 byte offsets for links and tags', () => {
  const text = 'Café update https://x.test/a #reefwatch';
  const facets = buildFacets(text);
  const bytes = new TextEncoder().encode(text);
  const slice = (f: (typeof facets)[number]) => new TextDecoder().decode(bytes.slice(f.index.byteStart, f.index.byteEnd));
  assert.deepEqual(facets.map(slice), ['https://x.test/a', '#reefwatch']);
  assert.equal(facets[1].features[0].tag, 'reefwatch');
});

test('sources reply links short labels to full URLs', () => {
  const r = sourcesReply([{ url: 'https://apnews.com/article/very/long/path', domain: 'apnews.com' }]);
  assert.equal(r.text, 'Sources:\n• apnews.com');
  const f = buildFacets(r.text, r.links);
  assert.equal(f[0].features[0].uri, 'https://apnews.com/article/very/long/path');
});

test('platform checklists require every required item', () => {
  const bsky = getPlatform('bluesky')!;
  const all = Object.fromEntries(bsky.checklist.map((c) => [c.id, true]));
  assert.equal(checklistDone(bsky, all), true);
  assert.equal(checklistDone(bsky, { ...all, 'bio-disclosure': false }), false);
});
