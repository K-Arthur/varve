#!/usr/bin/env node

/**
 * Heavy-task lease — cross-worktree coordination for expensive validation.
 *
 * Multiple agents (or shells) can run heavy suites in the same checkout or
 * separate worktrees. Each heavy task acquires an exclusive lease keyed by
 * the repository's common git directory (so worktrees share one lock) before
 * it starts, waits a bounded time, and never kills unrelated processes.
 *
 * It also gates on actual system memory headroom, not just the lease: the
 * lease alone only serializes tasks that go through this script, but a
 * memory-hungry process outside that set — another agent's raw `npx
 * playwright test`, the operator's own browser — can still starve a heavy
 * task that "won" the lease. Observed repeatedly in practice: Playwright's
 * Chromium got OOM-killed by the kernel (confirmed via `journalctl`) and,
 * separately, crashed on its first page load ("Page crashed" in
 * global-setup.ts) while available memory sat under ~250MB — in both cases
 * with the lease free, because the pressure came from processes that never
 * touch this lease. Checking `MemAvailable` directly is the only way to
 * catch that case.
 *
 * Usage:
 *   node scripts/quality/heavy-lease.mjs <lane-or-command> [-- cmd args...]
 *   VARVE_HEAVY_TASK_PARALLELISM=0  opt out of both the lease and the
 *     memory gate entirely (run immediately) — an explicit, deliberate
 *     override, not the default escape hatch for a slow wait.
 *
 * Lock file: $XDG_RUNTIME_DIR|/tmp/varve-leases/<common-gitdir-hash>.lock
 * A lease is reclaimed only after its owner PID exits. Large builds can run
 * for hours, so wall-clock age alone never makes an active owner stale.
 */

