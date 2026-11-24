// The sound gatherer: licences, planning, ranking, a full hunt with the
// libraries mocked, and keeping a pick. The DB is a temp SQLite file.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'deadchat-sounds-'));
process.env.DB_PATH = path.join(tmp, 'test.db');
process.env.MEDIA_DIR = path.join(tmp, 'media');
fs.mkdirSync(process.env.MEDIA_DIR, { recursive: true });

/* eslint-disable @typescript-eslint/no-require-imports */
const { runMigrations } = require('../../../db/migrate') as typeof import('../../../db/migrate');
const db = (require('../../../db/connection') as typeof import('../../../db/connection')).default;
const lic = require('./licenses') as typeof import('./licenses');
const src = require('./sources') as typeof import('./sources');
const g = require('./gatherer') as typeof import('./gatherer');
const store = require('../store') as typeof import('../store');
/* eslint-enable @typescript-eslint/no-require-imports */

import type { Candidate } from './sources';

before(() => {
  runMigrations();
  db.prepare("INSERT OR IGNORE INTO users (id, username, email, password_hash, role) VALUES (1, 'w', 'w@t', 'x', 'user')").run();
});

test('licences: parsed from URLs and codes, ranked by freedom, filtered for use', () => {
  const cases: Array<[string, string | undefined, string, boolean]> = [
    ['http://creativecommons.org/publicdomain/zero/1.0/', undefined, 'cc0', true],
    ['https://creativecommons.org/publicdomain/mark/1.0/', undefined, 'pdm', true],
    ['https://creativecommons.org/licenses/by/3.0/', undefined, 'by', true],
    ['by-sa', '4.0', 'by-sa', true],
    ['https://creativecommons.org/licenses/by-nc/4.0/', undefined, 'by-nc', false],
    ['https://creativecommons.org/licenses/by-nd/4.0/', undefined, 'by-nd', false],
    ['', undefined, 'unknown', false],
  ];
  for (const [u, v, code, ok] of cases) {
    const l = lic.licenseOf(u, v);
    assert.equal(l.code, code, u);
    assert.equal(lic.allowed(l), ok, u);
  }
  assert.equal(lic.licenseOf('http://creativecommons.org/licenses/by/3.0/').url, 'https://creativecommons.org/licenses/by/3.0/');
  assert.equal(lic.licenseOf('by', '4.0').name, 'CC BY 4.0');
  assert.equal(lic.allowed(lic.licenseOf('by-nc'), { allowNonCommercial: true }), true, 'NC when asked');
  assert.equal(lic.allowed(lic.licenseOf('by-nc-nd'), { allowNonCommercial: true }), false, 'never no-derivatives: we trim and mix');
  assert.ok(lic.licenseOf('cc0').rank < lic.licenseOf('by').rank && lic.licenseOf('by').rank < lic.licenseOf('by-sa').rank);
  assert.equal(lic.creditLine({ title: 'Rain', creator: 'Ann', sourceName: 'Freesound', license: lic.licenseOf('by', '4.0') }), '“Rain” by Ann (Freesound), CC BY 4.0');
  assert.deepEqual(['83.5', '1:02', '1:00:05', 'x', null].map((x) => src.parseLength(x)), [83.5, 62, 3605, null, null]);
});

const cand = (over: Partial<Candidate>): Candidate => ({
  key: over.key ?? `openverse:${Math.random()}`,
  source: 'openverse',
  sourceName: 'Freesound',
  title: 'x',
  creator: null,
  license: lic.licenseOf('cc0'),
  landingUrl: 'https://freesound.org/s/1',
  audioUrl: 'https://cdn.freesound.org/1.mp3',
  durationS: 10,
  tags: [],
  category: 'sound_effect',
  sourceScore: 0.5,
  ...over,
});

test('ranking prefers matching, freer, well-sized sounds', () => {
  const want = { want: 'heavy rain on a window', kind: 'ambience' as const, queries: ['rain window'] };
  const good = cand({ title: 'Heavy rain on window glass', durationS: 120 });
  const freerButOff = cand({ title: 'Kitchen clatter', durationS: 120 });
  const attrib = cand({ title: 'Heavy rain on window glass', durationS: 120, license: lic.licenseOf('by-sa', '4.0') });
  const tooShort = cand({ title: 'Heavy rain on window glass', durationS: 2 });
  const s = (c: Candidate) => g.score(c, want);
  assert.ok(s(good) > s(freerButOff), 'match beats licence');
  assert.ok(s(good) > s(attrib), 'CC0 beats BY-SA at equal match');
  assert.ok(s(good) > s(tooShort), 'ambience should run long');
  const music = { want: 'melancholy solo piano', kind: 'music' as const, queries: ['sad piano'] };
  assert.ok(g.score(cand({ title: 'Sad piano', category: 'music' }), music) > g.score(cand({ title: 'Sad piano', category: 'sound_effect' }), music));
});

