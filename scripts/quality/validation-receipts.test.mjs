#!/usr/bin/env node

/** Exact identity and common-Git-directory receipt regression tests. */

import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readReceipt, receiptPath, recordOverride, writeReceipt } from './validation-receipts.mjs';

const commonDir = mkdtempSync(join(tmpdir(), 'varve-receipts-common-'));
const tools = {
  node: 'v-test',
  pnpm: 'pnpm-test',
  rustc: 'rustc-test',
  cargo: 'cargo-test',
  just: 'just-test',
  packageManager: 'pnpm@11.9.0',
  playwright: '1.62.1',
  platform: 'linux',
  arch: 'x64',
};
const basePlan = {
  remote: { name: 'origin', url: 'https://example.invalid/varve.git' },
  refs: [
    {
      localRef: 'refs/heads/feature',
      localSha: 'c'.repeat(40),
      remoteRef: 'refs/heads/feature',
      remoteSha: 'b'.repeat(40),
      baseSha: 'b'.repeat(40),
      headSha: 'c'.repeat(40),
      comparisonBaseSha: 'b'.repeat(40),
      deleted: false,
    },
  ],
  changedFileHash: 'd'.repeat(64),
  outgoingCommitHash: 'e'.repeat(64),
  lockfileHash: 'f'.repeat(64),
  policyVersion: 'test-policy-v1',
  policyHash: '1'.repeat(64),
};

try {
  const now = Date.parse('2026-08-31T12:00:00Z');
  const written = writeReceipt(basePlan, { commonDir, tools, now, commands: [['pnpm', 'test']] });
  assert.ok(existsSync(written.path));
  assert.equal(written.path, receiptPath(basePlan, { commonDir, tools, now }));
  assert.equal(readReceipt(basePlan, { commonDir, tools, now: now + 1000 }).reusable, true);

  // The same identity is reusable from another worktree sharing the common
  // Git directory; a different ref/base/head never aliases the receipt.
  const sameFromOtherWorktree = readReceipt(structuredClone(basePlan), {
    commonDir,
    tools,
    now: now + 2000,
  });
  assert.equal(sameFromOtherWorktree.reusable, true);
  const changedHead = structuredClone(basePlan);
  changedHead.refs[0].headSha = '9'.repeat(40);
  assert.equal(readReceipt(changedHead, { commonDir, tools, now }).reusable, false);
  const changedBase = structuredClone(basePlan);
  changedBase.refs[0].baseSha = '8'.repeat(40);
  assert.equal(readReceipt(changedBase, { commonDir, tools, now }).reusable, false);
  const changedRawRemoteObject = structuredClone(basePlan);
  changedRawRemoteObject.refs[0].remoteSha = '7'.repeat(40);
  assert.equal(
    readReceipt(changedRawRemoteObject, { commonDir, tools, now }).reusable,
    false,
    'annotated-tag object changes must invalidate the receipt',
  );
  const changedRefs = structuredClone(basePlan);
  changedRefs.refs.push({ ...changedRefs.refs[0], remoteRef: 'refs/heads/other' });
  assert.equal(readReceipt(changedRefs, { commonDir, tools, now }).reusable, false);

  // Lockfile, policy, and toolchain changes all produce different identities.
  for (const field of ['lockfileHash', 'policyHash', 'policyVersion']) {
    const changed = structuredClone(basePlan);
    changed[field] = changed[field].replace(/./g, '2');
    assert.equal(readReceipt(changed, { commonDir, tools, now }).reusable, false, field);
  }
  assert.equal(
    readReceipt(basePlan, {
      commonDir,
      tools: { ...tools, node: 'v-other' },
      now,
    }).reusable,
    false,
  );
  assert.equal(
    readReceipt(basePlan, {
      commonDir,
      tools,
      now: now + 7 * 60 * 60 * 1000,
    }).reason,
    'expired',
  );
  writeReceipt(basePlan, { commonDir, tools, now: now + 60_000 });
  assert.equal(readReceipt(basePlan, { commonDir, tools, now }).reason, 'expired');

  const override = recordOverride('network outage while pushing integration branch', basePlan, {
    commonDir,
    now,
  });
  assert.equal(override.reason, 'network outage while pushing integration branch');
  const overrideLog = readFileSync(join(commonDir, 'varve-validation', 'overrides.ndjson'), 'utf8');
  assert.match(overrideLog, /network outage/);
  assert.throws(() => recordOverride('   ', basePlan, { commonDir }), /nonempty, specific/);

  console.log('validation receipt tests passed');
} finally {
  rmSync(commonDir, { recursive: true, force: true });
}
