#!/usr/bin/env node

/** Planner startup/error regression tests. */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPlan } from './affected-plan.mjs';

const plannerPath = fileURLToPath(new URL('./affected-plan.mjs', import.meta.url));
const verifierPath = fileURLToPath(new URL('./verify.mjs', import.meta.url));

assert.throws(
  () =>
    execFileSync(
      process.execPath,
      ['scripts/quality/affected-plan.mjs', '--since', 'refs/does-not-exist'],
      { encoding: 'utf8' },
    ),
  /cannot resolve comparison base|Command failed|status 1/,
  'an invalid comparison base must not become an empty successful plan',
);

const removedCrate = buildPlan(['crates/removed-crate/src/lib.rs']);
assert.deepEqual(removedCrate.unresolvedRustPaths, ['crates/removed-crate/src/lib.rs']);
assert.equal(
  removedCrate.full,
  true,
  'an unknown/deleted crate conservatively selects the full gate',
);
assert.ok(removedCrate.reasons.some((reason) => reason.includes('unrecognized Rust path')));

const owner = 'tests/e2e/canvas/alignment-arrangement.spec.ts';
const snapshots = [
  `${owner}-snapshots/nested-frame-reference-alignment-chromium-linux.png`,
  `${owner}-snapshots/nested-image-frame-alignment-chromium-linux.png`,
];
const snapshotPlan = buildPlan(snapshots);
assert.deepEqual(
  snapshotPlan.tiers[1],
  ['typecheck:e2e', `e2e:file:${owner}`],
  'multiple changed baselines select their existing owner once, after E2E typechecking',
);
assert.ok(!snapshotPlan.tiers[4].includes('e2e:canvas'));

const missingOwner = buildPlan([
  'tests/e2e/canvas/deleted.spec.ts-snapshots/deleted-chromium-linux.png',
]);
assert.ok(missingOwner.tiers[4].includes('e2e:canvas'));
assert.deepEqual(missingOwner.directE2eFiles, []);

const setupPlan = buildPlan(['tests/e2e/global-setup.ts']);
assert.ok(setupPlan.tiers[1].includes('typecheck:e2e'));
assert.ok(setupPlan.tiers[4].includes('e2e:all'));

const fixturePlan = buildPlan(['tests/e2e/fixtures/real-life-portrait.jpg']);
assert.ok(fixturePlan.tiers[4].includes('e2e:all'));

const canvasBenchPlan = buildPlan([
  'packages/editor/src/canvas/__tests__/cacheSystem.bench.test.ts',
]);
assert.deepEqual(canvasBenchPlan.tiers[1], [
  'js-unit:file:packages/editor/src/canvas/__tests__/cacheSystem.bench.test.ts',
]);
assert.ok(!canvasBenchPlan.tiers[4].includes('e2e:canvas'));
assert.ok(!canvasBenchPlan.tiers[4].includes('bench:render'));
assert.ok(buildPlan(['packages/editor/src/canvas/cameraState.ts']).tiers[4].includes('e2e:canvas'));

const repo = mkdtempSync(join(tmpdir(), 'varve-affected-since-'));
try {
  const git = (args) =>
    execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: 'pipe' }).trim();
  git(['init', '-q']);
  git(['config', 'user.name', 'Varve planner test']);
  git(['config', 'user.email', 'planner@example.invalid']);
  writeFileSync(join(repo, 'unstaged.txt'), 'base\n');
  writeFileSync(join(repo, 'staged.txt'), 'base\n');
  git(['add', '.']);
  git(['commit', '-qm', 'base']);
  const base = git(['rev-parse', 'HEAD']);

  writeFileSync(join(repo, 'committed.txt'), 'committed\n');
  git(['add', 'committed.txt']);
  git(['commit', '-qm', 'committed change']);
  writeFileSync(join(repo, 'unstaged.txt'), 'dirty\n');
  writeFileSync(join(repo, 'staged.txt'), 'dirty\n');
  git(['add', 'staged.txt']);
  writeFileSync(join(repo, 'untracked.txt'), 'dirty\n');

  for (const args of [
    [plannerPath, '--since', base, '--json'],
    [verifierPath, 'plan', '--since', base, '--json'],
  ]) {
    const output = execFileSync(process.execPath, args, { cwd: repo, encoding: 'utf8' });
    const { plan } = JSON.parse(output);
    assert.deepEqual(
      plan.changed.other,
      ['committed.txt'],
      `${args[0]} --since must use the exact committed ref range`,
    );
    assert.equal(plan.stats.files, 1);
  }
} finally {
  rmSync(repo, { recursive: true, force: true });
}

// A docs-only change must not invoke Biome with no paths, because Biome
// interprets that as a repository-wide scan. Exercise the actual verifier in
// a Git repository with a staged document and runnable audit scripts.
const docsRepo = mkdtempSync(join(tmpdir(), 'varve-docs-only-'));
try {
  const git = (args) =>
    execFileSync('git', args, { cwd: docsRepo, encoding: 'utf8', stdio: 'pipe' }).trim();
  git(['init', '-q']);
  git(['config', 'user.name', 'Varve planner test']);
  git(['config', 'user.email', 'planner@example.invalid']);
  mkdirSync(join(docsRepo, 'scripts'));
  mkdirSync(join(docsRepo, 'docs'));
  writeFileSync(
    join(docsRepo, 'package.json'),
    JSON.stringify({
      name: 'varve-docs-only-validation',
      private: true,
      scripts: {
        'audit:docs': 'node scripts/audit-docs.mjs',
        'audit:emoji': 'node scripts/audit-emoji.mjs',
      },
    }),
  );
  writeFileSync(join(docsRepo, 'scripts/audit-docs.mjs'), 'console.log("docs audit passed")\n');
  writeFileSync(join(docsRepo, 'scripts/audit-emoji.mjs'), 'console.log("emoji audit passed")\n');
  git(['add', '.']);
  git(['commit', '-qm', 'base']);
  writeFileSync(join(docsRepo, 'docs/capture.md'), '# Real docs-only change\n');
  git(['add', 'docs/capture.md']);
  const output = execFileSync(process.execPath, [verifierPath, 'quick', '--staged'], {
    cwd: docsRepo,
    encoding: 'utf8',
  });
  assert.match(output, /\[SKIP\] format:touched: no existing Biome-compatible changed files/);
  assert.match(output, /\[SKIP\] lint:touched: no existing Biome-compatible changed files/);
  assert.match(output, /docs audit passed/);
} finally {
  rmSync(docsRepo, { recursive: true, force: true });
}

console.log('affected plan tests passed');
