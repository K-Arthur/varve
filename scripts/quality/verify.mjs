#!/usr/bin/env node
/**
 * Varve validation executor.
 *
 * Runs the smallest sufficient affected validation for the current
 * changes (Tier 0 → 4 in order, fail fast), or the explicit full gate.
 *
 * Usage:
 *   pnpm verify:quick        Tier 0 (format/lint on touched) + Tier 1 (direct tests)
 *   pnpm verify:affected     Tiers 0–4, risk-aware
 *   pnpm verify:full         full repository gate (Tier 5)
 *   pnpm verify:plan         print the plan without running anything
 *
 * Environment:
 *   VARVE_TEST_WORKERS       vitest --maxWorkers override
 *   VARVE_E2E_WORKERS        playwright --workers override
 *   VARVE_HEAVY_TASK_PARALLELISM=0   opt out of heavy-task lease
 *   VARVE_FULL_GATE=1        permit full-suite execution without a reason
 *
 * Exit codes: 0 all passed, 1 failures, 2 full gate skipped (no reason).
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { IMPACT_CONFIG } from '../../validation-impact.config.mjs';
import {
  buildPlan,
  defaultScope,
  formatPlan,
  gitChangedFiles,
  loadPackages,
  parseArgs,
} from './affected-plan.mjs';
import { LANES, laneCommand, packageDirs } from './validation-lanes.mjs';

const _PLAN_URL = fileURLToPath(new URL('./affected-plan.mjs', import.meta.url));
const ROOT = process.cwd();

// Populate the shared package-dir map so laneCommand() can resolve
// js-unit:<pkg>/typecheck:<pkg> lanes to concrete commands.
for (const [name, p] of Object.entries(loadPackages())) {
  packageDirs[name] = p.dir;
}

function cmd(argv) {
  // Resolve pnpm-managed binaries and pnpm itself (user-local install).
  const PATH = [
    `${ROOT}/node_modules/.bin`,
    process.env.PNPM_HOME ? `${process.env.PNPM_HOME}/bin` : null,
    `${process.env.HOME}/.local/share/pnpm/bin`,
    process.env.PATH ?? '',
  ]
    .filter(Boolean)
    .join(':');
  const res = spawnSync(argv[0], argv.slice(1), {
    cwd: ROOT,
    stdio: 'inherit',
    shell: false,
    env: { ...process.env, PATH },
  });
  if (res.error) {
    console.error(`verify: failed to spawn ${argv[0]}: ${res.error.message}`);
    return 1;
  }
  return res.status ?? 1;
}

function shCmd(str) {
  return cmd(['sh', '-c', str]);
}

function runVitestFiles(files) {
  const args = ['pnpm', 'exec', 'vitest', 'run', ...files];
  const workers = process.env.VARVE_TEST_WORKERS;
  if (workers) args.push('--maxWorkers', workers);
  return cmd(args);
}

function runE2eDomains(domains) {
  // Domain -> path resolution: consult the impact config first (some domains
  // map to specific spec files, e.g. keyboard specs live under tests/e2e/canvas/),
  // fall back to the conventional directory.
  const args = ['pnpm', 'exec', 'playwright', 'test'];
  for (const d of domains) {
    if (d === 'visual') continue; // handled by project selection
    const paths = IMPACT_CONFIG.e2eDomains[d];
    if (paths?.length) args.push(...paths);
    else args.push(`tests/e2e/${d}`);
  }
  const workers = process.env.VARVE_E2E_WORKERS;
  if (workers) args.push('--workers', workers);
  if (domains.includes('visual'))
    args.push('--project=chromium-visual-1x', '--project=chromium-visual-2x');
  if (domains.length === 1 && domains[0] === 'visual')
    args.push('--project=chromium-visual-1x', '--project=chromium-visual-2x');
  return cmd(args);
}

const HEAVY = new Set([
  'js-unit:all',
  'typecheck:all',
  'e2e:all',
  'e2e:visual',
  'desktop-native',
  'website-e2e',
  'bench:render',
  'bench:table',
  'bench:table-layout',
  'wasm',
  'full',
]);

const TIER_ORDER = [0, 1, 2, 3, 4];

function flatten(plan) {
  const lanes = [];
  for (const t of TIER_ORDER) for (const l of plan.tiers[t]) lanes.push(l);
  return lanes;
}

// Changed files that biome can process (existing, supported extensions).
// Used for format:touched / lint:touched so Tier 0 checks the real worktree
// (staged + unstaged + untracked), not only what happens to be staged.
const BIOME_EXTS = /\.(ts|tsx|js|jsx|mjs|cjs|json)$/;
let CHANGED_FILES = [];

function biomeTouchedArgs() {
  const files = CHANGED_FILES.filter(
    (f) => !f.startsWith('.worktrees/') && BIOME_EXTS.test(f) && existsSync(f),
  );
  return ['biome', 'check', ...files, '--no-errors-on-unmatched'];
}

function runLane(lane) {
  const t0 = Date.now();
  const isHeavy =
    HEAVY.has(lane) || lane.startsWith('rust-test:') || lane.startsWith('rust-clippy:');
  let status;
  if (lane === 'format:touched') {
    status = cmd([...biomeTouchedArgs(), '--formatter-enabled=true', '--linter-enabled=false']);
  } else if (lane === 'lint:touched') {
    status = cmd(biomeTouchedArgs());
  } else if (lane.startsWith('js-unit:file:')) {
    status = runVitestFiles([lane.slice('js-unit:file:'.length)]);
  } else if (lane.startsWith('e2e:') && lane !== 'e2e:all' && lane !== 'e2e:visual') {
    status = runE2eDomains([lane.slice('e2e:'.length)]);
  } else if (lane === 'js-unit:all') {
    const args = ['pnpm', 'exec', 'vitest', 'run'];
    if (process.env.VARVE_TEST_WORKERS) args.push('--maxWorkers', process.env.VARVE_TEST_WORKERS);
    status = cmd(args);
  } else if (lane === 'typecheck:all') {
    status = cmd(['pnpm', 'typecheck']);
  } else if (lane === 'e2e:all') {
    const args = ['pnpm', 'exec', 'playwright', 'test'];
    if (process.env.VARVE_E2E_WORKERS) args.push('--workers', process.env.VARVE_E2E_WORKERS);
    status = cmd(args);
  } else if (lane === 'e2e:visual') {
    const args = [
      'pnpm',
      'exec',
      'playwright',
      'test',
      '--project=chromium-visual-1x',
      '--project=chromium-visual-2x',
    ];
    if (process.env.VARVE_E2E_WORKERS) args.push('--workers', process.env.VARVE_E2E_WORKERS);
    status = cmd(args);
  } else if (lane === 'bench:render' || lane === 'bench:table' || lane === 'bench:table-layout') {
    const benchCmd = {
      'bench:render': 'pnpm bench:canvas',
      'bench:table': 'pnpm bench:table',
      'bench:table-layout': 'pnpm bench:table-layout',
    }[lane];
    status = shCmd(benchCmd);
  } else {
    // Resolve the lane to a real command: dynamic package/crate lanes first
    // (js-unit:<pkg>, typecheck:<pkg>, rust-test:<crate>, rust-clippy:<crate>),
    // then the static registry. Never pass a raw lane id to the shell.
    const base = laneCommand(lane) ?? LANES[lane];
    if (!base) {
      console.error(`verify: no command registered for lane '${lane}'`);
      return 1;
    }
    if (isHeavy) {
      status = cmd(['node', 'scripts/quality/heavy-lease.mjs', lane, '--', 'sh', '-c', base]);
    } else {
      status = shCmd(base);
    }
  }
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`  [${status === 0 ? 'PASS' : 'FAIL'}] ${lane} (${elapsed}s)`);
  return status;
}

function main() {
  const runStart = Date.now();
  const args = process.argv.slice(2);
  const mode = args[0];
  const planOpts = parseArgs(['node', 'x', ...args.slice(1)]);

  if (mode === 'plan') {
    let files;
    let base;
    if (planOpts.since) {
      base = planOpts.since;
      files = gitChangedFiles({ base, staged: false });
    } else if (planOpts.staged) {
      files = gitChangedFiles({ base: null, staged: true });
    } else {
      ({ files, base } = defaultScope());
    }
    if (!files.length) {
      console.log('No changed files detected.');
      process.exit(0);
    }
    const plan = buildPlan(files, { includeReverse: !planOpts.noReverse });
    console.log(formatPlan(plan, planOpts));
    process.exit(0);
  }

  const fullGate = mode === 'full';
  if (fullGate) {
    const reason = process.env.VARVE_FULL_GATE_REASON;
    if (!reason && process.env.VARVE_FULL_GATE !== '1') {
      console.error(
        'verify:full requires a reason. Set VARVE_FULL_GATE_REASON="<why>" or VARVE_FULL_GATE=1.\n' +
          '"Just to be safe" is not a reason — see docs/quality/validation-strategy.md.',
      );
      process.exit(2);
    }
    if (reason) console.log(`Full gate reason: ${reason}`);
    console.log('Running full repository gate (Tier 5)...');
    // Order: cheap → heavy
    const statuses = [
      cmd(['pnpm', 'exec', 'biome', 'check', '.']),
      cmd(['pnpm', 'audit:emoji']),
      cmd(['node', 'scripts/audit-health.mjs']),
      cmd(['node', 'scripts/audit-architecture.mjs', '--ci']),
      cmd(['pnpm', 'typecheck']),
    ];
    if (statuses.some((s) => s !== 0)) process.exit(statuses.find((s) => s !== 0));
    const heavy = [
      ['pnpm', 'test:ci:tools'],
      ['pnpm', 'exec', 'vitest', 'run'],
      ['cargo', 'test', '--workspace', '--all-targets'],
      ['cargo', 'clippy', '--workspace', '--all-targets', '--', '-D', 'warnings'],
      ['pnpm', 'exec', 'playwright', 'test', '--project=chromium'],
      ['pnpm', 'e2e:visual'],
    ];
    for (const h of heavy) {
      // heavy-lease takes a LABEL before `--` and the full command after it.
      // The label is the first argv token ('pnpm' for 'pnpm test:ci:tools'),
      // but the command must be the ENTIRE argv — passing the remainder
      // (`h.slice(1)`) spawned 'test:ci:tools' as a bare executable and
      // failed with ENOENT before the gate could run.
      const st = cmd(['node', 'scripts/quality/heavy-lease.mjs', h[0], '--', ...h]);
      if (st !== 0) process.exit(st);
    }
    console.log('Full gate passed.');
    process.exit(0);
  }

  // quick / affected
  let files;
  let base;
  if (planOpts.since) {
    base = planOpts.since;
    files = gitChangedFiles({ base, staged: false });
  } else if (planOpts.staged) {
    files = gitChangedFiles({ base: null, staged: true });
  } else {
    ({ files, base } = defaultScope());
  }
  if (!files.length) {
    console.log('No changed files detected — nothing to verify.');
    process.exit(0);
  }
  CHANGED_FILES = files;
  const plan = buildPlan(files, { includeReverse: !planOpts.noReverse });
  console.log(formatPlan(plan, planOpts));

  if (mode === 'quick') {
    // Tier 0 + Tier 1 only
    for (const l of [...plan.tiers[0], ...plan.tiers[1]]) {
      if (runLane(l) !== 0) process.exit(1);
    }
  } else if (mode === 'affected') {
    if (plan.full) {
      console.log('\nEscalation to full gate required. Rerun with: pnpm verify:full');
      process.exit(2);
    }
    for (const l of flatten(plan)) {
      if (runLane(l) !== 0) process.exit(1);
    }
  } else {
    console.error(`verify: unknown mode '${mode}'. Use: quick | affected | full | plan`);
    process.exit(2);
  }

  const tAll = (Date.now() - runStart) / 1000;
  console.log(`\nTotal: ${tAll.toFixed(1)}s`);
}

main();