import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { constants, freemem, homedir, platform, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import crossSpawn from 'cross-spawn';

const MAX_WAIT_MS = Number(process.env.VARVE_LEASE_TIMEOUT ?? 600000);
// Below this, a freshly-launched Chromium (~300-500MB RSS to first paint)
// is a plausible OOM-kill candidate rather than a safe bet. Tune with
// VARVE_LEASE_MIN_MEM_MB; the number is deliberately conservative because
// the cost of waiting a few seconds longer is far lower than the cost of
// crashing a run (or, worse, having the kernel pick an unrelated victim
// process) partway through.
const MIN_MEM_MB = Number(process.env.VARVE_LEASE_MIN_MEM_MB ?? 1536);
const MEM_POLL_MS = Number(process.env.VARVE_LEASE_MEM_POLL_MS ?? 5000);
const LEASE_POLL_MS = Number(process.env.VARVE_LEASE_POLL_MS ?? 1000);

/** MemAvailable in MB — the same figure `free -h`'s "available" column
 * reports (free + reclaimable cache/buffers), not raw freemem(), which
 * undercounts by treating reclaimable page cache as unavailable. Falls
 * back to freemem() off Linux or if /proc/meminfo is unreadable. */
function memAvailableMB() {
  if (platform() === 'linux') {
    try {
      const meminfo = readFileSync('/proc/meminfo', 'utf-8');
      const match = meminfo.match(/^MemAvailable:\s+(\d+)\s*kB/m);
      if (match) return Math.round(Number(match[1]) / 1024);
    } catch {
      /* fall through to freemem() */
    }
  }
  return Math.round(freemem() / (1024 * 1024));
}

async function waitForMemoryHeadroom(label) {
  const deadline = Date.now() + MAX_WAIT_MS;
  let warned = false;
  let cancelled = null;
  const listeners = ['SIGINT', 'SIGTERM', 'SIGHUP'].map((signal) => {
    const listener = () => {
      cancelled ??= signal;
    };
    process.on(signal, listener);
    return [signal, listener];
  });
  try {
    while (Date.now() < deadline && !cancelled) {
      const availableMB = memAvailableMB();
      if (availableMB >= MIN_MEM_MB) {
        if (warned) console.log(`heavy-lease: memory recovered (${availableMB}MB available)`);
        return;
      }
      if (!warned) {
        console.warn(
          `heavy-lease: ${availableMB}MB available, below the ${MIN_MEM_MB}MB floor for ${label} — waiting rather than risk an OOM kill or a browser crash mid-run.`,
        );
        warned = true;
      }
      const wake = Math.min(deadline, Date.now() + MEM_POLL_MS);
      while (!cancelled && Date.now() < wake) await pause(Math.min(25, wake - Date.now()));
    }
    const message = cancelled
      ? `heavy-lease: cancelled by ${cancelled} while waiting for memory; command not launched`
      : `heavy-lease: memory still under ${MIN_MEM_MB}MB after ${MAX_WAIT_MS / 1000}s; command not launched (deadline reached)`;
    throw Object.assign(new Error(message), { exitCode: cancelled ? signalStatus(cancelled) : 1 });
  } finally {
    for (const [signal, listener] of listeners) process.off(signal, listener);
  }
}

const OWNER_ENV = 'VARVE_HEAVY_LEASE_OWNER';

/** Canonical keys bind all worktrees; legacy aliases bridge older clients. */
export function leasePaths({
  cwd = process.cwd(),
  runtimeDirectory = process.env.XDG_RUNTIME_DIR || tmpdir(),
} = {}) {
  let printed;
  try {
    printed = execFileSync('git', ['rev-parse', '--git-common-dir'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    printed = cwd;
  }
  const commonDir = realpathSync(resolve(cwd, printed));
  const base = join(resolve(runtimeDirectory), 'varve-leases');
  const primary = join(base, `${createHash('sha256').update(commonDir).digest('hex')}.lock`);
  const legacy = [...new Set([printed, commonDir, '.git'])].map((value) =>
    join(base, `${Buffer.from(value).toString('hex').slice(0, 32)}.lock`),
  );
  return { commonDir, primary, paths: [...new Set([primary, ...legacy])].sort() };
}

function readLease(path) {
  try {
    const record = JSON.parse(readFileSync(path, 'utf-8'));
    return record &&
      typeof record === 'object' &&
      Number.isSafeInteger(record.pid) &&
      record.pid > 0
      ? record
      : null;
  } catch {
    return null;
  }
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function hasLiveLeaseOwner(lease) {
  if (lease.cleanupUnknown)
    throw new Error(
      'heavy-lease: previous command tree cleanup is unverified; refusing to reclaim its lease',
    );
  return (
    pidAlive(lease.pid) ||
    (lease.cleanupRemaining ?? []).some((item) => {
      if (item.identity === null) return pidAlive(item.pid);
      const current = processInfo(item.pid);
      return current && !current.zombie && current.identity === item.identity;
    })
  );
}

function acquireTransaction(keys, label) {
  const ownedMutexes = [];
  const created = [];
  try {
    // Reserve all keys under the same ordered, short transaction. Publishing
    // aliases without their old mutex permits an old client to race admission.
    for (const path of keys.paths) {
      const mutex = `${path}.acquire`;
      try {
        writeFileSync(mutex, JSON.stringify({ pid: process.pid }), { flag: 'wx' });
        ownedMutexes.push(mutex);
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const owner = readLease(mutex);
        if (!owner)
          return { waiting: { pid: 'unknown', label: 'incomplete acquisition metadata' } };
        if (!pidAlive(owner.pid))
          throw new Error(
            `heavy-lease: acquisition mutex has an unknown or stopped owner; refusing to overwrite ${mutex}`,
          );
        return { waiting: owner };
      }
    }
    for (const path of keys.paths) {
      const lease = readLease(path);
      if ((!lease || typeof lease.leaseId !== 'string' || !lease.leaseId) && existsSync(path))
        throw new Error(
          `heavy-lease: invalid lease metadata; refusing to delete an unknown owner at ${path}`,
        );
      if (lease && hasLiveLeaseOwner(lease)) return { waiting: lease };
    }
    for (const path of keys.paths) {
      if (!existsSync(path)) continue;
      console.warn(`heavy-lease: reclaiming stale lease (${JSON.stringify(readLease(path))})`);
      unlinkSync(path);
    }
    const me = {
      pid: process.pid,
      identity: processInfo(process.pid)?.identity ?? null,
      leaseId: randomUUID(),
      commonDir: keys.commonDir,
      primary: keys.primary,
      label,
      startedAt: Date.now(),
      hostname: homedir(),
      tool: 'varve-verify',
    };
    for (const path of keys.paths) {
      writeFileSync(path, JSON.stringify(me, null, 2), { flag: 'wx' });
      created.push({ path, leaseId: me.leaseId });
    }
    return { acquired: me };
  } catch (error) {
    for (const item of created) release(item.path, item.leaseId);
    throw error;
  } finally {
    // No contender reclaims acquisition mutexes. Its creating process alone
    // unlinks it; a crash fails closed rather than racing another owner.
    for (const mutex of ownedMutexes) unlinkSync(mutex);
  }
}

async function acquire(label, keys) {
  mkdirSync(dirname(keys.primary), { recursive: true });
  const deadline = Date.now() + MAX_WAIT_MS;
  while (Date.now() < deadline) {
    const result = acquireTransaction(keys, label);
    if (result.acquired) return result.acquired;
    const lease = result.waiting;
    console.log(
      `heavy-lease: waiting for ${lease.label ?? 'acquisition transaction'} (pid ${lease.pid}, started ${lease.startedAt ? new Date(lease.startedAt).toISOString() : 'just now'})...`,
    );
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(LEASE_POLL_MS, Math.max(1, deadline - Date.now()))),
    );
  }
  console.error(`heavy-lease: deadline reached after ${MAX_WAIT_MS / 1000}s`);
  process.exit(1);
}

function release(path, leaseId) {
  try {
    // If an owner PID died and another task acquired the lock before this
    // process handled its exit, never remove that replacement lease.
    if (leaseId && readLease(path)?.leaseId === leaseId) unlinkSync(path);
  } catch {
    /* already released */
  }
}

// Linux identities use kernel start ticks, so a recycled PID cannot become
// an owned descendant. Other POSIX hosts use ps start time; Windows delegates
// its live command tree to taskkill /T and does not claim POSIX group support.
function processInfo(pid) {
  try {
    if (process.platform === 'linux') {
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
      const fields = stat
        .slice(stat.lastIndexOf(')') + 2)
        .trim()
        .split(/\s+/);
      return { pid, identity: fields[19], parent: Number(fields[1]), zombie: fields[0] === 'Z' };
    }
    const text = spawnSync('ps', ['-p', String(pid), '-o', 'ppid=,lstart=,stat='], {
      encoding: 'utf8',
      timeout: 1000,
    }).stdout?.trim();
    const match = text?.match(/^(\d+)\s+(.+?)\s+(\S+)$/);
    return match
      ? { pid, parent: Number(match[1]), identity: match[2], zombie: match[3].startsWith('Z') }
      : null;
  } catch {
    return null;
  }
}

/** An unreadable identity is not evidence that a supervisor died. */
function supervisorParentLost(parent) {
  if (!parent?.identity) return false;
  if (process.ppid !== parent.pid) return true;
  const current = processInfo(parent.pid);
  return current ? current.zombie || current.identity !== parent.identity : false;
}

/** Capture the launcher before spawning a supervisor, closing its startup race. */
export function validationSupervisorIdentity() {
  return process.platform === 'linux' || process.platform === 'darwin'
    ? processInfo(process.pid)
    : null;
}

function ownerIsAncestor(pid) {
  if (process.platform === 'win32') {
    // One bounded CIM query checks the real chain; an unreadable chain cannot
    // authorize inheritance. PowerShell is part of supported Windows hosts.
    const result = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `$id=${process.ppid};$seen=@{};$chain=@();while($id -gt 0 -and -not $seen.ContainsKey($id)){$seen[$id]=$true;$chain+=$id;$p=Get-CimInstance Win32_Process -Filter ("ProcessId="+$id);if($null -eq $p){break};$id=[int]$p.ParentProcessId};ConvertTo-Json -Compress -InputObject $chain`,
      ],
      { encoding: 'utf8', timeout: 3000, windowsHide: true },
    );
    try {
      return result.status === 0 && JSON.parse(result.stdout).includes(pid);
    } catch {
      return false;
    }
  }
  const seen = new Set();
  let parent = process.ppid;
  while (parent > 0 && !seen.has(parent)) {
    if (parent === pid) return true;
    seen.add(parent);
    const info = processInfo(parent);
    if (!info || info.zombie) return false;
    parent = info.parent;
  }
  return false;
}

