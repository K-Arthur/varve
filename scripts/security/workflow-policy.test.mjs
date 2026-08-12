#!/usr/bin/env node

/**
 * Workflow security-policy regression tests.
 *
 * Synthetic YAML fixtures exercise every rule in workflow-policy.mjs with
 * unmistakably fake secret names (e.g. secrets.FAKE_SIGNING_KEY — no real
 * GitHub secret name can be created containing the word FAKE by convention,
 * and the values are never interpolated). The audit also runs against the
 * real workflow files so a security invariant cannot regress silently.
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { auditWorkflowYaml } from './workflow-policy.mjs';

const WF_DIR = join(process.cwd(), '.github/workflows');

function yaml(text) {
  return auditWorkflowYaml(text, 'fixture.yml');
}

function yamlRelease(text) {
  return auditWorkflowYaml(text, 'release.yml');
}

function yamlWebsite(text) {
  return auditWorkflowYaml(text, 'website-deploy.yml');
}

function expectViolation(text, fragment) {
  const violations = yaml(text);
  assert.ok(
    violations.some((v) => v.includes(fragment)),
    `expected a violation containing "${fragment}", got: ${JSON.stringify(violations, null, 2)}`,
  );
}

function expectCleanAudit(violations) {
  assert.deepEqual(
    violations,
    [],
    `expected no violations, got: ${JSON.stringify(violations, null, 2)}`,
  );
}

const BASE = `name: Fixture
on:
  push:
    branches: [master]
permissions:
  contents: read
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10
`;

function testPullRequestTargetRejected() {
  const text = BASE.replace('on:\n  push:', 'on:\n  pull_request_target:');
  expectViolation(text, 'pull_request_target');
}

function testSecretsInheritRejected() {
  const text = BASE.replace(
    '      - uses: actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10',
    '      - uses: fake/action@0000000000000000000000000000000000000000\n        secrets: inherit',
  );
  expectViolation(text, 'secrets: inherit');
}

function testSigningSecretOutsideReleaseRejected() {
  const text = BASE.replace(
    '    steps:\n      - uses:',
    `    steps:\n      - name: Sign\n        run: echo
        env:
          P12: \${{ secrets.APPLE_CERTIFICATE }}
      - uses:`,
  );
  expectViolation(text, 'references production signing secrets');
}

function testSigningSecretInPrWorkflowRejected() {
  const text = BASE.replace('on:\n  push:', 'on:\n  pull_request:\n  push:').replace(
    '    steps:\n      - uses:',
    `    steps:\n      - name: Deploy\n        run: echo
        env:
          TOKEN: \${{ secrets.AZURE_SIGNING_CLIENT_SECRET }}
      - uses:`,
  );
  expectViolation(text, 'forked code must never see repo secrets');
}

function testSigningSecretUngatedInReleaseRejected() {
  const text = `name: Release
on:
  push:
    tags: ['v[0-9]+.[0-9]+.[0-9]+']
permissions:
  contents: read
jobs:
  bundle:
    runs-on: ubuntu-latest
    steps:
      - name: Tauri build
        env:
          P12: \${{ secrets.APPLE_CERTIFICATE }}
        run: pnpm tauri build
`;
  const violations = yamlRelease(text);
  assert.ok(
    violations.some((v) => v.includes('without a signed-mode gate')),
    `expected signed-mode gate violation, got: ${JSON.stringify(violations, null, 2)}`,
  );
}

function testSigningEnvPersistRejected() {
  const text = `name: Release
on:
  push:
    tags: ['v[0-9]+.[0-9]+.[0-9]+']
permissions:
  contents: read
jobs:
  bundle:
    runs-on: ubuntu-latest
    env:
      P12: \${{ secrets.APPLE_CERTIFICATE }}
    steps:
      - name: Export
        if: needs.signing-preflight.outputs.macos_mode == 'signed'
        env:
          P12: \${{ secrets.APPLE_CERTIFICATE }}
        run: echo "APPLE_CERTIFICATE=\${P12}" >> "$GITHUB_ENV"
`;
  const violations = yamlRelease(text);
  assert.ok(
    violations.some((v) => v.includes('writes signing material to $GITHUB_ENV')),
    `expected GITHUB_ENV violation, got: ${JSON.stringify(violations, null, 2)}`,
  );
}

function testIdTokenOutsideWhitelistRejected() {
  const text = BASE.replace(
    'permissions:\n  contents: read',
    'permissions:\n  contents: read\n  id-token: write',
  );
  expectViolation(text, 'id-token: write without a whitelisted need');
}

function testAttestationsOutsideVerifyRejected() {
  const text = BASE.replace(
    'permissions:\n  contents: read',
    'permissions:\n  contents: read\n  attestations: write',
  );
  expectViolation(text, 'attestations: write outside the release verify job');
}

function testContentsWriteOutsideWhitelistRejected() {
  const text = BASE.replace('permissions:\n  contents: read', 'permissions:\n  contents: write');
  expectViolation(text, 'grants contents: write');
}

function testActionsWriteRejected() {
  const text = BASE.replace(
    'permissions:\n  contents: read',
    'permissions:\n  contents: read\n  actions: write',
  );
  expectViolation(text, 'actions: write');
}

function testPagesWriteOutsideDeployRejected() {
  const text = BASE.replace(
    'permissions:\n  contents: read',
    'permissions:\n  contents: read\n  pages: write',
  );
  expectViolation(text, 'pages: write outside the website deploy job');
}

function testPublishEnvironmentAndGateRequired() {
  const text = `name: Release
on:
  workflow_dispatch:
    inputs:
      publish:
        default: 'no'
permissions:
  contents: read
jobs:
  publish:
    if: github.event_name == 'workflow_dispatch' && github.event.inputs.publish == 'yes'
    runs-on: ubuntu-latest
    steps:
      - run: gh release edit v0.1.0 --draft=false
`;
  const violations = yamlRelease(text);
  assert.ok(
    violations.some((v) => v.includes('publish job must declare environment: release-publish')),
    `expected environment violation, got: ${JSON.stringify(violations, null, 2)}`,
  );
}

function testPublishGateMissingRejected() {
  const text = `name: Release
on:
  workflow_dispatch:
permissions:
  contents: read
jobs:
  publish:
    environment:
      name: release-publish
    runs-on: ubuntu-latest
    steps:
      - run: gh release edit v0.1.0 --draft=false
`;
  const violations = yamlRelease(text);
  assert.ok(
    violations.some((v) => v.includes("publish == 'yes'")),
    `expected publish gate violation, got: ${JSON.stringify(violations, null, 2)}`,
  );
}

function testTagProvenanceGateRequired() {
  const text = `name: Release
on:
  push:
    tags: ['v[0-9]+.[0-9]+.[0-9]+']
permissions:
  contents: read
jobs:
  preflight:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10
`;
  const violations = yamlRelease(text);
  assert.ok(
    violations.some((v) => v.includes('merge-base --is-ancestor')),
    `expected tag provenance violation, got: ${JSON.stringify(violations, null, 2)}`,
  );
}

function testMissingPermissionsBlockRejected() {
  const text = `name: Fixture
on:
  push:
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: echo
`;
  expectViolation(text, 'no permissions block');
}

function testWebsiteCheckoutPersistCredentialsRejected() {
  const text = `name: Website Deploy
on:
  push:
    branches: [master]
permissions:
  contents: read
jobs:
  deploy:
    environment:
      name: github-pages
    permissions:
      contents: read
      pages: write
      id-token: write
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10
`;
  const violations = yamlWebsite(text);
  assert.ok(
    violations.some((v) => v.includes('persist-credentials: false')),
    `expected persist-credentials violation, got: ${JSON.stringify(violations, null, 2)}`,
  );
}

function testCompliantReleaseFixtureClean() {
  const text = `name: Release
on:
  push:
    tags: ['v[0-9]+.[0-9]+.[0-9]+']
  workflow_dispatch:
    inputs:
      publish:
        default: 'no'
permissions:
  contents: read
jobs:
  preflight:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10
      - name: Verify tag source
        run: |
          git fetch origin master --depth=1
          if ! git merge-base --is-ancestor "\${TAG}" origin/master; then exit 1; fi
  signing-preflight:
    runs-on: ubuntu-latest
    env:
      P_APPLE_CERTIFICATE: \${{ secrets.APPLE_CERTIFICATE != '' }}
    steps:
      - run: node scripts/release/resolve-signing-policy.mjs
  verify:
    permissions:
      contents: read
      id-token: write
      attestations: write
    runs-on: ubuntu-latest
    steps:
      - uses: actions/attest@1e69f48acb82d1966a394da916b4c1698aa569d6
        with:
          subject-path: dist/release/*
  draft:
    permissions:
      contents: write
    runs-on: ubuntu-latest
    steps:
      - uses: softprops/action-gh-release@c95fe1489396fe8a9eb87c0abf8aa5b2ef267fda
        with:
          draft: true
  publish:
    if: github.event_name == 'workflow_dispatch' && github.event.inputs.publish == 'yes'
    environment:
      name: release-publish
    permissions:
      contents: write
    runs-on: ubuntu-latest
    steps:
      - run: gh release edit v0.1.0 --draft=false
`;
  expectCleanAudit(auditWorkflowYaml(text, 'release.yml'));
}

function testRealWorkflowsPass() {
  let failures = 0;
  for (const file of readdirSync(WF_DIR).filter((f) => f.endsWith('.yml'))) {
    const text = readFileSync(join(WF_DIR, file), 'utf8');
    const violations = auditWorkflowYaml(text, file);
    if (violations.length > 0) {
      failures += 1;
      console.error(`${file}:`);
      for (const v of violations) console.error(`  ${v}`);
    }
  }
  assert.equal(
    failures,
    0,
    `${failures} real workflow(s) violate the security policy — fix the workflows, not the policy`,
  );
}

testPullRequestTargetRejected();
testSecretsInheritRejected();
testSigningSecretOutsideReleaseRejected();
testSigningSecretInPrWorkflowRejected();
testSigningSecretUngatedInReleaseRejected();
testSigningEnvPersistRejected();
testIdTokenOutsideWhitelistRejected();
testAttestationsOutsideVerifyRejected();
testContentsWriteOutsideWhitelistRejected();
testActionsWriteRejected();
testPagesWriteOutsideDeployRejected();
testPublishEnvironmentAndGateRequired();
testPublishGateMissingRejected();
testTagProvenanceGateRequired();
testMissingPermissionsBlockRejected();
testWebsiteCheckoutPersistCredentialsRejected();
testCompliantReleaseFixtureClean();
testRealWorkflowsPass();

console.log('workflow-policy tests passed (17 scenarios).');