test('planning falls back to the request as written when the model is unavailable', async () => {
  const real = globalThis.fetch;
  globalThis.fetch = (async () => new Response('down', { status: 500 })) as typeof fetch;
  try {
    const w = await g.planWants('rain on a window, distant foghorn; sad piano', '');
    assert.deepEqual(w.map((x) => [x.want, x.kind]), [['rain on a window', 'effect'], ['distant foghorn', 'effect'], ['sad piano', 'music']]);
    assert.deepEqual(await g.planWants('', ''), []);
  } finally {
    globalThis.fetch = real;
  }
});

test('a hunt plans wants from the shot, searches both libraries, filters licences and ranks; a pick is kept with its credit', async () => {
  const sp = store.createScreenplay(1, 'Lighthouse', {
    elements: [
      { id: 's1', type: 'scene', text: 'INT. LIGHTHOUSE - NIGHT' },
      { id: 'a1', type: 'action', text: 'Rain lashes the glass. A foghorn moans out at sea.' },
    ],
    shots: [{ id: 'sh1', anchorId: 'a1', type: 'Wide' }],
    characters: [],
    plans: {},
    settings: { ratio: '16:9' },
  });
  const planned: Array<{ request: string; context: string }> = [];
  const searched: string[] = [];
  const realDeps = { ...g.deps };
  g.deps.planWants = async (request, context) => {
    planned.push({ request, context });
    return [
      { want: 'rain lashing glass', kind: 'ambience', queries: ['rain glass', 'heavy rain'] },
      { want: 'distant foghorn', kind: 'effect', queries: ['foghorn'] },
    ];
  };
  g.deps.searchOpenverse = async (q, opts) => {
    searched.push(`ov:${q}:${opts.category}:${opts.nonCommercial ? 'nc' : 'free'}`);
    if (q === 'foghorn') throw new Error('rate limited');
    return [
      cand({ key: `ov:${q}:1`, title: `Rain on glass ${q}`, durationS: 90 }),
      cand({ key: `ov:${q}:nc`, title: 'Rain glass NC', license: lic.licenseOf('by-nc', '4.0') }),
      cand({ key: 'ov:shared', title: 'Rain glass shared', durationS: 60 }),
    ];
  };
  g.deps.searchArchive = async (q) => {
    searched.push(`ia:${q}`);
    return [cand({ key: `ia:${q}`, source: 'archive', sourceName: 'Internet Archive', title: `${q} recording`, durationS: 30, license: lic.licenseOf('https://creativecommons.org/licenses/by/3.0/'), audioUrl: 'https://archive.org/download/x/a.mp3' })];
  };
  try {
    const h = g.createHunt(sp, 'sh1', 'make it stormy', {});
    let done = g.getHunt(h.id)!;
    for (let i = 0; i < 200 && !['done', 'failed'].includes(done.status); i++) {
      await new Promise((r) => setTimeout(r, 10));
      done = g.getHunt(h.id)!;
    }
    assert.equal(done.status, 'done', done.error ?? '');
    assert.equal(planned[0].request, 'make it stormy');
    assert.match(planned[0].context, /INT\. LIGHTHOUSE - NIGHT\nRain lashes the glass/);
    assert.ok(searched.includes('ov:rain glass:sound_effect:free') && searched.includes('ia:foghorn'));
    const [rain, horn] = done.wants;
    assert.ok(rain.candidates.length >= 3);
    assert.ok(rain.candidates.every((c) => c.license.code !== 'by-nc'), 'non-commercial left out by default');
    assert.equal(new Set(rain.candidates.map((c) => c.key)).size, rain.candidates.length, 'no duplicates across queries');
    assert.deepEqual(horn.errors, ['Openverse: rate limited'], 'one library failing is reported, not fatal');
    assert.deepEqual(horn.candidates.map((c) => c.sourceName), ['Internet Archive']);
    assert.match(done.progress, /Found \d+ sounds/);

    // Keep one for shot 1: downloaded, saved as audio, credited.
    const real = globalThis.fetch;
    let fetched = '';
    globalThis.fetch = (async (u: string | URL) => {
      fetched = String(u);
      return new Response(new Uint8Array([73, 68, 51, 4]), { headers: { 'content-type': 'audio/mpeg' } });
    }) as typeof fetch;
    try {
      const pick = horn.candidates[0];
      const saved: string[] = [];
      const rowId = await g.keepCandidate(store.getScreenplay(sp.id)!, done, pick.key, 'sh1', (bytes, mime, name) => {
        saved.push(`${mime}:${name}:${bytes.length}`);
        return Number(db.prepare("INSERT INTO media (user_id, type, filename, mime, size_bytes) VALUES (1, 'audio', 'f.mp3', ?, ?)").run(mime, bytes.length).lastInsertRowid);
      });
      assert.equal(fetched, 'https://archive.org/download/x/a.mp3');
      assert.deepEqual(saved, ['audio/mpeg:foghorn recording.mp3:4']);
      const row = store.getMedia(rowId)!;
      assert.deepEqual([row.role, row.target, row.label], ['sound', 'sh1', 'foghorn recording']);
      const meta = JSON.parse(row.meta!);
      assert.equal(meta.license.code, 'by');
      assert.equal(meta.sourceName, 'Internet Archive');
      assert.equal(meta.want, 'distant foghorn');
      // Keeping it again just moves it; nothing is downloaded twice.
      fetched = '';
      assert.equal(await g.keepCandidate(store.getScreenplay(sp.id)!, done, pick.key, '', () => { throw new Error('no'); }), rowId);
      assert.equal(fetched, '');
      assert.equal(store.getMedia(rowId)!.target, '');
      await assert.rejects(g.keepCandidate(store.getScreenplay(sp.id)!, done, 'made:up', '', () => 0), /isn’t in this search/);
    } finally {
      globalThis.fetch = real;
    }

    // Asking for non-commercial too.
    searched.length = 0;
    const nc = g.createHunt(sp, '', 'rain', { allowNonCommercial: true });
    let d2 = g.getHunt(nc.id)!;
    for (let i = 0; i < 200 && d2.status !== 'done'; i++) {
      await new Promise((r) => setTimeout(r, 10));
      d2 = g.getHunt(nc.id)!;
    }
    assert.ok(searched.some((s) => s.endsWith(':nc')));
    assert.ok(d2.wants[0].candidates.some((c) => c.license.code === 'by-nc'));
  } finally {
    Object.assign(g.deps, realDeps);
  }
});