function inheritedOwner(keys) {
  if (!process.env[OWNER_ENV]) return null;
  try {
    const token = JSON.parse(process.env[OWNER_ENV]);
    if (token.primary !== keys.primary || token.commonDir !== keys.commonDir) return null;
    const lease = readLease(keys.primary);
    if (
      !lease ||
      lease.cleanupUnknown ||
      token.leaseId !== lease.leaseId ||
      token.pid !== lease.pid ||
      token.identity !== lease.identity ||
      !pidAlive(lease.pid) ||
      !ownerIsAncestor(lease.pid)
    )
      return null;
    const current = processInfo(lease.pid);
    if (
      lease.identity !== null &&
      (!current || current.zombie || current.identity !== lease.identity)
    )
      return null;
    return token;
  } catch {
    return null;
  }
}

function childPids(pid) {
  if (process.platform === 'linux') {
    try {
      return readdirSync(`/proc/${pid}/task`).flatMap((tid) => {
        try {
          return readFileSync(`/proc/${pid}/task/${tid}/children`, 'utf8')
            .trim()
            .split(/\s+/)
            .filter(Boolean)
            .map(Number);
        } catch {
          return [];
        }
      });
    } catch {
      return [];
    }
  }
  const text =
    spawnSync('ps', ['-eo', 'pid=,ppid='], { encoding: 'utf8', timeout: 1000 }).stdout ?? '';
  return text
    .trim()
    .split('\n')
    .flatMap((line) => {
      const [child, parent] = line.trim().split(/\s+/).map(Number);
      return parent === pid ? [child] : [];
    });
}

