#!/usr/bin/env node

/** Planner startup/error regression tests. */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { buildPlan } from './affected-plan.mjs';

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

console.log('affected plan tests passed');
