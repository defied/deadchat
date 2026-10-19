import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MEDIA_MODELS, buildGraph, resolveParams, ratioFromSize, type Graph } from './catalog';
import { cloudflareCost } from './cloudflare';

const PROMPT = 'unit-test prompt: a red cube on a blue table';

function links(g: Graph): Array<[string, string, string]> {
  const out: Array<[string, string, string]> = [];
  for (const [id, n] of Object.entries(g)) {
    for (const [k, v] of Object.entries(n.inputs)) {
      if (Array.isArray(v) && v.length === 2 && typeof v[0] === 'string' && typeof v[1] === 'number') out.push([id, k, v[0]]);
    }
  }
  return out;
}

for (const m of MEDIA_MODELS.filter((x) => x.backend !== 'cloudflare')) {
  test(`${m.id}: builds a valid graph`, () => {
    const g = buildGraph(m, { prompt: PROMPT, image: m.needsImage || m.acceptsImage ? 'start.png' : undefined, seed: 123 });
    const json = JSON.stringify(g);
    assert.ok(json.includes('unit-test prompt'), 'prompt was not written into the graph');
    for (const [id, key, target] of links(g)) {
      assert.ok(g[target], `${id}.${key} links to missing node ${target}`);
    }
    const outputs = Object.values(g).filter((n) => /^Save(Image|Video|ImageAdvanced)$/.test(n.class_type));
    assert.ok(outputs.length >= 1, 'no output node');
    if (m.needsImage) {
      const loaders = Object.values(g).filter((n) => n.class_type === 'LoadImage');
      assert.ok(loaders.some((n) => n.inputs.image === 'start.png'), 'start image not wired');
    }
  });

  test(`${m.id}: every ratio and fast mode build`, () => {
    for (const ratio of m.ratios) {
      buildGraph(m, { prompt: PROMPT, ratio, fast: true, image: 'start.png' });
    }
  });
}

test('needsImage models refuse to build without an image', () => {
  const m = MEDIA_MODELS.find((x) => x.needsImage)!;
  assert.throws(() => buildGraph(m, { prompt: PROMPT }), /needs a start image/);
});

test('durations are clamped to the model range', () => {
  const m = MEDIA_MODELS.find((x) => x.id === 'seedance25-t2v')!;
  const g = buildGraph(m, { prompt: PROMPT, duration: 999 });
  assert.equal(g['9'].inputs['model.duration'], 30);
});

test('ratioFromSize picks the closest ratio', () => {
  assert.equal(ratioFromSize(1920, 1080), '16:9');
  assert.equal(ratioFromSize(512, 512), '1:1');
  assert.equal(ratioFromSize(768, 1024), '3:4');
  assert.equal(ratioFromSize(undefined, undefined), '1:1');
});

test('cloudflare models: free-tier cost estimates match the published rates', () => {
  const schnell = MEDIA_MODELS.find((x) => x.id === 'cf-flux1-schnell')!;
  // 1024² = 4 tiles × 4.8 + 4 steps × 9.6 = 57.6 → ~173 free images/day
  assert.equal(cloudflareCost(schnell, { ratio: '1:1', fast: true }), 58);
  const klein = MEDIA_MODELS.find((x) => x.id === 'cf-flux2-klein-9b')!;
  assert.equal(cloudflareCost(klein, { ratio: '1:1', fast: false }), 1364);
  for (const m of MEDIA_MODELS.filter((x) => x.backend === 'cloudflare')) {
    assert.ok(m.cloudflare, `${m.id} has no cloudflare spec`);
    assert.throws(() => buildGraph(m, { prompt: 'x' }), /runs on Cloudflare/);
    const p = resolveParams(m, { prompt: 'x', ratio: '21:9' });
    assert.ok(m.ratios.includes(p.ratio));
    assert.ok(cloudflareCost(m, p) < 10_000, `${m.id} costs more than the whole free allowance`);
  }
});