function ownedProcesses(rootPid) {
  const known = new Map();
  const refresh = () => {
    const visited = new Set();
    const visit = (pid, depth) => {
      if (visited.has(pid)) return;
      visited.add(pid);
      const current = processInfo(pid);
      if (
        !current ||
        current.zombie ||
        (known.has(pid) && known.get(pid).identity !== current.identity)
      )
        return;
      known.set(pid, { ...current, depth });
      for (const child of childPids(pid)) visit(child, depth + 1);
    };
    visit(rootPid, 0);
    // Remember detached descendants after an intermediate parent exits.
    for (const old of [...known.values()]) visit(old.pid, old.depth);
    return [...known.values()].filter((old) => {
      const current = processInfo(old.pid);
      return current && !current.zombie && current.identity === old.identity;
    });
  };
  return refresh;
}

const signalStatus = (signal) =>
  signal && constants.signals[signal] ? 128 + constants.signals[signal] : 1;
const pause = (ms) => new Promise((done) => setTimeout(done, ms));

async function killWindowsTree(pid, graceMs) {
  return new Promise((resolve) => {
    const killer = spawn('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    const timer = setTimeout(() => {
      killer.kill();
      resolve(false);
    }, graceMs);
    killer.once('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
    killer.once('exit', (code) => {
      clearTimeout(timer);
      resolve(code === 0);
    });
  });
}

async function forceOwnedLeaves(refresh, deadline) {
  for (const item of refresh().sort((a, b) => b.depth - a.depth)) {
    if (refresh().some((other) => other.depth > item.depth)) continue;
    const current = processInfo(item.pid);
    if (!current || current.identity !== item.identity || current.zombie) continue;
    try {
      process.kill(item.pid, 'SIGKILL');
    } catch (error) {
      if (error.code !== 'ESRCH') console.error(`validation cleanup: ${error.message}`);
    }
    while (Date.now() < deadline && refresh().some((live) => live.pid === item.pid))
      await pause(10);
  }
}

