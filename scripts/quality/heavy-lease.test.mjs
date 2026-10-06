#!/usr/bin/env node

/** Regression coverage for the heavy-task lease's memory-availability gate
 * (added after repeated OOM kills / browser crashes when a raw `npx
 * playwright test` ran unwrapped under real memory pressure — see AGENTS.md
 * "Running E2E under memory pressure"). Black-box: invokes the actual CLI
 * with env overrides rather than importing internals, since the script is
 * meant to be run as a wrapper, not a library. */

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { observeValidationChild, runValidationCommand } from './heavy-lease.mjs';

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

async function waitForLease(runtimeDirectory, label, child = null, output = []) {
  const leaseDirectory = join(runtimeDirectory, 'varve-leases');
  // Keep the outer-process startup window separate from the wrapped command's
  // 5s memory-admission deadline. Fail immediately with child output if it
  // exits before publishing its lease, so a startup failure is diagnosable.
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      for (const name of readdirSync(leaseDirectory)) {
        const lease = JSON.parse(readFileSync(join(leaseDirectory, name), 'utf-8'));
        if (lease.label === label) return { path: join(leaseDirectory, name), lease };
      }
    } catch {
      // The first child may not have created its lease directory yet.
    }
    if (child && (child.exitCode !== null || child.signalCode !== null)) {
      throw new Error(
        `child exited before publishing ${label} lease (exit ${child.exitCode ?? 'none'}, signal ${child.signalCode ?? 'none'})\n${output.join('')}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out after 15s waiting for ${label} lease\n${output.join('')}`);
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
//
// The Windows preload must be handed to `node --import` as a `file://` URL.
// Node's ESM loader rejects a bare drive path (`C:\...`) with
// ERR_UNSUPPORTED_ESM_URL_SCHEME ("Received protocol 'c:'"), which makes the
// child die before it can publish its lease and reddens the Windows
// `pnpm test:ci:tools` preflight.
//
// A Windows drive path is absolute on every platform, so the URL conversion is
// keyed off the *path*, not off `process.platform`. Keying it off the platform
// was the original defect: on Windows the path was already drive-absolute, so
// `--import C:\...` was passed through verbatim and the loader rejected it.
// The platform argument and URL converter are injectable so this branch is
// regression-covered on a POSIX host too.
export function preloadArgsForPlatform(preloadPath, platform, toFileUrl = pathToFileURL) {
  return platform === 'win32' || isWindowsAbsolutePath(preloadPath)
    ? preloadImportArgs(preloadPath, toFileUrl)
    : [];
}

/** A Windows absolute path (`C:\`, `C:/`, or a UNC `\\server\share`). */
export function isWindowsAbsolutePath(filePath) {
  return typeof filePath === 'string' && /^(?:[a-zA-Z]:[\\/]|\\\\)/.test(filePath);
}

/**
 * Build the argv prefix that loads a scratch preload module.
 *
 * `node --import` accepts only `file:`, `data:` and `node:` specifiers, so a
 * bare Windows drive path is rejected with `ERR_UNSUPPORTED_ESM_URL_SCHEME`
 * ("Received protocol 'c:'"). That rejected the spawned child before it could
 * publish its lease, which is what failed the Windows `pnpm test:ci:tools`
 * preflight.
 *
 * Convert whenever the resulting specifier would not already be a valid URL
 * scheme. Deciding from the *path* rather than from the OS is deliberate: on
 * Windows the production path is drive-absolute, so an OS-keyed branch skips the
 * conversion that is actually required. Every `--import` in this file goes
 * through this helper so a new fixture cannot reintroduce a bare path.
 */
export function preloadImportArgs(preloadPath, toFileUrl = pathToFileURL) {
  const specifier = String(preloadPath);
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(specifier) && !isWindowsAbsolutePath(specifier))
    return ['--import', specifier];
  return ['--import', toFileUrl(specifier).href];
}

function cancellationPreload(directory, marker) {
  const path = join(directory, 'cancel-event.mjs');
  writeFileSync(
    path,
    `import fs from 'node:fs';const timer=setInterval(()=>{if(fs.existsSync(${JSON.stringify(marker)})){clearInterval(timer);process.emit('SIGTERM')}},5);timer.unref();`,
  );
  return preloadArgsForPlatform(path, process.platform);
}

