import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import BrowserProgressReporter from './browser-progress.mjs';

const root = mkdtempSync(join(tmpdir(), 'varve-browser-progress-'));
const caseFor = (id) => ({
  id,
  parent: { project: () => ({ name: 'chromium' }) },
  location: { file: '/tests/flow.spec.ts', line: 5 },
  titlePath: () => ['flow', id],
  expectedStatus: 'passed',
  annotations: [],
});
const resultFor = (status, retry = 0) => ({
  status,
  retry,
  duration: 1200,
  workerIndex: 0,
  errors: [],
  attachments: [],
});
const config = { rootDir: '/tests', workers: 1, shard: { current: 1, total: 8 } };

test('retains first failures and incomplete case inventory through crashes and retries', () => {
  const outputFile = join(root, 'progress.json');
  const reporter = new BrowserProgressReporter({ outputFile });
  const first = caseFor('first');
  const second = caseFor('second');
  reporter.onBegin(config, { allTests: () => [first, second] });
  reporter.onTestBegin(first, resultFor('failed'));
  reporter.onTestEnd(first, {
    ...resultFor('failed'),
    errors: [{ message: 'download https://example.invalid/model?token=private-token' }],
  });
  reporter.onTestBegin(first, resultFor('passed', 1));
  reporter.onTestEnd(first, resultFor('passed', 1));
  const interrupted = JSON.parse(readFileSync(outputFile, 'utf8'));
  assert.equal(interrupted.status, 'running');
  assert.equal(interrupted.summary.pending, 1);
  assert.equal(interrupted.summary.unexpectedAttempts, 1);
  assert.equal(interrupted.summary.retries, 1);
  assert.ok(!JSON.stringify(interrupted).includes('private-token'));
  assert.equal(interrupted.summary.firstFailure.id, 'first');
  assert.deepEqual(reporter.onEnd({ status: 'passed', duration: 2400 }), { status: 'failed' });
  reporter.onTestEnd(second, resultFor('skipped'));
  reporter.onEnd({ status: 'interrupted', duration: 2500 });
  assert.equal(JSON.parse(readFileSync(outputFile, 'utf8')).status, 'interrupted');
});

test('complete diagnostics persist timing and errors cannot silently turn into green', () => {
  const outputFile = join(root, 'complete.json');
  const reporter = new BrowserProgressReporter({ outputFile });
  const first = caseFor('first');
  reporter.onBegin(config, { allTests: () => [first] });
  reporter.onTestEnd(first, resultFor('passed'));
  assert.equal(reporter.onEnd({ status: 'passed', duration: 1400 }), undefined);
  const record = JSON.parse(readFileSync(outputFile, 'utf8'));
  assert.equal(record.summary.pending, 0);
  assert.equal(record.summary.durationP95Ms, 1200);
  assert.equal(record.summary.completed, 1);
  reporter.onError({ message: 'worker crashed' });
  assert.deepEqual(reporter.onEnd({ status: 'passed', duration: 1400 }), { status: 'failed' });
});

test('a write failure changes the runner outcome instead of being swallowed by Playwright', () => {
  const blocked = join(root, 'file-not-directory');
  writeFileSync(blocked, 'fixture');
  const reporter = new BrowserProgressReporter({ outputFile: join(blocked, 'progress.json') });
  reporter.onBegin(config, { allTests: () => [] });
  assert.deepEqual(reporter.onEnd({ status: 'passed', duration: 1 }), { status: 'failed' });
});

test('list-only discovery does not create execution evidence or fail for absent attempts', () => {
  const outputFile = join(root, 'discovery.json');
  const reporter = new BrowserProgressReporter({ outputFile, argv: ['playwright', '--list'] });
  reporter.onBegin(config, { allTests: () => [caseFor('listed')] });
  assert.equal(reporter.onEnd({ status: 'passed', duration: 1 }), undefined);
  assert.equal(existsSync(outputFile), false);
});

process.on('exit', () => rmSync(root, { recursive: true, force: true }));
