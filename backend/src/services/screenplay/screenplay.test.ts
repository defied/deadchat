// Screenplay reading, staging, prompts and the re-render loop. The DB is a temp SQLite file.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'deadchat-screenplay-'));
process.env.DB_PATH = path.join(tmp, 'test.db');
process.env.MEDIA_DIR = path.join(tmp, 'media');
fs.mkdirSync(process.env.MEDIA_DIR, { recursive: true });

/* eslint-disable @typescript-eslint/no-require-imports */
const { runMigrations } = require('../../db/migrate') as typeof import('../../db/migrate');
const db = (require('../../db/connection') as typeof import('../../db/connection')).default;
const script = require('./script') as typeof import('./script');
const staging = require('./staging') as typeof import('./staging');
const prompts = require('./prompts') as typeof import('./prompts');
const store = require('./store') as typeof import('./store');
const render = require('./render') as typeof import('./render');
const { cleanDoc } = require('../../routes/screenplays') as typeof import('../../routes/screenplays');
/* eslint-enable @typescript-eslint/no-require-imports */

import type { ScreenplayDoc, PlanItem } from './types';

before(() => runMigrations());

function doc(): ScreenplayDoc {
  return {
    elements: [
      { id: 's1', type: 'scene', text: "INT. JANE'S KITCHEN - NIGHT" },
      { id: 'a1', type: 'action', text: 'Rain hammers the window. JANE stands at the counter, gripping a knife.' },
      { id: 'c1', type: 'character', text: 'JANE' },
      { id: 'p1', type: 'parenthetical', text: '(whispering)' },
      { id: 'd1', type: 'dialogue', text: 'Who is there?' },
      { id: 'c2', type: 'character', text: 'TOM (O.S.)' },
      { id: 'd2', type: 'dialogue', text: 'It is me.' },
      { id: 'a2', type: 'action', text: 'The door creaks open. TOM steps in, soaked.' },
      { id: 's2', type: 'scene', text: 'EXT. HARBOUR - DAWN' },
      { id: 'a3', type: 'action', text: 'Gulls wheel over empty boats.' },
    ],
    shots: [
      { id: 'sh1', anchorId: 'a1', type: 'Wide establishing', seconds: 6 },
      { id: 'sh2', anchorId: 'a2', type: 'Medium', music: 'tense low strings, slow pulse' },
      { id: 'sh3', anchorId: 's2', type: '' },
    ],
    characters: [
      { id: 'jane', name: 'Jane', kind: 'human', appearance: 'woman in her forties, short grey hair, sharp features', wardrobe: 'a worn green cardigan' },
      { id: 'tom', name: 'Tom', kind: 'human', appearance: 'tall man, beard, rain-soaked' },
    ],
    plans: {},
    settings: { ratio: '21:9' },
  };
}

// ── script ──

test('parseHeading reads the setting, location and time', () => {
  assert.deepEqual(script.parseHeading("INT. JANE'S KITCHEN - NIGHT"), { setting: 'Interior', location: "Jane's kitchen", time: 'night' });
  assert.deepEqual(script.parseHeading('EXT./INT. CAR - MOVING - DAY'), { setting: 'Interior/exterior', location: 'Car', time: 'moving, day' });
  assert.equal(script.parseHeading('12 EXT. HARBOUR - DAWN #12#').location, 'Harbour');
});

test('a shot covers its anchor up to the next shot or scene heading', () => {
  const d = doc();
  const s1 = script.shotSection(d, d.shots[0])!;
  assert.deepEqual(s1.elements.map((e) => e.id), ['a1', 'c1', 'p1', 'd1', 'c2', 'd2']);
  assert.equal(s1.scene?.id, 's1');
  const s2 = script.shotSection(d, d.shots[1])!;
  assert.deepEqual(s2.elements.map((e) => e.id), ['a2']);
  assert.equal(script.shotSection(d, d.shots[2])!.heading?.location, 'Harbour');
});

