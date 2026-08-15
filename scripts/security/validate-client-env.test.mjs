#!/usr/bin/env node

/**
 * Client environment guard regression tests.
 *
 * Synthetic env maps exercise the deny-list, the allowlist value validation,
 * the CI canary tolerance, and the release.yml signing-step exception. The
 * guard never reads real credentials — these are unmistakably fake names and
 * values (e.g. OPENAI_API_KEY=sk-FAKE...), and auditEnv only inspects keys
 * and format, never real secrets.
 */

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  auditEnv,
  auditEnvWithFiles,
  PRIVATE_TEST_CANARY,
  parseEnvFile,
  SIGNING_STEP_ALLOWED,
} from './validate-client-env.mjs';

function errorsFor(app, env, signingStep = false) {
  return auditEnv(app, env, signingStep).errors;
}

function expectErrors(app, env, fragment, signingStep = false) {
  const errors = errorsFor(app, env, signingStep);
  assert.ok(
    errors.some((e) => e.includes(fragment)),
    `expected an error containing "${fragment}", got: ${JSON.stringify(errors, null, 2)}`,
  );
}

function expectClean(app, env, signingStep = false) {
  assert.deepEqual(
    errorsFor(app, env, signingStep),
    [],
    `expected no errors, got: ${JSON.stringify(errorsFor(app, env, signingStep), null, 2)}`,
  );
}

const CI_NOISE = {
  CI: 'true',
  GITHUB_ACTIONS: 'true',
  GITHUB_TOKEN: 'ephemeral-runtime-token',
  RUNNER_OS: 'Linux',
  ACTIONS_RUNTIME_URL: 'https://pipelines.actions.githubusercontent.com',
  PATH: '/usr/bin:/bin',
  HOME: '/home/runner',
  LANG: 'C.UTF-8',
  NODE_VERSION: '26',
  PNPM_HOME: '/opt/pnpm',
  LFS_CONFIG: 'lfs.url=https://github.com',
};

function testWebsiteRejectsOpenAiKey() {
  expectErrors('website', { OPENAI_API_KEY: 'sk-FAKE-test-only-value' }, 'OPENAI_API_KEY');
}

function testWebsiteRejectsDatabaseUrl() {
  expectErrors('website', { DATABASE_URL: 'postgres://fake:fake@localhost/db' }, 'DATABASE_URL');
}

function testWebsiteRejectsPorkbunDnsCredential() {
  expectErrors('website', { PORKBUN_API_SECRET: 'pk1_fake_fake_fake' }, 'class dns');
}

function testWebsiteRejectsUpdaterPrivateKey() {
  expectErrors('website', { TAURI_UPDATER_PRIVATE_KEY: 'RWQfake...' }, 'TAURI_UPDATER_PRIVATE_KEY');
}

function testDesktopAllowsPublicTauriUpdaterConfig() {
  expectClean('desktop', {
    TAURI_UPDATER_PLUGIN_CONFIG: JSON.stringify({
      pubkey: 'public-key',
      endpoints: ['https://varve.studio/updates/stable.json'],
    }),
  });
  expectErrors(
    'desktop',
    { TAURI_UPDATER_PLUGIN_CONFIG: JSON.stringify({ privateKey: 'fake' }) },
    'TAURI_UPDATER_PLUGIN_CONFIG',
  );
}

function testWebsiteRejectsSigningCredential() {
  expectErrors('website', { APPLE_CERTIFICATE: 'base64fake===' }, 'class signing');
}

function testDesktopRejectsAwsSecret() {
  expectErrors(
    'desktop',
    { AWS_SECRET_ACCESS_KEY: 'fake/secret/access/key' },
    'AWS_SECRET_ACCESS_KEY',
  );
}

function testRejectsPrivatePrefixFamily() {
  expectErrors(
    'website',
    { PRIVATE_API_BASE_URL: 'https://internal.example.com' },
    'class private',
  );
  expectErrors('desktop', { SIGNING_KEYSTORE: '/tmp/keystore' }, 'class private');
}

function testRejectsAzureSigningFamilyEvenAsVars() {
  // Non-secret repository VARIABLES (account/profile/endpoint) are signing
  // domain config and have no role in a client build either.
  expectErrors('desktop', { AZURE_SIGNING_ACCOUNT: 'varve-signing' }, 'class signing');
}

function testCleanWebsiteEnv() {
  expectClean('website', {
    ...CI_NOISE,
    SITE_URL: 'https://varve.studio',
    SITE_BASE: '/',
    ANALYTICS_DOMAIN: '',
  });
}

function testCleanDesktopEnv() {
  expectClean('desktop', {
    ...CI_NOISE,
    VITE_BASE_URL: '/',
    VARVE_APP_VERSION: '0.1.1',
    VARVE_BUILD_CHANNEL: 'stable',
    VARVE_RELEASE_ID: 'v0.1.1',
    VARVE_GIT_COMMIT: 'a'.repeat(40),
    TAURI_DEBUG: 'true',
  });
}

function testInvalidSiteUrlRejected() {
  expectErrors('website', { SITE_URL: 'not a url' }, 'SITE_URL');
  expectErrors('website', { SITE_URL: 'varve.studio' }, 'SITE_URL');
}

function testInvalidSiteBaseRejected() {
  expectErrors('website', { SITE_BASE: 'varve' }, 'SITE_BASE');
}

function testInvalidAnalyticsDomainRejected() {
  expectErrors('website', { ANALYTICS_DOMAIN: 'https://plausible.io' }, 'ANALYTICS_DOMAIN');
}

