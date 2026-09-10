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

  it('BiRefNet manifest entries have working rembg mirror URLs', () => {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as {
      models: Array<{ id: string; sha256: string | null; bundled: boolean; remoteUrl: string }>;
    };
    const lite = manifest.models.find((m) => m.id === 'birefnet-general-lite');
    const full = manifest.models.find((m) => m.id === 'birefnet-general');
    expect(lite?.remoteUrl).toContain('danielgatis/rembg');
    expect(lite?.remoteUrl).toContain('BiRefNet-general-bb_swin_v1_tiny');
    expect(lite?.bundled).toBe(false);
    expect(lite?.sha256).toBe('5600024376f572a557870a5eb0afb1e5961636bef4e1e22132025467d0f03333');
    expect(full?.remoteUrl).toContain('BiRefNet-general-epoch_244');
    expect(full?.bundled).toBe(false);
    expect(full?.sha256).toBe('58f621f00f5d756097615970a88a791584600dcf7c45b18a0a6267535a1ebd3c');
  });

  it('yunet-face-detect SHA-256 matches manifest.json', () => {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as {
      models: Array<{ id: string; filename: string; sha256: string | null; bundled: boolean }>;
    };
    const entry = manifest.models.find((model) => model.id === 'yunet-face-detect');
    expect(entry?.bundled).toBe(true);
    expect(entry?.sha256).toBe('8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4');

    const bytes = readFileSync(resolve(MODELS_DIR, entry?.filename ?? 'missing'));
    const actual = createHash('sha256').update(bytes).digest('hex');
    expect(actual).toBe(entry?.sha256);
  });

  it('bundled Real-ESRGAN x4v3 SHA-256 matches manifest.json', () => {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as {
      models: Array<{ id: string; filename: string; sha256: string | null; bundled: boolean }>;
    };
    const entry = manifest.models.find((model) => model.id === 'upscale-realesr-general');
    expect(entry?.bundled).toBe(true);
    expect(entry?.sha256).toBeTruthy();

    const bytes = readFileSync(resolve(MODELS_DIR, entry?.filename ?? 'missing'));
    const actual = createHash('sha256').update(bytes).digest('hex');
    expect(actual).toBe(entry?.sha256);
  });
});