async function stopCommandTree(child, refresh, ended, signal, { windows, graceMs, windowsKill }) {
  let cleanupUnknown = false;
  if (windows && child.pid && !ended()) {
    try {
      cleanupUnknown = !(await windowsKill(child.pid, graceMs));
    } catch {
      cleanupUnknown = true;
    }
    if (cleanupUnknown) {
      try {
        child.kill(signal);
      } catch {}
    }
  } else {
    for (const item of refresh().sort((a, b) => b.depth - a.depth)) {
      const current = processInfo(item.pid);
      if (!current || current.zombie || current.identity !== item.identity) continue;
      try {
        process.kill(item.pid, signal);
      } catch (error) {
        if (error.code !== 'ESRCH') console.error(`validation cleanup: ${error.message}`);
      }
    }
  }
  const graceDeadline = Date.now() + graceMs;
  while (Date.now() < graceDeadline && (!ended() || refresh().length)) await pause(10);
  const killDeadline = Date.now() + graceMs;
  if (!windows) await forceOwnedLeaves(refresh, killDeadline);
  while (!ended() && Date.now() < killDeadline) await pause(10);
  const remaining = refresh();
  if (windows && !ended() && child.pid)
    remaining.push({ pid: child.pid, identity: null, depth: 0 });
  return { remaining, cleanupUnknown };
}

/** Own a long-lived child from launch through bounded descendant cleanup.
 * Capture servers use this before readiness so detached grandchildren are
 * still known if their launcher exits first. This never acquires a lease. */
export function observeValidationChild(
  child,
  {
    graceMs = 1000,
    platform: targetPlatform = process.platform,
    windowsKill = killWindowsTree,
  } = {},
) {
  if (!Number.isSafeInteger(graceMs) || graceMs <= 0)
    throw new RangeError('validation graceMs must be a positive safe integer');
  const windows = targetPlatform === 'win32';
  const refresh = windows || !child.pid ? () => [] : ownedProcesses(child.pid);
  let ended = child.exitCode !== null || child.signalCode !== null;
  const onEnd = () => {
    ended = true;
  };
  child.once('exit', onEnd);
  child.once('error', onEnd);
  refresh();
  const timer = setInterval(refresh, 250);
  timer.unref();
  let stopping;
  return () =>
    (stopping ??= (async () => {
      try {
        const launcherExitedBeforeStop = windows && Boolean(child.pid) && ended;
        const result = await stopCommandTree(child, refresh, () => ended, 'SIGTERM', {
          windows,
          graceMs,
          windowsKill,
        });
        // taskkill cannot establish descendant cleanup after its root PID
        // has already disappeared. No PID on spawn error means no tree existed.
        if (launcherExitedBeforeStop) result.cleanupUnknown = true;
        if (result.remaining.length || result.cleanupUnknown)
          throw new Error(
            `Capture server cleanup incomplete: ${result.remaining.length} owned process(es), unknown=${result.cleanupUnknown}`,
          );
        return result;
      } finally {
        clearInterval(timer);
        child.off('exit', onEnd);
        child.off('error', onEnd);
      }
    })());
}

// The pinned adapter handles Windows .cmd shims and shebangs without
// shell:true. Its cmd escaping does not cover line breaks (upstream #179),
// so both execution modes reject them before crossing the shell boundary.
function assertSafeBatchArgv(argv, options) {
  const parsed = crossSpawn._parse(argv[0], argv.slice(1), options);
  if (parsed.options.windowsVerbatimArguments && argv.some((part) => /[\0\r\n]/.test(String(part))))
    throw new RangeError('Windows batch command arguments cannot contain line breaks or NUL');
}