function testInvalidChannelRejected() {
  expectErrors('desktop', { VARVE_BUILD_CHANNEL: 'stable channel' }, 'VARVE_BUILD_CHANNEL');
}

function testInvalidGitCommitRejected() {
  expectErrors('desktop', { VARVE_GIT_COMMIT: 'abc' }, 'VARVE_GIT_COMMIT');
}

function testCanaryTolerated() {
  expectClean('website', {
    ...CI_NOISE,
    [PRIVATE_TEST_CANARY]: 'VARVE_PRIVATE_TEST_CANARY_DO_NOT_SHIP',
  });
  expectClean('desktop', {
    ...CI_NOISE,
    [PRIVATE_TEST_CANARY]: 'VARVE_PRIVATE_TEST_CANARY_DO_NOT_SHIP',
  });
}

function testSigningStepBypassOnlyForSigningFamily() {
  const signingEnv = {
    ...CI_NOISE,
    APPLE_CERTIFICATE: 'base64fake===',
    APPLE_CERTIFICATE_PASSWORD: 'fake-password',
    AZURE_CLIENT_SECRET: 'fake-client-secret',
  };
  // Without the flag: fail closed.
  expectErrors('desktop', signingEnv, 'class signing');
  // With the flag: the signing family yields...
  expectClean('desktop', signingEnv, true);
  // ...but backend secrets still fail.
  expectErrors('desktop', { ...signingEnv, OPENAI_API_KEY: 'sk-FAKE' }, 'OPENAI_API_KEY', true);
  expectErrors('desktop', { ...signingEnv, PORKBUN_API_SECRET: 'pk1_fake' }, 'class dns', true);
}

function testUnknownVarsWarnNotFail() {
  const { warnings } = auditEnv('website', { ...CI_NOISE, SOME_UNKNOWN_VAR: 'x' });
  assert.ok(
    warnings.some((w) => w.includes('SOME_UNKNOWN_VAR')),
    `expected a warning for the unknown variable, got: ${JSON.stringify(warnings, null, 2)}`,
  );
  expectClean('website', { ...CI_NOISE, SOME_UNKNOWN_VAR: 'x' });
}

function testSigningStepFlagIsDocumentedException() {
  // The flag itself must not silence the guard for non-signing families.
  const env = { ...CI_NOISE, [SIGNING_STEP_ALLOWED]: '1', STRIPE_SECRET_KEY: 'sk_live_FAKE' };
  expectErrors('desktop', env, 'STRIPE_SECRET_KEY', true);
}

function testParseEnvFile() {
  const env = parseEnvFile(
    [
      '# comment',
      '',
      'SITE_URL=https://varve.studio',
      'ANALYTICS_DOMAIN=""',
      "SITE_BASE='/varve'",
      'MULTI=one=two',
      '  PADDED = value  ',
      '=orphan',
    ].join('\n'),
  );
  assert.deepEqual(env, {
    SITE_URL: 'https://varve.studio',
    ANALYTICS_DOMAIN: '',
    SITE_BASE: '/varve',
    MULTI: 'one=two',
    PADDED: 'value',
  });
}

function testEnvFileWithForbiddenSecretFails() {
  const root = mkdtempSync(join(tmpdir(), 'varve-env-guard-'));
  const originalCwd = process.cwd();
  try {
    mkdirSync(join(root, 'apps/website'), { recursive: true });
    writeFileSync(join(root, 'apps/website/.env'), 'OPENAI_API_KEY=sk-FAKE-test-only\n', 'utf8');
    process.chdir(root);
    const errors = [];
    auditEnvWithFiles('website', errors);
    assert.ok(
      errors.some((e) => e.includes('[website/.env]') && e.includes('OPENAI_API_KEY')),
      `expected .env file violation, got: ${JSON.stringify(errors, null, 2)}`,
    );
  } finally {
    process.chdir(originalCwd);
  }
}

function testEnvFileCleanPasses() {
  const root = mkdtempSync(join(tmpdir(), 'varve-env-guard-'));
  const originalCwd = process.cwd();
  try {
    mkdirSync(join(root, 'apps/website'), { recursive: true });
    writeFileSync(
      join(root, 'apps/website/.env'),
      'SITE_URL=https://varve.studio\nSITE_BASE=/\n',
      'utf8',
    );
    process.chdir(root);
    const errors = [];
    auditEnvWithFiles('website', errors);
    assert.deepEqual(errors, [], `expected no .env violations, got: ${JSON.stringify(errors)}`);
  } finally {
    process.chdir(originalCwd);
  }
}

testWebsiteRejectsOpenAiKey();
testWebsiteRejectsDatabaseUrl();
testWebsiteRejectsPorkbunDnsCredential();
testWebsiteRejectsUpdaterPrivateKey();
testDesktopAllowsPublicTauriUpdaterConfig();
testWebsiteRejectsSigningCredential();
testDesktopRejectsAwsSecret();
testRejectsPrivatePrefixFamily();
testRejectsAzureSigningFamilyEvenAsVars();
testCleanWebsiteEnv();
testCleanDesktopEnv();
testInvalidSiteUrlRejected();
testInvalidSiteBaseRejected();
testInvalidAnalyticsDomainRejected();
testInvalidChannelRejected();
testInvalidGitCommitRejected();
testCanaryTolerated();
testSigningStepBypassOnlyForSigningFamily();
testUnknownVarsWarnNotFail();
testSigningStepFlagIsDocumentedException();
testParseEnvFile();
testEnvFileWithForbiddenSecretFails();
testEnvFileCleanPasses();

console.log('validate-client-env tests passed (23 scenarios).');
