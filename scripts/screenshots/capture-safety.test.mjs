import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  assertPortAvailable,
  assertReviewDirectorySafe,
  reviewedAssemblyMetadata,
  sourceSceneProvenance,
} from './capture-safety.mjs';
import { captureSourceIdentity, readProducerCaptureReceipt } from './producer-capture.mjs';
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

const assemblyIdentity = {
  sourceRevision: 'c'.repeat(40),
  sourceDigest: 'd'.repeat(64),
  sourceDirty: false,
};
const assemblyScene = (revision, hash) => ({
  status: 'captured',
  provenanceUnknown: false,
  file: `${hash}.png`,
  sha256: hash.repeat(64),
  capturedAt: '2026-10-02T03:00:00.000Z',
  lastValidatedAgainst: revision.repeat(40),
  provenance: {
    sourceRevision: revision.repeat(40),
    sourceDigest: hash.repeat(64),
    sourceDirty: false,
    captureTool: 'Playwright / Chromium actual producer',
  },
});
const assemblyOptions = (scenes) => ({
  scenes,
  sourceIdentity: assemblyIdentity,
  assembledAt: '2026-10-03T00:00:00.000Z',
  reviewSha256: 'e'.repeat(64),
  reviewedAgainst: 'f'.repeat(64),
  promotedSceneIDs: ['new'],
});

test('reviewed promotion metadata keeps mixed producer revisions and actual assembly digest', () => {
  const scenes = { old: assemblyScene('a', '1'), new: assemblyScene('b', '2') };
  const original = structuredClone(scenes);
  const result = reviewedAssemblyMetadata(assemblyOptions(scenes));
  assert.deepEqual(scenes, original);
  assert.equal(result.sourceRevision, assemblyIdentity.sourceRevision);
  assert.equal(result.sourceDigest, assemblyIdentity.sourceDigest);
  assert.deepEqual(result.provenance.capturedSourceRevisions, ['a'.repeat(40), 'b'.repeat(40)]);
  assert.equal(result.provenance.kind, 'reviewed-mixed-source-assembly');
  assert.match(result.provenance.runtime, /no new capture/);
  assert.equal(result.provenance.sourceDirty, undefined);
  assert.equal(result.provenance.assemblySourceDirty, false);
  assert.equal(result.provenance.reviewManifestSha256, 'e'.repeat(64));
});

test('reviewed promotion identity digest responds to changed scene proof and exposes unknown provenance', () => {
  const scenes = { old: assemblyScene('a', '1'), new: assemblyScene('b', '2') };
  const before = reviewedAssemblyMetadata(assemblyOptions(scenes));
  scenes.new.sha256 = '3'.repeat(64);
  const after = reviewedAssemblyMetadata(assemblyOptions(scenes));
  assert.notEqual(after.provenance.sceneIdentitySha256, before.provenance.sceneIdentitySha256);
  scenes.old.provenanceUnknown = true;
  delete scenes.old.provenance;
  assert.deepEqual(
    reviewedAssemblyMetadata(assemblyOptions(scenes)).provenance.provenanceUnknownSceneIDs,
    ['old'],
  );
});

test('reviewed promotion refuses missing actual identity instead of falling back to a normalizer', () => {
  for (const sourceIdentity of [
    undefined,
    {},
    { ...assemblyIdentity, sourceDigest: '' },
    { ...assemblyIdentity, sourceDirty: undefined },
  ]) {
    assert.throws(
      () => reviewedAssemblyMetadata({ ...assemblyOptions({}), sourceIdentity }),
      /actual promotion source identity/,
    );
  }
  assert.equal(
    reviewedAssemblyMetadata({
      ...assemblyOptions({}),
      sourceIdentity: { ...assemblyIdentity, sourceDirty: true },
    }).provenance.assemblySourceDirty,
    true,
  );
});

