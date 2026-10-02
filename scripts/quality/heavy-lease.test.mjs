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
import { fileURLToPath } from 'node:url';
import { runValidationCommand } from './heavy-lease.mjs';

const SCRIPT = fileURLToPath(new URL('./heavy-lease.mjs', import.meta.url));

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

// An impossible memory floor fails closed at its deadline: no command starts,
// the diagnostic survives, and the acquired lease is released safely.
{
  const runtimeDirectory = mkdtempSync(join(tmpdir(), 'varve-heavy-memory-deadline-'));
  const marker = join(runtimeDirectory, 'unexpected-command');
  try {
    const result = spawnSync(
      process.execPath,
      [
        SCRIPT,
        'test-deadline',
        '--',
        process.execPath,
        '-e',
        `require('node:fs').writeFileSync(${JSON.stringify(marker)},'launched')`,
      ],
      {
        encoding: 'utf8',
        timeout: 2000,
        env: {
          ...process.env,
          XDG_RUNTIME_DIR: runtimeDirectory,
          VARVE_LEASE_MIN_MEM_MB: '999999999',
          VARVE_LEASE_TIMEOUT: '80',
          VARVE_LEASE_MEM_POLL_MS: '20',
        },
      },
    );
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /command not launched \(deadline reached\)/);
    assert.equal((result.stderr.match(/below the 999999999MB floor/g) ?? []).length, 1);
    assert.equal(existsSync(marker), false);
    assert.deepEqual(readdirSync(join(runtimeDirectory, 'varve-leases')), []);
  } finally {
    rmSync(runtimeDirectory, { recursive: true, force: true });
  }
}

// Windows ChildProcess.kill('SIGTERM') force-kills without running Node's
// handler. A file-triggered in-process event exercises that handler while the
// real Windows CLI, lease and command tree remain intact; POSIX uses real TERM.
function cancellationPreload(directory, marker) {
  const path = join(directory, 'cancel-event.mjs');
  writeFileSync(
    path,
    `import fs from 'node:fs';const timer=setInterval(()=>{if(fs.existsSync(${JSON.stringify(marker)})){clearInterval(timer);process.emit('SIGTERM')}},5);timer.unref();`,
  );
  return process.platform === 'win32' ? ['--import', path] : [];
}

// Cancellation during memory admission returns its exact signal exit and
// releases the lease without ever starting the wrapped command.
{
  const runtimeDirectory = mkdtempSync(join(tmpdir(), 'varve-heavy-memory-cancel-'));
  const marker = join(runtimeDirectory, 'unexpected-command');
  const cancelEvent = join(runtimeDirectory, 'cancel-event');
  let owner;
  try {
    owner = spawn(
      process.execPath,
      [
        ...cancellationPreload(runtimeDirectory, cancelEvent),
        SCRIPT,
        'memory-cancel',
        '--',
        process.execPath,
        '-e',
        `require('node:fs').writeFileSync(${JSON.stringify(marker)},'launched')`,
      ],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          XDG_RUNTIME_DIR: runtimeDirectory,
          VARVE_LEASE_MIN_MEM_MB: '999999999',
          VARVE_LEASE_TIMEOUT: '5000',
          VARVE_LEASE_MEM_POLL_MS: '1000',
        },
      },
    );
    const exit = waitForExit(owner);
    let output = '';
    owner.stderr.setEncoding('utf8').on('data', (chunk) => {
      output += chunk;
    });
    const record = await waitForLease(runtimeDirectory, 'memory-cancel');
    const deadline = Date.now() + 2000;
    while (!output.includes('below the') && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 5));
    assert.match(output, /below the/);
    if (process.platform === 'win32') writeFileSync(cancelEvent, 'cancel');
    else owner.kill('SIGTERM');
    const result = await exit;
    assert.equal(result.code, 143);
    assert.match(output, /cancelled by SIGTERM while waiting for memory; command not launched/);
    assert.equal(existsSync(marker), false);
    assert.equal(existsSync(record.path), false);
  } finally {
    owner?.kill('SIGKILL');
    rmSync(runtimeDirectory, { recursive: true, force: true });
  }
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

