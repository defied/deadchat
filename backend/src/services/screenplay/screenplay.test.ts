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
const voices = require('./voices') as typeof import('./voices');
const suggest = require('./suggestShots') as typeof import('./suggestShots');
const finder = require('./finds/finder') as typeof import('./finds/finder');
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
  assert.match(p.prompt!, /^Cinematic film still, extreme wide establishing shot: [^.]+\. 24mm wide-angle lens, deep focus[^.]*\. Interior, Jane's kitchen, night\. A single moment: Rain hammers the window/);
  assert.match(p.prompt!, /Jane \(woman in her forties, short grey hair, sharp features, wearing a worn green cardigan, whispering\)/);
  assert.match(p.prompt!, /Jane appears exactly once in the frame/);
  assert.match(p.prompt!, /the name "Jane" is never written anywhere in the picture, not on clothing/);
  assert.doesNotMatch(p.prompt!, /shallow depth of field/, 'a wide lens is not shallow');
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
  assert.match(p.prompt!, /Tom \(tall man/);
  assert.match(p.staging!, /Tom, centre frame, facing the camera/);
  assert.doesNotMatch(p.prompt!, /Jane \(/);
});

test('shot types become a described composition; lenses become a look', () => {
  const ots = prompts.composition('Over-the-shoulder', 'Ann', 'Bo');
  assert.match(ots, /camera is behind Bo, whose shoulder .* foreground, large and out of focus; we look past them at Ann/);
  assert.match(prompts.composition('OTS', 'Ann', null), /just behind Ann, Ann's shoulder/);
  assert.match(prompts.composition('Close-up', 'Ann', null), /Ann's face fills most of the frame/);
  assert.match(prompts.composition('POV', 'Ann', null), /through their eyes/);
  assert.match(prompts.lensLook(14), /ultra-wide.*everything in sharp focus/);
  assert.match(prompts.lensLook(85), /compressed background, strong background blur/);
  assert.match(prompts.lensLook(135), /telephoto.*very shallow depth of field/);
});

test('a frame shows one moment, one of each character, and passers-by on busy streets', () => {
  const action = 'Ferk leans in close to his phone and grins. He flips off the screen. He looks right, then left, then walks left out of the shot.';
  assert.equal(prompts.firstMoment(action), 'Ferk leans in close to his phone and grins. He flips off the screen.');
  assert.equal(prompts.genderFromText(action), 'man');
  assert.equal(prompts.genderFromText('She waves. He nods.'), null);
  assert.equal(prompts.extrasLine('Ferk stands on the sidewalk.', ['Ferk']), '');
  assert.match(prompts.extrasLine('Ferk stands on the sidewalk.', ['Ferk'], true), /Ferk/);
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

test('frames draw only when asked; music cues still render once the description settles', () => {
  db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('media.default_image_model', 'z-image-turbo')").run();
  const sp = store.createScreenplay(1, 'Test', doc());
  const t0 = 1_000_000;

  // Music waits for STABLE_MS, then renders; no frame is drawn by itself.
  assert.equal(render.reconcile(sp.id, t0), true);
  assert.equal(jobs().length, 0);
  render.reconcile(sp.id, t0 + render.STABLE_MS);
  const first = jobs();
  assert.deepEqual(first.map((j) => j.type), ['audio']);
  const audio = JSON.parse(first[0].params);
  assert.deepEqual([audio.catalogId, audio.duration], ['ace-step-v1', 20]);
  assert.equal(render.planAll(store.getScreenplay(sp.id)!).get('sh1')!.stale, false, 'an undrawn shot is not "out of date"');

  // "Draw with AI": renders straight away.
  render.refreshShots(sp.id, ['sh1', 'sh2']);
  const drawn = jobs().slice(1);
  assert.deepEqual(drawn.map((j) => j.type), ['image', 'image']);
  const img = JSON.parse(drawn[0].params);
  assert.deepEqual([img.catalogId, img.ratio, img.enhance], ['z-image-turbo', '21:9', false]);

  // Nothing changed: nothing new.
  render.reconcile(sp.id, t0 + 3 * render.STABLE_MS);
  assert.equal(jobs().length, 3);

  // Revising shot 2's action doesn't redraw it; it's marked out of date.
  const d = store.getScreenplay(sp.id)!.doc;
  d.elements[7].text = 'The door bursts open. TOM staggers in.';
  const saved = store.saveScreenplay(sp.id, 1, { doc: d });
  render.reconcile(sp.id, t0 + 10 * render.STABLE_MS);
  render.reconcile(sp.id, t0 + 11 * render.STABLE_MS);
  assert.equal(jobs().length, 3);
  assert.equal(render.planAll(store.getScreenplay(sp.id)!).get('sh2')!.stale, true);

  // Refresh redraws it with the same seed, so the picture changes only where the words did.
  render.refreshShots(sp.id, ['sh2']);
  const after = jobs();
  assert.equal(after.length, 4);
  assert.match(JSON.parse(after[3].params).prompt, /staggers in/);
  const sh2Rows = store.listMedia(sp.id, 'frame').filter((r) => r.target === 'sh2');
  assert.deepEqual(sh2Rows.map((r) => r.status), ['superseded', 'pending']);
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
    // First frames: drawn when asked.
    render.refreshShots(sp.id, ['sh1', 'sh2']);
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
  assert.equal(cleanDoc({ elements: [{ id: 'a1', type: 'action', text: 'x' }], shots: [{ id: 's', anchorId: 'a1', locked: true }, { id: 't', anchorId: 'a1', locked: 1 }] }).shots.map((x) => x.locked).join(), 'true,');
});

test('once drawn, nothing redraws by itself: script, shot box and character changes all wait for refresh', () => {
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
  assert.equal(count() - base, 1, 'only the music cue renders by itself');
  render.refreshShots(sp.id, 'all');
  assert.equal(count() - base, 1, '"Render now" never draws a shot that has no frame');
  render.refreshShots(sp.id, ['sh1', 'sh2']);
  const first = count();
  assert.equal(first - base, 3, 'two frames when asked');

  edit((d) => (d.shots[0].lens = 85));
  edit((d) => (d.characters[0].appearance = 'woman in her fifties, long white hair'));
  edit((d) => (d.shots[1].music = 'warm strings, hopeful'));
  edit((d) => (d.elements[7].text = 'The door bursts open. TOM staggers in.'));
  go(t0 + 40 * render.STABLE_MS);
  assert.equal(count(), first);
  assert.equal(plan('sh1').stale, true);
  assert.equal(plan('sh2').stale, true);
  assert.equal(plan('sh2').musicStale, true);

  // Refresh shot 1: renders now, with the new lens and description.
  render.refreshShots(sp.id, ['sh1']);
  const r1 = jobs().slice(first);
  assert.equal(r1.length, 1);
  assert.match(JSON.parse(r1[0].params).prompt, /85mm|long white hair/);
  assert.equal(plan('sh1').stale, false);

  // Render now refreshes everything waiting.
  render.refreshShots(sp.id, 'all');
  assert.deepEqual(jobs().slice(first + 1).map((j) => j.type).sort(), ['audio', 'image']);
  assert.equal(plan('sh2').musicStale, false);
});

test('a locked shot never re-renders, whatever changes; unlocking brings back the usual rules', () => {
  const sp = store.createScreenplay(1, 'Lock', doc());
  const t0 = 130_000_000;
  const go = (t: number) => {
    render.reconcile(sp.id, t);
    render.reconcile(sp.id, t + render.STABLE_MS);
  };
  let v = 1;
  const edit = (fn: (d: ScreenplayDoc) => void) => {
    const d = store.getScreenplay(sp.id)!.doc;
    fn(d);
    v = store.saveScreenplay(sp.id, v, { doc: d }).version;
  };
  go(t0);
  render.refreshShots(sp.id, ['sh1', 'sh2']);
  // Pretend the first renders finished.
  for (const r of store.listMedia(sp.id)) if (r.status === 'pending') store.setStatus(r.id, 'ready');
  const base = jobs().length;

  edit((d) => {
    d.shots[0].locked = true;
    d.shots[1].locked = true;
  });
  edit((d) => {
    d.elements[1].text = 'Thunder. JANE drops the knife.';
    d.elements[7].text = 'TOM collapses in the doorway.';
    d.shots[0].lens = 85;
    d.shots[1].music = 'a different cue';
  });
  go(t0 + 10 * render.STABLE_MS);
  render.refreshShots(sp.id, 'all');
  assert.equal(jobs().length, base, 'nothing rendered: script, shot box and Render now all skip locked shots');
  const plans = render.planAll(store.getScreenplay(sp.id)!);
  assert.equal(plans.get('sh1')!.stale, false);
  assert.equal(plans.get('sh2')!.musicStale, false);

  // Unlock shot 1: out of date, and redraws on refresh.
  edit((d) => (d.shots[0].locked = undefined));
  go(t0 + 20 * render.STABLE_MS);
  assert.equal(jobs().length, base);
  assert.equal(render.planAll(store.getScreenplay(sp.id)!).get('sh1')!.stale, true);
  render.refreshShots(sp.id, ['sh1']);
  const after = jobs().slice(base);
  assert.equal(after.length, 1);
  assert.match(JSON.parse(after[0].params).prompt, /drops the knife/);
});

test('extras are described as different people from the named characters', () => {
  assert.equal(prompts.extrasLine('JANE stands alone.', ['Jane']), '', 'no extras mentioned: nothing added');
  assert.equal(prompts.extrasLine('A crowd gathers.', []), '', 'no named characters: nothing to differ from');
  const one = prompts.extrasLine('JANE pushes through the crowd of commuters.', ['Jane']);
  assert.match(one, /unrelated strangers with their own distinct faces/);
  assert.match(one, /only Jane has the looks and outfits described above/);
  assert.match(prompts.extrasLine('Waiters weave between tables.', ['Jane', 'Tom', 'Ann']), /only Jane, Tom and Ann have/);
  const d = doc();
  d.elements[1].text = 'Rain hammers the window. JANE stands among the party guests, gripping a knife.';
  const p = prompts.planShot(d, d.shots[0]).prompt!;
  assert.ok(p.indexOf('Background extras') > p.indexOf('Characters: Jane'), 'comes after the character descriptions');
  assert.doesNotMatch(p.split('Background extras')[1], /green cardigan/, 'the cast’s wardrobe isn’t repeated for extras');
});

test('cleanDoc keeps the pitch and drops junk', () => {
  const d = cleanDoc({
    elements: [{ id: 'a1', type: 'action', text: 'x' }],
    pitch: {
      logline: 'A lighthouse keeper hides a storm.',
      vision: { statement: 'Quiet dread.', comps: ['Moonlight meets The Lighthouse', '', 42], moodboard: [3, 'x', -1, 7] },
      treatment: 'ACT ONE\nThe storm arrives.',
      reel: {
        items: [
          { id: 'r1', source: { kind: 'upload', mediaRowId: 9 }, in: 2, out: 6.5, caption: 'Silence' },
          { id: 'r2', source: { kind: 'frame', shotId: 'sh1' }, hold: 3 },
          { id: 'r3', source: { kind: 'nope' } },
          { id: 'r4', source: { kind: 'upload', mediaRowId: 2 }, in: 5, out: 1 },
        ],
        soundtrack: { kind: 'cue', shotId: 'sh2' },
        openCard: false,
        endCard: 'IN DEVELOPMENT',
      },
    },
  });
  assert.equal(d.pitch!.logline, 'A lighthouse keeper hides a storm.');
  assert.deepEqual(d.pitch!.vision!.comps, ['Moonlight meets The Lighthouse']);
  assert.deepEqual(d.pitch!.vision!.moodboard, [3, 7]);
  assert.deepEqual(d.pitch!.reel!.items.map((i) => i.id), ['r1', 'r2', 'r4']);
  assert.equal(d.pitch!.reel!.items[2].out, undefined, 'an out point before the in point is dropped');
  assert.deepEqual(d.pitch!.reel!.soundtrack, { kind: 'cue', shotId: 'sh2' });
  assert.equal(d.pitch!.reel!.openCard, false);
  assert.equal(cleanDoc({ elements: [] }).pitch, undefined);
});

test('dialogue lines are spoken in each character’s voice, re-made only when the words or voice change', () => {
  const sp = store.createScreenplay(1, 'Voices', doc());
  assert.deepEqual(voices.dialogueLines(sp).map((l) => [l.shotId, l.cue, l.text]), [['sh1', 'JANE', 'Who is there?'], ['sh1', 'TOM', 'It is me.']]);
  assert.equal(voices.characterFor(sp.doc.characters, 'JANE')!.id, 'jane');
  assert.deepEqual(['JANE:', 'JANE (V.O.)', 'Jane ^', 'JANE (CONT\'D):'].map((c) => script.cueName(c)), ['JANE', 'JANE', 'Jane', 'JANE']);
  assert.equal(voices.characterFor([{ id: 'x', name: 'Jane Doe', kind: 'human' }], 'JANE')!.id, 'x', 'first name answers');

  // No voices yet: nothing queued, and the writer is told who's missing one.
  const none = voices.queueLines(sp, 1);
  assert.equal(none.queued, 0);
  assert.deepEqual(none.skipped, [{ cue: 'JANE', reason: 'Jane has no voice yet' }, { cue: 'TOM', reason: 'Tom has no voice yet' }]);

  // Jane gets an uploaded sample.
  const mediaId = Number(db.prepare("INSERT INTO media (user_id, type, filename, mime, size_bytes) VALUES (1, 'audio', 'jane.wav', 'audio/wav', 10)").run().lastInsertRowid);
  const sample = store.addMedia(sp.id, 'sound', voices.voiceTarget('jane'), { status: 'ready', media_id: mediaId });
  let v = 1;
  const edit = (fn: (d: ScreenplayDoc) => void) => {
    const d = store.getScreenplay(sp.id)!.doc;
    fn(d);
    v = store.saveScreenplay(sp.id, v, { doc: d }).version;
  };
  edit((d) => (d.characters[0].voiceRef = { kind: 'upload', mediaRowId: sample.id }));
  const before = jobs().length;
  const r1 = voices.queueLines(store.getScreenplay(sp.id)!, 1);
  assert.deepEqual([r1.queued, r1.current], [1, 0]);
  assert.deepEqual(r1.skipped, [{ cue: 'TOM', reason: 'Tom has no voice yet' }]);
  const job = jobs().slice(before)[0];
  assert.equal(job.type, 'tts');
  assert.deepEqual(JSON.parse(job.params), { referenceMediaId: mediaId, prompt: 'Who is there?', language: 'en' });
  const row = store.listMedia(sp.id, 'sound').find((m) => m.target === voices.lineTarget('d1'))!;
  assert.equal(row.label, 'JANE: Who is there?');
  assert.equal(JSON.parse(row.meta!).shotId, 'sh1');

  // Same words, same voice: nothing new. New words: the old pending line is replaced.
  assert.deepEqual(voices.queueLines(store.getScreenplay(sp.id)!, 1).queued, 0);
  edit((d) => (d.elements[4].text = 'Who’s there?'));
  assert.equal(voices.queueLines(store.getScreenplay(sp.id)!, 1).queued, 1);
  assert.equal(store.getMedia(row.id)!.status, 'superseded');
  assert.equal(jobs().length, before + 2);

  // Only the shots asked for.
  assert.equal(voices.dialogueLines(store.getScreenplay(sp.id)!, ['sh2']).length, 0);

  // A removed sample, and cleanDoc keeps a valid voice source only.
  store.deleteMedia(sample.id);
  assert.deepEqual(voices.queueLines(store.getScreenplay(sp.id)!, 1).skipped[0], { cue: 'JANE', reason: 'Jane’s voice sample was removed' });
  const cleaned = cleanDoc({ elements: [{ id: 'a1', type: 'action', text: 'x' }], characters: [{ id: 'a', name: 'A', voiceRef: { kind: 'upload', mediaRowId: 3 } }, { id: 'b', name: 'B', voiceRef: { kind: 'studio', characterId: 'x' } }] });
  assert.deepEqual(cleaned.characters.map((c) => c.voiceRef), [{ kind: 'upload', mediaRowId: 3 }, undefined]);
});

test('a shot using a chosen image as its frame never renders one', () => {
  const sp = store.createScreenplay(1, 'Own frame', doc());
  const d = store.getScreenplay(sp.id)!.doc;
  d.shots[0].frameImage = 42;
  store.saveScreenplay(sp.id, 1, { doc: d });
  const base = jobs().length;
  render.refreshShots(sp.id, ['sh1', 'sh2']);
  const made = jobs().slice(base).filter((j) => j.type === 'image').map((j) => JSON.parse(j.params).prompt as string);
  assert.equal(made.length, 1, 'only shot 2 renders');
  assert.doesNotMatch(made[0], /gripping a knife/);
  assert.equal(cleanDoc({ elements: [{ id: 'a1', type: 'action', text: 'x' }], shots: [{ id: 's', anchorId: 'a1', frameImage: 7 }] }).shots[0].frameImage, 7);
});

test('suggested shots: the model’s breakdown is checked against the scene; rules when it can’t help', async () => {
  const sp = store.createScreenplay(1, 'Suggest', doc());
  assert.deepEqual(suggest.sceneElements(sp, 's1').map((e) => e.id), ['s1', 'a1', 'c1', 'p1', 'd1', 'c2', 'd2', 'a2']);
  const real = globalThis.fetch;
  let asked = '';
  globalThis.fetch = (async (_u: string | URL, init?: RequestInit) => {
    const b = JSON.parse(String(init?.body));
    asked = b.messages[1].content;
    const shots = [
      { line: 2, type: 'wide', seconds: 5.2, lens: 26, note: 'Kitchen in the storm' },
      { line: 5, type: 'Close-up shot', seconds: 2, lens: 90 },
      { line: 5, type: 'Medium', seconds: 3 }, // duplicate line: dropped
      { line: 99, type: 'Wide' }, // no such line: dropped
      { line: 8, type: 'Something odd', seconds: 400 },
    ];
    return new Response(JSON.stringify({ message: { content: JSON.stringify({ shots }) } }));
  }) as typeof fetch;
  try {
    const r = await suggest.suggestShots(sp, 's1', 'more');
    assert.equal(r.source, 'ai');
    assert.match(asked, /Give full coverage/);
    assert.match(asked, /1\. SCENE: INT\. JANE'S KITCHEN - NIGHT\n2\. ACTION: Rain hammers/);
    assert.deepEqual(r.shots, [
      { anchorId: 'a1', type: 'Wide', seconds: 5, lens: 24, notes: 'Kitchen in the storm' },
      { anchorId: 'd1', type: 'Close-up', seconds: 2, lens: 85 },
      { anchorId: 'a2', type: 'Something odd', seconds: 30 },
    ]);

    globalThis.fetch = (async () => new Response('down', { status: 500 })) as typeof fetch;
    const rules = await suggest.suggestShots(sp, 's1', 'normal');
    assert.equal(rules.source, 'rules');
    assert.deepEqual(rules.shots.map((x) => [x.anchorId, x.type]), [['a1', 'Wide'], ['c1', 'Medium close-up'], ['c2', 'Over-the-shoulder'], ['a2', 'Medium']]);
    assert.deepEqual((await suggest.suggestShots(sp, 's1', 'fewer')).shots.map((x) => x.anchorId), ['a1', 'c1']);
    assert.deepEqual((await suggest.suggestShots(sp, 's2', 'normal')).shots.map((x) => x.anchorId), ['a3'], 'a scene with only action gets its opening shot');
    await assert.rejects(suggest.suggestShots(sp, 'nope', 'normal'), /no longer exists/);
  } finally {
    globalThis.fetch = real;
  }
});

test('saving with a stale version is refused', () => {
  const sp = store.createScreenplay(1, 'Conflict', doc());
  store.saveScreenplay(sp.id, 1, { title: 'A' });
  assert.throws(() => store.saveScreenplay(sp.id, 1, { title: 'B' }), store.VersionConflict);
});

test('lens families add their look; a shot overrides the film kit', () => {
  assert.equal(prompts.lensLook(50), '50mm lens, natural perspective, background softly out of focus');
  assert.match(prompts.lensLook(40, 'anamorphic'), /^40mm anamorphic lens.*oval vertically stretched bokeh/);
  assert.doesNotMatch(prompts.lensLook(40, 'anamorphic'), /flare/, 'flares depend on the scene, not the lens');
  assert.match(prompts.lensLook(35, 'vintage-prime'), /halation/);
  assert.match(prompts.lensLook(14, 'fisheye'), /^14mm fisheye lens; fisheye lens, a circular/);
  const d = doc();
  d.settings.lensType = 'anamorphic';
  const film = prompts.planShot(d, d.shots[0]);
  assert.match(film.prompt!, /24mm anamorphic wide-angle lens/);
  d.shots[0].lensType = 'vintage-prime';
  const own = prompts.planShot(d, d.shots[0]);
  assert.match(own.prompt!, /vintage spherical prime/);
  assert.notEqual(own.hash, film.hash, 'changing the glass re-renders');
});

test('flares come only from a light in the scene', () => {
  assert.equal(prompts.flareLine('spherical', 'Exterior, street, night, neon'), '', 'clean glass adds no flare line');
  assert.equal(prompts.flareLine('anamorphic', 'Interior, office, day. She types.'), 'No lens flares, no light streaks');
  assert.equal(prompts.flareLine('anamorphic', 'Exterior, New York skyline, day, lightning storm'), 'No lens flares, no light streaks', 'distant lights never flare');
  assert.equal(prompts.flareLine('anamorphic', 'Sunset over the bay.'), 'No lens flares, no light streaks');
  assert.match(prompts.flareLine('anamorphic', 'Lightning flashes. He clicks on a flashlight.'), /only where the flashlight beam is visible.*blue anamorphic streak/);
  assert.match(prompts.flareLine('vintage-anamorphic', 'A car pulls up, headlights blazing. Neon hums.'), /the headlights or the neon signs are visible.*amber/);
  assert.deepEqual(prompts.lightSources('Golden hour. Sunlight floods the field.'), ['the low sun']);
});

test('casting asks for each look in turn, keeps the brief, and falls back to the description', async () => {
  const c = { id: 'ch1', name: 'Ferk', age: '20s', gender: 'male', personality: 'cocky influencer', appearance: 'red hair', wardrobe: 'neon hoodie, sneakers' };
  assert.match(render.castingBrief(c), /Name: Ferk\nAge: 20s\nGender: male\nAppearance so far: red hair\nPersonality: cocky influencer/);
  const real = render.castingDeps.llmJson;
  try {
    const systems: string[] = [];
    render.castingDeps.llmJson = (async (sys: string) => {
      systems.push(sys);
      const n = systems.length;
      if (n === 1) return { label: 'Ferk - narrow fox face', appearance: 'Wiry and freckled, copper curls, a narrow fox-like face, pale grey eyes.' };
      if (n === 2) return { label: '2-5 word summary', appearance: 'Ferk has a stocky frame, a buzz-cut ginger scalp, a broken nose and a heavy jaw.' };
      if (n <= 4) return { appearance: 'red' };
      throw new Error('offline');
    }) as typeof real;
    const looks = await render.castingLooks(c);
    assert.equal(systems.length, 2 + 2 + 2, 'a bad answer is retried once');
    assert.match(systems[0], /Every trait the brief states is fixed/);
    assert.match(systems[1], /clearly different from these already proposed: narrow fox face/);
    assert.deepEqual(looks[0], { label: 'narrow fox face', appearance: 'Wiry and freckled, copper curls, a narrow fox-like face, pale grey eyes.' });
    assert.equal(looks[1].label, 'a stocky frame', 'template labels are replaced, without the name');
    assert.deepEqual(looks[2], { label: 'Take 3', appearance: 'red hair' });
    assert.deepEqual(looks[3], { label: 'Take 4', appearance: 'red hair' });
  } finally {
    render.castingDeps.llmJson = real;
  }
  const head = prompts.castingPrompt({ ...c, appearance: 'Wiry and freckled' });
  assert.match(head, /^Casting headshot: Wiry and freckled\. tight head-and-shoulders close-up/);
  assert.doesNotMatch(head, /hoodie|sneakers/, 'no costume in a casting headshot');
});

// ── shot finder ──

test('the shot brief holds only what the script says; searches can only use the script, the notes or generic people words', async () => {
  const sp = store.createScreenplay(1, 'Finder brief', doc());
  const brief = finder.shotBrief(sp, sp.doc.shots[0]);
  assert.equal(brief, "Setting: Interior, Jane's kitchen, night\nMoment: Rain hammers the window. JANE stands at the counter, gripping a knife.\nPeople (never use their names): Jane = a person");
  assert.doesNotMatch(brief, /Wide establishing|lens|style|grey hair/i, 'no shot type, lens, style or looks');
  assert.equal(finder.lookOf(brief, ['no knife, a mug instead']), "Rain hammers the window. JANE stands at the counter, gripping a knife. (Jane's kitchen, night) · no knife, a mug instead");
  // The model adds things the script never said: they're removed.
  const source = `${brief}\nno knife, a mug instead`;
  assert.deepEqual(finder.onlyAsked(['woman kitchen knife', 'lightning city skyline', 'cosy kitchen sunset', 'rainy window', 'woman mug'], source), [
    'woman kitchen knife',
    'kitchen',
    'rainy window',
    'woman mug',
  ]);
  const q = finder.ruleQueries(brief, ['no knife, a mug instead'], ['Jane', 'Tom']);
  assert.ok(q.every((x) => !/jane|tom/i.test(x)), q.join(' | '));
  assert.ok(q.some((x) => /kitchen/.test(x)));
  assert.ok(q.some((x) => /mug/.test(x)), 'adjustment notes become searches');
  assert.deepEqual(finder.ownQueries(['  Red Phone! ', 'red phone', 'x', 7]), ['red phone']);
  const real = { ...finder.deps };
  const searched: string[] = [];
  let planned = false;
  try {
    finder.deps.planFind = async () => {
      planned = true;
      return { look: '', queries: ['x'], notes: [] };
    };
    finder.deps.searchOpenverseImages = async (q) => (searched.push(q), []);
    finder.deps.searchPexels = async () => [];
    finder.deps.searchUnsplash = async () => [];
    const own = finder.createFind(sp, 'sh1', ['red phone', 'kitchen']);
    assert.deepEqual([own.plan.own, own.plan.queries], [true, ['red phone', 'kitchen']]);
    for (let i = 0; i < 100 && !['done', 'failed'].includes(finder.getFind(own.id)!.status); i++) await new Promise((r) => setTimeout(r, 5));
    assert.equal(planned, false, 'the writer’s own words are used exactly, nothing planned');
    assert.deepEqual([...new Set(searched)], ['red phone', 'kitchen']);
  } finally {
    Object.assign(finder.deps, real);
  }
});

test('a find proposes ten varied photos, find more adds ten new ones, and a pick is kept with its licence', async () => {
  const sp = store.createScreenplay(1, 'Finder', doc());
  const real = { ...finder.deps };
  const photo = (q: string, page: number, i: number, src: 'openverse' | 'pexels' = 'openverse') => ({
    key: `${src}:${q}-${page}-${i}`,
    source: src,
    sourceName: src === 'pexels' ? 'Pexels' : 'Flickr',
    title: `${q} photo ${i}`,
    creator: 'Someone',
    license: { code: 'by' as const, name: 'CC BY 2.0', url: 'https://creativecommons.org/licenses/by/2.0/', commercial: true, derivatives: true, attribution: true, rank: 1 },
    landingUrl: `https://example.org/${q}/${i}`,
    imageUrl: `https://images.example.org/${q}-${page}-${i}.jpg`,
    thumbUrl: `https://images.example.org/t/${q}-${page}-${i}.jpg`,
    width: 2000,
    height: i % 2 ? 840 : 2000,
    tags: q.split(' '),
    query: q,
    sourceScore: 1 - i / 20,
  });
  const realFetch = globalThis.fetch;
  try {
    const planned: string[] = [];
    finder.deps.planFind = async (brief, notes) => {
      planned.push(brief + '|' + notes.join(','));
      return { look: 'a woman at a kitchen counter at night, rain on the window', queries: ['woman kitchen night', 'rain window night', 'kitchen counter knife'], notes };
    };
    finder.deps.searchOpenverseImages = async (q, o) => (o.page > 2 ? [] : Array.from({ length: 8 }, (_, i) => photo(q, o.page, i)));
    finder.deps.searchPexels = async () => {
      throw new Error('api.pexels.com answered 401');
    };
    finder.deps.searchUnsplash = async () => [];
    finder.deps.keys = () => ({ pexels: 'k', unsplash: null });

    const d = store.getScreenplay(sp.id)!.doc;
    d.shots[0].adjustments = [{ id: 'n1', text: 'warmer light' }, { id: 'n2', text: 'off note', off: true }];
    store.saveScreenplay(sp.id, 1, { doc: d });
    const f = finder.createFind(store.getScreenplay(sp.id)!, 'sh1');
    const wait = async (id: number) => {
      for (let i = 0; i < 100; i++) {
        const x = finder.getFind(id)!;
        if (x.status === 'done' || x.status === 'failed') return x;
        await new Promise((r) => setTimeout(r, 5));
      }
      throw new Error('timeout');
    };
    const done = await wait(f.id);
    assert.equal(done.status, 'done');
    assert.match(planned[0], /\|warmer light$/, 'only notes that are on');
    assert.equal(done.candidates.length, 10);
    const perQuery = new Map<string, number>();
    for (const c of done.candidates) perQuery.set(c.query, (perQuery.get(c.query) ?? 0) + 1);
    assert.ok([...perQuery.values()].every((n) => n <= 4), 'no more than four from one search');
    assert.match(done.error!, /Pexels: api.pexels.com answered 401/, 'a failing library is reported, not fatal');

    const more = await wait(finder.findMore(done).id);
    assert.equal(more.candidates.length, 20);
    assert.equal(new Set(more.candidates.map((c) => c.key)).size, 20, 'find more never repeats a photo');
    assert.equal(planned.length, 1, 'find more reuses the plan');

    const dry = await wait(finder.findMore(more).id);
    assert.ok(dry.candidates.length >= 20);

    globalThis.fetch = (async () => new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]), { headers: { 'content-type': 'image/jpeg' } })) as typeof fetch;
    const pick = done.candidates[0];
    let saved = 0;
    const rowId = await finder.keepFound(store.getScreenplay(sp.id)!, more, pick.key, (bytes, mime) => {
      saved++;
      assert.equal(mime, 'image/jpeg');
      return Number(db.prepare("INSERT INTO media (user_id, type, filename, mime, size_bytes) VALUES (1, 'image', 'x.jpg', 'image/jpeg', ?)").run(bytes.length).lastInsertRowid);
    });
    const row = store.getMedia(rowId)!;
    assert.deepEqual([row.role, row.target, row.status], ['reference', 'sh1', 'ready']);
    const meta = JSON.parse(row.meta!);
    assert.equal(meta.found.license.name, 'CC BY 2.0');
    assert.equal(meta.found.landingUrl, pick.landingUrl);
    assert.equal(row.caption, null, 'found photos are not captioned into prompts');
    assert.equal(await finder.keepFound(store.getScreenplay(sp.id)!, more, pick.key, () => 0), rowId, 'keeping twice reuses the row');
    assert.equal(saved, 1);
    await assert.rejects(finder.keepFound(store.getScreenplay(sp.id)!, more, 'openverse:nope', () => 0), /isn’t in this search/);
  } finally {
    Object.assign(finder.deps, real);
    globalThis.fetch = realFetch;
  }
});

// ── props ──

test('props: found in a shot by name or alias, kept through cleanDoc, searched by what they are', () => {
  const d = doc();
  d.props = [
    { id: 'p1', name: 'Knife', aliases: 'the blade, cleaver', description: 'a heavy black-handled chef’s knife' },
    { id: 'p2', name: 'Umbrella' },
  ];
  assert.deepEqual(script.propsInShot(d, d.shots[0]).map((p) => p.id), ['p1']);
  d.elements[1].text = 'JANE raises the blade.';
  assert.deepEqual(script.propsInShot(d, d.shots[0]).map((p) => p.id), ['p1'], 'aliases count');
  assert.deepEqual(script.propsInShot(d, d.shots[1]).map((p) => p.id), []);
  const clean = cleanDoc({ ...d, props: [...d.props, { name: 'no id' }, { id: 'p3', name: 'Lamp', primaryRefId: 'x' }] });
  assert.deepEqual(clean.props!.map((p) => p.id), ['p1', 'p2', 'p3']);
  assert.equal(clean.props![2].primaryRefId, undefined);
  const plan = finder.planPropFind(d.props[0]);
  assert.equal(plan.look, 'a heavy black-handled chef’s knife');
  assert.ok(plan.queries.includes('knife'));
  assert.match(prompts.propPrompt(d.props[0]), /^Product reference photo of Knife: a heavy black-handled chef’s knife\. the whole object in frame/);
});

test('a prop search keeps its photos as prop images', async () => {
  const d = doc();
  d.props = [{ id: 'p1', name: 'Knife', description: 'black handle' }];
  const sp = store.createScreenplay(1, 'Props', d);
  const real = { ...finder.deps };
  const realFetch = globalThis.fetch;
  try {
    let wide: boolean | null = null;
    finder.deps.searchOpenverseImages = async (q, o) => {
      wide = o.wide;
      return o.page > 1 ? [] : [{ key: `openverse:${q}`, source: 'openverse', sourceName: 'Flickr', title: q, creator: null, license: { code: 'cc0', name: 'CC0', url: null, commercial: true, derivatives: true, attribution: false, rank: 0 }, landingUrl: 'https://x', imageUrl: 'https://x/i.jpg', thumbUrl: 'https://x/t.jpg', width: 800, height: 800, tags: [], query: q, sourceScore: 1 }];
    };
    finder.deps.searchPexels = async () => [];
    finder.deps.searchUnsplash = async () => [];
    const f = finder.createFind(sp, finder.propTarget('p1'));
    let x = f;
    for (let i = 0; i < 100 && x.status !== 'done' && x.status !== 'failed'; i++) {
      await new Promise((r) => setTimeout(r, 5));
      x = finder.getFind(f.id)!;
    }
    assert.equal(x.status, 'done', x.error ?? '');
    assert.equal(wide, false, 'props are not searched as wide frames');
    globalThis.fetch = (async () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } })) as typeof fetch;
    const rowId = await finder.keepFound(sp, x, x.candidates[0].key, (bytes) => Number(db.prepare("INSERT INTO media (user_id, type, filename, mime, size_bytes) VALUES (1, 'image', 'p.png', 'image/png', ?)").run(bytes.length).lastInsertRowid));
    const row = store.getMedia(rowId)!;
    assert.deepEqual([row.role, row.target], ['prop', 'p1']);
  } finally {
    Object.assign(finder.deps, real);
    globalThis.fetch = realFetch;
  }
});

