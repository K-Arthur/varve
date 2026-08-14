#!/usr/bin/env node

/**
 * Import-boundary regression tests.
 *
 * Synthetic source files exercise every boundary rule with fake paths and
 * specifiers (no real imports are ever made — the audit only parses text).
 * auditWorkspaceDeps runs against a temp fixture tree so package.json
 * dependency edges are covered without touching the real manifests, and the
 * real repository is audited at the end as a live regression pass.
 */

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { auditFile, auditRepo, auditWorkspaceDeps } from './import-boundaries.mjs';

function expectFileViolation(text, path, fragment) {
  const violations = auditFile(text, path);
  assert.ok(
    violations.some((v) => v.includes(fragment)),
    `expected a violation containing "${fragment}", got: ${JSON.stringify(violations, null, 2)}`,
  );
}

function expectFileClean(text, path) {
  assert.deepEqual(
    auditFile(text, path),
    [],
    `expected no violations, got: ${JSON.stringify(auditFile(text, path), null, 2)}`,
  );
}

const WEBSITE_FILE = 'apps/website/src/pages/index.astro.ts';
const DESKTOP_FILE = 'apps/desktop/src/main.ts';

function testWebsiteCannotImportDesktop() {
  expectFileViolation(
    "import { x } from '@varve/desktop';",
    WEBSITE_FILE,
    "must not import another application's internals",
  );
}

function testWebsiteCannotImportDesktopRelative() {
  expectFileViolation(
    "import { x } from '../../../desktop/src/main';",
    WEBSITE_FILE,
    "must not import another application's internals",
  );
}

function testDesktopCannotImportWebsite() {
  expectFileViolation(
    "import { x } from '@varve/website';",
    DESKTOP_FILE,
    "must not import another application's internals",
  );
}

function testPackageCannotImportApp() {
  expectFileViolation(
    "import { x } from '@varve/desktop';",
    'packages/shared/src/index.ts',
    'packages must never import from apps',
  );
}

function testClientCannotImportFutureBackend() {
  expectFileViolation(
    "import { api } from 'apps/api/src/server';",
    DESKTOP_FILE,
    'future backend location (apps/api/src/server) is reserved',
  );
  expectFileViolation(
    "import { api } from 'services/api/server';",
    WEBSITE_FILE,
    'future backend location (services/api/server) is reserved',
  );
}

function testCannotImportTauriSurface() {
  // The Rust crate under apps/desktop/src-tauri is never importable from TS
  // (the published @tauri-apps/api package is the legitimate bridge).
  expectFileViolation(
    "import { x } from '../src-tauri/src/lib';",
    DESKTOP_FILE,
    'Rust/Tauri surface must never be imported from TypeScript',
  );
}

function testValidImportsClean() {
  expectFileClean(
    `import { z } from 'zod';
import { Icon } from '@varve/ui';
import { debounce } from '@varve/shared';
import { helper } from './local-helper';
import type { Node } from '@varve/scene';
import fs from 'node:fs';
const req = require('@varve/platform');`,
    WEBSITE_FILE,
  );
  expectFileClean(
    `import { EditorProvider } from '@varve/editor';
import { Icon } from '@varve/ui';
import { helper } from '../src/util';`,
    DESKTOP_FILE,
  );
  expectFileClean(
    `import { sharedThing } from '@varve/shared';
import { tokens } from '@varve/ui';`,
    'packages/shared/src/index.ts',
  );
}

function testPackageJsonDependencyEdge() {
  const root = mkdtempSync(join(tmpdir(), 'varve-import-boundaries-'));
  try {
    mkdirSync(join(root, 'apps/website'), { recursive: true });
    mkdirSync(join(root, 'apps/desktop'), { recursive: true });
    mkdirSync(join(root, 'packages/shared'), { recursive: true });
    writeFileSync(
      join(root, 'apps/website/package.json'),
      JSON.stringify({ name: '@varve/website', dependencies: { '@varve/desktop': 'workspace:*' } }),
    );
    writeFileSync(
      join(root, 'apps/desktop/package.json'),
      JSON.stringify({ name: '@varve/desktop', dependencies: {} }),
    );
    writeFileSync(
      join(root, 'packages/shared/package.json'),
      JSON.stringify({ name: '@varve/shared', dependencies: { '@varve/website': 'workspace:*' } }),
    );
    const violations = auditWorkspaceDeps(root);
    assert.ok(
      violations.some((v) => v.includes('apps/website/package.json depends on @varve/desktop')),
      `expected website→desktop dep violation, got: ${JSON.stringify(violations, null, 2)}`,
    );
    assert.ok(
      violations.some((v) => v.includes('packages/shared/package.json depends on @varve/website')),
      `expected package→app dep violation, got: ${JSON.stringify(violations, null, 2)}`,
    );
  } finally {
    // Cleanup happens on the next tempdir sweep; leaving files is harmless
    // (they live in the OS temp dir, not the repository).
  }
}

function testRealRepositoryPasses() {
  const violations = auditRepo();
  assert.deepEqual(
    violations,
    [],
    `real repository violates import boundaries: ${JSON.stringify(violations, null, 2)}`,
  );
}

testWebsiteCannotImportDesktop();
testWebsiteCannotImportDesktopRelative();
testDesktopCannotImportWebsite();
testPackageCannotImportApp();
testClientCannotImportFutureBackend();
testCannotImportTauriSurface();
testValidImportsClean();
testPackageJsonDependencyEdge();
testRealRepositoryPasses();

console.log('import-boundaries tests passed (9 scenarios).');