test('scope text: a shot’s block, a scene, or the whole script', () => {
  const sp = store.createScreenplay(1, 'Scopes', {
    elements: [
      { id: 's1', type: 'scene', text: 'EXT. PIER - DAWN' },
      { id: 'a1', type: 'action', text: 'Gulls wheel.' },
      { id: 's2', type: 'scene', text: 'INT. BAR - NIGHT' },
      { id: 'a2', type: 'action', text: 'Glasses clink.' },
    ],
    shots: [{ id: 'sh1', anchorId: 'a2', type: 'Wide', music: 'slow blues' }],
    characters: [],
    plans: {},
    settings: { ratio: '16:9' },
  });
  assert.deepEqual(g.scopeText(sp, 'sh1'), { label: 'Shot 1', text: 'INT. BAR - NIGHT\nGlasses clink.\nMusic cue: slow blues' });
  assert.deepEqual(g.scopeText(sp, 's1'), { label: 'EXT. PIER - DAWN', text: 'EXT. PIER - DAWN\nGulls wheel.' });
  assert.match(g.scopeText(sp, 'script').text, /Gulls wheel\.[\s\S]*Glasses clink\./);
  assert.equal(g.scopeText(sp, '').text, '');
});

test('source adapters: Openverse and Internet Archive requests and result mapping', async () => {
  const real = globalThis.fetch;
  const asked: string[] = [];
  globalThis.fetch = (async (u: string | URL) => {
    const url = new URL(String(u));
    asked.push(url.toString());
    if (url.host === 'api.openverse.org' && url.searchParams.get('q') === 'refuse' && url.searchParams.get('license_type')) {
      return new Response('{"detail":"Invalid license_type"}', { status: 400 });
    }
    if (url.host === 'api.openverse.org') {
      return Response.json({
        results: [
          { id: 'abc', title: 'Rain on Window', creator: 'ann', license: 'by', license_version: '4.0', license_url: 'https://creativecommons.org/licenses/by/4.0/', foreign_landing_url: 'https://freesound.org/s/1/', url: 'https://cdn.freesound.org/previews/1.mp3', duration: 61500, source: 'freesound', category: 'sound_effect', tags: [{ name: 'rain' }, { name: 'window' }] },
          { id: 'm', title: 'Mature', url: 'https://x/y.mp3', mature: true },
        ],
      });
    }
    if (url.pathname === '/advancedsearch.php') {
      return Response.json({
        response: {
          docs: [
            { identifier: 'nd_item', title: 'No derivatives', licenseurl: 'https://creativecommons.org/licenses/by-nd/4.0/' },
            { identifier: 'nc_item', title: 'Non-commercial', licenseurl: 'https://creativecommons.org/licenses/by-nc/4.0/' },
            { identifier: 'kpod_radio', title: 'KPOD 1240 AM', licenseurl: 'https://creativecommons.org/publicdomain/mark/1.0/', collection: ['radioprograms', 'kpod'] },
            { identifier: 'storm_sfx', title: 'Storm sounds', licenseurl: 'http://creativecommons.org/publicdomain/zero/1.0/' },
          ],
        },
      });
    }
    if (url.pathname === '/metadata/storm_sfx') {
      return Response.json({
        metadata: { title: 'Storm sounds', creator: 'Bob', licenseurl: 'http://creativecommons.org/publicdomain/zero/1.0/' },
        files: [
          { name: 'rain_heavy.mp3', format: 'VBR MP3', length: '1:05' },
          { name: 'rain_heavy.ogg', format: 'Ogg Vorbis', length: '1:05' },
          { name: 'rain_heavy.wav', format: 'WAVE', length: '1:05' },
          { name: 'thunder.mp3', format: 'VBR MP3', length: '12' },
          { name: 'wind_long.mp3', format: 'VBR MP3', length: '45:00' },
          { name: 'cover.jpg', format: 'JPEG' },
        ],
      });
    }
    return new Response('nope', { status: 404 });
  }) as typeof fetch;
  try {
    const ov = await src.searchOpenverse('rain window', { category: 'sound_effect' });
    const ovUrl = new URL(asked[0]);
    assert.equal(ovUrl.searchParams.get('license_type'), 'commercial,modification');
    assert.equal(ovUrl.searchParams.get('category'), null, 'Freesound has no category: filtering on it returns nothing');
    assert.equal(ovUrl.searchParams.get('source'), 'freesound,wikimedia_audio');
    assert.equal(ov.length, 1, 'mature results dropped');
    assert.deepEqual([ov[0].key, ov[0].sourceName, ov[0].license.name, ov[0].durationS, ov[0].tags], ['openverse:abc', 'Freesound', 'CC BY 4.0', 61.5, ['rain', 'window']]);
    await src.searchOpenverse('x', { nonCommercial: true, category: 'music' });
    assert.equal(new URL(asked[1]).searchParams.get('license_type'), 'modification');
    assert.equal(new URL(asked[1]).searchParams.get('category'), 'music');
    // A refused filter falls back to naming the licences.
    asked.length = 0;
    await src.searchOpenverse('refuse', {});
    assert.equal(asked.length, 2);
    assert.equal(new URL(asked[1]).searchParams.get('license'), 'cc0,pdm,by,by-sa');
    assert.equal(new URL(asked[1]).searchParams.get('license_type'), null);

    asked.length = 0;
    const ia = await src.searchArchive('heavy rain!', { maxDurationS: 900 });
    const q = new URL(asked[0]).searchParams.get('q')!;
    assert.match(q, /^\(title:\(heavy AND rain\) OR subject:\(heavy AND rain\)\) AND mediatype:audio AND /);
    assert.match(q, /NOT collection:\(librivoxaudio OR oldtimeradio/);
    assert.match(q, /licenseurl:\(\*creativecommons\.org\*\) OR licenseurl:\(\*publicdomain\*\)/);
    assert.doesNotMatch(q.replace(/creativecommons\.org\*/g, ''), /\//, 'no slashes: Archive.org reads them as a regular expression');
    assert.equal(new URL(asked[0]).searchParams.get('rows'), '40');
    assert.ok(!asked.some((u) => u.includes('/metadata/nd_item') || u.includes('/metadata/nc_item')), 'unusable licences are dropped before fetching files');
    assert.ok(!asked.some((u) => u.includes('/metadata/kpod_radio')), 'radio captures are skipped');
    assert.deepEqual(new URL(asked[0]).searchParams.getAll('fl[]'), ['identifier', 'title', 'creator', 'licenseurl', 'downloads', 'collection']);
    // One encoding per recording, the over-long file left out, best name match first.
    assert.deepEqual(ia.map((c) => [c.title, c.durationS]), [['rain heavy (Storm sounds)', 65], ['thunder (Storm sounds)', 12]]);
    assert.equal(ia[0].audioUrl, 'https://archive.org/download/storm_sfx/rain_heavy.mp3');
    assert.equal(ia[0].license.code, 'cc0');
    assert.equal(ia[0].creator, 'Bob');
    assert.deepEqual(await src.searchArchive('!!', {}), []);
  } finally {
    globalThis.fetch = real;
  }
});
