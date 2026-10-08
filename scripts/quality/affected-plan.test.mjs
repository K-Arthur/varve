#!/usr/bin/env node

/** Planner startup/error regression tests. */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { IMPACT_CONFIG } from '../../validation-impact.config.mjs';
import { buildPlan } from './affected-plan.mjs';
import { e2eArgv } from './ci-run-lanes.mjs';
import { laneArgv } from './validation-lanes.mjs';
import { deriveCiCategories, selectedCiLanes, selectPushValidation } from './validation-policy.mjs';

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
for (const path of [
  'scripts/release/production/macos-production.mjs',
  'scripts/release/production/macos-ax-controls.test.mjs',
  'scripts/release/production/macos-session.sh',
  'scripts/release/production/macos-profile-snapshot.py',
  'scripts/release/native-qualification-reuse.mjs',
  'scripts/release/select-run-artifacts.mjs',
  '.github/workflows/release.yml',
]) {
  const plan = buildPlan([path]);
  assert.ok(
    plan.tiers[1].includes('native-adapter-contracts'),
    `${path}: cheap native regressions cannot be deferred to the full gate`,
  );
  assert.equal(plan.full, true, 'Native infrastructure still requires its hosted final checkpoint');
  assert.ok(
    selectPushValidation(plan, { files: [path] }).localBlocking.includes(
      'native-adapter-contracts',
    ),
    'The push checkpoint also runs cheap native regressions, even when a full hosted gate is required',
  );
  assert.deepEqual(
    laneArgv('native-adapter-contracts'),
    ['node', 'scripts/release/production/contracts.test.mjs'],
    'A selected push lane must resolve through the real argv executor, not only the affected shell registry',
  );
}
assert.ok(
  !buildPlan(['docs/release/signing-decision-record.md']).tiers[1].includes(
    'native-adapter-contracts',
  ),
);
assert.deepEqual(removedCrate.unresolvedRustPaths, ['crates/removed-crate/src/lib.rs']);
assert.equal(
  removedCrate.full,
  true,
  'an unknown/deleted crate conservatively selects the full gate',
);
assert.ok(removedCrate.reasons.some((reason) => reason.includes('unrecognized Rust path')));

const removedUnitTest = 'packages/editor/src/workspace/__tests__/removed-model.test.ts';
assert.ok(
  !buildPlan([removedUnitTest]).tiers[1].includes(`js-unit:file:${removedUnitTest}`),
  'a deleted unit test must not be selected as an executable validation lane',
);

const removedE2eTest = 'tests/e2e/canvas/variable-debug.spec.ts';
assert.ok(
  !buildPlan([removedE2eTest]).tiers[1].includes(`e2e:file:${removedE2eTest}`),
  'a deleted Playwright spec must not be selected as an executable validation lane',
);

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

