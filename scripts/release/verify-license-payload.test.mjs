import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { verifyLicensePayload } from './verify-license-payload.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
const files = {
  LICENSE: 'project license',
  NOTICE: 'project notice',
  THIRD_PARTY_NOTICES: 'component notices',
  'THIRD_PARTY_LICENSES/MIT.txt': 'MIT text',
  'THIRD_PARTY_LICENSES/Apache-2.0.txt': 'Apache text',
  'THIRD_PARTY_LICENSES/BSD-2-Clause.txt': 'BSD-2-Clause text',
  'THIRD_PARTY_LICENSES/fonts/OFL-1.1.txt': 'OFL text',
  'THIRD_PARTY_LICENSES/Unlicense.txt': 'Unlicense text',
};

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'varve-license-payload-'));
  const sourceRoot = join(root, 'source');
  const resourceRoot = join(root, 'resources');
  const resourceDir = join(resourceRoot, '_up_', '_up_', '_up_');
  t.after(() => rmSync(root, { recursive: true, force: true }));

  function write(base, relativePath, contents) {
    const path = join(base, relativePath);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents);
  }

  for (const [path, contents] of Object.entries(files)) {
    write(sourceRoot, path, contents);
    write(resourceDir, path, contents);
  }

  return {
    sourceRoot,
    resourceRoot,
    write: (path, contents) => write(resourceDir, path, contents),
  };
}

test('accepts exact source contents under Tauri’s three-parent _up_ resource path', (t) => {
  const { sourceRoot, resourceRoot } = fixture(t);
  assert.deepEqual(verifyLicensePayload({ sourceRoot, resourceRoot }), {
    filesChecked: Object.keys(files).length,
    problems: [],
  });
});

test('rejects missing root notices and license texts', (t) => {
  const { sourceRoot, resourceRoot } = fixture(t);
  const resourceDir = join(resourceRoot, '_up_', '_up_', '_up_');
  rmSync(join(resourceDir, 'NOTICE'));
  rmSync(join(resourceDir, 'THIRD_PARTY_LICENSES/Apache-2.0.txt'));

  const result = verifyLicensePayload({ sourceRoot, resourceRoot });
  assert.match(result.problems.join('\n'), /Missing packaged file: NOTICE/);
  assert.match(
    result.problems.join('\n'),
    /Missing packaged file: THIRD_PARTY_LICENSES\/Apache-2\.0\.txt/,
  );
});

test('rejects altered source payload bytes and unexpected license files', (t) => {
  const { sourceRoot, resourceRoot, write } = fixture(t);
  write('THIRD_PARTY_NOTICES', 'tampered notices');
  write('THIRD_PARTY_LICENSES/Extra.txt', 'unreviewed extra text');

  const result = verifyLicensePayload({ sourceRoot, resourceRoot });
  assert.match(
    result.problems.join('\n'),
    /Packaged file differs from source: THIRD_PARTY_NOTICES/,
  );
  assert.match(
    result.problems.join('\n'),
    /Unexpected packaged file: THIRD_PARTY_LICENSES\/Extra\.txt/,
  );
});

test('Tauri resource list includes each root notice and the nested license directory', () => {
  const config = JSON.parse(
    readFileSync(join(repoRoot, 'apps/desktop/src-tauri/tauri.conf.json'), 'utf8'),
  );
  assert.deepEqual(config.bundle.resources, [
    'onnxruntime-libs/**/*',
    '../../../target/release/varve-generative-helper*',
    '../../../LICENSE',
    '../../../NOTICE',
    '../../../THIRD_PARTY_NOTICES',
    '../../../THIRD_PARTY_LICENSES/**/*',
  ]);
});
