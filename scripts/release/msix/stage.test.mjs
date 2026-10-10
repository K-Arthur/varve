import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { STORE_ASSET_FILES } from './identity.mjs';
import { listStagedPayload, stageMsixLayout } from './stage.mjs';

describe('MSIX staging', () => {
  it('copies the exe, DLLs, and Store assets without wrapping an NSIS installer', () => {
    const root = mkdtempSync(join(tmpdir(), 'varve-msix-'));
    const releaseDir = join(root, 'release');
    const outputDir = join(root, 'layout');
    const iconDir = join(root, 'icons');
    mkdirSync(releaseDir);
    mkdirSync(iconDir);
    writeFileSync(join(releaseDir, 'varve-desktop.exe'), 'exe');
    writeFileSync(join(releaseDir, 'onnxruntime.dll'), 'dll');
    writeFileSync(join(releaseDir, 'Varve_0.5.0_x64-setup.exe'), 'nsis-must-not-copy');
    for (const file of STORE_ASSET_FILES) writeFileSync(join(iconDir, file), file);

    const staged = listStagedPayload(releaseDir);
    assert.deepEqual(staged, ['onnxruntime.dll', 'varve-desktop.exe']);

    const { identity } = stageMsixLayout({
      releaseDir,
      outputDir,
      version: '0.5.0',
      architecture: 'x64',
      iconDir,
      env: {},
    });
    assert.equal(identity.kind, 'ci-test');
    assert.equal(identity.storeSubmittable, false);
    assert.equal(readFileSync(join(outputDir, 'varve-desktop.exe'), 'utf8'), 'exe');
    assert.equal(readFileSync(join(outputDir, 'Assets', 'StoreLogo.png'), 'utf8'), 'StoreLogo.png');
    assert.match(readFileSync(join(outputDir, 'AppxManifest.xml'), 'utf8'), /runFullTrust/);
    assert.throws(() => readFileSync(join(outputDir, 'Varve_0.5.0_x64-setup.exe')));
    rmSync(root, { recursive: true, force: true });
  });
});
