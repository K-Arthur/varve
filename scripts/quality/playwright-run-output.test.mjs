import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveRunOutput, validatedE2ePort } from './playwright-run-output.mjs';

test('workers and failure restarts share the coordinator output while runs stay isolated', () => {
  const environment = {};
  assert.equal(resolveRunOutput(environment, { pid: 101, port: '1420' }), 'run-101-1420');
  assert.equal(resolveRunOutput({ ...environment }, { pid: 102, port: '1420' }), 'run-101-1420');
  assert.equal(resolveRunOutput({}, { pid: 103, port: '1420' }), 'run-103-1420');
  assert.equal(resolveRunOutput({ VARVE_E2E_OUTPUT_DIR: 'ci-run-42' }), 'ci-run-42');
});

test('rejects report traversal and shell-unsafe port overrides before starting servers', () => {
  for (const value of ['../capture', '/tmp/report', 'two/paths', '', 'a\\b'])
    assert.throws(() => resolveRunOutput({ VARVE_E2E_OUTPUT_DIR: value }), /single directory/);
  for (const value of ['0', '65536', '1420; touch sentinel', '-1', '1.5', ''])
    assert.throws(() => validatedE2ePort(value), /integer/);
  assert.equal(validatedE2ePort('1499'), '1499');
});
