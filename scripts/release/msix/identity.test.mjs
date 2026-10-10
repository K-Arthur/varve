import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  assertStoreManifestContract,
  CI_TEST_IDENTITY,
  committedIdentityHasPlaceholders,
  fourPartVersion,
  IDENTITY_VARIABLES,
  loadIdentityFile,
  loadManifestTemplate,
  msixArchitecture,
  renderManifest,
  resolveStoreIdentity,
  STORE_ASSET_FILES,
} from './identity.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');

describe('MSIX identity', () => {
  it('keeps Partner Center slots empty in the committed file', () => {
    const identity = loadIdentityFile();
    assert.equal(identity.packageName, '');
    assert.equal(identity.publisherCn, '');
    assert.equal(identity.publisherDisplayName, 'Varve');
    assert.equal(identity.placeholders.packageName, IDENTITY_VARIABLES.packageName);
    assert.equal(identity.placeholders.publisherCn, IDENTITY_VARIABLES.publisherCn);
    assert.ok(committedIdentityHasPlaceholders(identity));
  });

  it('uses the CI test identity when Partner Center values are missing', () => {
    const resolved = resolveStoreIdentity({
      file: { packageName: '', publisherCn: '', publisherDisplayName: 'Varve' },
      env: {},
    });
    assert.equal(resolved.kind, 'ci-test');
    assert.equal(resolved.storeSubmittable, false);
    assert.equal(resolved.packageName, CI_TEST_IDENTITY.packageName);
    assert.equal(resolved.publisherCn, CI_TEST_IDENTITY.publisherCn);
  });

  it('uses Partner Center values only when both slots are set and the package is unsigned', () => {
    const resolved = resolveStoreIdentity({
      signMode: 'unsigned',
      file: { packageName: '', publisherCn: '', publisherDisplayName: 'Varve' },
      env: {
        VARVE_STORE_PACKAGE_NAME: 'ReservedNameFromPartnerCenter',
        VARVE_STORE_PUBLISHER_CN: 'CN=AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE',
      },
    });
    assert.equal(resolved.kind, 'partner-center');
    assert.equal(resolved.storeSubmittable, true);
    assert.equal(resolved.packageName, 'ReservedNameFromPartnerCenter');
  });

  it('refuses a publisher CN that is not a distinguished name', () => {
    assert.throws(
      () =>
        resolveStoreIdentity({
          file: { packageName: 'Name', publisherCn: '', publisherDisplayName: 'Varve' },
          env: {
            VARVE_STORE_PACKAGE_NAME: 'Name',
            VARVE_STORE_PUBLISHER_CN: 'Varve',
          },
        }),
      /CN=/,
    );
  });

  it('forces the CI test identity for test-signed packages', () => {
    const resolved = resolveStoreIdentity({
      signMode: 'test-signed',
      env: {
        VARVE_STORE_PACKAGE_NAME: 'ReservedNameFromPartnerCenter',
        VARVE_STORE_PUBLISHER_CN: 'CN=AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE',
      },
    });
    assert.equal(resolved.kind, 'ci-test');
    assert.equal(resolved.storeSubmittable, false);
  });

  it('renders a Store-valid manifest with file associations and runFullTrust only', () => {
    const xml = renderManifest(loadManifestTemplate(), CI_TEST_IDENTITY, {
      version: '0.5.0',
      architecture: 'x86_64',
    });
    assertStoreManifestContract(xml);
    assert.match(xml, /Version="0\.5\.0\.0"/);
    assert.match(xml, /ProcessorArchitecture="x64"/);
    assert.doesNotMatch(xml, /broadFileSystemAccess/);
  });

  it('normalizes versions and architectures', () => {
    assert.equal(fourPartVersion('v0.5.1'), '0.5.1.0');
    assert.equal(msixArchitecture('aarch64'), 'arm64');
    assert.throws(() => fourPartVersion('release-candidate'), /major\.minor\.patch/);
  });

  it('reuses the existing Store icon assets from the master icon pipeline', () => {
    for (const file of STORE_ASSET_FILES) {
      const bytes = readFileSync(join(root, 'apps/desktop/src-tauri/icons', file));
      assert.ok(bytes.length > 32, `${file} should exist`);
    }
  });
});