/** Synchronous lightweight checkpoints share the same safe shim adapter.
 * This helper preserves caller deadlines and never acquires a lease. */
export function spawnValidationCommandSync(argv, options = {}) {
  try {
    const spawnOptions = { shell: false, ...options };
    assertSafeBatchArgv(argv, spawnOptions);
    return crossSpawn.sync(argv[0], argv.slice(1), spawnOptions);
  } catch (error) {
    return { status: null, signal: null, error, stdout: null, stderr: null };
  }
}

/** Run only this command's descendants; cancellation and optional deadlines
 * never scan by name or kill the invoking terminal's process group. Resolve
 * after bounded cleanup, with surviving identities reported so a lease cannot
 * be released early. */
export async function runValidationCommand(argv, options = {}) {
  if ('onStdout' in options || 'onStderr' in options)
    throw new TypeError(
      'runValidationCommand does not support output callbacks; use stdio streams or file descriptors',
    );
  const {
    graceMs = 1500,
    timeoutMs,
    platform: targetPlatform = process.platform,
    windowsKill = killWindowsTree,
    expectedParent,
    ...spawnOptions
  } = options;
  if (timeoutMs !== undefined && (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0))
    throw new RangeError('validation timeoutMs must be a positive safe integer');
  const deadline = timeoutMs === undefined ? null : Date.now() + timeoutMs;
  const windows = targetPlatform === 'win32';
  // A terminal or pnpm parent can disappear without signalling this detached
  // supervisor. Capture its identity before launching any owned command.
  const supervisorParent =
    expectedParent ??
    (!windows && (process.platform === 'linux' || process.platform === 'darwin')
      ? processInfo(process.ppid)
      : null);
  if (expectedParent && supervisorParentLost(expectedParent)) {
    console.error(
      'validation: original launcher exited before supervisor admission; command not launched',
    );
    return { status: 1, signal: null, remaining: [], cleanupUnknown: false };
  }
  let child;
  try {
    const childOptions = {
      stdio: 'inherit',
      shell: false,
      ...spawnOptions,
      detached: !windows,
    };
    assertSafeBatchArgv(argv, childOptions);
    child = crossSpawn(argv[0], argv.slice(1), childOptions);
  } catch (error) {
    console.error(`validation: failed to spawn ${argv[0]}: ${error.message}`);
    return { status: 1, signal: null, remaining: [], cleanupUnknown: false };
  }
  let ended = false;
  let code = null;
  let childSignal = null;
  let receivedSignal = null;
  let timedOut = false;
  let parentLost = false;
  let spawnError = null;
  const refresh = windows || !child.pid ? () => [] : ownedProcesses(child.pid);
  const listeners = ['SIGINT', 'SIGTERM', 'SIGHUP'].map((signal) => {
    const listener = () => {
      receivedSignal ??= signal;
    };
    process.on(signal, listener);
    return [signal, listener];
  });
  child.once('exit', (status, signal) => {
    ended = true;
    code = status;
    childSignal = signal;
  });
  child.once('error', (error) => {
    ended = true;
    spawnError = error;
  });
  try {
    refresh();
    let lastRefresh = Date.now();
    while (!ended && !receivedSignal && !timedOut && !parentLost) {
      await pause(25);
      timedOut = !ended && deadline !== null && Date.now() >= deadline;
      if (Date.now() - lastRefresh >= 250) {
        refresh();
        parentLost = supervisorParentLost(supervisorParent);
        lastRefresh = Date.now();
      }
    }
    let remaining = refresh();
    const orphaned = ended && remaining.length > 0;
    let cleanupUnknown = false;
    if (receivedSignal || timedOut || parentLost || orphaned) {
      const result = await stopCommandTree(
        child,
        refresh,
        () => ended,
        receivedSignal ?? 'SIGTERM',
        { windows, graceMs, windowsKill },
      );
      remaining = result.remaining;
      cleanupUnknown = result.cleanupUnknown;
    }

    if (receivedSignal)
      console.error(
        `validation: cancelled by ${receivedSignal}; owned-process cleanup ${remaining.length || cleanupUnknown ? 'incomplete' : 'completed'}`,
      );
    if (parentLost && !receivedSignal)
      console.error(
        'validation: supervising parent ' +
          supervisorParent.pid +
          ' exited or changed; owned-process cleanup ' +
          (remaining.length || cleanupUnknown ? 'incomplete' : 'completed'),
      );
    if (timedOut && !receivedSignal)
      console.error(
        `validation: command timed out after ${timeoutMs / 1000}s; owned-process cleanup ${remaining.length || cleanupUnknown ? 'incomplete' : 'completed'}`,
      );
    if (orphaned && !receivedSignal && !timedOut && !parentLost)
      console.error(
        'validation: command exited with owned processes still running; owned-process cleanup ' +
          (remaining.length || cleanupUnknown ? 'incomplete' : 'completed'),
      );
    if (spawnError) console.error(`validation: failed to spawn ${argv[0]}: ${spawnError.message}`);
    if (cleanupUnknown)
      console.error('validation: Windows command tree cleanup is unverified; retaining the lease');
    if (remaining.length)
      console.error(`validation: cleanup incomplete; ${remaining.length} owned process(es) remain`);
    // If bounded cleanup cannot finish, report the live owner and let the
    // supervising CLI exit with its failure evidence rather than hang forever.
    // The lease retains these identities (or unknown Windows tree state).
    if (!ended && (remaining.length || cleanupUnknown)) child.unref();
    return {
      status: receivedSignal
        ? signalStatus(receivedSignal)
        : timedOut
          ? 124
          : spawnError || parentLost || orphaned || remaining.length || cleanupUnknown
            ? 1
            : (code ?? signalStatus(childSignal)),
      signal: receivedSignal ?? (timedOut || parentLost ? null : childSignal),
      remaining,
      cleanupUnknown,
    };
  } finally {
    for (const [signal, listener] of listeners) process.off(signal, listener);
  }
}