// Regression guard. The invariant that matters is the *specifier*, not which
// branch produced it: nothing may hand `node --import` a bare drive path,
// because Node's ESM loader rejects it with ERR_UNSUPPORTED_ESM_URL_SCHEME.
//
// The original guard only asserted "pathToFileURL was called on the win32
// branch". On Windows the path was already drive-absolute, so the guard passed
// while the child still died — the passing test was the reason the bug survived
// review (CI run 37198361776, Windows and macOS both red).
{
  const windowsPath = 'C:\\Users\\runneradmin\\AppData\\Local\\Temp\\cancel-event.mjs';
  const expectedHref = pathToFileURL('/tmp/cancel-event.mjs').href.replace(
    '/tmp/cancel-event.mjs',
    windowsPath.replaceAll('\\', '/').replace(/^([a-zA-Z]):/, '$1:'),
  );

  // Every combination that can occur in production: the real Windows branch,
  // and a drive-absolute path observed while `process.platform` is POSIX (the
  // shape that actually broke). Both must yield a `file://` specifier.
  for (const [platform, observedPath] of [
    ['win32', windowsPath],
    ['linux', windowsPath],
    ['darwin', 'C:/Users/runneradmin/AppData/Local/Temp/cancel-event.mjs'],
    ['win32', '\\\\server\\share\\cancel-event.mjs'],
  ]) {
    const args = preloadArgsForPlatform(observedPath, platform);
    assert.deepEqual(args.slice(0, 1), ['--import'], `${platform} ${observedPath} needs a preload`);
    assert.match(
      args[1],
      /^file:\/\//,
      `${platform} ${observedPath} must reach node as a file:// URL, got ${args[1]}`,
    );
    assert.ok(
      !isWindowsAbsolutePath(args[1]),
      `a bare drive/UNC path (${args[1]}) must never reach --import`,
    );
  }

  // The concrete POSIX shape: the injected converter is exercised, and the
  // result is exactly the converted href.
  assert.deepEqual(
    preloadArgsForPlatform(windowsPath, 'win32', () => ({ href: expectedHref })),
    ['--import', expectedHref],
  );

  // POSIX-native paths cancel with a real SIGTERM and need no preload.
  assert.deepEqual(preloadArgsForPlatform('/tmp/cancel-event.mjs', 'linux'), []);
  assert.equal(isWindowsAbsolutePath('/tmp/cancel-event.mjs'), false);
  assert.equal(isWindowsAbsolutePath(windowsPath), true);
  assert.equal(isWindowsAbsolutePath('C:/Users/runneradmin/x.mjs'), true);
  assert.equal(isWindowsAbsolutePath('\\\\server\\share\\x.mjs'), true);

  // preloadImportArgs is the primitive every `--import` site must use: a bare
  // drive/UNC path and a POSIX path both become file: URLs, while an existing
  // URL specifier passes through untouched.
  for (const [input, expected] of [
    [windowsPath, /^file:\/\//],
    ['C:/Users/runneradmin/x.mjs', /^file:\/\//],
    ['\\\\server\\share\\x.mjs', /^file:\/\//],
    ['/tmp/x.mjs', /^file:\/\//],
    ['data:text/javascript,1', /^data:/],
    ['node:fs', /^node:/],
  ]) {
    const [flag, specifier] = preloadImportArgs(input);
    assert.equal(flag, '--import');
    assert.match(specifier, expected, `${input} must become ${expected}`);
    assert.ok(
      !isWindowsAbsolutePath(specifier),
      `a bare drive/UNC path (${specifier}) must never reach --import`,
    );
  }

  // Static guard: no fixture may hand `--import` a path directly. Four separate
  // fixtures built argv literals this way, so a per-branch unit test kept
  // missing sites and the Windows legs failed three runs in a row.
  //
  // Match argv call sites only: `'--import'` immediately followed by a path
  // expression. The helper bodies and this guard's own assertions legitimately
  // name the flag, and anchoring on the following token keeps this precise
  // instead of accumulating allow-list exceptions.
  const source = readFileSync(fileURLToPath(import.meta.url), 'utf8');
  const directImport = [
    ...source.matchAll(/'--import'\s*,\s*(?![a-zA-Z_$][\w$]*\s*[);])([^,\n]+)/g),
  ]
    .map((m) => m[1].trim())
    .filter((next) => /^(?:pathToFileURL|join|resolve|new URL|`)/.test(next));
  assert.deepEqual(
    directImport,
    [],
    `every --import must go through preloadImportArgs; found: ${directImport.join(' | ')}`,
  );
  console.log('windows preload url regression passed');
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
    const output = [];
    for (const stream of [owner.stdout, owner.stderr]) {
      stream.setEncoding('utf8').on('data', (chunk) => {
        output.push(chunk);
      });
    }
    const record = await waitForLease(runtimeDirectory, 'memory-cancel', owner, output);
    const deadline = Date.now() + 2000;
    while (!output.join('').includes('below the') && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 5));
    assert.match(output.join(''), /below the/);
    if (process.platform === 'win32') writeFileSync(cancelEvent, 'cancel');
    else owner.kill('SIGTERM');
    const result = await exit;
    assert.equal(result.code, 143);
    assert.match(
      output.join(''),
      /cancelled by SIGTERM while waiting for memory; command not launched/,
    );
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
  {
    platform: 'darwin',
    pressure: 'System-wide memory free percentage: 75%\n',
    freeMB: 8,
    admitted: true,
  },
  {
    platform: 'darwin',
    pressure: 'System-wide memory free percentage: 10%\n',
    freeMB: 96,
    admitted: false,
  },
  {
    platform: 'darwin',
    pressure: 'System-wide memory free percentage: 101%\n',
    freeMB: 8,
    admitted: false,
  },
  { platform: 'darwin', pressure: 'unrecognized output\n', freeMB: 96, admitted: true },
]) {
  const directory = mkdtempSync(join(tmpdir(), 'varve-memory-source-'));
  const marker = join(directory, 'launched');
  const preload = join(directory, 'memory-source.mjs');
  try {
    writeFileSync(
      preload,
      `import fs from 'node:fs';import os from 'node:os';import cp from 'node:child_process';import assert from 'node:assert/strict';import {syncBuiltinESMExports} from 'node:module';const actual=fs.readFileSync;const actualExec=cp.execFileSync;os.totalmem=()=>128*1024*1024;cp.execFileSync=function(file,args,...rest){if(file==='/usr/bin/memory_pressure'){assert.deepEqual(args,['-Q']);if(${JSON.stringify(sample.pressure)}===undefined)throw Error('native query unavailable');return ${JSON.stringify(sample.pressure)}}return actualExec.call(this,file,args,...rest)};os.platform=()=>${JSON.stringify(sample.platform)};os.freemem=()=>${sample.freeMB}*1024*1024;fs.readFileSync=function(path,...args){if(String(path)==='/proc/meminfo'){if(${JSON.stringify(sample.platform)}!=='linux')throw Error('non-Linux must not sample proc');return ${JSON.stringify(sample.meminfo)}}return actual.call(this,path,...args)};syncBuiltinESMExports();`,
    );
    const result = spawnSync(
      process.execPath,
      [
        ...preloadImportArgs(preload),
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

/**
 * Wait for a fixture file to hold complete, parseable JSON.
 *
 * These fixtures are written by spawned processes, so existence becomes
 * observable at creation while the bytes land afterwards. Waiting only for
 * existence let a following `JSON.parse(readFileSync(...))` throw
 * `SyntaxError: Unexpected end of JSON input` under load — an intermittent
 * failure of `test:ci:tools` that surfaced on macOS in CI run 37198361776.
 */
async function waitForFixtureJson(path, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  for (;;) {
    try {
      const raw = readFileSync(path, 'utf8');
      if (raw.length > 0) return JSON.parse(raw);
      last = 'empty file';
    } catch (err) {
      last = err.message;
    }
    if (Date.now() >= deadline) {
      assert.ok(false, `fixture ${path} never held complete JSON (last: ${last})`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
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
    // The fixture writes `ready` from the spawned grandchild, so existence is
    // observable before the bytes land. Waiting only for existence let a read
    // observe a partial file; wait for parseable JSON instead.
    pids = await waitForFixtureJson(ready, 3000);
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

// A capture launcher can exit before its detached server worker. Observe the
// tree from launch, wait for cooperative termination or force the owned leaf,
// and preserve an unrelated live process. The old fire-and-exit cleanup only
// signalled the launcher group and left this worker behind.
if (process.platform !== 'win32') {
  for (const cooperate of [true, false]) {
    const directory = mkdtempSync(join(tmpdir(), 'varve-capture-drain-'));
    const ready = join(directory, 'worker.json');
    let child;
    let sentinel;
    let worker;
    let stop;
    try {
      const workerCode = `const fs=require('node:fs');process.on('SIGTERM',()=>{if(${cooperate})setTimeout(()=>process.exit(0),80)});fs.writeFileSync(process.argv[1],JSON.stringify({pid:process.pid}));setInterval(()=>{},1000);`;
      const launcherCode = `const {spawn}=require('node:child_process');spawn(process.execPath,['-e',${JSON.stringify(workerCode)},process.argv[1]],{detached:true,stdio:'ignore'});process.on('SIGTERM',()=>process.exit(0));setInterval(()=>{},1000);`;
      sentinel = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
      child = spawn(process.execPath, ['-e', launcherCode, ready], {
        detached: true,
        stdio: 'ignore',
      });
      stop = observeValidationChild(child, { graceMs: 200 });
      await waitForFile(ready);
      worker = JSON.parse(readFileSync(ready, 'utf8')).pid;
      await new Promise((resolve) => setTimeout(resolve, 300));
      const exit = waitForExit(child);
      process.kill(-child.pid, 'SIGTERM');
      await exit;
      assert.equal(
        activeProcess(worker),
        true,
        'negative control: signalling only the launcher leaves its detached worker alive',
      );
      const firstStop = stop();
      assert.equal(stop(), firstStop, 'repeated cleanup shares one bounded operation');
      const result = await firstStop;
      assert.deepEqual(result, { remaining: [], cleanupUnknown: false });
      assert.equal(
        activeProcess(worker),
        false,
        'server worker must stop before capture owner exits',
      );
      assert.equal(activeProcess(sentinel.pid), true, 'unrelated process is never cleaned up');
    } finally {
      await stop?.().catch(() => {});
      for (const pid of [child?.pid, worker, sentinel?.pid].filter(Boolean)) {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {}
      }
      rmSync(directory, { recursive: true, force: true });
    }
  }
}
// Windows taskkill cannot prove descendant cleanup when the launched root
// already exited. This injectable branch is separate from native Windows CI.
{
  const child = Object.assign(new EventEmitter(), { pid: 12345, exitCode: 0, signalCode: null });
  let calls = 0;
  const stop = observeValidationChild(child, {
    platform: 'win32',
    graceMs: 10,
    windowsKill: async () => {
      calls += 1;
      return true;
    },
  });
  await assert.rejects(stop(), /cleanup incomplete.*unknown=true/);
  assert.equal(calls, 0, 'a nonexistent root cannot truthfully certify its descendants');
}
console.log('capture server descendant drain regressions passed');

// An unsupported output callback used to be silently passed to spawn, losing
// durable progress logs. Refuse it before launching any command.
{
  const directory = mkdtempSync(join(tmpdir(), 'varve-output-contract-'));
  const marker = join(directory, 'must-not-launch');
  try {
    for (const key of ['onStdout', 'onStderr']) {
      await assert.rejects(
        runValidationCommand(
          [
            process.execPath,
            '-e',
            `require('node:fs').writeFileSync(${JSON.stringify(marker)},'launched')`,
          ],
          {
            [key]: () => {},
          },
        ),
        /does not support output callbacks; use stdio/,
      );
      assert.equal(existsSync(marker), false, 'unsupported capture must fail before launch');
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
console.log('output capture contract regressions passed');

await import('./heavy-lease-ownership.test.mjs');
