import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { selectPublishedInstaller, verifyPublishedBytes } from './published-upgrade.mjs';

const bytes = Buffer.from('actual fixture installer'),
  sha256 = createHash('sha256').update(bytes).digest('hex');
const artifact = {
  filename: 'Varve-0.2.1-windows-aarch64.exe',
  os: 'windows',
  arch: 'aarch64',
  format: 'nsis',
  sha256,
  sizeBytes: bytes.length,
};
const manifest = { version: '0.2.1', artifacts: [artifact] };
const release = {
  tag_name: 'v0.2.1',
  draft: false,
  assets: [
    { name: artifact.filename, size: bytes.length },
    { name: 'varve-0.2.1-sbom.cdx.json', size: 1 },
  ],
};
const sums = `${sha256}  ${artifact.filename}\n${'a'.repeat(64)}  varve-0.2.1-sbom.cdx.json\n`;
const select = (overrides = {}) =>
  selectPublishedInstaller({
    release,
    manifest,
    checksumsText: sums,
    target: 'windows-aarch64',
    format: 'nsis',
    ...overrides,
  });
assert.equal(select().artifact.filename, artifact.filename);
assert.equal(verifyPublishedBytes(bytes, artifact), sha256);
assert.throws(() => select({ release: { ...release, draft: true } }), /published/);
assert.throws(() => select({ target: 'windows-x86_64' }), /matching published native installer/);
assert.throws(
  () => select({ checksumsText: sums.replace(sha256, 'b'.repeat(64)) }),
  /Hash mismatch/,
);
assert.throws(
  () => verifyPublishedBytes(Buffer.from('actual fixture installeR'), artifact),
  /SHA-256/,
);
assert.throws(() => verifyPublishedBytes(Buffer.from('short'), artifact), /size/);
console.log(
  'Published baseline target/version/publication metadata and actual installer hash/size checks passed; no downloads/native execution.',
);