function retainOrRelease(path, leaseId, remaining, cleanupUnknown) {
  if (!remaining.length && !cleanupUnknown) return release(path, leaseId);
  const lease = readLease(path);
  if (lease?.leaseId === leaseId)
    writeFileSync(
      path,
      JSON.stringify({ ...lease, cleanupRemaining: remaining, cleanupUnknown }, null, 2),
    );
}

async function main() {
  const args = process.argv.slice(2);
  const dashIdx = args.indexOf('--');
  const optOut = process.env.VARVE_HEAVY_TASK_PARALLELISM === '0';
  const keys = optOut ? null : leasePaths();
  const inherited = keys ? inheritedOwner(keys) : null;
  if (dashIdx === -1) {
    if (optOut) {
      console.log(
        `heavy-lease: parallelism opt-out, not acquiring lease for ${args[0] ?? 'unknown'}`,
      );
      return;
    }
    if (inherited) return;
    const lease = await acquire(args[0] ?? 'unknown', keys);
    for (const path of keys.paths) release(path, lease.leaseId);
    return;
  }
  const label = args.slice(0, dashIdx).join(' ');
  const rest = args.slice(dashIdx + 1);
  if (!rest.length) {
    console.error('heavy-lease: missing command after --');
    process.exitCode = 2;
    return;
  }
  const lease = optOut || inherited ? null : await acquire(label, keys);
  if (lease) {
    try {
      await waitForMemoryHeadroom(label);
    } catch (error) {
      for (const path of keys.paths) release(path, lease.leaseId);
      console.error(error.message);
      process.exitCode = error.exitCode ?? 1;
      return;
    }
  }
  const token = lease ?? inherited;
  const env = { ...process.env };
  if (token) env[OWNER_ENV] = JSON.stringify(token);
  else delete env[OWNER_ENV];
  const result = await runValidationCommand(rest, { env });
  if (lease)
    for (const path of keys.paths)
      retainOrRelease(path, lease.leaseId, result.remaining, result.cleanupUnknown);
  process.exitCode = result.status;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