const chromeOwners = [
  'tests/e2e/canvas/overlay-alignment.spec.ts',
  'tests/e2e/canvas/upscale-dialog-visual.spec.ts',
  'tests/e2e/email/visual.spec.ts',
  'tests/e2e/workspace/visual.spec.ts',
];
assert.deepEqual(IMPACT_CONFIG.e2eDomains['editor-chrome-visual'], chromeOwners);
assert.deepEqual(
  e2eArgv('e2e:editor-chrome-visual', '1/1'),
  ['pnpm', 'exec', 'playwright', 'test', ...chromeOwners, '--project=chromium', '--shard', '1/1'],
  'the hosted runner resolves the domain to real owners and retains its shard identity',
);
function fullEditorScreenshotOwners(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return fullEditorScreenshotOwners(path);
    return entry.name.endsWith('.spec.ts') &&
      /expect\(\s*page\s*\)\s*\.toHaveScreenshot\(/.test(readFileSync(path, 'utf8'))
      ? [path]
      : [];
  });
}
assert.deepEqual(
  [...IMPACT_CONFIG.e2eDomains['editor-chrome-visual']].sort(),
  fullEditorScreenshotOwners('tests/e2e').sort(),
  'new whole-editor screenshot owners must join chrome selection before they can drift',
);
const chromeRule = IMPACT_CONFIG.impactRules.find((rule) => rule.id === 'editor-chrome-visual');
assert.ok(chromeRule);
for (const source of chromeRule.paths) {
  const chromePlan = buildPlan([source]);
  assert.ok(
    chromePlan.tiers[1].includes('typecheck:e2e'),
    `${source} compiles browser specs first`,
  );
  assert.ok(
    chromePlan.tiers[4].includes('e2e:editor-chrome-visual'),
    `${source} selects every chrome screenshot owner`,
  );
  assert.ok(
    !chromePlan.tiers[4].includes('e2e:workspace'),
    `${source} does not run unrelated workspace interactions`,
  );
  assert.ok(
    !chromePlan.tiers[4].includes('e2e:all'),
    `${source} does not force the entire browser corpus`,
  );
  assert.ok(
    selectedCiLanes(chromePlan, deriveCiCategories(chromePlan, [source])).includes(
      'e2e:editor-chrome-visual',
    ),
    `${source} reaches hosted selection`,
  );
}
for (const spec of chromeOwners) {
  const baselinePlan = buildPlan([`${spec}-snapshots/changed-chrome-chromium-linux.png`]);
  assert.deepEqual(baselinePlan.tiers[1], ['typecheck:e2e', `e2e:file:${spec}`]);
  assert.ok(
    !baselinePlan.tiers[4].includes('e2e:editor-chrome-visual'),
    'a baseline update keeps its exact owner scope',
  );
}

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
assert.ok(
  fixturePlan.tiers[4].includes('e2e:demo-dist'),
  'the broad app browser closure also runs owners excluded from the development-server suite',
);
assert.ok(
  selectedCiLanes(
    fixturePlan,
    deriveCiCategories(fixturePlan, ['tests/e2e/fixtures/real-life-portrait.jpg']),
  ).includes('e2e:demo-dist'),
  'broad affected browser changes must reach the dedicated production-demo CI lane',
);

const demoDistPlan = buildPlan(['scripts/website/demo-dist-validation.mjs']);
assert.ok(demoDistPlan.tiers[4].includes('demo-dist-validation'));
assert.ok(!demoDistPlan.tiers[4].includes('ci-tools'));
assert.ok(!demoDistPlan.full, 'a bounded demo-path test does not force a local full gate');
assert.ok(
  selectPushValidation(demoDistPlan, {
    files: ['scripts/website/demo-dist-validation.mjs'],
  }).localBlocking.includes('demo-dist-validation'),
  'the small portability regression test remains in the push checkpoint',
);

for (const owner of IMPACT_CONFIG.demoDistE2eOwners) {
  const ownerPlan = buildPlan([owner]);
  assert.deepEqual(ownerPlan.tiers[1], ['typecheck:e2e', 'e2e:demo-dist']);
  assert.deepEqual(ownerPlan.directE2eFiles, []);
  assert.equal(ownerPlan.integrationRequired, true);
  const categories = deriveCiCategories(ownerPlan, [owner]);
  assert.equal(categories.e2e, true);
  assert.ok(
    selectedCiLanes(ownerPlan, categories).includes('e2e:demo-dist'),
    `${owner} must reach the staged production-demo lane`,
  );
}

const canvasBenchPlan = buildPlan([
  'packages/editor/src/canvas/__tests__/cacheSystem.bench.test.ts',
]);
assert.deepEqual(canvasBenchPlan.tiers[1], [
  'js-unit:file:packages/editor/src/canvas/__tests__/cacheSystem.bench.test.ts',
]);
assert.ok(!canvasBenchPlan.tiers[4].includes('e2e:canvas'));
assert.ok(!canvasBenchPlan.tiers[4].includes('bench:render'));
assert.ok(buildPlan(['packages/editor/src/canvas/cameraState.ts']).tiers[4].includes('e2e:canvas'));

