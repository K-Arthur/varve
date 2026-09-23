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
 * Stale locks (older than 30 min or dead owner PID) are reclaimed.
 */

import { execSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { freemem, homedir, platform, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const MAX_WAIT_MS = Number(process.env.VARVE_LEASE_TIMEOUT ?? 600000);
const STALE_MS = Number(process.env.VARVE_LEASE_STALE ?? 1800000);
// Below this, a freshly-launched Chromium (~300-500MB RSS to first paint)
// is a plausible OOM-kill candidate rather than a safe bet. Tune with
// VARVE_LEASE_MIN_MEM_MB; the number is deliberately conservative because
// the cost of waiting a few seconds longer is far lower than the cost of
// crashing a run (or, worse, having the kernel pick an unrelated victim
// process) partway through.
const MIN_MEM_MB = Number(process.env.VARVE_LEASE_MIN_MEM_MB ?? 1536);
const MEM_POLL_MS = Number(process.env.VARVE_LEASE_MEM_POLL_MS ?? 5000);

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
  while (Date.now() < deadline) {
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
    await new Promise((r) => setTimeout(r, MEM_POLL_MS));
  }
  console.error(
    `heavy-lease: memory still under ${MIN_MEM_MB}MB after ${MAX_WAIT_MS / 1000}s — proceeding anyway (deadline reached). Consider closing other applications, or set VARVE_LEASE_MIN_MEM_MB lower if this is a low-memory machine by design.`,
  );
}

function commonGitDir() {
  try {
    return execSync('git rev-parse --git-common-dir', { encoding: 'utf8' }).trim();
  } catch {
    return process.cwd();
  }
}

function lockPath() {
  const gitDir = commonGitDir();
  const hash = Buffer.from(gitDir).toString('hex').slice(0, 32);
  const base = process.env.XDG_RUNTIME_DIR || tmpdir();
  return join(base, 'varve-leases', `${hash}.lock`);
}

function readLease(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
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

async function acquire(label) {
  const path = lockPath();
  mkdirSync(dirname(path), { recursive: true });
  const deadline = Date.now() + MAX_WAIT_MS;
  while (Date.now() < deadline) {
    const lease = readLease(path);
    if (!lease) {
      const me = {
        pid: process.pid,
        leaseId: randomUUID(),
        label,
        startedAt: Date.now(),
        hostname: homedir(),
        tool: 'varve-verify',
      };
      try {
        writeFileSync(path, JSON.stringify(me, null, 2));
        return me;
      } catch {
        /* lost the race; loop */
      }
    } else {
      if (!pidAlive(lease.pid) || Date.now() - lease.startedAt > STALE_MS) {
        console.warn(`heavy-lease: reclaiming stale lease (${JSON.stringify(lease)})`);
        try {
          unlinkSync(path);
        } catch {
          /* another agent reclaimed; loop */
        }
        continue;
      }
      console.log(
        `heavy-lease: waiting for ${lease.label} (pid ${lease.pid}, started ${new Date(lease.startedAt).toISOString()})...`,
      );
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
  console.error(`heavy-lease: deadline reached after ${MAX_WAIT_MS / 1000}s`);
  process.exit(1);
}

function release(path, leaseId) {
  try {
    // A task that outlives STALE_MS may have had its lease reclaimed. It must
    // not remove the replacement task's lock when it eventually exits.
    if (leaseId && readLease(path)?.leaseId === leaseId) unlinkSync(path);
  } catch {
    /* already released */
  }
}

async function main() {
  const args = process.argv.slice(2);
  const dashIdx = args.indexOf('--');

  if (process.env.VARVE_HEAVY_TASK_PARALLELISM === '0') {
    if (dashIdx === -1) {
      console.log(
        `heavy-lease: parallelism opt-out, not acquiring lease for ${args[0] ?? 'unknown'}`,
      );
      return;
    }
    const rest = args.slice(dashIdx + 1);
    if (!rest.length) return;
    const child = spawn(rest[0], rest.slice(1), { stdio: 'inherit', shell: false });
    child.on('exit', (code) => process.exit(code ?? 1));
    child.on('error', (err) => {
      console.error(`heavy-lease: failed to spawn ${rest[0]}: ${err.message}`);
      process.exit(1);
    });
    return;
  }

  if (dashIdx === -1) {
    // pure label: acquire + release immediately (lease smoke test)
    const lease = await acquire(args[0] ?? 'unknown');
    release(lockPath(), lease.leaseId);
    return;
  }

  const label = args.slice(0, dashIdx).join(' ');
  const rest = args.slice(dashIdx + 1);
  const lease = await acquire(label);
  // Re-check right before spawning: the lease wait above may have taken a
  // while, and memory pressure is independent of who holds the lease.
  await waitForMemoryHeadroom(label);
  const child = spawn(rest[0], rest.slice(1), { stdio: 'inherit', shell: false });
  child.on('exit', (code) => {
    release(lockPath(), lease.leaseId);
    process.exit(code ?? 1);
  });
  child.on('error', (err) => {
    console.error(`heavy-lease: failed to spawn ${rest[0]}: ${err.message}`);
    release(lockPath(), lease.leaseId);
    process.exit(1);
  });
}

main();
