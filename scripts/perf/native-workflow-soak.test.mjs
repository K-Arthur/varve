import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryPlateau, validateWorkflowEvents } from './native-workflow-soak.mjs';

function cycle(overrides = {}) {
  return {
    schemaVersion: 1,
    type: 'cycleComplete',
    index: 1,
    phases: { open: 'completed', interact: 'completed', save: 'completed', close: 'completed' },
    input: { source: 'webdriver-dom-synthetic', trusted: false },
    webview: { visible: true, width: 1200, height: 800 },
    pixels: { before: 12, after: 34, changed: true },
    screenshot: { path: '/tmp/cycle-001.png', bytes: 5000, exists: true },
    ...overrides,
  };
}

test('accepts completed visible synthetic workflows without calling them OS input', () => {
  assert.deepEqual(validateWorkflowEvents([cycle()], 1), []);
});

test('rejects missing lifecycle phases, hidden windows, unchanged pixels, and screenshots', () => {
  const event = cycle({
    phases: { open: 'completed', interact: 'completed', save: 'missing', close: 'completed' },
    webview: { visible: false, width: 0, height: 800 },
    pixels: { before: 12, after: 12, changed: false },
    screenshot: { path: '', bytes: 0, exists: false },
  });

  assert.ok(
    validateWorkflowEvents([event], 1).includes('cycle-1-save-missing'),
    'missing save phase must block evidence',
  );
  assert.ok(validateWorkflowEvents([event], 1).includes('cycle-1-hidden-or-zero-size-webview'));
  assert.ok(validateWorkflowEvents([event], 1).includes('cycle-1-artwork-pixels-did-not-change'));
  assert.ok(validateWorkflowEvents([event], 1).includes('cycle-1-screenshot-evidence-missing'));
});

test('rejects screenshot metadata when the image has been removed', () => {
  const event = cycle({ screenshot: { path: '/tmp/missing.png', bytes: 5000, exists: false } });
  assert.ok(validateWorkflowEvents([event], 1).includes('cycle-1-screenshot-evidence-missing'));
});

test('requires an event for every requested cycle in order', () => {
  assert.deepEqual(validateWorkflowEvents([cycle()], 2), ['completed-1-of-2-cycles']);
  assert.ok(validateWorkflowEvents([cycle({ index: 2 })], 1).includes('cycle-1-sequence-invalid'));
});

test('requires enough process-tree samples and checks the final memory plateau', () => {
  assert.equal(memoryPlateau(Array(39).fill(100_000)).reason, 'fewer-than-40-memory-samples');
  assert.equal(memoryPlateau(Array(20).fill(100_000).concat(Array(20).fill(104_000))).passed, true);
  const growing = memoryPlateau(Array(20).fill(100_000).concat(Array(20).fill(130_000)));
  assert.equal(growing.passed, false);
  assert.equal(growing.reason, 'final-memory-window-exceeds-plateau-limit');
});
