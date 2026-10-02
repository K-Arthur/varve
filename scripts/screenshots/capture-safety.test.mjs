import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  assertPortAvailable,
  assertReviewDirectorySafe,
  sourceSceneProvenance,
} from './capture-safety.mjs';
import { readProducerCaptureReceipt } from './producer-capture.mjs';
import { SOURCE_SCENES } from './source-scenes.mjs';

test('owning browser specs can load the producer helper through Playwright', () => {
  const root = fileURLToPath(new URL('../..', import.meta.url));
  const result = spawnSync(
    'pnpm',
    [
      'exec',
      'playwright',
      'test',
      'tests/e2e/canvas/comic-lettering.spec.ts',
      '--project=chromium',
      '--list',
    ],
    { cwd: root, encoding: 'utf8', timeout: 30_000 },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Total: [1-9]\d* tests? in 1 file/);
});

test('review captures refuse canonical and published screenshot paths', () => {
  const canonical = join(tmpdir(), 'varve', 'docs', 'screenshots', 'product');
  const published = join(tmpdir(), 'varve', 'apps', 'website', 'public', 'screenshots');
  assert.throws(() => assertReviewDirectorySafe(canonical, [canonical, published]), /outside/);
  assert.throws(
    () => assertReviewDirectorySafe(join(canonical, 'review'), [canonical, published]),
    /outside/,
  );
  assert.throws(
    () => assertReviewDirectorySafe(join(published, 'review'), [canonical, published]),
    /outside/,
  );
  assert.doesNotThrow(() =>
    assertReviewDirectorySafe(join(tmpdir(), 'varve-review'), [canonical, published]),
  );
});

test('workflow CLI rejects protected review directories before changing media', () => {
  const root = fileURLToPath(new URL('../..', import.meta.url));
  for (const directory of ['docs/screenshots/product', 'apps/website/public/screenshots']) {
    const poster = join(root, directory, 'workflow-poster.png');
    const before = readFileSync(poster);
    const result = spawnSync(
      process.execPath,
      ['scripts/screenshots/workflow.mjs', '--review-dir', directory],
      { cwd: root, encoding: 'utf8', timeout: 15_000 },
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /outside the canonical and published screenshot directories/);
    assert.deepEqual(readFileSync(poster), before);
  }
});

