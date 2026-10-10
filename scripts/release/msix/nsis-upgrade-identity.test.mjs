import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * Tauri 2's NSIS installer writes the Add/Remove Programs key as
 * `Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCTNAME}`.
 * PRODUCTNAME comes from `bundle.productName` ("Varve"), not from
 * `bundle.publisher`. Changing the publisher display string therefore
 * does not mint a new ProductCode / uninstall key, so a 0.5.0 → 0.5.1
 * NSIS upgrade still finds the existing install.
 *
 * Source: tauri-bundler Windows NSIS `installer.nsi` (`UNINSTKEY`).
 */
const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const tauriConf = JSON.parse(
  readFileSync(join(root, 'apps/desktop/src-tauri/tauri.conf.json'), 'utf8'),
);

describe('NSIS upgrade identity', () => {
  it('keeps the 0.5.0 uninstall key inputs stable while renaming the publisher', () => {
    assert.equal(tauriConf.productName, 'Varve');
    assert.equal(tauriConf.identifier, 'dev.varve.desktop');
    assert.equal(tauriConf.bundle.publisher, 'Varve');
    assert.notEqual(tauriConf.bundle.publisher, 'K-Arthur (Varve Founder)');
    const extensions = tauriConf.bundle.fileAssociations.flatMap((entry) => entry.ext);
    assert.deepEqual(extensions, ['varve', 'strata']);
  });
});