// A long-running owner retains its lease even when the recorded timestamp is old.
{
  const runtimeDirectory = mkdtempSync(join(tmpdir(), 'varve-heavy-lease-race-'));
  const releaseOldOwner = join(runtimeDirectory, 'release-old-owner');
  const env = {
    ...process.env,
    XDG_RUNTIME_DIR: runtimeDirectory,
    VARVE_LEASE_MIN_MEM_MB: '0',
    VARVE_LEASE_TIMEOUT: '15000',
  };
  let oldOwner;
  let newOwner;
  try {
    const waitForSignal =
      `const fs = require('node:fs'); const signal = ${JSON.stringify(releaseOldOwner)}; ` +
      'const deadline = Date.now() + 20000; const poll = () => { ' +
      'if (fs.existsSync(signal)) return; if (Date.now() >= deadline) process.exit(2); ' +
      'setTimeout(poll, 10); }; poll();';
    oldOwner = spawn('node', [SCRIPT, 'old-owner', '--', 'node', '-e', waitForSignal], {
      env,
      stdio: 'ignore',
    });
    const oldExit = waitForExit(oldOwner);
    const first = await waitForLease(runtimeDirectory, 'old-owner');
    writeFileSync(
      first.path,
      JSON.stringify({ ...first.lease, startedAt: Date.now() - 60 * 60 * 1000 }, null, 2),
    );

    newOwner = spawn(
      'node',
      [SCRIPT, 'new-owner', '--', 'node', '-e', 'console.log("new-owner-ran")'],
      { env, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const newExit = waitForExit(newOwner);
    let newOutput = '';
    newOwner.stdout.setEncoding('utf8').on('data', (chunk) => (newOutput += chunk));
    newOwner.stderr.setEncoding('utf8').on('data', (chunk) => (newOutput += chunk));
    const waitDeadline = Date.now() + 5000;
    while (!newOutput.includes('waiting for old-owner') && Date.now() < waitDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.match(newOutput, /waiting for old-owner/);
    assert.doesNotMatch(newOutput, /reclaiming stale lease/);
    assert.equal(
      JSON.parse(readFileSync(first.path, 'utf-8')).leaseId,
      first.lease.leaseId,
      'old owner lease should remain while its PID is active',
    );

    writeFileSync(releaseOldOwner, 'release');
    assert.equal((await oldExit).code, 0);
    assert.equal((await newExit).code, 0);
    assert.match(newOutput, /new-owner-ran/);
    assert.equal(existsSync(first.path), false);
  } finally {
    oldOwner?.kill('SIGTERM');
    newOwner?.kill('SIGTERM');
    rmSync(runtimeDirectory, { recursive: true, force: true });
  }
}

// A finishing owner must not unlink a replacement lock with a different ID.
{
  const runtimeDirectory = mkdtempSync(join(tmpdir(), 'varve-heavy-lease-release-'));
  const releaseOwner = join(runtimeDirectory, 'release-owner');
  const env = {
    ...process.env,
    XDG_RUNTIME_DIR: runtimeDirectory,
    VARVE_LEASE_MIN_MEM_MB: '0',
    VARVE_LEASE_TIMEOUT: '5000',
  };
  let owner;
  try {
    const waitForSignal =
      `const fs = require('node:fs'); const signal = ${JSON.stringify(releaseOwner)}; ` +
      'const poll = () => { if (fs.existsSync(signal)) return; setTimeout(poll, 10); }; poll();';
    owner = spawn('node', [SCRIPT, 'original-owner', '--', 'node', '-e', waitForSignal], {
      env,
      stdio: 'ignore',
    });
    const ownerExit = waitForExit(owner);
    const original = await waitForLease(runtimeDirectory, 'original-owner');
    const replacement = {
      ...original.lease,
      leaseId: 'replacement-lease-id',
      label: 'replacement',
    };
    writeFileSync(original.path, JSON.stringify(replacement, null, 2));
    writeFileSync(releaseOwner, 'release');
    assert.equal((await ownerExit).code, 0);
    assert.equal(JSON.parse(readFileSync(original.path, 'utf-8')).leaseId, replacement.leaseId);
  } finally {
    owner?.kill('SIGTERM');
    rmSync(runtimeDirectory, { recursive: true, force: true });
  }
}

// Only Linux has /proc/meminfo. The CLI sampling fixtures below exercise
// Linux's parser and the non-Linux/fallback source on every actual host.
if (process.platform === 'linux') {
  const meminfo = readFileSync('/proc/meminfo', 'utf-8');
  assert.match(meminfo, /^MemAvailable:\s+\d+\s*kB/m, 'expected Linux /proc/meminfo format');
}
for (const sample of [
  { platform: 'linux', meminfo: 'MemAvailable: 98304 kB\n', freeMB: 8, admitted: true },
  { platform: 'linux', meminfo: 'MemAvailable: 16384 kB\n', freeMB: 96, admitted: false },
  { platform: 'linux', meminfo: 'missing available field\n', freeMB: 96, admitted: true },
  { platform: 'win32', meminfo: 'must not read proc\n', freeMB: 96, admitted: true },
  { platform: 'darwin', meminfo: 'must not read proc\n', freeMB: 8, admitted: false },
]) {
  const directory = mkdtempSync(join(tmpdir(), 'varve-memory-source-'));
  const marker = join(directory, 'launched');
  const preload = join(directory, 'memory-source.mjs');
  try {
    writeFileSync(
      preload,
      `import fs from 'node:fs';import os from 'node:os';import {syncBuiltinESMExports} from 'node:module';const actual=fs.readFileSync;os.platform=()=>${JSON.stringify(sample.platform)};os.freemem=()=>${sample.freeMB}*1024*1024;fs.readFileSync=function(path,...args){if(String(path)==='/proc/meminfo'){if(${JSON.stringify(sample.platform)}!=='linux')throw Error('non-Linux must not sample proc');return ${JSON.stringify(sample.meminfo)}}return actual.call(this,path,...args)};syncBuiltinESMExports();`,
    );
    const result = spawnSync(
      process.execPath,
      [
        '--import',
        preload,
        SCRIPT,
        'memory-source',
        '--',
        process.execPath,
        '-e',
        `require('node:fs').writeFileSync(${JSON.stringify(marker)},'launched')`,
      ],
      {
        encoding: 'utf8',
        timeout: 2000,
        env: {
          ...process.env,
          XDG_RUNTIME_DIR: directory,
          VARVE_LEASE_MIN_MEM_MB: '64',
          VARVE_LEASE_TIMEOUT: '100',
          VARVE_LEASE_MEM_POLL_MS: '10',
        },
      },
    );
    assert.equal(result.error, undefined);
    assert.equal(result.status, sample.admitted ? 0 : 1, result.stderr);
    assert.equal(
      existsSync(marker),
      sample.admitted,
      'real CLI admission must match its selected memory source',
    );
    if (!sample.admitted) assert.match(result.stderr, /command not launched \(deadline reached\)/);
    assert.deepEqual(readdirSync(join(directory, 'varve-leases')), []);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function activeProcess(pid) {
  try {
    if (process.platform === 'linux') {
      const text = readFileSync(`/proc/${pid}/stat`, 'utf8');
      return text.slice(text.lastIndexOf(')') + 2).split(' ')[0] !== 'Z';
    }
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForFile(path) {
  const deadline = Date.now() + 3000;
  while (!existsSync(path) && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 5));
  assert.ok(existsSync(path), `fixture did not become ready: ${path}`);
}

// Real detached grandchildren model pnpm's separate process groups. A lease
// stays held through cooperative cleanup; an unrelated sibling is untouched.
// Windows taskkill is forcible; POSIX additionally covers cooperative TERM.
for (const cooperate of process.platform === 'win32' ? [false] : [true, false]) {
  const runtimeDirectory = mkdtempSync(join(tmpdir(), 'varve-heavy-cancel-'));
  const ready = join(runtimeDirectory, 'ready.json');
  const signalled = join(runtimeDirectory, 'signalled');
  const finish = join(runtimeDirectory, 'finish');
  const cancelEvent = join(runtimeDirectory, 'cancel-event');
  let owner;
  let sentinel;
  let pids;
  try {
    const grandchild = `const fs=require('node:fs');process.on('SIGTERM',()=>fs.writeFileSync(process.argv[2],'signal'));fs.writeFileSync(process.argv[1],JSON.stringify({parent:Number(process.argv[4]),grandchild:process.pid}));setInterval(()=>{if(${cooperate}&&fs.existsSync(process.argv[3]))process.exit(0)},5);`;
    const parent = `const {spawn}=require('node:child_process');process.on('SIGTERM',()=>{});const child=spawn(process.execPath,['-e',${JSON.stringify(grandchild)},...process.argv.slice(1),String(process.pid)],{detached:true,stdio:'ignore'});child.on('exit',()=>process.exit(0));setInterval(()=>{},1000);`;
    sentinel = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
    owner = spawn(
      process.execPath,
      [
        ...cancellationPreload(runtimeDirectory, cancelEvent),
        SCRIPT,
        'cancel-owned',
        '--',
        process.execPath,
        '-e',
        parent,
        ready,
        signalled,
        finish,
      ],
      {
        env: { ...process.env, XDG_RUNTIME_DIR: runtimeDirectory, VARVE_LEASE_MIN_MEM_MB: '0' },
        stdio: 'ignore',
      },
    );
    const exit = waitForExit(owner);
    const record = await waitForLease(runtimeDirectory, 'cancel-owned');
    await waitForFile(ready);
    pids = JSON.parse(readFileSync(ready, 'utf8'));
    assert.equal(existsSync(record.path), true, 'lease must remain while a descendant is alive');
    assert.equal(activeProcess(pids.grandchild), true);
    assert.equal(activeProcess(sentinel.pid), true, 'unrelated process must remain alive');
    if (process.platform === 'win32') writeFileSync(cancelEvent, 'cancel');
    else {
      owner.kill('SIGTERM');
      await waitForFile(signalled);
      assert.equal(existsSync(record.path), true, 'lease must remain through cooperative cleanup');
    }
    if (cooperate) writeFileSync(finish, 'release');
    const result = await Promise.race([
      exit,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('bounded cancellation did not finish')), 4000).unref(),
      ),
    ]);
    assert.equal(result.code, 143);
    assert.equal(result.signal, null, 'wrapper records the signal as an explicit nonzero exit');
    assert.equal(activeProcess(pids.parent), false);
    assert.equal(
      activeProcess(pids.grandchild),
      false,
      'detached grandchild may not survive cancellation',
    );
    assert.equal(activeProcess(sentinel.pid), true);
    assert.equal(
      existsSync(record.path),
      false,
      'lease is released only after all owned work stops',
    );
  } finally {
    for (const pid of Object.values(pids ?? {})) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {}
    }
    owner?.kill('SIGKILL');
    sentinel?.kill('SIGKILL');
    rmSync(runtimeDirectory, { recursive: true, force: true });
  }
}

// Failed/throwing taskkill is injected on every host. In-process emission
// drives Node's cancellation handler; real taskkill success is covered above.
for (const throws of [false, true]) {
  const directory = mkdtempSync(join(tmpdir(), 'varve-windows-cleanup-'));
  const ready = join(directory, 'ready');
  const receipt = join(directory, 'receipt.json');
  let ownedPid;
  try {
    const source = `import {runValidationCommand} from ${JSON.stringify(new URL('./heavy-lease.mjs', import.meta.url).href)};import fs from 'node:fs';const ready=${JSON.stringify(ready)};const task=runValidationCommand([process.execPath,'-e',"const fs=require('node:fs');process.on('SIGTERM',()=>{});fs.writeFileSync(process.argv[1],String(process.pid));setInterval(()=>{},1000)",ready],{platform:'win32',graceMs:30,windowsKill:async()=>{${throws ? "throw Error('taskkill unavailable')" : 'return false'}}});while(!fs.existsSync(ready))await new Promise(r=>setTimeout(r,5));process.emit('SIGTERM');const result=await task;fs.writeFileSync(${JSON.stringify(receipt)},JSON.stringify(result));process.exitCode=result.status;`;
    const runner = spawn(process.execPath, ['--input-type=module', '-e', source], {
      stdio: 'ignore',
    });
    const result = await Promise.race([
      waitForExit(runner),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error('Windows failure contract did not finish')),
          3000,
        ).unref(),
      ),
    ]);
    ownedPid = Number(readFileSync(ready, 'utf8'));
    const evidence = JSON.parse(readFileSync(receipt, 'utf8'));
    assert.equal(result.code, 143);
    assert.equal(evidence.cleanupUnknown, true, 'unverified taskkill cannot release the lease');
    if (process.platform === 'win32') {
      // The fallback kill ends the native root, but failed taskkill cannot
      // verify its whole tree and must still retain unknown-cleanup evidence.
      assert.deepEqual(evidence.remaining, []);
      assert.equal(activeProcess(ownedPid), false);
    } else {
      assert.deepEqual(evidence.remaining, [{ pid: ownedPid, identity: null, depth: 0 }]);
      assert.equal(
        activeProcess(ownedPid),
        true,
        'the still-live root must be retained as evidence',
      );
    }
  } finally {
    if (!ownedPid && existsSync(ready)) ownedPid = Number(readFileSync(ready, 'utf8'));
    if (ownedPid) {
      try {
        process.kill(ownedPid, 'SIGKILL');
      } catch {}
    }
    rmSync(directory, { recursive: true, force: true });
  }
}

// Synchronous spawn validation errors and asynchronous ENOENT leave no
// cancellation listener behind and return a nonzero command result.
{
  const before = ['SIGINT', 'SIGTERM', 'SIGHUP'].map((signal) => process.listenerCount(signal));
  for (const argv of [[null], ['/varve-fixture-missing-command']]) {
    const result = await runValidationCommand(argv, { stdio: 'ignore' });
    assert.equal(result.status, 1);
    assert.deepEqual(result.remaining, []);
    assert.equal(result.cleanupUnknown, false);
  }
  assert.deepEqual(
    ['SIGINT', 'SIGTERM', 'SIGHUP'].map((signal) => process.listenerCount(signal)),
    before,
  );
}

await import('./heavy-lease-acquisition.test.mjs');
console.log('heavy-lease.test.mjs: all assertions passed');
