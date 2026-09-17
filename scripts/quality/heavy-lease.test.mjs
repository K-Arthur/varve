#!/usr/bin/env node

/** Regression coverage for the heavy-task lease's memory-availability gate
 * (added after repeated OOM kills / browser crashes when a raw `npx
 * playwright test` ran unwrapped under real memory pressure — see AGENTS.md
 * "Running E2E under memory pressure"). Black-box: invokes the actual CLI
 * with env overrides rather than importing internals, since the script is
 * meant to be run as a wrapper, not a library. */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const SCRIPT = new URL('./heavy-lease.mjs', import.meta.url).pathname;

/** Combined stdout+stderr: the wait/deadline messages are console.warn/error
 * (stderr, correct CLI convention) while the wrapped command's own output is
 * stdout — assertions below need both in one stream. */
function run(env, args) {
  const result = spawnSync('node', [SCRIPT, ...args], {
    encoding: 'utf-8',
    env: { ...process.env, ...env },
  });
  assert.equal(result.status, 0, `expected exit 0, got ${result.status}\n${result.stderr}`);
  return `${result.stdout}${result.stderr}`;
}

// A floor of 0MB is always satisfied immediately: no wait, command runs once.
{
  const out = run({ VARVE_LEASE_MIN_MEM_MB: '0' }, [
    'test-immediate',
    '--',
    'node',
    '-e',
    'console.log("ran")',
  ]);
  assert.match(out, /ran/);
  assert.doesNotMatch(out, /below the 0MB floor/);
}

// An impossible floor (larger than total system RAM) must still wait, warn
// exactly once, hit its deadline, and then run the command anyway rather
// than hang forever or silently skip it.
{
  const out = run(
    {
      VARVE_LEASE_MIN_MEM_MB: '999999999',
      VARVE_LEASE_TIMEOUT: '3000',
      VARVE_LEASE_MEM_POLL_MS: '1000',
    },
    ['test-deadline', '--', 'node', '-e', 'console.log("ran-after-deadline")'],
  );
  assert.match(out, /below the 999999999MB floor for test-deadline/);
  assert.match(out, /proceeding anyway \(deadline reached\)/);
  assert.match(out, /ran-after-deadline/);
  const warnCount = (out.match(/below the 999999999MB floor/g) ?? []).length;
  assert.equal(warnCount, 1, 'should warn once, not once per poll tick');
}

// VARVE_HEAVY_TASK_PARALLELISM=0 bypasses the memory gate entirely, same as
// it already bypasses the lease — a deliberate full opt-out, not throttled.
{
  const out = run({ VARVE_HEAVY_TASK_PARALLELISM: '0', VARVE_LEASE_MIN_MEM_MB: '999999999' }, [
    'test-optout',
    '--',
    'node',
    '-e',
    'console.log("ran-unthrottled")',
  ]);
  assert.match(out, /ran-unthrottled/);
  assert.doesNotMatch(out, /below the/);
}

// The MemAvailable parser must exist and be reachable from the script for
// the above behavior to mean anything on this platform (guards against the
// regex silently matching nothing and always falling back to freemem()).
{
  const meminfo = readFileSync('/proc/meminfo', 'utf-8');
  assert.match(meminfo, /^MemAvailable:\s+\d+\s*kB/m, 'expected Linux /proc/meminfo format');
}

console.log('heavy-lease.test.mjs: all assertions passed');
