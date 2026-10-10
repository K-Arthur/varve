#!/usr/bin/env node
/**
 * Resolve Microsoft Store / MSIX package identity.
 *
 * Partner Center values are never invented. Empty committed slots stay empty
 * until VARVE_STORE_* variables (or explicit CLI flags) supply them. CI can
 * fall back to a clearly named test identity that is not Store-submittable.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const IDENTITY_VARIABLES = {
  packageName: 'VARVE_STORE_PACKAGE_NAME',
  publisherCn: 'VARVE_STORE_PUBLISHER_CN',
  publisherDisplayName: 'VARVE_STORE_PUBLISHER_DISPLAY_NAME',
};

export const CI_TEST_IDENTITY = {
  packageName: 'Varve.Desktop.CI',
  publisherCn: 'CN=Varve CI Test',
  publisherDisplayName: 'Varve',
  kind: 'ci-test',
};

export const STORE_ASSET_FILES = [
  'StoreLogo.png',
  'Square44x44Logo.png',
  'Square71x71Logo.png',
  'Square150x150Logo.png',
  'Square310x310Logo.png',
];

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

export function loadIdentityFile(path = join(repoRoot, 'packaging/msix/identity.json')) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function committedIdentityHasPlaceholders(identity = loadIdentityFile()) {
  return identity.packageName === '' && identity.publisherCn === '';
}

export function fourPartVersion(version) {
  const match = String(version)
    .trim()
    .match(/^v?(\d+)\.(\d+)\.(\d+)(?:-.*)?$/);
  if (!match) throw new Error(`MSIX version must be major.minor.patch, got ${version}`);
  return `${match[1]}.${match[2]}.${match[3]}.0`;
}

export function msixArchitecture(arch) {
  if (arch === 'x86_64' || arch === 'x64' || arch === 'amd64') return 'x64';
  if (arch === 'aarch64' || arch === 'arm64') return 'arm64';
  throw new Error(`unsupported MSIX architecture: ${arch}`);
}

function readSlot(fileValue, envValue) {
  const env = typeof envValue === 'string' ? envValue.trim() : '';
  if (env) return env;
  const file = typeof fileValue === 'string' ? fileValue.trim() : '';
  return file;
}

/**
 * @param {object} options
 * @param {'unsigned' | 'test-signed'} [options.signMode]
 * @param {NodeJS.ProcessEnv} [options.env]
 * @param {object} [options.file]
 */
export function resolveStoreIdentity({
  signMode = 'unsigned',
  env = process.env,
  file = loadIdentityFile(),
} = {}) {
  const publisherDisplayName =
    readSlot(file.publisherDisplayName, env[IDENTITY_VARIABLES.publisherDisplayName]) || 'Varve';
  const packageName = readSlot(file.packageName, env[IDENTITY_VARIABLES.packageName]);
  const publisherCn = readSlot(file.publisherCn, env[IDENTITY_VARIABLES.publisherCn]);
  const storeReady = Boolean(packageName && publisherCn);

  if (signMode === 'test-signed' || !storeReady) {
    return {
      ...CI_TEST_IDENTITY,
      publisherDisplayName,
      storeSubmittable: false,
      reason:
        signMode === 'test-signed'
          ? 'test-signed packages use the CI certificate subject, not Partner Center'
          : 'Partner Center identity variables are unset',
    };
  }

  if (!publisherCn.startsWith('CN=')) {
    throw new Error(
      `${IDENTITY_VARIABLES.publisherCn} must be a distinguished name starting with CN=`,
    );
  }

  return {
    packageName,
    publisherCn,
    publisherDisplayName,
    kind: 'partner-center',
    storeSubmittable: signMode === 'unsigned',
    reason: 'Partner Center identity variables are set',
  };
}

export function renderManifest(
  template,
  identity,
  { version, architecture, displayName = 'Varve' },
) {
  const replacements = {
    PACKAGE_NAME: identity.packageName,
    PUBLISHER_CN: identity.publisherCn,
    PUBLISHER_DISPLAY_NAME: identity.publisherDisplayName,
    DISPLAY_NAME: displayName,
    VERSION: fourPartVersion(version),
    ARCHITECTURE: msixArchitecture(architecture),
  };
  let rendered = template;
  for (const [key, value] of Object.entries(replacements)) {
    if (!value) throw new Error(`MSIX manifest replacement ${key} is empty`);
    rendered = rendered.replaceAll(`{{${key}}}`, value);
  }
  if (rendered.includes('{{')) {
    throw new Error('MSIX manifest still contains unreplaced placeholders');
  }
  return rendered;
}

export function assertStoreManifestContract(xml) {
  if (!xml.includes('<rescap:Capability Name="runFullTrust" />')) {
    throw new Error('Store manifest must declare runFullTrust');
  }
  if (/broadFileSystemAccess/i.test(xml)) {
    throw new Error('Store manifest must not declare broadFileSystemAccess');
  }
  if ((xml.match(/rescap:Capability/g) ?? []).length !== 1) {
    throw new Error('Store manifest must declare only the runFullTrust restricted capability');
  }
  if (!xml.includes('<uap:FileType>.varve</uap:FileType>')) {
    throw new Error('Store manifest must declare the .varve file association');
  }
  if (!xml.includes('<uap:FileType>.strata</uap:FileType>')) {
    throw new Error('Store manifest must declare the legacy .strata file association');
  }
}

export function defaultTemplatePath() {
  return join(repoRoot, 'packaging/msix/Package.appxmanifest.template');
}

export function loadManifestTemplate(path = defaultTemplatePath()) {
  return readFileSync(path, 'utf8');
}