test('present characters: on-screen cues and names in action, never voice-over or off-screen', () => {
  const d = doc();
  const s1 = script.shotSection(d, d.shots[0])!;
  const present = script.presentCharacters(s1.elements, d.characters);
  assert.deepEqual(present.map((p) => p.name), ['Jane']);
  assert.deepEqual(present[0].manner, ['whispering']);
  assert.equal(script.cueIsOffscreen('TOM (V.O.)'), true);
  assert.equal(script.cueIsOffscreen("TOM (CONT'D)"), false);
  assert.equal(script.mentions('JANEWAY looks up', 'Jane'), false);
});

// ── staging ──

test('staging places characters in frame, judges size, facing and light', () => {
  const cam: PlanItem = { id: 'cam', kind: 'camera', x: 0, y: 0, rot: 0, ref: 'sh1', lens: 35, height: 'low' };
  const plan = {
    items: [
      cam,
      // 3 m ahead, slightly to the camera's left (negative y is the camera's left when facing +x), facing the camera.
      { id: 'j', kind: 'character', x: 3, y: -0.3, rot: 180, ref: 'jane' } as PlanItem,
      // Far behind and to the right, facing away.
      { id: 't', kind: 'character', x: 8, y: 1.5, rot: 0, ref: 'tom' } as PlanItem,
      // Behind the camera: not in frame.
      { id: 'x', kind: 'character', x: -2, y: 0, rot: 0, label: 'Ghost' } as PlanItem,
      { id: 'l', kind: 'light', x: 3, y: -3, rot: 90, color: 'warm', quality: 'hard' } as PlanItem,
      { id: 'b', kind: 'light', x: 6, y: -0.6, rot: 180, color: 'cool' } as PlanItem,
    ],
  };
  const s = staging.describeStaging(plan, cam, doc().characters, 21 / 9);
  assert.deepEqual(s.inFrame, ['Jane', 'Tom']);
  assert.match(s.text, /^Low-angle camera looking up, 35mm lens\. Framing: medium shot\./);
  assert.match(s.text, /Jane, centre frame, facing the camera, in the foreground/);
  assert.match(s.text, /Tom, frame right, back to the camera, in the background/);
  assert.match(s.text, /hard warm tungsten key light from screen left/);
  assert.match(s.text, /soft cool daylight-blue backlight/);
  assert.doesNotMatch(s.text, /Ghost/);
});

test('framing follows distance and lens', () => {
  assert.equal(staging.framingFor(1, 85), 'extreme close-up');
  assert.equal(staging.framingFor(1.6, 85), 'close-up');
  assert.equal(staging.framingFor(3, 50), 'medium shot');
  assert.equal(staging.framingFor(5, 35), 'full shot');
  assert.equal(staging.framingFor(20, 24), 'extreme wide shot');
  assert.equal(staging.defaultLens('Extreme close-up'), 100);
  assert.equal(staging.defaultLens('Wide establishing'), 24);
});

// ── prompts ──