test('workflow CLI refuses an occupied port before recording or replacing media', async () => {
  const root = fileURLToPath(new URL('../..', import.meta.url));
  const directory = mkdtempSync(join(tmpdir(), 'varve-workflow-port-'));
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  try {
    const result = spawnSync(
      process.execPath,
      ['scripts/screenshots/workflow.mjs', '--review-dir', directory],
      {
        cwd: root,
        encoding: 'utf8',
        timeout: 15_000,
        env: { ...process.env, VARVE_SHOT_PORT: String(port) },
      },
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /already occupied/);
    assert.equal(existsSync(join(directory, 'workflow-provenance.json')), false);
    assert.equal(existsSync(join(directory, 'workflow.webm')), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(directory, { recursive: true, force: true });
  }
});

test('copied producer captures retain historical provenance unless their bytes changed', () => {
  const previous = {
    capturedAt: '2026-09-20T00:00:00.000Z',
    lastValidatedAgainst: 'abc123',
    provenanceUnknown: false,
    sha256: 'same-hash',
  };
  assert.deepEqual(sourceSceneProvenance(previous, 'same-hash'), {
    capturedAt: previous.capturedAt,
    lastValidatedAgainst: 'abc123',
    provenanceUnknown: false,
  });
  assert.deepEqual(sourceSceneProvenance(previous, 'different-hash'), {
    capturedAt: undefined,
    lastValidatedAgainst: null,
    provenanceUnknown: true,
  });
  assert.deepEqual(
    sourceSceneProvenance(previous, 'new-hash', {
      capturedAt: '2026-10-01T23:40:00.000Z',
      lastValidatedAgainst: 'def456',
      provenance: { runId: 'playwright-run', sourceRevision: 'def456' },
    }),
    {
      capturedAt: '2026-10-01T23:40:00.000Z',
      lastValidatedAgainst: 'def456',
      provenanceUnknown: false,
      provenance: { runId: 'playwright-run', sourceRevision: 'def456' },
    },
  );
});

test('fresh producer evidence replaces unknown provenance even when pixels are unchanged', () => {
  const capture = {
    capturedAt: '2026-10-02T03:00:00.000Z',
    lastValidatedAgainst: 'a'.repeat(40),
    provenance: { sourceRevision: 'a'.repeat(40), viewport: { width: 1280, height: 720 } },
  };
  assert.deepEqual(
    sourceSceneProvenance({ sha256: 'same-hash', provenanceUnknown: true }, 'same-hash', capture),
    { ...capture, provenanceUnknown: false },
  );
});

test('imports require the owning producer receipt and retain its capture-time revision', () => {
  const directory = mkdtempSync(join(tmpdir(), 'varve-producer-receipt-'));
  const path = join(directory, 'producer.png');
  const bytes = readFileSync(
    new URL('../../docs/screenshots/product/comic-lettering-light.png', import.meta.url),
  );
  const source = {
    id: 'comic-lettering',
    producer: 'tests/e2e/canvas/comic-lettering.spec.ts',
    theme: 'light',
  };
  const receipt = {
    schemaVersion: 1,
    file: 'producer.png',
    sha256: createHash('sha256').update(bytes).digest('hex'),
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    producer: source.producer,
    capturedAt: '2026-10-02T03:00:00.000Z',
    provenance: {
      sourceRevision: 'a'.repeat(40),
      sourceDigest: 'b'.repeat(64),
      sourceDirty: false,
      runId: 'test-results/recorded-run',
      runtime: 'chromium Playwright E2E',
      captureTool: 'Playwright 1.62.1 / chromium 151.0',
      viewport: { width: 1280, height: 720 },
      deviceScaleFactor: 1,
      theme: 'light',
    },
  };
  try {
    writeFileSync(path, bytes);
    assert.throws(() => readProducerCaptureReceipt(path, source), /missing producer receipt/);
    writeFileSync(`${path}.provenance.json`, JSON.stringify(receipt));
    const capture = readProducerCaptureReceipt(path, source);
    assert.equal(capture.lastValidatedAgainst, receipt.provenance.sourceRevision);
    assert.deepEqual(capture.provenance, receipt.provenance);
    for (const altered of [
      { ...receipt, sha256: 'c'.repeat(64) },
      { ...receipt, producer: 'tests/e2e/another.spec.ts' },
      { ...receipt, provenance: { ...receipt.provenance, theme: 'dark' } },
      { ...receipt, provenance: { ...receipt.provenance, sourceDigest: undefined } },
    ]) {
      writeFileSync(`${path}.provenance.json`, JSON.stringify(altered));
      assert.throws(() => readProducerCaptureReceipt(path, source), /mismatched producer receipt/);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('every external scene names a real owning spec and explicit producer filename', () => {
  assert.equal(new Set(SOURCE_SCENES.map((scene) => scene.id)).size, SOURCE_SCENES.length);
  for (const source of SOURCE_SCENES) {
    assert.match(source.captureFile, /^[^/\\]+\.png$/);
    assert.ok(readFileSync(new URL(`../../${source.producer}`, import.meta.url)).length > 0);
  }
});

test('receipt-backed review imports preserve canonical images and reject missing receipts', () => {
  const root = fileURLToPath(new URL('../..', import.meta.url));
  mkdirSync(join(root, 'test-results'), { recursive: true });
  const sourceDirectory = mkdtempSync(join(root, 'test-results', 'producer-review-test-'));
  const reviewDirectory = mkdtempSync(join(tmpdir(), 'varve-review-import-'));
  const source = SOURCE_SCENES.find((scene) => scene.id === 'comic-lettering');
  const canonical = join(root, 'docs/screenshots/product', source.file);
  const manifest = join(root, 'apps/website/src/data/screenshot-manifest.json');
  const bytes = readFileSync(canonical);
  const originalManifest = readFileSync(manifest);
  const path = join(sourceDirectory, source.captureFile);
  const run = () =>
    spawnSync(
      process.execPath,
      [
        join(root, 'scripts/screenshots/product.mjs'),
        '--normalize',
        '--source-scenes-dir',
        sourceDirectory,
        '--scenes',
        source.id,
        '--review-dir',
        reviewDirectory,
      ],
      { cwd: root, encoding: 'utf8' },
    );
  try {
    writeFileSync(path, bytes);
    assert.notEqual(run().status, 0);
    const provenance = {
      sourceRevision: 'a'.repeat(40),
      sourceDigest: 'b'.repeat(64),
      sourceDirty: false,
      runId: 'test-results/recorded-run',
      runtime: 'chromium Playwright E2E',
      captureTool: 'Playwright 1.62.1 / chromium 151.0',
      viewport: { width: 1280, height: 720 },
      deviceScaleFactor: 1,
      theme: 'light',
    };
    writeFileSync(
      `${path}.provenance.json`,
      JSON.stringify({
        schemaVersion: 1,
        file: source.captureFile,
        producer: source.producer,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        width: bytes.readUInt32BE(16),
        height: bytes.readUInt32BE(20),
        capturedAt: '2026-10-02T03:00:00.000Z',
        provenance,
      }),
    );
    const result = run();
    assert.equal(result.status, 0, result.stderr);
    const reviewed = JSON.parse(readFileSync(join(reviewDirectory, 'manifest.json'), 'utf8'));
    assert.equal(reviewed.scenes[source.id].lastValidatedAgainst, provenance.sourceRevision);
    assert.equal(reviewed.scenes[source.id].provenanceUnknown, false);
    assert.deepEqual(readFileSync(canonical), bytes);
    assert.deepEqual(readFileSync(manifest), originalManifest);
  } finally {
    rmSync(sourceDirectory, { recursive: true, force: true });
    rmSync(reviewDirectory, { recursive: true, force: true });
  }
});

test('capture port preflight rejects an occupied IPv4 port and releases an available one', async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  await assert.rejects(assertPortAvailable(address.port), /already occupied/);
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  await assertPortAvailable(address.port);
});

test('capture port preflight rejects an occupied IPv6 localhost port', async (t) => {
  const server = createServer();
  const listenError = await new Promise((resolve) => {
    server.once('error', resolve);
    server.listen(0, '::1', () => resolve(null));
  });
  if (listenError) {
    if (['EAFNOSUPPORT', 'EADDRNOTAVAIL', 'EINVAL', 'EPROTONOSUPPORT'].includes(listenError.code)) {
      t.skip('IPv6 loopback is unavailable on this host');
      return;
    }
    throw listenError;
  }

  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  await assert.rejects(assertPortAvailable(address.port), /already occupied on ::1/);
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  await assertPortAvailable(address.port);
});