// ── recreate ──

test('recreate prompt: image 1 is the scene, faces and props by image number, text only when there is no photo', () => {
  const p = prompts.recreatePrompt({
    cast: [{ name: 'Jane', look: 'woman in her forties, short grey hair', wardrobe: 'Dressed in a worn green cardigan', image: 2 }, { name: 'Tom', look: 'tall man, beard', image: null }],
    props: [{ name: 'knife', look: 'black handle', image: 3 }],
    moment: 'Jane grips the knife.',
    notes: ['night'],
  });
  assert.doesNotMatch(p, /mm lens/, 'the photo keeps its own lens');
  assert.match(p, /^Edit image 1, keeping it as it is: the same place, buildings, landscape, background, camera angle/);
  assert.match(p, /if not, place them naturally in the scene/);
  assert.match(p, /Jane, who looks exactly like the person in image 2: woman in her forties, short grey hair, wearing a worn green cardigan; Tom: tall man, beard/);
  assert.match(p, /the knife looks exactly like the one in image 3 \(black handle\)/);
  assert.match(p, /each appears exactly once/i);
  assert.match(p, /What they are doing: Jane grips the knife\. Also: night\./);
  assert.match(p, /the names "Jane", "Tom" are never written anywhere$/);
});

test('recreating a picked photo queues FLUX.2 with the photo, the cast photos and the prop photos, and keeps the credit', () => {
  const d = doc();
  d.props = [{ id: 'p1', name: 'knife', description: 'black handle' }];
  const sp = store.createScreenplay(1, 'Recreate', d);
  const media = () => Number(db.prepare("INSERT INTO media (user_id, type, filename, mime, size_bytes) VALUES (1, 'image', 'x.jpg', 'image/jpeg', 1)").run().lastInsertRowid);
  const photo = store.addMedia(sp.id, 'reference', 'sh1', { status: 'ready', media_id: media(), label: 'Kitchen at night' });
  store.updateMedia(photo.id, { meta: JSON.stringify({ found: { key: 'openverse:1', title: 'Kitchen', license: { name: 'CC BY 2.0', attribution: true } } }) });
  const old = store.addMedia(sp.id, 'character', 'jane', { status: 'ready', media_id: media(), label: 'portrait' });
  const face = store.addMedia(sp.id, 'character', 'jane', { status: 'ready', media_id: media(), label: 'casting' });
  const knife = store.addMedia(sp.id, 'prop', 'p1', { status: 'ready', media_id: media() });
  const doc2 = store.getScreenplay(sp.id)!.doc;
  doc2.characters[0].primaryRefId = face.id;
  store.saveScreenplay(sp.id, 1, { doc: doc2 });
  const s = store.getScreenplay(sp.id)!;

  const cand = render.recreateCandidates(s, s.doc.shots[0]);
  assert.deepEqual(cand.characters.map((c) => [c.name, !!c.photo]), [['Jane', true]]);
  assert.deepEqual(cand.props.map((p) => p.name), ['knife']);

  const n = jobs().length;
  const row = render.recreateFrame(s, s.doc.shots[0], photo.id, {});
  const job = jobs()[n];
  const params = JSON.parse(job.params);
  assert.equal(params.catalogId, 'flux2-dev');
  assert.deepEqual(params.refMediaIds, [photo.media_id, face.media_id, knife.media_id], 'the main photo, not the older one');
  assert.notEqual(params.refMediaIds[1], old.media_id);
  assert.match(params.prompt, /Jane, who looks exactly like the person in image 2/);
  assert.match(params.prompt, /knife looks exactly like the one in image 3/);
  assert.deepEqual([row.role, row.target, row.status, row.label], ['reference', 'sh1', 'pending', 'Recreated with AI']);
  const meta = JSON.parse(store.getMedia(row.id)!.meta!);
  assert.equal(meta.found.license.name, 'CC BY 2.0', 'the photo’s credit carries over');
  assert.deepEqual(meta.recreated, { from: photo.id, characters: ['Jane'], props: ['knife'] });

  const none = render.recreateFrame(s, s.doc.shots[0], photo.id, { characterIds: [], propIds: [] });
  assert.deepEqual(JSON.parse(jobs()[n + 1].params).refMediaIds, [photo.media_id]);
  assert.ok(none.id);
  assert.throws(() => render.recreateFrame(s, s.doc.shots[0], face.id, {}), /Pick a photo/);
});

