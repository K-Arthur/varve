#!/usr/bin/env node

/** Canonical local/CI planner parity and bounded command construction tests. */

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildCiPlan, validateCiPlan } from './ci-plan.mjs';
import { preflightCommands } from './ci-preflight.mjs';
import { laneArgv } from './validation-lanes.mjs';
import { CI_CATEGORIES, promisedLanesForCategories } from './validation-policy.mjs';

const head = readFileSync('.git/HEAD', 'utf8').trim();
assert.ok(head, 'test repository has a HEAD');
const actualHead = buildCiPlan({ base: 'HEAD', head: 'HEAD', profile: 'integration' }).commitSha;
const full = buildCiPlan({
  base: actualHead,
  head: actualHead,
  profile: 'candidate',
  forceFull: true,
});
assert.equal(full.globalImpact, true);
assert.deepEqual(
  Object.values(full.categories),
  CI_CATEGORIES.map(() => true),
);
assert.deepEqual(full.selectedLanes, promisedLanesForCategories(full.categories, 'candidate'));
assert.deepEqual(
  validateCiPlan(full, { expectedHead: actualHead, expectedPolicyHash: full.policyHash }),
  [],
);

const browserSpec = buildCiPlan({
  base: 'HEAD',
  head: 'HEAD',
  planner: () => ({
    tiers: { 0: [], 1: ['e2e:file:tests/e2e/canvas/tools.spec.ts'], 2: [], 3: [], 4: [] },
    changed: { js: [], rust: [], other: [], app: [] },
    directE2eFiles: ['tests/e2e/canvas/tools.spec.ts'],
    e2eDomains: [],
    benchDomains: [],
    full: false,
    stats: { jsPackages: [], rustCrates: [] },
  }),
});
assert.equal(browserSpec.categories.e2e, true, 'a direct E2E spec selects the browser consumer');
assert.ok(browserSpec.selectedLanes.includes('e2e:file:tests/e2e/canvas/tools.spec.ts'));
assert.ok(!browserSpec.selectedLanes.includes('e2e:all'));
assert.deepEqual(browserSpec.e2eShards, [1], 'a focused browser lane uses one shard');

// A large range is chunked into bounded argv calls. Paths remain individual
// arguments, so whitespace/unusual characters cannot become shell syntax.
const manyFiles = Array.from({ length: 2000 }, (_, index) =>
  index % 2 ? 'package.json' : 'pnpm-lock.yaml',
);
const commands = preflightCommands({ files: manyFiles, plan: { tiers: { 1: [], 2: [] } } });
const biomeCommands = commands.filter(
  (command) => command[0] === 'pnpm' && command.includes('biome'),
);
assert.ok(biomeCommands.length >= 26, 'thousands of files require chunked Biome commands');
assert.ok(biomeCommands.every((command) => command.length <= 86));
assert.ok(biomeCommands.every((command) => !command.includes('--check')));
assert.ok(biomeCommands.every((command) => !command.includes('-c') && !command.includes('sh')));
assert.deepEqual(laneArgv('format:changed', { files: ['package.json'] }), [
  'biome',
  'format',
  'package.json',
]);
const unusualRoot = mkdtempSync(join(tmpdir(), 'varve-preflight-paths-'));
try {
  writeFileSync(join(unusualRoot, 'path with spaces-[odd].ts'), 'export {}\n');
  const unusual = preflightCommands(
    {
      files: ['path with spaces-[odd].ts'],
      plan: { tiers: { 1: [], 2: [] } },
    },
    { root: unusualRoot },
  );
  assert.ok(unusual.some((command) => command.includes('path with spaces-[odd].ts')));
} finally {
  rmSync(unusualRoot, { recursive: true, force: true });
}

// Workflow conditions and the local planner use the same profile vocabulary.
const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
assert.match(ci, /ci-plan\.mjs/);
assert.match(ci, /--profile integration/);
assert.match(ci, /--force-full/);
assert.match(ci, /commit_sha/);
assert.match(ci, /fromJSON\(needs\.changes\.outputs\.e2e_shards\)/);

console.log('CI plan tests passed');
