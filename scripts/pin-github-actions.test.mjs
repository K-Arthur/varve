#!/usr/bin/env node
/**
 * Unit tests for pin-github-actions.mjs
 *
 * Run: node scripts/pin-github-actions.test.mjs
 * Wired into the regression suite (pnpm test + CI pipeline-validation gate).
 */
import assert from 'node:assert';
import { ACTION_SHAS, extractActionUses, isMutableVersion, SHA_RE } from './pin-github-actions.mjs';

// ── SHA_RE ────────────────────────────────────────────────────────────────────
assert.strictEqual(SHA_RE.test('11bd71901bbe5b1630ceea73d27597364c9af683'), true, 'full SHA ok');
assert.strictEqual(SHA_RE.test('11bd71901bbe5b1630ceea73d27597364c9af68'), false, 'too short');
assert.strictEqual(
  SHA_RE.test('11BD71901BBE5B1630CEEA73D27597364C9AF683'),
  false,
  'uppercase invalid',
);
assert.strictEqual(SHA_RE.test('v4'), false, 'tag is not a SHA');
assert.strictEqual(
  SHA_RE.test('11bd71901bbe5b1630ceea73d27597364c9af683Z'),
  false,
  'non-hex invalid',
);

// ── isMutableVersion ─────────────────────────────────────────────────────────
assert.strictEqual(isMutableVersion(null), true, 'no ref is mutable');
assert.strictEqual(isMutableVersion(undefined), true, 'undefined ref is mutable');
assert.strictEqual(isMutableVersion('v4'), true, 'major tag mutable');
assert.strictEqual(isMutableVersion('v4.0.0'), true, 'semver tag mutable');
assert.strictEqual(isMutableVersion('stable'), true, 'stable mutable');
assert.strictEqual(isMutableVersion('main'), true, 'main mutable');
assert.strictEqual(
  isMutableVersion('cargo-llvm-cov'),
  true,
  'tool-branch ref mutable (blind spot fixed)',
);
assert.strictEqual(
  isMutableVersion('11bd71901bbe5b1630ceea73d27597364c9af683'),
  false,
  'full SHA is pinned',
);

// ── extractActionUses ────────────────────────────────────────────────────────
const quoted = extractActionUses(
  "uses: 'actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683'",
);
assert.strictEqual(quoted.action, 'actions/checkout');
assert.strictEqual(quoted.version, '11bd71901bbe5b1630ceea73d27597364c9af683');
assert.strictEqual(
  quoted.original,
  "uses: 'actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683'",
);

const bare = extractActionUses(
  '      uses: actions/setup-node@1d0ff469b7ec7b3cb9d8673fde0c81c44821de2a',
);
assert.strictEqual(bare.action, 'actions/setup-node');
assert.strictEqual(bare.version, '1d0ff469b7ec7b3cb9d8673fde0c81c44821de2a');

const mutable = extractActionUses('uses: pnpm/action-setup@v4.0.0');
assert.strictEqual(mutable.action, 'pnpm/action-setup');
assert.strictEqual(mutable.version, 'v4.0.0');
assert.strictEqual(isMutableVersion(mutable.version), true);

const local = extractActionUses('uses: ./some-local-action');
assert.strictEqual(local.action, './some-local-action');
assert.strictEqual(local.version, null);
assert.strictEqual(isMutableVersion(local.version), true);

assert.strictEqual(extractActionUses('run: echo hello'), null, 'non-uses line ignored');
// Commented lines still match extractActionUses; the caller (collectUses)
// skips comment lines before calling. Assert the raw match contract here.
const commented = extractActionUses('# uses: actions/checkout@v4');
assert.strictEqual(commented.action, 'actions/checkout', 'extractor matches commented uses');
assert.strictEqual(isMutableVersion(commented.version), true, 'v4 is mutable');

// ── ACTION_SHAS table integrity ──────────────────────────────────────────────
for (const [action, sha] of Object.entries(ACTION_SHAS)) {
  assert.strictEqual(
    SHA_RE.test(sha),
    true,
    `ACTION_SHAS[${action}] must be a 40-char hex SHA, got ${sha}`,
  );
}

// Every workflow-referenced action in the seed table must be present and valid.
const referenced = [
  'actions/checkout',
  'actions/setup-node',
  'actions/upload-artifact',
  'actions/download-artifact',
  'actions/upload-pages-artifact',
  'actions/deploy-pages',
  'actions/setup-python',
  'dtolnay/rust-toolchain',
  'Swatinem/rust-cache',
  'taiki-e/install-action',
  'softprops/action-gh-release',
  'pnpm/action-setup',
];
for (const action of referenced) {
  assert.ok(ACTION_SHAS[action], `ACTION_SHAS missing entry for ${action}`);
}

// The fabricated SHAs that caused the 2026-08-01 outage must NOT be present.
for (const sha of [
  'a5ac7e51b41094c92402da3b243b9e2b7c2e1d6f',
  '1a4442cda7143948ae1d52f1a60fd880ff95df6a',
  '65462800fd760344b1a7b4382951275a0bbc538f',
  '6c4b8581f9e2785c6e3e9df2dd1c0c0c5b5b5b5b',
]) {
  assert.ok(
    !Object.values(ACTION_SHAS).includes(sha),
    `fabricated SHA ${sha} must not be in the pin table`,
  );
}

console.log('pin-github-actions tests passed.');
