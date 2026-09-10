#!/usr/bin/env node
/**
 * Heavy-task lease — cross-worktree coordination for expensive validation.
 *
 * Multiple agents (or shells) can run heavy suites in the same checkout or
 * separate worktrees. Each heavy task acquires an exclusive lease keyed by
 * the repository's common git directory (so worktrees share one lock) before
 * it starts, waits a bounded time, and never kills unrelated processes.
 *
 * Usage:
 *   node scripts/quality/heavy-lease.mjs <lane-or-command> [-- cmd args...]
 *   VARVE_HEAVY_TASK_PARALLELISM=0  opt out entirely (run immediately)
 *
 * Lock file: $XDG_RUNTIME_DIR|/tmp/varve-leases/<common-gitdir-hash>.lock
 * Stale locks (older than 30 min or dead owner PID) are reclaimed.
 */

import { execSync, spawn } from 'node:child_process';
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const MAX_WAIT_MS = Number(process.env.VARVE_LEASE_TIMEOUT ?? 600000);
const STALE_MS = Number(process.env.VARVE_LEASE_STALE ?? 1800000);

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

function release(path) {
  try {
    unlinkSync(path);
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
    await acquire(args[0] ?? 'unknown');
    release(lockPath());
    return;
  }

  const label = args.slice(0, dashIdx).join(' ');
  const rest = args.slice(dashIdx + 1);
  await acquire(label);
  const child = spawn(rest[0], rest.slice(1), { stdio: 'inherit', shell: false });
  child.on('exit', (code) => {
    release(lockPath());
    process.exit(code ?? 1);
  });
  child.on('error', (err) => {
    console.error(`heavy-lease: failed to spawn ${rest[0]}: ${err.message}`);
    release(lockPath());
    process.exit(1);
  });
}

main();
