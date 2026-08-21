#!/usr/bin/env node
/**
 * Regression tests for release artifact collection, including the documented
 * manual-download fallback when updater signing is not configured.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const fixture = mkdtempSync(join(tmpdir(), 'varve-collect-artifacts-'));
const bundle = join(fixture, 'bundle', 'appimage');
const unsignedOut = join(fixture, 'unsigned');
const signedOut = join(fixture, 'signed');
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const source = join(bundle, `Varve_${version}_amd64.AppImage`);

mkdirSync(bundle, { recursive: true });
writeFileSync(source, 'synthetic AppImage bytes');

function collect(out, updaterSignatures) {
  execFileSync(
    process.execPath,
    [
      'scripts/release/collect-artifacts.mjs',
      '--bundle-dir',
      join(fixture, 'bundle'),
      '--out',
      out,
      '--os',
      'linux',
      '--arch',
      'x86_64',
      '--updater-signatures',
      String(updaterSignatures),
    ],
    { cwd: root, stdio: 'pipe' },
  );
}

try {
  collect(unsignedOut, false);
  assert.equal(existsSync(join(unsignedOut, `Varve-${version}-linux-x86_64.AppImage`)), true);
  assert.equal(existsSync(join(unsignedOut, `Varve-${version}-linux-x86_64.AppImage.sig`)), false);

  writeFileSync(`${source}.sig`, 'synthetic updater signature');
  collect(signedOut, true);
  assert.equal(existsSync(join(signedOut, `Varve-${version}-linux-x86_64.AppImage.sig`)), true);

  rmSync(`${source}.sig`);
  assert.throws(
    () => collect(join(fixture, 'missing-signature')),
    /Missing Tauri updater signature/,
  );
  console.log('collect-artifacts tests passed');
} finally {
  rmSync(fixture, { recursive: true, force: true });
}