test('finder relevance: most of the query must be in the title or tags; stems match', () => {
  const c = (title: string, query: string, tags: string[] = []) => ({ title, query, tags });
  assert.equal(finder.relevance(c('lean-to shed taking shape', 'phone lean')), 0.5);
  assert.ok(finder.relevance(c('Stormy night: lightning over the city skyline', 'lightning storm city skyline')) >= 0.75);
  assert.equal(finder.relevance(c('Brooklyn Bridge', 'young man smartphone street')), 0);
  assert.ok(finder.relevance(c('A young man on his phones', 'young man smartphone', ['smartphone'])) === 1);
});

test('single-thing searches get one that puts the subject in its place', () => {
  assert.deepEqual(finder.withMoment(['phone', 'sneer', 'new york city', 'lightning storm']), ['phone lightning storm', 'phone', 'sneer', 'new york city', 'lightning storm']);
  assert.deepEqual(finder.withMoment(['man phone street', 'street']), ['man phone street', 'street']);
  assert.deepEqual(finder.withMoment(['phone']), ['phone']);
});

// ── highlighted shots ──

test('a highlighted shot covers only its highlight; its summary drives the search and the drawing', async () => {
  const d = doc();
  d.elements[1].text = 'Rain hammers the window. JANE stands at the counter, gripping a knife. Lightning flashes outside.';
  d.shots = [{ id: 'sh1', anchorId: 'a1', type: 'Close-up', excerpt: 'JANE stands at the counter, gripping a knife.' }, { id: 'sh2', anchorId: 'a2', type: 'Medium' }];
  const sec = script.shotSection(d, d.shots[0])!;
  assert.deepEqual(sec.elements.map((e) => e.text), ['JANE stands at the counter, gripping a knife.']);
  const plan = prompts.planShot(d, d.shots[0]);
  assert.doesNotMatch(plan.prompt!, /Rain|Lightning/, 'nothing outside the highlight');
  d.shots[0].summary = 'Jane grips a knife at the kitchen counter.';
  assert.match(prompts.planShot(d, d.shots[0]).prompt!, /A single moment: Jane grips a knife at the kitchen counter\./);
  assert.notEqual(prompts.planShot(d, d.shots[0]).blockHash, plan.blockHash, 'editing the summary changes the shot');
  const sp = store.createScreenplay(1, 'Highlight', d);
  assert.match(finder.shotBrief(sp, sp.doc.shots[0]), /Moment: Jane grips a knife at the kitchen counter\./);

  const summarize = require('./summarize') as typeof import('./summarize');
  const real = summarize.deps.llmJson;
  try {
    let asked = '';
    summarize.deps.llmJson = (async (_s: string, user: string) => ((asked = user), { summary: 'Jane stands at the counter gripping a knife.' })) as typeof real;
    assert.equal(await summarize.summarizeShot("INT. JANE'S KITCHEN - NIGHT", 'JANE stands at the counter, gripping a knife.'), 'Jane stands at the counter gripping a knife.');
    assert.match(asked, /Scene heading: Interior, Jane's kitchen, night\nHighlighted text:\nJANE stands/);
    summarize.deps.llmJson = (async () => {
      throw new Error('offline');
    }) as typeof real;
    assert.equal(await summarize.summarizeShot('', '  JANE   waits. '), 'JANE waits.', 'without a model the highlight is the summary');
    await assert.rejects(summarize.summarizeShot('', ' '), /Highlight/);
  } finally {
    summarize.deps.llmJson = real;
  }
});

test('the vision check keeps only photos that show the shot, best first, and never looks at a turned-down photo twice', async () => {
  const d = doc();
  d.shots[0].summary = 'Jane grips a knife at the kitchen counter.';
  const sp = store.createScreenplay(1, 'Checked', d);
  const real = { ...finder.deps };
  try {
    const looked: string[] = [];
    let wantedSeen = '';
    finder.deps.planFind = async (_b, notes) => ({ look: '', queries: ['woman kitchen knife', 'kitchen'], notes });
    finder.deps.searchOpenverseImages = async (q, o) =>
      o.page > 2
        ? []
        : Array.from({ length: 6 }, (_, i) => ({
            key: `openverse:${q}-${o.page}-${i}`, source: 'openverse' as const, sourceName: 'Flickr', title: `${q} ${i}`, creator: null,
            license: { code: 'cc0' as const, name: 'CC0', url: null, commercial: true, derivatives: true, attribution: false, rank: 0 },
            landingUrl: 'https://x', imageUrl: 'https://x/i.jpg', thumbUrl: `https://x/${q}-${o.page}-${i}.jpg`, width: 2000, height: 900, tags: q.split(' '), query: q, sourceScore: 1 - i / 6,
          }));
    finder.deps.searchPexels = async () => [];
    finder.deps.searchUnsplash = async () => [];
    // Even-numbered photos match (score 8 or 9), odd ones don't (3).
    finder.deps.checkImage = async (c, wanted) => {
      wantedSeen = wanted;
      looked.push(c.key);
      const i = Number(c.key.split('-').pop());
      return i % 2 ? { score: 3, sees: 'a car park', missing: 'the woman and the knife' } : { score: 8 + (i % 4 === 0 ? 1 : 0), sees: 'a woman with a knife', missing: '' };
    };
    const wait = async (fid: number) => {
      for (let i = 0; i < 200; i++) {
        const x = finder.getFind(fid)!;
        if (x.status === 'done' || x.status === 'failed') return x;
        await new Promise((r) => setTimeout(r, 5));
      }
      throw new Error('timeout');
    };
    const f = await wait(finder.createFind(sp, 'sh1').id);
    assert.match(wantedSeen, /^Jane grips a knife at the kitchen counter\./, 'photos are judged against the shot’s summary');
    assert.ok(f.candidates.length > 0 && f.candidates.every((c) => c.check!.score >= finder.MIN_SCORE), 'only matches are shown');
    const scores = f.candidates.map((c) => c.check!.score);
    assert.deepEqual(scores, [...scores].sort((a, b) => b - a), 'best first');
    assert.match(f.progress, /photos? that match · looked at \d+ this time/);
    assert.ok(f.plan.rejected!.length > 0);
    const before = looked.length;
    const more = await wait(finder.findMore(f).id);
    const again = looked.slice(before);
    assert.ok(again.every((k) => !f.plan.rejected!.includes(k) && !f.candidates.some((c) => c.key === k)), 'turned-down and shown photos aren’t looked at again');
    assert.ok(more.candidates.length >= f.candidates.length);

    // No vision model: photos are shown unchecked, and the writer is told.
    finder.deps.checkImage = async () => {
      throw new Error('no-vision');
    };
    const u = await wait(finder.createFind(sp, 'sh1').id);
    assert.equal(u.candidates.length, 10);
    assert.equal(u.plan.unchecked, true);
    assert.match(u.progress, /not checked/);
  } finally {
    Object.assign(finder.deps, real);
  }
});
