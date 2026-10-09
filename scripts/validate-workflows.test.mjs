#!/usr/bin/env node
/**
 * Unit tests for the Varve workflow regression guards
 * (scripts/validate-workflows.mjs validateVarveRules).
 *
 * Run: node scripts/validate-workflows.test.mjs
 * Wired into the regression suite (pnpm test:ci:tools + CI pipeline-validation).
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { load } from 'js-yaml';
import { browserEvidenceErrors } from './quality/ci-execution-report.mjs';

function baselineBash(platform = process.platform, environment = process.env) {
  if (platform !== 'win32') return 'bash';
  const directories = [
    environment.ProgramFiles,
    environment.ProgramW6432,
    'C:\\Program Files',
  ].filter(Boolean);
  const executable = directories
    .map((directory) => join(directory, 'Git', 'bin', 'bash.exe'))
    .find(existsSync);
  assert.ok(executable, 'Baseline shell fixtures require Git for Windows Bash');
  return executable;
}

function runInertBaselineShell(source, environment) {
  // Shell functions avoid extensionless executable/PATH precedence and native
  // Windows redirection-path assumptions. All original workflow code still runs.
  const marker = '\0VARVE_TEST_BASELINE_ARGV\0';
  const prelude = `git() { printf '%s\\n' "$VARVE_TEST_SOURCE_SHA"; }
node() { printf '\\0VARVE_TEST_BASELINE_ARGV\\0'; printf '%s\\0' "$@"; }
pnpm() { printf 'Unexpected unleased pnpm invocation\\n' >&2; return 91; }`;
  const result = spawnSync(
    baselineBash(),
    ['--noprofile', '--norc', '-c', `${prelude}\n${source}`],
    { env: environment, encoding: 'utf8', timeout: 5000 },
  );
  const offset = result.stdout?.indexOf(marker) ?? -1;
  const argv =
    offset < 0
      ? []
      : result.stdout
          .slice(offset + marker.length)
          .split('\0')
          .slice(0, -1);
  return {
    status: result.status,
    argv,
    phaseError: result.error?.message ?? null,
    stderr: result.stderr,
    stdout: result.stdout,
  };
}

import {
  extractStepBlocks,
  validateRepoInvariants,
  validateVarveRules,
  validateWorkflowStructure,
  validateYAMLSyntax,
} from './validate-workflows.mjs';

const DUPLICATE_KEY = `name: Duplicate key fixture
on: workflow_dispatch
permissions:
  contents: read
jobs:
  build:
    runs-on: ubuntu-latest
    env:
      VALUE: first
    env:
      VALUE: second
    steps:
      - run: echo test
`;

assert.equal(validateYAMLSyntax(DUPLICATE_KEY).valid, false);
assert.match(validateYAMLSyntax(DUPLICATE_KEY).errors[0], /duplicated mapping key/i);

const RUST_TOOLCHAIN_GOOD = `name: Rust
on: workflow_dispatch
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: dtolnay/rust-toolchain@0123456789012345678901234567890123456789
        with:
          toolchain: 1.97.1
`;
const RUST_TOOLCHAIN_BAD = RUST_TOOLCHAIN_GOOD.replace('toolchain: 1.97.1\n', '');
assert.equal(validateWorkflowStructure(RUST_TOOLCHAIN_GOOD, 'rust.yml').valid, true);
assert.match(
  validateWorkflowStructure(RUST_TOOLCHAIN_BAD, 'rust.yml').errors[0],
  /with\.toolchain/,
);

// Reproduce the October 6 run that passed browser commands but rejected every
// receipt. Policy drift must now stop the preflight before any shard starts.
{
  const candidate = readFileSync('.github/workflows/release-candidate.yml', 'utf8');
  assert.deepEqual(validateVarveRules(candidate, 'release-candidate.yml'), []);
  for (const change of [
    (source) => source.replace('--retries=0', '--retries=1'),
    (source) => source.replace('--fail-on-flaky-tests ', ''),
    (source) => source.replace('--workers=1', '--workers=1 --workers=2'),
    (source) => source.replace('--update-snapshots=none', '--update-snapshots=all'),
    (source) => source.replace('--trace=retain-on-failure', '--trace=off'),
  ]) {
    assert.ok(
      validateVarveRules(change(candidate), 'release-candidate.yml').some((error) =>
        error.includes('certified browser command requires exactly one'),
      ),
      'a contradictory command must fail preflight',
    );
  }
  const expression = (value) => `\${{ ${value} }}`;
  const plan = load(candidate).jobs.changes.steps.find((step) => step.id === 'plan').run;
  const inertPlan = plan.replaceAll(expression('inputs.mode'), 'final');
  const sha = 'a'.repeat(40);
  for (const workflowSha of [sha, 'b'.repeat(40)]) {
    const result = runInertBaselineShell(inertPlan, {
      ...process.env,
      VARVE_TEST_SOURCE_SHA: sha,
      EXPECTED_SHA: sha,
      WORKFLOW_SHA: workflowSha,
      GITHUB_OUTPUT: 'unused-inert-output',
    });
    assert.equal(result.phaseError, null);
    assert.equal(result.status, workflowSha === sha ? 0 : 1);
    assert.equal(result.argv.length > 0, workflowSha === sha, 'mismatch must stop before planning');
  }
}

// Website deployment uses folded YAML commands; flags on continuation lines
// must be checked as the command the runner will actually execute.
{
  const website = readFileSync('.github/workflows/website-deploy.yml', 'utf8');
  assert.deepEqual(validateVarveRules(website, 'website-deploy.yml'), []);
  const steps = extractStepBlocks(website);
  assert.ok(steps.test.some((step) => step.run.includes('--fail-on-flaky-tests')));
  const fixture = `name: browser policy fixture
on: workflow_dispatch
jobs:
  e2e:
    steps:
      - name: Browser E2E
        run: >-
          pnpm exec playwright test
          --workers=1 --retries=1 --update-snapshots=none
          --fail-on-flaky-tests --trace=retain-on-failure
`;
  assert.ok(
    validateVarveRules(fixture, 'ci.yml').some((error) => error.includes('--retries=0')),
    'folded command retry drift fails before execution',
  );
  const continued = fixture
    .replace('run: >-', 'run: |')
    .replace('playwright test\n', 'playwright test \\\n')
    .replace('--update-snapshots=none\n', '--update-snapshots=none \\\n');
  for (const valid of [fixture, continued])
    assert.deepEqual(validateVarveRules(valid.replace('--retries=1', '--retries=0'), 'ci.yml'), []);
  assert.ok(
    validateVarveRules(continued, 'ci.yml').some((error) => error.includes('--retries=0')),
    'shell continuations cannot hide conflicting retry flags',
  );
}

const RELEASE_GOOD = `name: Release
on:
  push:
    tags: ['v*']
permissions:
  contents: read
jobs:
  preflight:
    runs-on: ubuntu-latest
    steps:
      - run: echo preflight
  signing-preflight:
    runs-on: ubuntu-latest
    needs: preflight
    steps:
      - run: node scripts/release/signing-policy.mjs
  gate:
    runs-on: ubuntu-latest
    needs: preflight
    steps:
      - run: pnpm install --frozen-lockfile
      - name: Build frontend (required by tauri generate_context!)
        run: pnpm build
        working-directory: apps/desktop
      - name: cargo test (desktop)
        run: cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --features custom-protocol
  bundle:
    runs-on: ubuntu-latest
    needs: [preflight, gate, signing-preflight]
    steps:
      - name: Tauri build
        run: pnpm tauri build --bundles nsis --ci
      - name: Collect artifacts
        run: node scripts/release/collect-artifacts.mjs
      - name: Verify Windows signature
        run: powershell -File scripts/release/verify-windows-signature.ps1 -Path dist/release/x.exe
      - name: Verify macOS signature
        run: bash scripts/release/verify-macos-signature.sh --dmg dist/release/y.dmg
  verify:
    runs-on: ubuntu-latest
    needs: bundle
    permissions:
      contents: read
      id-token: write
      attestations: write
    steps:
      - run: node scripts/release/verify-release-trust.mjs --staged staged --out dist/release
      - name: Generate final SHA256SUMS.txt
        run: node scripts/release/generate-final-checksums.mjs --dir dist/release
      - name: Attest final bytes
        uses: actions/attest@1e69f48acb82d1966a394da916b4c1698aa569d6
        with:
          subject-path: dist/release/*
`;

const RELEASE_BAD_ORDER = `name: Release
on:
  push:
    tags: ['v*']
jobs:
  gate:
    runs-on: ubuntu-latest
    steps:
      - run: pnpm install --frozen-lockfile
      - name: cargo test (desktop)
        run: cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --features custom-protocol
      - name: Build frontend (required by tauri generate_context!)
        run: pnpm build
        working-directory: apps/desktop
`;

const RELEASE_NO_FRONTEND = `name: Release
on:
  push:
    tags: ['v*']
jobs:
  gate:
    runs-on: ubuntu-latest
    steps:
      - run: pnpm install --frozen-lockfile
      - name: cargo test (desktop)
        run: cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --features custom-protocol
`;

// ── draft job: negated globs must not come back ──────────────────────────────
// softprops/action-gh-release v2 globs each `files` entry with the npm `glob`
// package; a standalone `!pattern` matches nothing, so with
// fail_on_unmatched_files: true the v0.1.1 draft always failed. The notes
// must be staged outside the globbed directory instead.
const RELEASE_DRAFT_GOOD = `name: Release
on:
  push:
    tags: ['v*']
permissions:
  contents: read
jobs:
  preflight:
    runs-on: ubuntu-latest
    steps:
      - run: echo preflight
  signing-preflight:
    runs-on: ubuntu-latest
    needs: preflight
    steps:
      - run: node scripts/release/signing-policy.mjs
  gate:
    runs-on: ubuntu-latest
    needs: preflight
    steps:
      - run: pnpm install --frozen-lockfile
      - name: Build frontend (required by tauri generate_context!)
        run: pnpm build
        working-directory: apps/desktop
      - name: cargo test (desktop)
        run: cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --features custom-protocol
  bundle:
    runs-on: ubuntu-latest
    needs: [preflight, gate, signing-preflight]
    steps:
      - name: Tauri build
        run: pnpm tauri build --bundles nsis --ci
      - name: Collect artifacts
        run: node scripts/release/collect-artifacts.mjs
      - name: Verify Windows signature
        run: powershell -File scripts/release/verify-windows-signature.ps1 -Path dist/release/x.exe
      - name: Verify macOS signature
        run: bash scripts/release/verify-macos-signature.sh --dmg dist/release/y.dmg
  verify:
    runs-on: ubuntu-latest
    needs: bundle
    permissions:
      contents: read
      id-token: write
      attestations: write
    steps:
      - run: node scripts/release/verify-release-trust.mjs --staged staged --out dist/release
      - name: Generate final SHA256SUMS.txt
        run: node scripts/release/generate-final-checksums.mjs --dir dist/release
      - name: Attest final bytes
        uses: actions/attest@1e69f48acb82d1966a394da916b4c1698aa569d6
        with:
          subject-path: dist/release/*
  draft:
    runs-on: ubuntu-latest
    needs: verify
    steps:
      - name: Download the verified release set
        uses: actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093
        with:
          name: release-final
          path: staged-final
      - name: Stage release directory
        run: |
          mkdir -p dist/release
          find staged-final -type f ! -name 'RELEASE_NOTES.md' -exec cp {} dist/release/ \\;
          cp staged-final/RELEASE_NOTES.md RELEASE_NOTES.md
      - name: Create draft release
        uses: softprops/action-gh-release@c95fe1489396fe8a9eb87c0abf8aa5b2ef267fda
        with:
          tag_name: v0.1.1
          draft: true
          body_path: RELEASE_NOTES.md
          files: dist/release/*
          fail_on_unmatched_files: true
`;

const RELEASE_DRAFT_NEGATED = `name: Release
on:
  push:
    tags: ['v*']
jobs:
  draft:
    runs-on: ubuntu-latest
    steps:
      - name: Download the verified release set
        uses: actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093
        with:
          name: release-final
          path: dist/release
      - name: Create draft release
        uses: softprops/action-gh-release@c95fe1489396fe8a9eb87c0abf8aa5b2ef267fda
        with:
          tag_name: v0.1.1
          draft: true
          body_path: dist/release/RELEASE_NOTES.md
          files: |
            dist/release/*
            !dist/release/RELEASE_NOTES.md
          fail_on_unmatched_files: true
`;

const RELEASE_DRAFT_NOTES_INSIDE_GLOB = RELEASE_DRAFT_GOOD.replace(
  '          body_path: RELEASE_NOTES.md',
  '          body_path: dist/release/RELEASE_NOTES.md',
);

const PAGES_GOOD = `name: Website Deploy
on:
  push:
    branches: [master]
    paths:
      - 'apps/website/**'
      - 'scripts/release/fetch-website-release.mjs'
      - 'scripts/release/verify-release-data.mjs'
      - 'scripts/release/website-release-data.mjs'
      - 'scripts/release/product.mjs'
      - 'scripts/release/github-fetch.mjs'
  workflow_run:
    workflows: ['Release']
    types: [completed]
  workflow_dispatch:
permissions:
  contents: read
  pages: write
  id-token: write
concurrency:
  group: pages
  cancel-in-progress: false
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: pnpm install --frozen-lockfile
      - name: Build website
        run: pnpm --filter @varve/website build
      - name: Upload artifact
        uses: actions/upload-pages-artifact@56afc609e74202658d3ffba0e8f6dda462b719fa
        with:
          path: apps/website/dist
`;

const PAGES_ACTIONS_WRITE = PAGES_GOOD.replace(
  'id-token: write',
  'id-token: write\n  actions: write',
);

const PAGES_NO_RELEASE_TRIGGER = PAGES_GOOD.replace(
  `  workflow_run:
    workflows: ['Release']
    types: [completed]
`,
  '',
);

const PAGES_BAD_OUTPUT = PAGES_GOOD.replace('apps/website/dist', 'apps/website/src');

const PR_RELEASE_PUB = `name: CI
on:
  push:
  pull_request:
jobs:
  ship:
    runs-on: ubuntu-latest
    steps:
      - uses: softprops/action-gh-release@c95fe1489396fe8a9eb87c0abf8aa5b2ef267fda
`;

// ── release.yml gate ordering ────────────────────────────────────────────────
assert.deepEqual(
  validateVarveRules(RELEASE_GOOD, '.github/workflows/release.yml'),
  [],
  'frontend-before-desktop ordering passes',
);

{
  const errors = validateVarveRules(RELEASE_BAD_ORDER, '.github/workflows/release.yml');
  assert.ok(
    errors.some((e) => /desktop compilation must come AFTER the frontend build/.test(e)),
    'desktop compile before frontend build must be rejected',
  );
}

{
  const errors = validateVarveRules(RELEASE_NO_FRONTEND, '.github/workflows/release.yml');
  assert.ok(
    errors.some((e) => /missing "Build frontend"/.test(e)),
    'a gate job without the frontend build must be rejected',
  );
}

// ── release.yml draft glob rules ─────────────────────────────────────────────
assert.deepEqual(
  validateVarveRules(RELEASE_DRAFT_GOOD, '.github/workflows/release.yml'),
  [],
  'draft job with notes staged outside the glob passes',
);

{
  const errors = validateVarveRules(RELEASE_DRAFT_NEGATED, '.github/workflows/release.yml');
  assert.ok(
    errors.some((e) => /negated `files` pattern/.test(e)),
    'a negated files pattern in the draft job must be rejected',
  );
}

{
  const errors = validateVarveRules(
    RELEASE_DRAFT_NOTES_INSIDE_GLOB,
    '.github/workflows/release.yml',
  );
  assert.ok(
    errors.some((e) => /body_path must point at a RELEASE_NOTES.md outside/.test(e)),
    'a body_path inside the globbed directory must be rejected',
  );
}

// ── website-deploy.yml rules ─────────────────────────────────────────────────
assert.deepEqual(
  validateVarveRules(PAGES_GOOD, '.github/workflows/website-deploy.yml'),
  [],
  'hardened Pages workflow passes',
);

{
  const broadReleaseTrigger = PAGES_GOOD.replace(
    "      - 'scripts/release/fetch-website-release.mjs'",
    "      - 'scripts/release/**'",
  );
  const errors = validateVarveRules(broadReleaseTrigger, '.github/workflows/website-deploy.yml');
  assert.ok(
    errors.some((e) => /broad scripts\/release\/\*\* path trigger/.test(e)),
    'release verifier-only edits must not trigger the full website suite',
  );
}

{
  const missingReleaseGenerator = PAGES_GOOD.replace(
    "      - 'scripts/release/github-fetch.mjs'\n",
    '',
  );
  const errors = validateVarveRules(
    missingReleaseGenerator,
    '.github/workflows/website-deploy.yml',
  );
  assert.ok(
    errors.some((e) => /missing scripts\/release\/github-fetch\.mjs path trigger/.test(e)),
    'changes to any release website-data input must still redeploy the site',
  );
}

{
  const errors = validateVarveRules(PAGES_ACTIONS_WRITE, '.github/workflows/website-deploy.yml');
  assert.ok(
    errors.some((e) => /actions: write/.test(e)),
    'unnecessary actions:write must be rejected',
  );
}

{
  const errors = validateVarveRules(
    PAGES_NO_RELEASE_TRIGGER,
    '.github/workflows/website-deploy.yml',
  );
  assert.ok(
    errors.some((e) => /release: types: \[published\]/.test(e)),
    'a Pages workflow without the release.published trigger must be rejected',
  );
}

{
  const errors = validateVarveRules(PAGES_BAD_OUTPUT, '.github/workflows/website-deploy.yml');
  assert.ok(
    errors.some((e) => /does not look like a build output/.test(e)),
    'a Pages artifact path that is not a build output must be rejected',
  );
}

// ── release signing rules ───────────────────────────────────────────────────
const SIGNED_GOOD = `name: Release
on:
  push:
    tags: ['v*']
permissions:
  contents: read
jobs:
  preflight:
    runs-on: ubuntu-latest
    steps:
      - run: echo preflight
  signing-preflight:
    runs-on: ubuntu-latest
    needs: preflight
    steps:
      - run: node scripts/release/signing-policy.mjs
  gate:
    runs-on: ubuntu-latest
    needs: preflight
    steps:
      - name: Build frontend (required by tauri generate_context!)
        run: pnpm build
        working-directory: apps/desktop
      - name: cargo test (desktop)
        run: cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --features custom-protocol
  bundle:
    runs-on: ubuntu-latest
    needs: [preflight, gate, signing-preflight]
    steps:
      - name: Tauri build
        run: pnpm tauri build --bundles nsis --ci
      - name: Collect artifacts
        run: node scripts/release/collect-artifacts.mjs
      - name: Verify Windows signature
        run: powershell -File scripts/release/verify-windows-signature.ps1 -Path dist/release/x.exe
      - name: Verify macOS signature
        run: bash scripts/release/verify-macos-signature.sh --dmg dist/release/y.dmg
  verify:
    runs-on: ubuntu-latest
    needs: bundle
    permissions:
      contents: read
      id-token: write
      attestations: write
    steps:
      - run: node scripts/release/verify-release-trust.mjs --staged staged --out dist/release
      - name: Generate final SHA256SUMS.txt
        run: node scripts/release/generate-final-checksums.mjs --dir dist/release
      - name: Attest final bytes
        uses: actions/attest@1e69f48acb82d1966a394da916b4c1698aa569d6
        with:
          subject-path: dist/release/*
`;

assert.deepEqual(
  validateVarveRules(SIGNED_GOOD, '.github/workflows/release.yml'),
  [],
  'a fully wired signing workflow passes',
);

{
  const noPreflight = SIGNED_GOOD.replace(/^ {2}signing-preflight:[\s\S]*?^ {2}gate:/m, '  gate:');
  const errors = validateVarveRules(noPreflight, '.github/workflows/release.yml');
  assert.ok(
    errors.some((e) => /signing-preflight/.test(e) && /BEFORE/.test(e)),
    'missing signing-preflight job must be rejected',
  );
}

{
  const noDependency = SIGNED_GOOD.replace(
    'needs: [preflight, gate, signing-preflight]',
    'needs: [preflight, gate]',
  );
  const errors = validateVarveRules(noDependency, '.github/workflows/release.yml');
  assert.ok(
    errors.some((e) => /bundle job must depend on signing-preflight/.test(e)),
    'bundle without signing-preflight dependency must be rejected',
  );
}

{
  const noVerify = SIGNED_GOOD.replace(
    /^ {6}- name: Verify Windows signature[\s\S]*?verify-windows-signature\.ps1.*\n/m,
    '',
  ).replace(/^ {6}- name: Verify macOS signature[\s\S]*?verify-macos-signature\.sh.*\n/m, '');
  const errors = validateVarveRules(noVerify, '.github/workflows/release.yml');
  assert.ok(
    errors.some((e) => /verify-windows-signature\.ps1/.test(e)),
    'missing Windows signature verification must be rejected',
  );
  assert.ok(
    errors.some((e) => /verify-macos-signature\.sh/.test(e)),
    'missing macOS signature verification must be rejected',
  );
}

{
  const noTrust = SIGNED_GOOD.replace(/.*verify-release-trust\.mjs.*\n/, '');
  const errors = validateVarveRules(noTrust, '.github/workflows/release.yml');
  assert.ok(
    errors.some((e) => /missing verify-release-trust\.mjs/.test(e)),
    'missing trust gate must be rejected',
  );
}

{
  const checksumBeforeTrust = SIGNED_GOOD.replace(
    'node scripts/release/verify-release-trust.mjs --staged staged --out dist/release\n',
    'node scripts/release/generate-final-checksums.mjs --dir dist/release\n',
  ).replace(
    '      - name: Generate final SHA256SUMS.txt\n        run: node scripts/release/generate-final-checksums.mjs --dir dist/release\n',
    '      - name: Trust gate\n        run: node scripts/release/verify-release-trust.mjs --staged staged --out dist/release\n',
  );
  const errors = validateVarveRules(checksumBeforeTrust, '.github/workflows/release.yml');
  assert.ok(
    errors.some((e) =>
      /verify-release-trust\.mjs must run BEFORE generate-final-checksums/.test(e),
    ),
    'checksum-before-trust-gate ordering must be rejected',
  );
}

{
  const noAttest = SIGNED_GOOD.replace(/.*actions\/attest@.*\n/, '').replace(
    /.*subject-path:.*\n/,
    '',
  );
  const errors = validateVarveRules(noAttest, '.github/workflows/release.yml');
  assert.ok(
    errors.some((e) => /missing actions\/attest/.test(e)),
    'missing attestation must be rejected',
  );
}

{
  const noAttestPerm = SIGNED_GOOD.replace('  attestations: write\n', '');
  const errors = validateVarveRules(noAttestPerm, '.github/workflows/release.yml');
  assert.ok(
    errors.some((e) => /attestations: write/.test(e)),
    'missing attestations:write permission must be rejected',
  );
}

{
  const literalClaim = SIGNED_GOOD.replace(
    '      - run: node scripts/release/verify-release-trust.mjs --staged staged --out dist/release',
    '      - run: echo "signed=true"',
  );
  const errors = validateVarveRules(literalClaim, '.github/workflows/release.yml');
  assert.ok(
    errors.some((e) => /signed=true/.test(e) && /never from workflow text/.test(e)),
    'a literal signed=true claim must be rejected',
  );
}

// ── no release publication from PR contexts ──────────────────────────────────
{
  const errors = validateVarveRules(PR_RELEASE_PUB, '.github/workflows/ci.yml');
  assert.ok(
    errors.some((e) => /action-gh-release/.test(e)),
    'release publication from a PR-capable workflow must be rejected',
  );
}

// validateRepoInvariants: Git LFS regression guard
{
  const realErrors = validateRepoInvariants();
  assert.deepEqual(realErrors, [], `real repo invariants must pass: ${realErrors.join('; ')}`);
}

// .gitattributes: no Git LFS (free-tier budget exhausted; models on release assets)
{
  const fs = await import('node:fs');
  const attrs = fs.readFileSync('.gitattributes', 'utf8');
  assert.doesNotMatch(
    attrs,
    /filter=lfs/,
    '.gitattributes must not contain filter=lfs (use release assets for large models)',
  );
}

// The real files must pass — the rules must describe the repo as it is.
{
  const fs = await import('node:fs');
  const ci = fs.readFileSync('.github/workflows/ci.yml', 'utf-8');
  assert.match(
    ci,
    /if: \$\{\{ needs\.changes\.outputs\.e2e == 'true' \|\| needs\.changes\.outputs\.full == 'true' \}\}/,
    'browser E2E must be selected by explicit browser-impact lanes or the deliberate full profile',
  );
  assert.match(
    ci,
    /if: \$\{\{ needs\.changes\.outputs\.visual == 'true' \|\| needs\.changes\.outputs\.full == 'true' \}\}/,
    'visual E2E must be selected by explicit visual-impact lanes or the deliberate full profile',
  );
  assert.match(
    ci,
    /if: \$\{\{ needs\.changes\.outputs\.desktop == 'true' \|\| needs\.changes\.outputs\.full == 'true' \}\}/,
    'native desktop E2E must be selected by explicit desktop-impact lanes or the deliberate full profile',
  );
  assert.match(
    ci,
    /scripts\/quality\/ci-plan\.mjs[\s\S]*--profile integration/,
    'CI must use the canonical exact-SHA planner for browser-impact selection',
  );
  const onnxStage = ci.indexOf('node scripts/fetch-onnxruntime.mjs');
  const rustCoverage = ci.indexOf('node scripts/audit-rust-coverage.mjs --ci');
  assert.ok(
    onnxStage >= 0 && onnxStage < rustCoverage,
    'Rust coverage must stage the optional ONNX Runtime before Tauri build metadata is evaluated',
  );
  const policy = fs.readFileSync('scripts/quality/validation-policy.mjs', 'utf-8');
  assert.match(
    policy,
    /tests\\\/e2e|tests\/e2e/,
    'canonical policy must retain browser infrastructure impact semantics',
  );
  const release = fs.readFileSync('.github/workflows/release.yml', 'utf-8');
  assert.match(
    release,
    /squashfs-tools xdg-utils/,
    'Linux release bundlers must install xdg-utils for Tauri AppImage packaging',
  );
  const visual = fs.readFileSync('.github/workflows/visual-baselines.yml', 'utf-8');
  assert.match(
    visual,
    /contents: read/,
    'visual baseline workflow must not write repository contents',
  );
  assert.match(
    visual,
    /VARVE_REVIEWED/,
    'visual updates require an explicit review acknowledgement',
  );
  assert.match(
    visual,
    /VARVE_UPDATE_SNAPSHOTS.*true[\s\S]*--update-snapshots/,
    'snapshot updates require the explicit reviewed update mode',
  );
  assert.doesNotMatch(
    visual,
    /git\s+(?:commit|push)/,
    'baseline workflow must not publish changes',
  );
  const candidate = fs.readFileSync('.github/workflows/release-candidate.yml', 'utf-8');
  assert.match(
    candidate,
    /verify-candidate-integration\.mjs --plan ci-plan\.json/,
    'final candidate certification must adopt complete exact-SHA integration evidence',
  );
  for (const name of ['release.yml', 'website-deploy.yml', 'ci.yml', 'build.yml']) {
    const content = fs.readFileSync(`.github/workflows/${name}`, 'utf-8');
    assert.deepEqual(
      validateVarveRules(content, `.github/workflows/${name}`),
      [],
      `real ${name} must satisfy the Varve workflow rules`,
    );
  }
}

// Execute the actual baseline orchestration shell with inert launchers. These
// controls exercise both modes without launching a browser or changing PNGs.
{
  const fs = await import('node:fs');
  const { createRequire } = await import('node:module');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { pathToFileURL } = await import('node:url');
  const yaml = createRequire(import.meta.url)('js-yaml');
  const workflow = yaml.load(fs.readFileSync('.github/workflows/visual-baselines.yml', 'utf8'));
  const job = workflow.jobs.regenerate;
  const steps = job.steps;
  const checkout = steps.find((step) => step.uses?.startsWith('actions/checkout@'));
  assert.equal(checkout.with.ref, '$' + '{{ github.sha }}');
  assert.equal(checkout.with['persist-credentials'], false);
  const sourceGuard = steps.find(
    (step) => step.name === 'Verify immutable source and reviewed update identity',
  );
  const execute = steps.find((step) => step.name === 'Compare or update visual baselines');
  assert.ok(steps.indexOf(sourceGuard) < steps.indexOf(execute));
  const temporary = fs.mkdtempSync(join(tmpdir(), 'varve-baseline-workflow-'));
  const sourceSha = '1234567890abcdef1234567890abcdef12345678';
  try {
    const gitBash = join(temporary, 'Program Files', 'Git', 'bin', 'bash.exe');
    fs.mkdirSync(join(temporary, 'Program Files', 'Git', 'bin'), { recursive: true });
    fs.writeFileSync(gitBash, 'fixture');
    assert.equal(
      baselineBash('win32', { ProgramFiles: join(temporary, 'Program Files') }),
      gitBash,
    );
    const inertEnvironment = { ...process.env, VARVE_TEST_SOURCE_SHA: sourceSha };
    const direct = runInertBaselineShell(
      'set -euo pipefail; node wrapper.mjs "one two" "" --update-snapshots=none',
      inertEnvironment,
    );
    assert.equal(direct.status, 0, JSON.stringify(direct));
    assert.deepEqual(direct.argv, ['wrapper.mjs', 'one two', '', '--update-snapshots=none']);
    const bypass = runInertBaselineShell(
      'set -euo pipefail; pnpm exec playwright test',
      inertEnvironment,
    );
    assert.equal(bypass.status, 91, JSON.stringify(bypass));
    assert.deepEqual(bypass.argv, []);
    assert.match(bypass.stderr, /Unexpected unleased pnpm invocation/);
    function runBaselineMode(overrides = {}) {
      const environment = {
        ...process.env,
        VARVE_TEST_SOURCE_SHA: sourceSha,
        VARVE_EVENT_SHA: sourceSha,
        VARVE_REVIEWED_SHA: '',
        VARVE_REVIEWED: 'false',
        VARVE_UPDATE_SNAPSHOTS: 'false',
        VARVE_BASELINE_SCOPE: 'homepage',
        ...overrides,
      };
      const guard = runInertBaselineShell(sourceGuard.run, environment);
      if (guard.status !== 0) return { ...guard, phase: 'source guard' };
      return { ...runInertBaselineShell(execute.run, environment), phase: 'execution' };
    }
    const comparison = runBaselineMode();
    assert.equal(comparison.status, 0, JSON.stringify(comparison));
    assert.equal(comparison.argv[0], 'scripts/quality/heavy-lease.mjs');
    for (const flag of [
      '--workers=1',
      '--retries=0',
      '--forbid-only',
      '--fail-on-flaky-tests',
      '--trace=retain-on-failure',
      '--update-snapshots=none',
      '--global-timeout=1200000',
    ])
      assert.ok(comparison.argv.includes(flag), `baseline comparison must preserve ${flag}`);
    assert.ok(
      !comparison.argv.some(
        (argument) => argument === '--update-snapshots' || argument === '--ignore-snapshots',
      ),
    );
    const match = new RegExp(comparison.argv[comparison.argv.indexOf('--grep') + 1]);
    for (const title of [
      'homepage light',
      'homepage dark',
      'homepage mobile light',
      'homepage mobile dark',
      'hero light',
      'product showcase light',
    ])
      assert.ok(match.test(`visual.spec.ts ${title}`));
    assert.ok(
      !match.test('visual.spec.ts hero eyebrow stays contained across viewport sizes (light)'),
    );
    assert.ok(!match.test('visual.spec.ts download page dark'));
    const update = runBaselineMode({
      VARVE_UPDATE_SNAPSHOTS: 'true',
      VARVE_REVIEWED: 'true',
      VARVE_REVIEWED_SHA: sourceSha,
    });
    assert.equal(update.status, 0, JSON.stringify(update));
    assert.equal(update.argv[0], 'scripts/quality/heavy-lease.mjs');
    assert.ok(update.argv.includes('--update-snapshots=changed'));
    assert.ok(!update.argv.includes('--update-snapshots=all'));
    const unreviewed = runBaselineMode({ VARVE_UPDATE_SNAPSHOTS: 'true' });
    assert.notEqual(unreviewed.status, 0);
    assert.deepEqual(unreviewed.argv, []);
    const stale = runBaselineMode({
      VARVE_UPDATE_SNAPSHOTS: 'true',
      VARVE_REVIEWED: 'true',
      VARVE_REVIEWED_SHA: 'a'.repeat(40),
    });
    assert.notEqual(stale.status, 0);
    assert.deepEqual(stale.argv, []);
    assert.notEqual(runBaselineMode({ VARVE_TEST_SOURCE_SHA: 'b'.repeat(40) }).status, 0);
    assert.notEqual(runBaselineMode({ VARVE_BASELINE_SCOPE: 'unknown' }).status, 0);
    const all = runBaselineMode({ VARVE_BASELINE_SCOPE: 'all' });
    assert.equal(all.status, 0, JSON.stringify(all));
    assert.ok(!all.argv.includes('--grep'));
    const identity = steps.find(
      (step) => step.name === 'Record source and installed browser/font environment',
    );
    assert.match(identity.run, /sourceSha !== process\.env\.GITHUB_SHA/);
    assert.match(identity.run, /browserInstalls\.length !== 2/);
    assert.match(identity.run, /command\('fc-list'/);
    assert.match(identity.run, /sha256: await digest/);
    const outcome = steps.find(
      (step) => step.name === 'Retain baseline review outcome (never certification)',
    );
    assert.equal(outcome.if, 'always()');
    assert.match(outcome.run, /certified: false/);
    assert.match(outcome.run, /collectBrowserEvidence\([^\n]*\{ reviewOnly: true \}\)/);
    assert.match(outcome.run, /casesSha256/);
    const outcomeSource = outcome.run
      .split("<<'JS'\n")[1]
      .split('\nJS')[0]
      .replace(
        "'./scripts/quality/ci-execution-report.mjs'",
        JSON.stringify(
          pathToFileURL(join(process.cwd(), 'scripts/quality/ci-execution-report.mjs')).href,
        ),
      );
    const reportDirectory = join(temporary, 'reports/visual-baseline-review');
    fs.mkdirSync(reportDirectory, { recursive: true });
    fs.writeFileSync(join(reportDirectory, 'environment.json'), JSON.stringify({ sourceSha }));
    const caseTitles = [
      'homepage light',
      'homepage dark',
      'homepage mobile light',
      'homepage mobile dark',
      'hero light',
      'product showcase light',
    ];
    function retainedOutcome({ mode = 'none', mutate, missing = false } = {}) {
      const report = {
        config: {
          workers: 1,
          updateSnapshots: mode,
          failOnFlakyTests: true,
          argv: ['--trace=retain-on-failure'],
          projects: [{ name: 'ghpages', retries: 0 }],
        },
        errors: [],
        stats: { expected: 6, unexpected: 0, flaky: 0, skipped: 0 },
        suites: [
          {
            title: '',
            specs: caseTitles.map((title) => ({
              file: 'apps/website/tests/e2e/visual.spec.ts',
              title,
              tests: [
                {
                  projectName: 'ghpages',
                  expectedStatus: 'passed',
                  status: 'expected',
                  results: [{ retry: 0, status: 'passed', duration: 1 }],
                },
              ],
            })),
          },
        ],
      };
      mutate?.(report);
      const cases = join(reportDirectory, 'cases.json');
      if (missing) fs.rmSync(cases, { force: true });
      else fs.writeFileSync(cases, JSON.stringify(report));
      const result = spawnSync(process.execPath, ['--input-type=module', '-e', outcomeSource], {
        cwd: temporary,
        encoding: 'utf8',
        timeout: 5000,
        env: {
          ...process.env,
          VARVE_BASELINE_STATUS: 'success',
          VARVE_UPDATE_SNAPSHOTS: mode === 'changed' ? 'true' : 'false',
          VARVE_BASELINE_SCOPE: 'homepage',
        },
      });
      assert.equal(result.error, undefined);
      const receipt = JSON.parse(fs.readFileSync(join(reportDirectory, 'outcome.json'), 'utf8'));
      assert.equal(receipt.certified, false);
      assert.equal(receipt.reviewOnly, true);
      return { status: result.status, receipt };
    }
    for (const mode of ['none', 'changed']) {
      const valid = retainedOutcome({ mode });
      assert.equal(valid.status, 0);
      assert.deepEqual(valid.receipt.reviewErrors, []);
      assert.equal(valid.receipt.browserEvidence.reports[0].runner.updateSnapshots, mode);
      assert.equal(valid.receipt.browserEvidence.reviewOnly, true);
      assert.equal(valid.receipt.browserEvidence.certified, false);
      assert.ok(
        browserEvidenceErrors(valid.receipt.browserEvidence, ['website-e2e']).includes(
          'review-only browser evidence cannot certify',
        ),
        'even a passing comparison is selected review evidence, never certification',
      );
    }
    const absent = retainedOutcome({ missing: true });
    assert.notEqual(absent.status, 0);
    assert.ok(absent.receipt.reviewErrors.includes('missing browser report'));
    const flaky = retainedOutcome({
      mutate(report) {
        report.stats.expected = 5;
        report.stats.flaky = 1;
        report.suites[0].specs[0].tests[0].status = 'flaky';
        report.suites[0].specs[0].tests[0].results.push({
          retry: 1,
          status: 'passed',
          duration: 1,
        });
      },
    });
    assert.notEqual(flaky.status, 0);
    assert.ok(flaky.receipt.reviewErrors.includes('invalid or retried case attempt'));
    const skipped = retainedOutcome({
      mutate(report) {
        report.stats.expected = 5;
        report.stats.skipped = 1;
        report.suites[0].specs[0].tests[0].status = 'skipped';
        report.suites[0].specs[0].tests[0].results = [];
      },
    });
    assert.notEqual(skipped.status, 0);
    assert.ok(
      skipped.receipt.reviewErrors.includes('baseline capture did not pass every selected case'),
    );
    const drift = retainedOutcome({
      mutate(report) {
        report.config.workers = 2;
      },
    });
    assert.notEqual(drift.status, 0);
    assert.ok(drift.receipt.reviewErrors.includes('browser execution policy drift'));
    const upload = steps.find((step) => step.uses?.startsWith('actions/upload-artifact@'));
    assert.equal(upload.if, 'always()');
    assert.ok(upload.with.path.includes('reports/visual-baseline-review/'));
    assert.ok(upload.with.name.includes('$' + '{{ github.sha }}'));
    assert.ok(upload.with.name.includes('$' + '{{ github.run_attempt }}'));
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

// Application review stays in the existing single baseline job/queue. Resolve
// the actual inline selector and exercise shell argv with inert launchers.
{
  const fs = await import('node:fs');
  const { createRequire } = await import('node:module');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const yaml = createRequire(import.meta.url)('js-yaml');
  const workflow = yaml.load(fs.readFileSync('.github/workflows/visual-baselines.yml', 'utf8'));
  const inputs = workflow.on.workflow_dispatch.inputs;
  assert.equal(inputs.target.default, 'website');
  assert.deepEqual(inputs.target.options, ['website', 'app-replay', 'app-ui']);
  assert.equal(Object.keys(workflow.jobs).length, 1);
  assert.equal(workflow.concurrency.group, 'visual-baselines');
  const steps = workflow.jobs.regenerate.steps;
  const resolveCase = steps.find(
    (step) => step.name === 'Resolve one explicit application baseline case',
  );
  const execute = steps.find(
    (step) => step.name === 'Compare or update one application baseline case',
  );
  const sourceGuard = steps.find(
    (step) => step.name === 'Verify immutable source and reviewed update identity',
  );
  const outcome = steps.find(
    (step) => step.name === 'Retain baseline review outcome (never certification)',
  );
  const temporary = fs.mkdtempSync(join(tmpdir(), 'varve-app-baseline-workflow-'));
  const directory = join(temporary, 'reports');
  const nodeSource = resolveCase.run
    .split("<<'JS'\n")[1]
    .split('\nJS')[0]
    .replaceAll('reports/visual-baseline-review', directory.replaceAll('\\', '/'));
  const sourceSha = '1234567890abcdef1234567890abcdef12345678';
  const envPath = join(temporary, 'environment.txt');
  const outputPath = join(temporary, 'outputs.txt');
  try {
    const selections = [];
    function selection(target, caseName) {
      fs.writeFileSync(envPath, '');
      fs.writeFileSync(outputPath, '');
      const result = spawnSync(process.execPath, ['--input-type=module', '-e', nodeSource], {
        encoding: 'utf8',
        timeout: 5000,
        env: {
          ...process.env,
          GITHUB_SHA: sourceSha,
          GITHUB_ENV: envPath,
          GITHUB_OUTPUT: outputPath,
          VARVE_BASELINE_TARGET: target,
          VARVE_BASELINE_APP_CASE: caseName,
        },
      });
      if (result.status !== 0) return { status: result.status };
      const plan = JSON.parse(fs.readFileSync(join(directory, 'selection.json'), 'utf8'));
      const environment = Object.fromEntries(
        fs
          .readFileSync(envPath, 'utf8')
          .trim()
          .split('\n')
          .map((line) => {
            const index = line.indexOf('=');
            return [line.slice(0, index), line.slice(index + 1)];
          }),
      );
      return {
        status: result.status,
        plan,
        environment,
        output: fs.readFileSync(outputPath, 'utf8'),
      };
    }
    for (const caseName of inputs.app_case.options) {
      const target = caseName === 'multilingual-text' ? 'app-replay' : 'app-ui';
      const result = selection(target, caseName);
      assert.equal(result.status, 0, `actual selector must resolve ${caseName}`);
      assert.equal(result.plan.caseName, caseName);
      assert.equal(result.plan.sourceSha, sourceSha);
      assert.equal(result.plan.expectedCases, target === 'app-replay' ? 3 : 1);
      assert.equal(
        result.environment.VARVE_VISUAL_HARNESS_ONLY,
        target === 'app-replay' ? '1' : '0',
      );
      assert.ok(new RegExp(result.plan.grep).test(result.plan.title));
      assert.ok(!new RegExp(result.plan.grep).test(`${result.plan.title} extra case`));
      for (const snapshot of result.plan.originalSnapshots) {
        assert.match(snapshot.sha256, /^[a-f0-9]{64}$/);
        assert.ok(snapshot.path.startsWith(`${result.plan.spec}-snapshots/`));
        assert.ok(
          !snapshot.path.includes('gpu') &&
            !snapshot.path.includes('firefox') &&
            !snapshot.path.includes('webkit'),
        );
        assert.ok(result.output.includes(snapshot.path));
      }
      assert.deepEqual(
        result.plan.projects,
        target === 'app-replay'
          ? ['chromium-visual-1x', 'chromium-visual-2x', 'chromium-visual-3x']
          : ['chromium'],
      );
      selections.push(result);
    }
    assert.equal(selections.length, 21);
    assert.equal(
      selections.find((entry) => entry.plan.caseName === 'nested-groups-isolated-opacity').plan
        .originalSnapshots.length,
      2,
    );
    for (const [target, caseName] of [
      ['app-ui', 'multilingual-text'],
      ['app-replay', 'document-settings'],
      ['app-ui', 'all'],
      ['app-ui', '.*'],
      ['unknown', 'multilingual-text'],
    ])
      assert.notEqual(selection(target, caseName).status, 0);
    function capture(plan, overrides = {}) {
      const environment = {
        ...process.env,
        ...plan.environment,
        VARVE_TEST_SOURCE_SHA: sourceSha,
        VARVE_EVENT_SHA: sourceSha,
        VARVE_REVIEWED_SHA: '',
        VARVE_REVIEWED_CASE: '',
        VARVE_REVIEWED: 'false',
        VARVE_UPDATE_SNAPSHOTS: 'false',
        VARVE_WASM_RUN_ID: '101',
        VARVE_WASM_ARTIFACT_ID: '202',
        VARVE_BASELINE_TARGET: plan.plan.target,
        VARVE_BASELINE_APP_CASE: plan.plan.caseName,
        ...overrides,
      };
      const guard = runInertBaselineShell(sourceGuard.run, environment);
      if (guard.status !== 0) return { ...guard, phase: 'source guard' };
      return { ...runInertBaselineShell(execute.run, environment), phase: 'execution' };
    }
    for (const selected of [
      selections[0],
      selections.find((entry) => entry.plan.caseName === 'enhance-dialog-default'),
    ]) {
      const comparison = capture(selected);
      assert.equal(comparison.status, 0, JSON.stringify(comparison));
      assert.equal(comparison.argv[0], 'scripts/quality/heavy-lease.mjs');
      assert.ok(comparison.argv.includes(selected.plan.spec));
      assert.equal(comparison.argv[comparison.argv.indexOf('--grep') + 1], selected.plan.grep);
      for (const flag of [
        '--workers=1',
        '--retries=0',
        '--forbid-only',
        '--fail-on-flaky-tests',
        '--trace=retain-on-failure',
        '--update-snapshots=none',
      ])
        assert.ok(comparison.argv.includes(flag));
      assert.deepEqual(
        comparison.argv.filter((arg) => arg.startsWith('--project=')),
        selected.plan.projects.map((project) => `--project=${project}`),
      );
      assert.notEqual(
        capture(selected, {
          VARVE_UPDATE_SNAPSHOTS: 'true',
          VARVE_REVIEWED: 'true',
          VARVE_REVIEWED_SHA: sourceSha,
          VARVE_REVIEWED_CASE: 'different-owner',
        }).status,
        0,
      );
      const update = capture(selected, {
        VARVE_UPDATE_SNAPSHOTS: 'true',
        VARVE_REVIEWED: 'true',
        VARVE_REVIEWED_SHA: sourceSha,
        VARVE_REVIEWED_CASE: selected.plan.caseName,
      });
      assert.equal(update.status, 0, JSON.stringify(update));
      assert.ok(update.argv.includes('--update-snapshots=changed'));
      assert.ok(!update.argv.includes('--update-snapshots=all'));
    }
    const outcomeSource = outcome.run
      .split("<<'JS'\n")[1]
      .split('\nJS')[0]
      .replace(
        "const directory = 'reports/visual-baseline-review';",
        `const directory = ${JSON.stringify(directory)};`,
      )
      .replaceAll(
        "execFileSync('git', [",
        `execFileSync(process.execPath, [${JSON.stringify(join(temporary, 'git-fixture.mjs'))}, `,
      );
    fs.writeFileSync(join(directory, 'environment.json'), JSON.stringify({ sourceSha }));
    fs.writeFileSync(
      join(temporary, 'git-fixture.mjs'),
      `const kind = process.argv[2];
const value = kind === 'diff' ? process.env.VARVE_TEST_CHANGED_FILE : process.env.VARVE_TEST_UNTRACKED_FILE;
if (!['diff', 'ls-files'].includes(kind)) throw new Error('Unexpected Git fixture command');
if (value) process.stdout.write(value + '\\0');\n`,
    );
    function appOutcome(
      selected,
      { mode = 'none', mutate, changedFile = '', untrackedFile = '' } = {},
    ) {
      fs.writeFileSync(join(directory, 'selection.json'), JSON.stringify(selected.plan));
      const report = {
        config: {
          workers: 1,
          updateSnapshots: mode,
          failOnFlakyTests: true,
          argv: ['--trace=retain-on-failure'],
          projects: selected.plan.projects.map((name) => ({ name, retries: 0 })),
        },
        errors: [],
        stats: { expected: selected.plan.expectedCases, unexpected: 0, flaky: 0, skipped: 0 },
        suites: [
          {
            title: '',
            specs: [
              {
                file: selected.plan.spec.replace('tests/e2e/', ''),
                title: selected.plan.title,
                tests: selected.plan.projects.map((projectName) => ({
                  projectName,
                  expectedStatus: 'passed',
                  status: 'expected',
                  results: [{ retry: 0, status: 'passed', duration: 1 }],
                })),
              },
            ],
          },
        ],
      };
      mutate?.(report);
      fs.writeFileSync(join(directory, 'cases.json'), JSON.stringify(report));
      const result = spawnSync(process.execPath, ['--input-type=module', '-e', outcomeSource], {
        encoding: 'utf8',
        timeout: 5000,
        env: {
          ...process.env,
          GITHUB_SHA: sourceSha,
          VARVE_BASELINE_TARGET: selected.plan.target,
          VARVE_BASELINE_APP_CASE: selected.plan.caseName,
          VARVE_BASELINE_STATUS: 'success',
          VARVE_UPDATE_SNAPSHOTS: mode === 'changed' ? 'true' : 'false',
          VARVE_TEST_CHANGED_FILE: changedFile,
          VARVE_TEST_UNTRACKED_FILE: untrackedFile,
        },
      });
      assert.equal(result.error, undefined);
      const receipt = JSON.parse(fs.readFileSync(join(directory, 'outcome.json'), 'utf8'));
      assert.equal(receipt.certified, false);
      assert.equal(receipt.reviewOnly, true);
      return { status: result.status, receipt };
    }
    for (const selected of [
      selections[0],
      selections.find((entry) => entry.plan.caseName === 'enhance-dialog-default'),
    ]) {
      for (const mode of ['none', 'changed']) {
        const valid = appOutcome(selected, { mode });
        assert.equal(valid.status, 0);
        assert.deepEqual(valid.receipt.reviewErrors, []);
        assert.equal(valid.receipt.snapshotFiles.length, selected.plan.originalSnapshots.length);
        assert.equal(valid.receipt.browserEvidence.reports[0].runner.updateSnapshots, mode);
        assert.equal(valid.receipt.browserEvidence.reviewOnly, true);
        assert.equal(valid.receipt.browserEvidence.certified, false);
        assert.ok(
          browserEvidenceErrors(valid.receipt.browserEvidence, ['e2e:visual-review']).includes(
            'review-only browser evidence cannot certify',
          ),
          'application comparison/update review cannot certify a browser lane',
        );
      }
      const wrongCase = appOutcome(selected, {
        mutate(report) {
          report.suites[0].specs[0].title += ' extra';
        },
      });
      assert.notEqual(wrongCase.status, 0);
      assert.ok(
        wrongCase.receipt.reviewErrors.includes('application case or project selection drift'),
      );
      const gpu = appOutcome(selected, {
        mutate(report) {
          report.suites[0].specs[0].tests[0].projectName = 'chromium-visual-gpu';
        },
      });
      assert.notEqual(gpu.status, 0);
      assert.ok(gpu.receipt.reviewErrors.includes('application case or project selection drift'));
      const changed = appOutcome(selected, {
        mode: 'changed',
        changedFile: 'packages/editor/src/CanvasArea.tsx',
      });
      assert.notEqual(changed.status, 0);
      assert.ok(
        changed.receipt.reviewErrors.includes(
          'application run changed source or an unselected baseline',
        ),
      );
      const newPng = appOutcome(selected, {
        mode: 'changed',
        untrackedFile: 'tests/e2e/visual/replay.spec.ts-snapshots/unreviewed-gpu-linux.png',
      });
      assert.notEqual(newPng.status, 0);
      assert.ok(
        newPng.receipt.reviewErrors.includes(
          'application run changed source or an unselected baseline',
        ),
      );
      const compareWrite = appOutcome(selected, {
        changedFile: selected.plan.originalSnapshots[0].path,
      });
      assert.notEqual(compareWrite.status, 0);
      assert.ok(
        compareWrite.receipt.reviewErrors.includes(
          'application run changed source or an unselected baseline',
        ),
      );
    }
    const wasmStep = steps.find((step) => step.name === 'Verify reused application WASM producer');
    const wasmSource = wasmStep.run
      .split("<<'JS'\n")[1]
      .split('\nJS')[0]
      .replaceAll('reports/visual-baseline-review', directory.replaceAll('\\', '/'));
    const download = steps.find((step) => step.name === 'Reuse verified application WASM artifact');
    assert.ok(download.uses.startsWith('actions/download-artifact@'));
    assert.ok(download.with['artifact-ids'].includes('steps.wasm-source.outputs.artifact_id'));
    const fixtureValue = 'fixture-access';
    function reusedWasm(mutate) {
      fs.rmSync(join(directory, 'wasm-source.json'), { force: true });
      const fixture = {
        run: {
          id: 101,
          head_sha: sourceSha,
          head_repository: { full_name: 'K-Arthur/varve' },
          path: '.github/workflows/ci.yml',
          run_attempt: 2,
        },
        artifact: {
          id: 202,
          name: 'varve-wasm-101-attempt-1',
          expired: false,
          expires_at: new Date(Date.now() + 3600000).toISOString(),
          digest: `sha256:${'a'.repeat(64)}`,
          workflow_run: { id: 101, head_sha: sourceSha },
        },
        jobs: [
          {
            id: 301,
            name: 'WASM',
            run_id: 101,
            head_sha: sourceSha,
            run_attempt: 1,
            status: 'completed',
            conclusion: 'success',
          },
          {
            id: 302,
            name: 'E2E',
            run_id: 101,
            head_sha: sourceSha,
            run_attempt: 2,
            status: 'completed',
            conclusion: 'failure',
          },
        ],
      };
      mutate?.(fixture);
      const mocked = `const fixture = ${JSON.stringify(fixture)}; globalThis.fetch = async (url) => ({ ok: true, json: async () => String(url).includes('/jobs?') ? { jobs: fixture.jobs } : String(url).includes('/artifacts/') ? fixture.artifact : fixture.run });\n${wasmSource}`;
      const result = spawnSync(process.execPath, ['--input-type=module', '-e', mocked], {
        encoding: 'utf8',
        timeout: 5000,
        env: {
          ...process.env,
          GITHUB_SHA: sourceSha,
          GITHUB_REPOSITORY: 'K-Arthur/varve',
          GITHUB_TOKEN: fixtureValue,
          GITHUB_OUTPUT: outputPath,
          VARVE_WASM_RUN_ID: '101',
          VARVE_WASM_ARTIFACT_ID: '202',
        },
      });
      assert.equal(result.error, undefined);
      return {
        status: result.status,
        receipt: fs.existsSync(join(directory, 'wasm-source.json'))
          ? JSON.parse(fs.readFileSync(join(directory, 'wasm-source.json'), 'utf8'))
          : null,
      };
    }
    const unchangedProducer = reusedWasm();
    assert.equal(
      unchangedProducer.status,
      0,
      'failed-only E2E rerun retains the untouched same-source WASM producer',
    );
    assert.equal(unchangedProducer.receipt.producerAttempt, 1);
    assert.equal(unchangedProducer.receipt.certified, false);
    for (const mutate of [
      (fixture) => {
        fixture.run.head_sha = 'b'.repeat(40);
      },
      (fixture) => {
        fixture.run.head_repository.full_name = 'other/varve';
      },
      (fixture) => {
        fixture.run.path = '.github/workflows/unknown.yml';
      },
      (fixture) => {
        fixture.jobs.push({ ...fixture.jobs[0], id: 303, run_attempt: 2, conclusion: 'failure' });
      },
      (fixture) => {
        fixture.jobs.push({ ...fixture.jobs[0], id: 303, run_attempt: 3 });
      },
      (fixture) => {
        fixture.artifact.expired = true;
      },
      (fixture) => {
        fixture.artifact.workflow_run.head_sha = 'b'.repeat(40);
      },
      (fixture) => {
        fixture.artifact.name = 'varve-wasm-101-attempt-2';
      },
      (fixture) => {
        fixture.artifact.digest = null;
      },
    ]) {
      const invalid = reusedWasm(mutate);
      assert.notEqual(invalid.status, 0);
      assert.equal(invalid.receipt, null);
    }
    const uiOwner = selections.find((entry) => entry.plan.target === 'app-ui');
    assert.notEqual(
      capture(uiOwner, { VARVE_WASM_RUN_ID: '', VARVE_WASM_ARTIFACT_ID: '' }).status,
      0,
    );
    const upload = steps.find((step) => step.uses?.startsWith('actions/upload-artifact@'));
    assert.ok(upload.with.path.includes('steps.app-case.outputs.artifact_paths'));
    assert.ok(!upload.with.path.includes('tests/e2e/visual/replay.spec.ts-snapshots/'));
    assert.match(outcome.run, /application case or project selection drift/);
    assert.match(outcome.run, /application run changed source or an unselected baseline/);
    assert.match(outcome.run, /originalSha256/);
    assert.match(outcome.run, /certified: false/);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

process.stdout.write('validate-workflows.test.mjs: all assertions passed\n');
