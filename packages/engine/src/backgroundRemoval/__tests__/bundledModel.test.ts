// @vitest-environment node
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const MANIFEST_PATH = resolve(
  import.meta.dirname,
  '../../../../../apps/desktop/public/models/manifest.json',
);
const MODELS_DIR = resolve(import.meta.dirname, '../../../../../apps/desktop/public/models');

describe('bundled model integrity', () => {
  it('u2netp.onnx SHA-256 matches manifest.json', () => {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as {
      models: Array<{ id: string; sha256: string | null; bundled: boolean }>;
    };
    const entry = manifest.models.find((m) => m.id === 'u2netp');
    expect(entry?.bundled).toBe(true);
    expect(entry?.sha256).toBeTruthy();

    const bytes = readFileSync(resolve(MODELS_DIR, 'u2netp.onnx'));
    const actual = createHash('sha256').update(bytes).digest('hex');
    expect(actual).toBe(entry?.sha256);
  });
});