const websiteSpec = 'apps/website/tests/e2e/visual.spec.ts';
const websitePlan = buildPlan([websiteSpec]);
assert.deepEqual(websitePlan.tiers[1], [
  'typecheck:website-e2e',
  `website-e2e:file:${websiteSpec}`,
]);
assert.deepEqual(websitePlan.tiers[4], []);
assert.equal(websitePlan.stats.selectedTestFiles, 1);
const websiteCategories = deriveCiCategories(websitePlan, [websiteSpec]);
assert.equal(websiteCategories.website, true);
assert.equal(websiteCategories.e2e, false);
assert.ok(
  selectPushValidation(websitePlan, { files: [websiteSpec] }).localBlocking.includes(
    'typecheck:website-e2e',
  ),
  'bounded push retains the owning website compiler',
);
assert.ok(
  selectedCiLanes(websitePlan, websiteCategories).includes('website-e2e'),
  'hosted CI retains full website E2E for a local exact spec plan',
);
assert.deepEqual(websitePlan.directE2eFiles, []);
assert.deepEqual(websitePlan.directWebsiteE2eFiles, [websiteSpec]);
assert.ok(
  !buildPlan(['apps/website/tests/e2e/removed.spec.ts']).tiers[1].some((lane) =>
    lane.startsWith('website-e2e:file:'),
  ),
);
const websiteSnapshot = buildPlan([`${websiteSpec}-snapshots/scene-ghpages-linux.png`]);
assert.deepEqual(websiteSnapshot.tiers[1], [
  'typecheck:website-e2e',
  `website-e2e:file:${websiteSpec}`,
]);
assert.ok(!websiteSnapshot.tiers[4].includes('website-e2e'));
const screenshotOnlyWebsite = buildPlan([
  'apps/website/public/screenshots/patterns-document-alignment.png',
  'apps/website/src/data/screenshot-manifest.json',
  'docs/screenshots/product/patterns-document-alignment.png',
]);
assert.equal(screenshotOnlyWebsite.websiteScreenshotScope, true);
assert.ok(!screenshotOnlyWebsite.tiers[4].includes('website-e2e'));
assert.ok(screenshotOnlyWebsite.tiers[4].includes('website-unit'));
assert.ok(!screenshotOnlyWebsite.tiers[2].some((lane) => lane.endsWith('@varve/website')));
assert.ok(!screenshotOnlyWebsite.tiers[2].includes('typecheck:@varve/website'));
assert.ok(screenshotOnlyWebsite.tiers[1].includes('typecheck:website-e2e'));
assert.deepEqual(
  screenshotOnlyWebsite.directWebsiteE2eFiles,
  IMPACT_CONFIG.websiteScreenshotValidation.specs,
  'image-only changes select the reviewed screenshot consumer and layout spec set',
);
assert.equal(
  selectedCiLanes(
    screenshotOnlyWebsite,
    deriveCiCategories(screenshotOnlyWebsite, [
      'apps/website/public/screenshots/patterns-document-alignment.png',
    ]),
  ).includes('website-e2e'),
  true,
  'hosted CI keeps the full website suite for screenshot changes',
);
const mixedScreenshotAndSource = buildPlan([
  'apps/website/public/screenshots/patterns-document-alignment.png',
  'apps/website/src/pages/index.astro',
]);
assert.equal(mixedScreenshotAndSource.websiteScreenshotScope, false);
assert.ok(
  mixedScreenshotAndSource.tiers[4].includes('website-e2e'),
  'mixed source and screenshot changes keep the full local website suite',
);
for (const path of [
  'apps/website/src/pages/index.astro',
  'apps/website/tests/e2e/helpers.ts',
  'apps/website/tests/e2e/tsconfig.json',
  'playwright.website.config.ts',
]) {
  assert.ok(
    buildPlan([path]).tiers[4].includes('website-e2e'),
    `${path} retains broad website validation`,
  );
}
assert.ok(
  buildPlan(['apps/website/tests/e2e/helpers.ts']).tiers[1].includes('typecheck:website-e2e'),
);
const mixedWebsite = buildPlan([websiteSpec, 'apps/website/src/pages/index.astro']);
assert.ok(mixedWebsite.tiers[4].includes('website-e2e'));

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
