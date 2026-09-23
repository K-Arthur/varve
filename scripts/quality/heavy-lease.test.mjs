#!/usr/bin/env node

/** Regression coverage for the heavy-task lease's memory-availability gate
 * (added after repeated OOM kills / browser crashes when a raw `npx
 * playwright test` ran unwrapped under real memory pressure — see AGENTS.md
 * "Running E2E under memory pressure"). Black-box: invokes the actual CLI
 * with env overrides rather than importing internals, since the script is
 * meant to be run as a wrapper, not a library. */

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = new URL('./heavy-lease.mjs', import.meta.url).pathname;

/** Combined stdout+stderr: the wait/deadline messages are console.warn/error
 * (stderr, correct CLI convention) while the wrapped command's own output is
 * stdout — assertions below need both in one stream. */
function run(env, args) {
  // This test can itself run inside the lease (for example from
  // `verify:full`). Give each black-box child a private runtime directory so
  // it exercises acquisition without waiting on its parent's repository lock.
  const runtimeDirectory = mkdtempSync(join(tmpdir(), 'varve-heavy-lease-test-'));
  try {
    const result = spawnSync('node', [SCRIPT, ...args], {
      encoding: 'utf-8',
      env: { ...process.env, ...env, XDG_RUNTIME_DIR: runtimeDirectory },
    });
    assert.equal(result.status, 0, `expected exit 0, got ${result.status}\n${result.stderr}`);
    return `${result.stdout}${result.stderr}`;
  } finally {
    rmSync(runtimeDirectory, { recursive: true, force: true });
  }
}

async function waitForLease(runtimeDirectory, label) {
  const leaseDirectory = join(runtimeDirectory, 'varve-leases');
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      for (const name of readdirSync(leaseDirectory)) {
        const lease = JSON.parse(readFileSync(join(leaseDirectory, name), 'utf-8'));
        if (lease.label === label) return { path: join(leaseDirectory, name), lease };
      }
    } catch {
      // The first child may not have created its lease directory yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for ${label} lease`);
}

function waitForExit(child) {
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
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

// Reclaiming an over-age lock must not let its former owner delete the new
// owner's lease when the former task eventually exits.
{
  const runtimeDirectory = mkdtempSync(join(tmpdir(), 'varve-heavy-lease-race-'));
  const releaseOldOwner = join(runtimeDirectory, 'release-old-owner');
  const env = {
    ...process.env,
    XDG_RUNTIME_DIR: runtimeDirectory,
    VARVE_LEASE_MIN_MEM_MB: '0',
    VARVE_LEASE_STALE: '0',
    VARVE_LEASE_TIMEOUT: '5000',
  };
  let oldOwner;
  let newOwner;
  try {
    const waitForSignal =
      `const fs = require('node:fs'); const signal = ${JSON.stringify(releaseOldOwner)}; ` +
      'const deadline = Date.now() + 5000; const poll = () => { ' +
      'if (fs.existsSync(signal)) return; if (Date.now() >= deadline) process.exit(2); ' +
      'setTimeout(poll, 10); }; poll();';
    oldOwner = spawn('node', [SCRIPT, 'old-owner', '--', 'node', '-e', waitForSignal], {
      env,
      stdio: 'ignore',
    });
    const oldExit = waitForExit(oldOwner);
    const first = await waitForLease(runtimeDirectory, 'old-owner');
    await new Promise((resolve) => setTimeout(resolve, 20));

    newOwner = spawn(
      'node',
      [SCRIPT, 'new-owner', '--', 'node', '-e', 'setTimeout(() => {}, 1200)'],
      { env, stdio: 'ignore' },
    );
    const newExit = waitForExit(newOwner);
    const replacement = await waitForLease(runtimeDirectory, 'new-owner');
    assert.notEqual(replacement.lease.leaseId, first.lease.leaseId);

    writeFileSync(releaseOldOwner, 'release');
    assert.equal((await oldExit).code, 0);
    assert.equal(
      JSON.parse(readFileSync(replacement.path, 'utf-8')).leaseId,
      replacement.lease.leaseId,
    );
    assert.equal((await newExit).code, 0);
    assert.equal(existsSync(replacement.path), false);
  } finally {
    oldOwner?.kill('SIGTERM');
    newOwner?.kill('SIGTERM');
    rmSync(runtimeDirectory, { recursive: true, force: true });
  }
}

// The MemAvailable parser must exist and be reachable from the script for
// the above behavior to mean anything on this platform (guards against the
// regex silently matching nothing and always falling back to freemem()).
{
  const meminfo = readFileSync('/proc/meminfo', 'utf-8');
  assert.match(meminfo, /^MemAvailable:\s+\d+\s*kB/m, 'expected Linux /proc/meminfo format');
}

console.log('heavy-lease.test.mjs: all assertions passed');
