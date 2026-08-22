#!/usr/bin/env node
/**
 * Unit tests for the Varve workflow regression guards
 * (scripts/validate-workflows.mjs validateVarveRules).
 *
 * Run: node scripts/validate-workflows.test.mjs
 * Wired into the regression suite (pnpm test:ci:tools + CI pipeline-validation).
 */
import assert from 'node:assert/strict';
import {
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
      - 'scripts/release/**'
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
    /if: \$\{\{ needs\.changes\.outputs\.e2e == 'true' \|\| needs\.changes\.outputs\.visual == 'true' \}\}/,
    'browser E2E must be selected by explicit browser-impact lanes, not generic full validation',
  );
  assert.match(
    ci,
    /if: \$\{\{ needs\.changes\.outputs\.desktop == 'true' \}\}/,
    'native desktop E2E must be selected by explicit desktop-impact lanes, not generic full validation',
  );
  assert.match(
    ci,
    /tests\/e2e\/\(canvas\|settings[\s\S]*shared\|helpers\|fixtures\)[\s\S]*playwright\\\.config\\\.ts/,
    'browser infrastructure paths must select the browser lane',
  );
  const release = fs.readFileSync('.github/workflows/release.yml', 'utf-8');
  assert.match(
    release,
    /squashfs-tools xdg-utils/,
    'Linux release bundlers must install xdg-utils for Tauri AppImage packaging',
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

process.stdout.write('validate-workflows.test.mjs: all assertions passed\n');
