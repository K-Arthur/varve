#!/usr/bin/env node
/**
 * Rust line-coverage ratchet, via cargo-llvm-cov (NOT tarpaulin — tarpaulin
 * numbers seen elsewhere for this codebase are not comparable to what this
 * script reports; llvm-cov and tarpaulin instrument differently and
 * routinely disagree by several points on the same code).
 *
 * Covers both cargo workspaces in this repo:
 *   - the root workspace (crates/*)
 *   - apps/desktop/src-tauri (a separate workspace, not a root member)
 *
 * Usage:
 *   node scripts/audit-rust-coverage.mjs          # measure + report
 *   node scripts/audit-rust-coverage.mjs --ci      # fail on regression vs baseline
 *   node scripts/audit-rust-coverage.mjs --update  # write current numbers as the new floor
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname;
const BASELINE_PATH = `${ROOT}.rust-coverage-baseline.json`;
const args = process.argv.slice(2);
const CI_MODE = args.includes('--ci');
const UPDATE = args.includes('--update');

function run(cmd, cwd) {
  return execSync(cmd, { cwd, encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 });
}

function measure(label, cwd, extraArgs = '') {
  console.log(`\n═══ cargo llvm-cov: ${label} ═══`);
  // --fail-under-lines intentionally omitted here — this script owns the
  // pass/fail decision against the ratcheting baseline, not llvm-cov itself.
  const json = run(`cargo llvm-cov --all-targets --summary-only --json ${extraArgs}`, cwd);
  const report = JSON.parse(json);
  const totals = report.data?.[0]?.totals;
  if (!totals) {
    throw new Error(`${label}: could not parse cargo-llvm-cov JSON summary`);
  }
  const linePct = totals.lines.percent;
  const regionPct = totals.regions.percent;
  const functionPct = totals.functions.percent;
  console.log(
    `  lines ${linePct.toFixed(2)}%  regions ${regionPct.toFixed(2)}%  functions ${functionPct.toFixed(2)}%`,
  );
  return { lines: linePct, regions: regionPct, functions: functionPct };
}

function main() {
  const results = {
    workspace: measure('root workspace (crates/*)', ROOT),
    desktop: measure('apps/desktop/src-tauri', `${ROOT}apps/desktop/src-tauri`),
  };

  if (UPDATE) {
    const baseline = {
      version: new Date().toISOString().slice(0, 10),
      note:
        'Measured via cargo-llvm-cov. Do not compare to tarpaulin numbers from ' +
        'elsewhere in this repo — different instrumentation, not the same metric.',
      floors: {
        workspace: { lines: results.workspace.lines },
        desktop: { lines: results.desktop.lines },
      },
    };
    writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`);
    console.log(`\naudit-rust-coverage: baseline written to .rust-coverage-baseline.json`);
    return;
  }

  if (CI_MODE) {
    if (!existsSync(BASELINE_PATH)) {
      console.error(
        'audit-rust-coverage: no .rust-coverage-baseline.json found. Run with --update once to create it.',
      );
      process.exit(1);
    }
    const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf-8'));
    const errors = [];
    // A small tolerance (0.1 points) absorbs cross-platform floating-point
    // noise in the percentage, not real regressions.
    const TOLERANCE = 0.1;
    for (const [key, data] of Object.entries(results)) {
      const floor = baseline.floors?.[key]?.lines;
      if (floor === undefined) continue;
      if (data.lines < floor - TOLERANCE) {
        errors.push(
          `${key}: line coverage ${data.lines.toFixed(2)}% dropped below floor ${floor.toFixed(2)}%`,
        );
      }
    }
    if (errors.length > 0) {
      console.error('\n❌ RUST COVERAGE REGRESSION:');
      for (const err of errors) console.error(`  ${err}`);
      console.error(
        '\nEither restore coverage or, if the drop is intentional (e.g. new ' +
          'generated/stub code), run `node scripts/audit-rust-coverage.mjs --update` ' +
          'and explain why in the PR description.',
      );
      process.exit(1);
    }
    console.log('\n✓ Rust coverage at or above the ratcheting floor.');
  }
}

main();
