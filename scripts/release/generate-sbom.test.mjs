import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';
import { rustComponentFromPackage } from './generate-sbom.mjs';

const root = resolve('/fixture/varve');
const packageFixture = {
  name: 'little_exif',
  version: '0.6.23',
  source: null,
  manifest_path: resolve(root, 'vendor/little_exif/Cargo.toml'),
  license: 'MIT OR Apache-2.0',
  repository: 'https://github.com/TechnikTobi/little_exif',
};

function origin(component) {
  return component.properties.find((property) => property.name === 'varve:origin').value;
}

test('vendored Rust patches keep upstream license and source identity', () => {
  const component = rustComponentFromPackage(packageFixture, root);
  assert.equal(origin(component), 'vendored-source');
  assert.equal(component.purl, 'pkg:cargo/little_exif@0.6.23');
  assert.deepEqual(component.licenses, [{ expression: 'MIT OR Apache-2.0' }]);
  assert.deepEqual(component.externalReferences, [{ type: 'vcs', url: packageFixture.repository }]);
});

test('the existing diffusion binding patch is also third-party source', () => {
  const component = rustComponentFromPackage(
    {
      ...packageFixture,
      name: 'diffusion-rs',
      version: '0.1.20',
      manifest_path: resolve(root, 'vendor/diffusion-rs/Cargo.toml'),
      license: 'MIT',
    },
    root,
  );
  assert.equal(origin(component), 'vendored-source');
  assert.deepEqual(component.licenses, [{ license: { id: 'MIT' } }]);
});

test('vendored bindgen build tooling keeps its BSD license and upstream identity', () => {
  const component = rustComponentFromPackage(
    {
      ...packageFixture,
      name: 'bindgen',
      version: '0.71.1',
      manifest_path: resolve(root, 'vendor/bindgen/Cargo.toml'),
      license: 'BSD-3-Clause',
      repository: 'https://github.com/rust-lang/rust-bindgen',
    },
    root,
  );
  assert.equal(origin(component), 'vendored-source');
  assert.equal(component.purl, 'pkg:cargo/bindgen@0.71.1');
  assert.deepEqual(component.licenses, [{ license: { id: 'BSD-3-Clause' } }]);
  assert.deepEqual(component.externalReferences, [
    { type: 'vcs', url: 'https://github.com/rust-lang/rust-bindgen' },
  ]);
});

test('ordinary Varve path dependencies remain first-party', () => {
  const component = rustComponentFromPackage(
    {
      ...packageFixture,
      name: 'varve-core',
      manifest_path: resolve(root, 'crates/varve-core/Cargo.toml'),
      license: 'FSL-1.1-MIT',
    },
    root,
  );
  assert.equal(origin(component), 'first-party');
  assert.deepEqual(component.licenses, [{ license: { id: 'FSL-1.1-MIT' } }]);
});

test('registry crates stay registry even if their name matches a patch', () => {
  const component = rustComponentFromPackage(
    { ...packageFixture, source: 'registry+https://github.com/rust-lang/crates.io-index' },
    root,
  );
  assert.equal(origin(component), 'registry');
});

test('vendor prefix lookalikes, outside paths and missing paths are not patches', () => {
  for (const manifest_path of [
    resolve(root, 'vendor-other/little_exif/Cargo.toml'),
    resolve(root, '../vendor/little_exif/Cargo.toml'),
    undefined,
  ]) {
    assert.equal(
      origin(rustComponentFromPackage({ ...packageFixture, manifest_path }, root)),
      'first-party',
    );
  }
});
