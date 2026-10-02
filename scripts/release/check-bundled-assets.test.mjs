import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { inspectBundledAssets } from './check-bundled-assets.mjs';

function fixture(
  t,
  models = [
    { id: 'baseline', filename: 'baseline.onnx', bundled: true },
    { id: 'optional', filename: 'optional.onnx', bundled: false },
  ],
) {
  const root = mkdtempSync(join(tmpdir(), 'varve-bundled-assets-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (relativePath, data) => {
    const path = join(root, relativePath);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, data);
  };
  write('apps/desktop/public/models/manifest.json', JSON.stringify({ models }));
  return { root, write };
}

const weights = Buffer.alloc(2048, 42);

test('accepts declared bundled weights in source and built output', (t) => {
  const { root, write } = fixture(t);
  write('apps/desktop/public/models/baseline.onnx', weights);
  write('apps/desktop/dist/models/baseline.onnx', weights);
  const result = inspectBundledAssets({ root, checkDist: true });
  assert.deepEqual(result.problems, []);
  assert.equal(result.checked, 2);
});

test('rejects a locally downloaded optional model in public before packaging', (t) => {
  const { root, write } = fixture(t);
  write('apps/desktop/public/models/optional.onnx', weights);
  assert.match(inspectBundledAssets({ root }).problems.join('\n'), /public.*optional\.onnx/);
});

test('rejects stale optional weights in dist after the source file has been removed', (t) => {
  const { root, write } = fixture(t);
  write('apps/desktop/public/models/baseline.onnx', weights);
  write('apps/desktop/dist/models/optional.onnx', weights);
  const result = inspectBundledAssets({ root, checkDist: true });
  assert.equal(result.problems.length, 1);
  assert.match(result.problems[0], /dist.*optional\.onnx/);
  assert.match(result.problems[0], /built installer payload/);
});

test('still rejects bundled LFS pointers in either source or dist', (t) => {
  const { root, write } = fixture(t);
  const pointer = `version https://git-lfs.github.com/spec/v1\noid sha256:${'a'.repeat(64)}\nsize 2048\n`;
  write('apps/desktop/public/models/baseline.onnx', pointer);
  write('apps/desktop/dist/models/baseline.onnx', pointer);
  const result = inspectBundledAssets({ root, checkDist: true });
  assert.equal(result.problems.length, 2);
  assert.ok(result.problems.every((problem) => problem.includes('Git LFS pointer')));
});

test('still rejects catalog disagreements and unpinned insecure model URLs', (t) => {
  const { root, write } = fixture(t, [
    {
      id: 'optional',
      filename: 'optional.onnx',
      bundled: false,
      remoteUrl: 'http://example.com/model',
    },
  ]);
  write(
    'packages/engine/src/inference/modelCatalog.ts',
    "[\n  {\n    id: 'optional',\n    bundled: true,\n  },\n]\n",
  );
  const result = inspectBundledAssets({ root });
  assert.equal(result.problems.length, 3);
  assert.match(result.problems.join('\n'), /must agree/);
  assert.match(result.problems.join('\n'), /no sha256/);
  assert.match(result.problems.join('\n'), /non-HTTPS/);
});
