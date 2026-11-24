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
  assert.equal(cleanDoc({ elements: [{ id: 'a1', type: 'action', text: 'x' }], shots: [{ id: 's', anchorId: 'a1', locked: true }, { id: 't', anchorId: 'a1', locked: 1 }] }).shots.map((x) => x.locked).join(), 'true,');
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

  // Unlock shot 1: its script block changed, so it re-renders by itself.
  edit((d) => (d.shots[0].locked = undefined));
  go(t0 + 20 * render.STABLE_MS);
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
  render.reconcile(sp.id, 200_000_000);
  render.reconcile(sp.id, 200_000_000 + render.STABLE_MS);
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