test('planShot waits for a shot type and a description, then builds the prompt', () => {
  const d = doc();
  assert.match(prompts.planShot(d, d.shots[2]).waiting!, /shot type/);
  const p = prompts.planShot(d, d.shots[0]);
  assert.ok(p.prompt);
  assert.match(p.prompt!, /^Cinematic film still, Wide establishing shot, 24mm lens\. Interior, Jane's kitchen, night\. Rain hammers the window/);
  assert.match(p.prompt!, /Characters: Jane: woman in her forties, short grey hair, sharp features, wearing a worn green cardigan, whispering/);
  assert.doesNotMatch(p.prompt!, /Who is there/, 'dialogue is not visual');
  assert.doesNotMatch(p.prompt!, /Tom/, 'off-screen Tom is not in the shot');
});

test('editing a section changes only that shot’s hash', () => {
  const d = doc();
  const before1 = prompts.planShot(d, d.shots[0]).hash;
  const before2 = prompts.planShot(d, d.shots[1]).hash;
  d.elements[7].text = 'The door bursts open. TOM staggers in, bleeding.';
  assert.equal(prompts.planShot(d, d.shots[0]).hash, before1);
  assert.notEqual(prompts.planShot(d, d.shots[1]).hash, before2);
  d.characters[1].appearance = 'short man, clean-shaven';
  assert.notEqual(prompts.planShot(d, d.shots[1]).hash, before2, 'character changes re-render shots they appear in');
  assert.equal(prompts.planShot(d, d.shots[0]).hash, before1, '…and only those');
});

test('a set-plan camera adds staging and limits the cast to who it sees', () => {
  const d = doc();
  d.plans.s1 = {
    items: [
      { id: 'cam', kind: 'camera', x: 0, y: 0, rot: 0, ref: 'sh2', lens: 50 },
      { id: 'j', kind: 'character', x: -3, y: 0, rot: 0, ref: 'jane' },
      { id: 't', kind: 'character', x: 3, y: 0, rot: 180, ref: 'tom' },
    ],
  };
  const p = prompts.planShot(d, d.shots[1]);
  assert.match(p.prompt!, /Characters: Tom: tall man/);
  assert.match(p.staging!, /Tom, centre frame, facing the camera/);
  assert.doesNotMatch(p.prompt!, /Jane:/);
});

test('references add a look; sexual content with a minor is never rendered', () => {
  const d = doc();
  const p = prompts.planShot(d, d.shots[0], [{ target: '', caption: 'low-key teal lighting, anamorphic flares' }]);
  assert.match(p.prompt!, /Look and feel: low-key teal lighting, anamorphic flares/);
  d.elements[1].text = 'A naked teenager stands at the counter.';
  const blocked = prompts.planShot(d, d.shots[0]);
  assert.match(blocked.blocked!, /child or teenager/);
  assert.equal(blocked.prompt, undefined);
});

test('planMusic clamps the cue length and changes hash with the description', () => {
  const d = doc();
  const m = prompts.planMusic(d.shots[1]);
  assert.equal(m.seconds, 20);
  assert.match(m.prompt!, /tense low strings, slow pulse, film score, instrumental/);
  assert.notEqual(prompts.planMusic({ ...d.shots[1], music: 'warm piano' }).hash, m.hash);
  assert.equal(prompts.planMusic({ ...d.shots[1], seconds: 900 }).seconds, 120);
  assert.deepEqual(prompts.planMusic(d.shots[0]), {});
});

test('cleanDoc drops malformed parts and caps sizes', () => {
  const c = cleanDoc({
    elements: [{ id: 'ok', type: 'scene', text: 'INT. A' }, { id: 'bad id!', type: 'scene', text: 'x' }, { id: 'e2', type: 'weird', text: 5 }],
    shots: [{ id: 'sh', anchorId: 'ok', seconds: -4, lens: 9999 }, { id: 'nope' }],
    plans: { ok: { items: [{ id: 'i', kind: 'camera', x: 1e9, y: 0, rot: 0, height: 'sideways' }] } },
    settings: { ratio: '7:3' },
  });
  assert.deepEqual(c.elements, [{ id: 'ok', type: 'scene', text: 'INT. A' }, { id: 'e2', type: 'action', text: '' }]);
  assert.deepEqual([c.shots.length, c.shots[0].seconds, c.shots[0].lens], [1, 0, 800]);
  assert.deepEqual([c.plans.ok.items[0].x, c.plans.ok.items[0].height], [500, undefined]);
  assert.equal(c.settings.ratio, '21:9');
});

// ── re-render loop ──

function jobs() {
  return db.prepare('SELECT id, type, status, params FROM jobs ORDER BY id').all() as Array<{ id: number; type: string; status: string; params: string }>;
}

test('renders wait for the description to settle, then re-render only what changed', () => {
  db.prepare("INSERT INTO settings (key, value) VALUES ('media.default_image_model', 'z-image-turbo')").run();
  const sp = store.createScreenplay(1, 'Test', doc());
  const t0 = 1_000_000;

  // First pass only notes the hashes; nothing is queued until they hold for STABLE_MS.
  assert.equal(render.reconcile(sp.id, t0), true);
  assert.equal(jobs().length, 0);
  render.reconcile(sp.id, t0 + render.STABLE_MS);
  const first = jobs();
  assert.deepEqual(first.map((j) => j.type).sort(), ['audio', 'image', 'image']);
  const audio = JSON.parse(first.find((j) => j.type === 'audio')!.params);
  assert.deepEqual([audio.catalogId, audio.duration], ['ace-step-v1', 20]);
  const img = JSON.parse(first.find((j) => j.type === 'image')!.params);
  assert.deepEqual([img.catalogId, img.ratio, img.enhance], ['z-image-turbo', '21:9', false]);

  // Nothing changed: nothing new.
  render.reconcile(sp.id, t0 + 3 * render.STABLE_MS);
  assert.equal(jobs().length, 3);

  // Revise shot 2's action: its queued render is cancelled and replaced; shot 1 is untouched.
  const d = store.getScreenplay(sp.id)!.doc;
  d.elements[7].text = 'The door bursts open. TOM staggers in.';
  const saved = store.saveScreenplay(sp.id, 1, { doc: d });
  render.reconcile(sp.id, t0 + 10 * render.STABLE_MS);
  render.reconcile(sp.id, t0 + 11 * render.STABLE_MS);
  const after = jobs();
  assert.equal(after.length, 4);
  const sh2Rows = store.listMedia(sp.id, 'frame').filter((r) => r.target === 'sh2');
  assert.deepEqual(sh2Rows.map((r) => r.status), ['superseded', 'pending']);
  assert.equal(after.find((j) => j.id === sh2Rows[0].job_id)!.status, 'canceled');
  assert.match(JSON.parse(after[3].params).prompt, /staggers in/);

  // Same seed for the revision, so the picture changes only where the words did.
  assert.equal(JSON.parse(after[3].params).seed, JSON.parse(after.find((j) => j.id === sh2Rows[0].job_id)!.params).seed);

  // Deleting a shot stops its pending work.
  const d2 = store.getScreenplay(sp.id)!.doc;
  d2.shots = d2.shots.filter((s) => s.id !== 'sh2');
  store.saveScreenplay(sp.id, saved.version, { doc: d2 });
  render.reconcile(sp.id, t0 + 20 * render.STABLE_MS);
  assert.ok(store.listMedia(sp.id).filter((r) => r.target === 'sh2').every((r) => r.status === 'superseded'));
});

test('adjustment notes: on/off and edits change the hash, notes are checked for safety, fallback appends them', () => {
  const d = doc();
  const base = prompts.planShot(d, d.shots[0]);
  const withNote = prompts.planShot(d, { ...d.shots[0], adjustments: [{ id: 'n1', text: 'warmer, golden light' }] });
  assert.equal(withNote.basePrompt, base.prompt, 'the script prompt is unchanged');
  assert.deepEqual(withNote.adjustments, ['warmer, golden light']);
  assert.notEqual(withNote.hash, base.hash);
  const off = prompts.planShot(d, { ...d.shots[0], adjustments: [{ id: 'n1', text: 'warmer, golden light', off: true }, { id: 'n2', text: '  ' }] });
  assert.equal(off.hash, base.hash, 'notes that are off or blank don’t re-render');
  const edited = prompts.planShot(d, { ...d.shots[0], adjustments: [{ id: 'n1', text: 'cold blue light' }] });
  assert.notEqual(edited.hash, withNote.hash);
  const unsafe = prompts.planShot(
    { ...d, elements: d.elements.map((e) => (e.id === 'a1' ? { ...e, text: 'A teenage girl stands at the counter.' } : e)) },
    { ...d.shots[0], adjustments: [{ id: 'n1', text: 'make her nude' }] },
  );
  assert.ok(unsafe.blocked);
  const fb = prompts.appendAdjustments(base.prompt!, ['warmer light', 'lower camera.']);
  assert.match(fb, /Adjustments: warmer light; lower camera\. No text, captions, subtitles or watermarks\.$/);
});

test('adjustment notes are applied by the AI before rendering, cached, and re-applied when they change', async () => {
  const sp = store.createScreenplay(1, 'Adjust', doc());
  const t0 = 50_000_000;
  const asked: Array<{ system: string; user: string }> = [];
  let fail = false;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const b = JSON.parse(String(init?.body));
    asked.push({ system: b.messages[0].content, user: b.messages[1].content });
    if (fail) return new Response('down', { status: 500 });
    const notes = b.messages[1].content.split('Adjustment notes:\n')[1];
    return new Response(JSON.stringify({ message: { content: JSON.stringify({ prompt: `Cinematic film still, wide establishing shot, rewritten for: ${notes.replace(/\n/g, ' ')}. No text, captions, subtitles or watermarks.` }) } }));
  }) as typeof fetch;
  const imageJobs = () => jobs().filter((j) => j.type === 'image').map((j) => JSON.parse(j.params).prompt as string);
  const settle = async (t: number) => {
    render.reconcile(sp.id, t);
    render.reconcile(sp.id, t + render.STABLE_MS);
    // Notes are shot-box changes: they wait for the writer's refresh.
    render.refreshShots(sp.id, ['sh1']);
    await new Promise((r) => setTimeout(r, 30));
  };
  try {
    // First renders happen by themselves.
    render.reconcile(sp.id, t0 - 2 * render.STABLE_MS);
    render.reconcile(sp.id, t0 - render.STABLE_MS);
    const before = imageJobs().length;
    const d = store.getScreenplay(sp.id)!.doc;
    d.shots[0].adjustments = [{ id: 'n1', text: 'warmer, golden light' }];
    let v = store.saveScreenplay(sp.id, 1, { doc: d }).version;
    const planned = render.planAll(store.getScreenplay(sp.id)!).get('sh1')!;
    assert.equal(planned.adjusting, true);
    assert.equal(planned.stale, true, 'waits for a refresh');
    assert.equal(planned.prompt, undefined, 'no render from the un-adjusted prompt');
    render.reconcile(sp.id, t0);
    render.reconcile(sp.id, t0 + 2 * render.STABLE_MS);
    assert.equal(asked.length, 0, 'no AI call before the refresh');
    assert.equal(imageJobs().length, before);

    await settle(t0);
    assert.equal(asked.length, 1);
    assert.match(asked[0].user, /Prompt:\nCinematic film still[\s\S]*Adjustment notes:\n1\. warmer, golden light/);
    assert.match(asked[0].system, /the note wins/);
    const after1 = imageJobs().slice(before);
    assert.equal(after1.length, 1, 'only the refreshed shot rendered');
    assert.ok(after1.some((p) => /rewritten for: 1\. warmer, golden light/.test(p)), 'shot 1 renders the rewritten prompt');
    assert.equal(render.planAll(store.getScreenplay(sp.id)!).get('sh1')!.adjusting, undefined);

    // Add a second note: re-applied and re-rendered.
    const d2 = store.getScreenplay(sp.id)!.doc;
    d2.shots[0].adjustments!.push({ id: 'n2', text: 'lower camera' });
    v = store.saveScreenplay(sp.id, v, { doc: d2 }).version;
    await settle(t0 + 10 * render.STABLE_MS);
    assert.equal(asked.length, 2);
    assert.match(imageJobs().at(-1)!, /1\. warmer, golden light 2\. lower camera/);

    // Remove it again: the earlier rewrite is cached, so no new AI call, but it renders again.
    const d3 = store.getScreenplay(sp.id)!.doc;
    d3.shots[0].adjustments = d3.shots[0].adjustments!.filter((a) => a.id !== 'n2');
    v = store.saveScreenplay(sp.id, v, { doc: d3 }).version;
    const n = imageJobs().length;
    await settle(t0 + 20 * render.STABLE_MS);
    assert.equal(asked.length, 2);
    assert.equal(imageJobs().length, n + 1);
    assert.match(imageJobs().at(-1)!, /rewritten for: 1\. warmer, golden light\./);

    // The AI is down: the notes are added as written, and the writer is told.
    fail = true;
    const d4 = store.getScreenplay(sp.id)!.doc;
    d4.shots[0].adjustments = [{ id: 'n3', text: 'fog on the window' }];
    store.saveScreenplay(sp.id, v, { doc: d4 });
    await settle(t0 + 30 * render.STABLE_MS);
    assert.match(imageJobs().at(-1)!, /Adjustments: fog on the window\. No text/);
    assert.match(render.planAll(store.getScreenplay(sp.id)!).get('sh1')!.adjustNote!, /added to the prompt as written/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('cleanDoc keeps adjustment notes and placeholder profiles, dropping junk', () => {
  const d = cleanDoc({
    elements: [{ id: 'a1', type: 'action', text: 'x' }],
    shots: [{ id: 'sh1', anchorId: 'a1', adjustments: [{ id: 'n1', text: 'warmer', off: true }, { id: 'n2', text: 'lower', off: 'yes' }, { text: 'no id' }] }],
    characters: [{ id: 'c1', name: 'Marcus', placeholder: true }, { id: 'c2', name: 'Jane', placeholder: 'x' }],
  });
  assert.deepEqual(d.shots[0].adjustments, [{ id: 'n1', text: 'warmer', off: true }, { id: 'n2', text: 'lower' }]);
  assert.equal(d.characters[0].placeholder, true);
  assert.equal(d.characters[1].placeholder, undefined);
});

test('only a change to a shot’s own script block re-renders by itself; the rest waits for refresh', () => {
  const sp = store.createScreenplay(1, 'Gates', doc());
  const t0 = 90_000_000;
  const count = () => jobs().length;
  const go = (t: number) => {
    render.reconcile(sp.id, t);
    render.reconcile(sp.id, t + render.STABLE_MS);
  };
  const plan = (id: string) => render.planAll(store.getScreenplay(sp.id)!).get(id)!;
  let v = 1;
  const edit = (fn: (d: ScreenplayDoc) => void) => {
    const d = store.getScreenplay(sp.id)!.doc;
    fn(d);
    v = store.saveScreenplay(sp.id, v, { doc: d }).version;
  };
  const base = count();
  go(t0);
  const first = count();
  assert.equal(first - base, 3, 'two frames and a music cue render the first time');
  const frameRow = store.latestMedia(sp.id, 'frame', 'sh1')!;
  assert.ok(frameRow.block_hash);

  // Shot box: lens and type wait; the shot says it's out of date.
  edit((d) => (d.shots[0].lens = 85));
  go(t0 + 10 * render.STABLE_MS);
  assert.equal(count(), first);
  assert.equal(plan('sh1').stale, true);
  assert.equal(plan('sh2').stale, false);

  // A character's description changes shot 1 and 2's prompts; still no render.
  edit((d) => (d.characters[0].appearance = 'woman in her fifties, long white hair'));
  go(t0 + 20 * render.STABLE_MS);
  assert.equal(count(), first);
  assert.equal(plan('sh1').stale, true);

  // Music description: waits too.
  edit((d) => (d.shots[1].music = 'warm strings, hopeful'));
  go(t0 + 30 * render.STABLE_MS);
  assert.equal(count(), first);
  assert.equal(plan('sh2').musicStale, true);

  // Editing shot 2's script block re-renders shot 2 (with everything pending), not shot 1.
  edit((d) => (d.elements[7].text = 'The door bursts open. TOM staggers in.'));
  go(t0 + 40 * render.STABLE_MS);
  const after = jobs().slice(first);
  assert.deepEqual(after.map((j) => j.type), ['image']);
  assert.match(JSON.parse(after[0].params).prompt, /staggers in/);
  assert.equal(plan('sh1').stale, true);
  assert.equal(plan('sh2').musicStale, true, 'music is a shot-box field: still waits');

  // Refresh shot 1: renders now, with the new lens and description, without waiting to settle.
  render.refreshShots(sp.id, ['sh1']);
  const r1 = jobs().slice(first + 1);
  assert.equal(r1.length, 1);
  assert.match(JSON.parse(r1[0].params).prompt, /85mm|long white hair/);
  assert.equal(plan('sh1').stale, false);

  // Render now refreshes everything waiting (the music cue).
  render.refreshShots(sp.id, 'all');
  assert.deepEqual(jobs().slice(first + 2).map((j) => j.type), ['audio']);
  assert.equal(plan('sh2').musicStale, false);

  // Frames from before this change (no block hash) wait for a refresh instead of re-rendering.
  db.prepare("UPDATE screenplay_media SET block_hash = NULL WHERE screenplay_id = ?").run(sp.id);
  edit((d) => (d.shots[0].lens = 35));
  go(t0 + 60 * render.STABLE_MS);
  assert.equal(plan('sh1').stale, true);
});

test('saving with a stale version is refused', () => {
  const sp = store.createScreenplay(1, 'Conflict', doc());
  store.saveScreenplay(sp.id, 1, { title: 'A' });
  assert.throws(() => store.saveScreenplay(sp.id, 1, { title: 'B' }), store.VersionConflict);
});
