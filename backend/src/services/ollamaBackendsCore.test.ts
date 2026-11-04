import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyProbe,
  initialHealth,
  modelFor,
  normaliseUrl,
  parseBackends,
  pickBackend,
  pickBackendForModel,
  type BackendCandidate,
  type BackendHealth,
} from './ollamaBackendsCore';

const t = { failThreshold: 2, recoverThreshold: 2 };
const now = '2026-11-03T00:00:00.000Z';

function probes(h: BackendHealth, results: boolean[]): BackendHealth {
  return results.reduce((acc, ok) => applyProbe(acc, ok, ok ? ['m'] : null, ok ? null : 'down', t, now), h);
}

const gpu = (over: Partial<BackendCandidate> = {}): BackendCandidate => ({
  id: 'gpu-box',
  available: true,
  models: ['qwen3.8:27b', 'gemma4:latest'],
  defaultModel: 'qwen3.8:27b',
  ...over,
});
const mac = (over: Partial<BackendCandidate> = {}): BackendCandidate => ({
  id: 'mac',
  available: true,
  models: ['qwen3.6:35b', 'gemma4:latest'],
  defaultModel: 'qwen3.6:35b',
  ...over,
});

// ── parsing ────────────────────────────────────────────────────────────────

test('parseBackends reads id=url pairs in order', () => {
  assert.deepEqual(parseBackends('gpu-box=http://192.168.0.106:11434/, mac=http://192.168.0.29:11434', 'http://x:1'), [
    { id: 'gpu-box', url: 'http://192.168.0.106:11434' },
    { id: 'mac', url: 'http://192.168.0.29:11434' },
  ]);
});

test('parseBackends falls back to the single URL when unset or all invalid', () => {
  assert.deepEqual(parseBackends(undefined, 'http://192.168.0.106:11434'), [
    { id: 'default', url: 'http://192.168.0.106:11434' },
  ]);
  assert.deepEqual(parseBackends('bad=notaurl', 'http://a:1'), [{ id: 'default', url: 'http://a:1' }]);
});

test('parseBackends skips duplicate ids and names id-less entries', () => {
  assert.deepEqual(parseBackends('a=http://h1:1,a=http://h2:2,http://h3:3', 'http://x:1'), [
    { id: 'a', url: 'http://h1:1' },
    { id: 'backend-3', url: 'http://h3:3' },
  ]);
});

test('normaliseUrl rejects paths-only and non-http schemes', () => {
  assert.equal(normaliseUrl('ftp://h:1'), null);
  assert.equal(normaliseUrl(''), null);
  assert.equal(normaliseUrl('http://Mac.local:11434/x/'), 'http://mac.local:11434');
});

// ── health ─────────────────────────────────────────────────────────────────

test('first probe decides health immediately', () => {
  assert.equal(probes(initialHealth(), [false]).healthy, false);
  assert.equal(probes(initialHealth(), [true]).healthy, true);
});

test('a healthy backend goes down only after the fail threshold', () => {
  const h = probes(initialHealth(), [true, false]);
  assert.equal(h.healthy, true);
  assert.equal(probes(h, [false]).healthy, false);
});

test('a down backend comes back only after the recover threshold, and a flap resets it', () => {
  let h = probes(initialHealth(), [false, true, false, true]);
  assert.equal(h.healthy, false);
  h = probes(h, [true]);
  assert.equal(h.healthy, true);
});

test('model list is kept from the last good probe while failing', () => {
  const h = applyProbe(initialHealth(), true, ['a', 'b'], null, t, now);
  const failed = applyProbe(h, false, null, 'timed out', t, now);
  assert.deepEqual(failed.models, ['a', 'b']);
  assert.equal(failed.error, 'timed out');
});

// ── model choice ───────────────────────────────────────────────────────────

test('modelFor keeps a requested model the backend has', () => {
  assert.equal(modelFor(mac(), 'gemma4:latest'), 'gemma4:latest');
  assert.equal(modelFor(mac(), 'gemma4'), 'gemma4');
});

test("modelFor uses the backend default when it lacks the requested model", () => {
  assert.equal(modelFor(mac(), 'qwen3.8:27b'), 'qwen3.6:35b');
  assert.equal(modelFor(mac(), null), 'qwen3.6:35b');
});

test('modelFor falls back to the first installed model without a default', () => {
  assert.equal(modelFor(mac({ defaultModel: null }), null), 'qwen3.6:35b');
});

test('modelFor trusts the requested model when the model list is unknown', () => {
  assert.equal(modelFor(mac({ models: null }), 'anything'), 'anything');
});

// ── backend choice ─────────────────────────────────────────────────────────

test('null request picks the primary', () => {
  assert.deepEqual(pickBackend([gpu(), mac()], null, null), { id: 'gpu-box', model: 'qwen3.8:27b', switched: false });
});

test('a requested, available backend is used as chosen', () => {
  assert.deepEqual(pickBackend([gpu(), mac()], 'mac', null), { id: 'mac', model: 'qwen3.6:35b', switched: false });
});

test('an unknown id is treated as the primary', () => {
  assert.equal(pickBackend([gpu(), mac()], 'nope', null).id, 'gpu-box');
});

test('switches to the other backend with its default model when the chosen one is down', () => {
  assert.deepEqual(pickBackend([gpu({ available: false }), mac()], 'gpu-box', 'qwen3.8:27b'), {
    id: 'mac',
    model: 'qwen3.6:35b',
    switched: true,
  });
});

test('keeps the chat model across a switch when the other backend has it', () => {
  const p = pickBackend([gpu(), mac({ available: false })], 'mac', 'gemma4:latest');
  assert.deepEqual(p, { id: 'gpu-box', model: 'gemma4:latest', switched: true });
});

test('stays on the requested backend when nothing is available', () => {
  const p = pickBackend([gpu({ available: false }), mac({ available: false })], 'mac', null);
  assert.deepEqual(p, { id: 'mac', model: 'qwen3.6:35b', switched: false });
});

test('a single backend is always used', () => {
  assert.equal(pickBackend([gpu({ available: false })], 'gpu-box', null).id, 'gpu-box');
});

// ── public API routing by model ────────────────────────────────────────────

test('pickBackendForModel prefers an available backend that has the model', () => {
  assert.equal(pickBackendForModel([gpu(), mac()], 'qwen3.6:35b'), 'mac');
  assert.equal(pickBackendForModel([gpu(), mac()], 'gemma4:latest'), 'gpu-box');
});

test('pickBackendForModel falls back to the first available backend', () => {
  assert.equal(pickBackendForModel([gpu(), mac()], 'unknown'), 'gpu-box');
  assert.equal(pickBackendForModel([gpu({ available: false }), mac()], 'qwen3.8:27b'), 'mac');
  assert.equal(pickBackendForModel([gpu({ available: false }), mac({ available: false })], null), 'gpu-box');
});
