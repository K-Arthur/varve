import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  assertPortAvailable,
  assertReviewDirectorySafe,
  sourceSceneProvenance,
} from './capture-safety.mjs';

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