test('reviewed promotion CLI replaces dirty normalize aggregate metadata without relabeling producer scenes', () => {
  const root = fileURLToPath(new URL('../..', import.meta.url));
  const fixture = mkdtempSync(join(tmpdir(), 'varve-promotion-assembly-'));
  const actualGitDir = spawnSync('git', ['rev-parse', '--absolute-git-dir'], {
    cwd: root,
    encoding: 'utf8',
  }).stdout.trim();
  const sourceRoot = spawnSync('git', ['rev-parse', '--show-toplevel'], {
    cwd: root,
    encoding: 'utf8',
  }).stdout.trim();
  const env = { ...process.env, GIT_DIR: actualGitDir, GIT_WORK_TREE: sourceRoot };
  const bytes = readFileSync(join(root, 'docs/screenshots/product/comic-lettering-light.png'));
  const imageHash = createHash('sha256').update(bytes).digest('hex');
  const scene = (revision, file) => ({ ...assemblyScene(revision, '1'), file, sha256: imageHash });
  const original = {
    schemaVersion: 2,
    sourceRevision: '9'.repeat(40),
    sourceDigest: '8'.repeat(64),
    captureTool: 'stale normalizer',
    provenance: { runtime: 'metadata-only (--normalize; no capture)', sourceDirty: true },
    scenes: { old: scene('a', 'old.png'), new: scene('a', 'new.png') },
  };
  const sourceFiles = [
    'scripts/screenshots/product.mjs',
    'scripts/screenshots/capture-safety.mjs',
    'scripts/screenshots/producer-capture.mjs',
    'scripts/screenshots/source-scenes.mjs',
    'scripts/screenshots/lib/image-analysis.mjs',
    'scripts/quality/heavy-lease.mjs',
  ];
  try {
    // The fixture points Git metadata at the live worktree so its provenance
    // revision is real. Mirror untracked capture inputs too: source identity
    // hashes those bytes, and a temporary fixture that omits a new test file
    // would otherwise fail with ENOENT while unrelated work is in progress.
    const untrackedSource = spawnSync(
      'git',
      [
        'ls-files',
        '--others',
        '--exclude-standard',
        '-z',
        '--',
        'packages',
        'apps/desktop',
        'tests/e2e',
        'scripts/screenshots',
      ],
      { cwd: root, encoding: 'utf8' },
    );
    assert.equal(untrackedSource.status, 0, untrackedSource.stderr);
    for (const file of sourceFiles) {
      mkdirSync(dirname(join(fixture, file)), { recursive: true });
      copyFileSync(join(root, file), join(fixture, file));
    }
    for (const file of untrackedSource.stdout.split('\0').filter(Boolean)) {
      const source = join(root, file);
      const destination = join(fixture, file);
      mkdirSync(dirname(destination), { recursive: true });
      copyFileSync(source, destination);
    }
    symlinkSync(join(root, 'node_modules'), join(fixture, 'node_modules'), 'junction');
    const canonicalManifest = join(fixture, 'apps/website/src/data/screenshot-manifest.json');
    mkdirSync(dirname(canonicalManifest), { recursive: true });
    const originalBytes = Buffer.from(`${JSON.stringify(original)}\n`);
    writeFileSync(canonicalManifest, originalBytes);
    for (const directory of [
      'docs/screenshots/product',
      'apps/website/public/screenshots',
      'review',
    ])
      mkdirSync(join(fixture, directory), { recursive: true });
    for (const directory of ['docs/screenshots/product', 'apps/website/public/screenshots'])
      for (const file of ['old.png', 'new.png'])
        writeFileSync(join(fixture, directory, file), bytes);
    const reviewed = {
      reviewedAgainst: createHash('sha256').update(originalBytes).digest('hex'),
      sourceRevision: '7'.repeat(40),
      sourceDigest: '6'.repeat(64),
      provenance: { sourceDirty: true, runtime: 'dirty normalization' },
      scenes: { new: scene('b', 'new.png') },
    };
    const reviewBytes = Buffer.from(JSON.stringify(reviewed));
    writeFileSync(join(fixture, 'review/manifest.json'), reviewBytes);
    writeFileSync(join(fixture, 'review/new.png'), bytes);
    const result = spawnSync(
      process.execPath,
      [
        join(fixture, 'scripts/screenshots/product.mjs'),
        '--sync-reviewed',
        '--review-dir',
        join(fixture, 'review'),
        '--scenes',
        'new',
      ],
      { cwd: root, env, encoding: 'utf8', timeout: 15_000 },
    );
    assert.equal(result.status, 0, result.stderr.slice(0, 3000));
    const promoted = JSON.parse(readFileSync(canonicalManifest));
    assert.equal(promoted.sourceRevision, captureSourceIdentity(sourceRoot).sourceRevision);
    assert.notEqual(promoted.sourceRevision, original.sourceRevision);
    assert.notEqual(promoted.sourceDigest, original.sourceDigest);
    assert.notEqual(promoted.sourceDigest, reviewed.sourceDigest);
    assert.equal(promoted.provenance.kind, 'reviewed-mixed-source-assembly');
    assert.deepEqual(promoted.scenes.old, original.scenes.old);
    assert.equal(promoted.scenes.new.provenance.sourceRevision, 'b'.repeat(40));
    assert.equal(promoted.scenes.new.lastValidatedAgainst, 'b'.repeat(40));
    assert.equal(promoted.scenes.new.capturedAt, reviewed.scenes.new.capturedAt);
    assert.equal(
      promoted.provenance.reviewManifestSha256,
      createHash('sha256').update(reviewBytes).digest('hex'),
    );
    assert.deepEqual(promoted.provenance.capturedSourceRevisions, ['a'.repeat(40), 'b'.repeat(40)]);
    for (const directory of ['docs/screenshots/product', 'apps/website/public/screenshots'])
      for (const file of ['old.png', 'new.png'])
        assert.deepEqual(readFileSync(join(fixture, directory, file)), bytes);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
