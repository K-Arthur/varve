#!/usr/bin/env node

/** Operation journal tests: atomic lifecycle, retries, recovery, and redaction. */

import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  finishOperation,
  formatOperation,
  listOperations,
  recoverInterruptedOperations,
  sanitizeRemoteUrl,
  startOperation,
} from './operation-history.mjs';

const commonDir = mkdtempSync(join(tmpdir(), 'varve-operation-history-'));
try {
  assert.equal(
    sanitizeRemoteUrl('https://user:token@example.test/varve.git?access_token=secret'),
    'https://example.test/varve.git',
  );
  assert.equal(
    sanitizeRemoteUrl('git@example.test:team/varve.git'),
    'git@example.test:team/varve.git',
  );

  const started = startOperation({
    type: 'push-checkpoint',
    cwd: '/tmp/varve-worktree-a',
    commonDir,
    destination: {
      name: 'origin',
      url: 'https://user:token@example.test/team/varve.git?token=secret',
    },
    requested: { profile: 'push', strict: false },
    refs: [
      {
        localRef: 'refs/heads/feature',
        localSha: 'a'.repeat(40),
        remoteRef: 'refs/heads/feature',
        remoteSha: 'b'.repeat(40),
        treeSha: 'c'.repeat(40),
      },
    ],
    now: Date.parse('2026-09-08T12:00:00Z'),
  });
  assert.ok(existsSync(started.path));
  assert.match(formatOperation(started.record), /push-checkpoint running/);
  const finished = finishOperation(started.path, {
    status: 'failed',
    exitCode: 1,
    phase: 'lane',
    result: { category: 'validation-failure', failedLane: 'lint:changed' },
    now: Date.parse('2026-09-08T12:00:03Z'),
  });
  assert.equal(finished.status, 'failed');
  assert.equal(finished.result.exitCode, 1);
  assert.equal(finished.durationMs, 3000);
  assert.equal(finished.destination.url, 'https://example.test/team/varve.git');

  // A retry is a separate immutable operation file, not a rewrite of the
  // failed attempt.
  const retry = startOperation({
    type: 'push-checkpoint',
    commonDir,
    now: Date.parse('2026-09-08T12:01:00Z'),
  });
  finishOperation(retry.path, {
    status: 'completed',
    exitCode: 0,
    now: Date.parse('2026-09-08T12:01:01Z'),
  });
  assert.equal(readdirSync(join(commonDir, 'varve-validation', 'operations')).length, 2);
  assert.equal(listOperations({ commonDir }).length, 2);

  const interrupted = startOperation({
    type: 'pull-validation',
    commonDir,
    now: Date.parse('2026-09-08T10:00:00Z'),
  });
  const recovered = recoverInterruptedOperations({
    commonDir,
    now: Date.parse('2026-09-08T11:00:00Z'),
    maxAgeMs: 30 * 60 * 1000,
  });
  assert.equal(recovered.length, 1);
  assert.equal(
    listOperations({ commonDir }).find((entry) => entry.path === interrupted.path).record.status,
    'incomplete',
  );

  console.log('operation history tests passed');
} finally {
  rmSync(commonDir, { recursive: true, force: true });
}
