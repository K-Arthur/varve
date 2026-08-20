import { describe, expect, it } from 'vitest';
import { defaultBrushPreset } from '../brush';
import {
  BRUSH_PACKAGE_FORMAT,
  BRUSH_PACKAGE_VERSION,
  type BrushGrainResource,
  collectGrainDependencies,
  exportBrushPackage,
  importBrushPackage,
  MAX_EMBEDDED_GRAIN_BYTES,
  resolveImportCollisions,
  serializeBrushPackage,
} from '../brushPackage';

const preset = (id: string, grainId?: string) => ({
  ...defaultBrushPreset(id, `Brush ${id}`),
  ...(grainId ? { grainId } : {}),
});

const grain = (id: string, data = 'AAAA'): BrushGrainResource => ({
  id,
  name: id,
  mimeType: 'image/png',
  data,
  contentHash: `hash-${data}`,
});

describe('brush export', () => {
  it('embeds the grains a preset depends on', () => {
    const pkg = exportBrushPackage([preset('a', 'paper')], {
      resolveResource: (id) => grain(id),
    });
    expect(pkg.format).toBe(BRUSH_PACKAGE_FORMAT);
    expect(pkg.resources.map((r) => r.id)).toEqual(['paper']);
  });

  it('leaves built-in grains as bare references', () => {
    // resolveResource declining means "the recipient already has this".
    const pkg = exportBrushPackage([preset('a', 'builtin-canvas')], {
      resolveResource: () => null,
    });
    expect(pkg.resources).toHaveLength(0);
    expect(pkg.presets[0]!.grainId).toBe('builtin-canvas');
  });

  it('does not embed the same texture twice', () => {
    const pkg = exportBrushPackage([preset('a', 'x'), preset('b', 'y')], {
      resolveResource: (id) => ({ ...grain(id, 'SAME'), contentHash: 'shared' }),
    });
    expect(pkg.resources).toHaveLength(1);
  });

  it('ignores procedural grain', () => {
    expect(collectGrainDependencies([preset('a', 'procedural')])).toEqual([]);
  });

  it('round-trips through serialization', () => {
    const pkg = exportBrushPackage([preset('a', 'paper')], { resolveResource: (id) => grain(id) });
    const result = importBrushPackage(serializeBrushPackage(pkg));
    expect(result.ok).toBe(true);
    expect(result.presets[0]!.id).toBe('a');
    expect(result.resources[0]!.id).toBe('paper');
  });
});

describe('brush import validation', () => {
  it('rejects malformed JSON', () => {
    const r = importBrushPackage('{not json');
    expect(r.ok).toBe(false);
    expect(r.issues[0]!.code).toBe('not-an-object');
  });

  it('rejects a file that is not a brush package', () => {
    expect(importBrushPackage({ format: 'something-else', version: 1 }).issues[0]!.code).toBe(
      'wrong-format',
    );
  });

  it('refuses a package from a newer Varve', () => {
    const r = importBrushPackage({
      format: BRUSH_PACKAGE_FORMAT,
      version: BRUSH_PACKAGE_VERSION + 1,
      presets: [preset('a')],
    });
    expect(r.ok).toBe(false);
    expect(r.issues[0]!.code).toBe('unsupported-version');
  });

  it('caps how many presets one package may carry', () => {
    const r = importBrushPackage({
      format: BRUSH_PACKAGE_FORMAT,
      version: 1,
      presets: Array.from({ length: 500 }, (_, i) => preset(`p${i}`)),
    });
    expect(r.issues[0]!.code).toBe('too-many-presets');
  });

  it('drops an unreadable preset but keeps the rest', () => {
    const r = importBrushPackage({
      format: BRUSH_PACKAGE_FORMAT,
      version: 1,
      presets: [preset('good'), { id: 'bad' }, preset('other')],
    });
    expect(r.ok).toBe(true);
    expect(r.presets.map((p) => p.id)).toEqual(['good', 'other']);
    expect(r.issues.some((i) => i.code === 'invalid-preset')).toBe(true);
  });

  it('never lets unknown keys reach a runtime brush', () => {
    const r = importBrushPackage({
      format: BRUSH_PACKAGE_FORMAT,
      version: 1,
      presets: [{ ...preset('a'), __proto__: { polluted: true }, evil: 'x' }],
    });
    expect(r.ok).toBe(true);
    expect('evil' in r.presets[0]!).toBe(false);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('rejects a path-shaped resource id', () => {
    const r = importBrushPackage({
      format: BRUSH_PACKAGE_FORMAT,
      version: 1,
      presets: [preset('a')],
      resources: [{ ...grain('x'), id: '../../etc/passwd' }],
    });
    expect(r.issues.some((i) => i.code === 'invalid-resource')).toBe(true);
    expect(r.resources).toHaveLength(0);
  });

  it('rejects an unsupported image type', () => {
    const r = importBrushPackage({
      format: BRUSH_PACKAGE_FORMAT,
      version: 1,
      presets: [preset('a')],
      resources: [{ ...grain('x'), mimeType: 'image/svg+xml' }],
    });
    expect(r.issues.some((i) => i.code === 'invalid-resource')).toBe(true);
  });

  it('refuses an oversized embedded grain before allocating it', () => {
    const oversized = 'A'.repeat(Math.ceil((MAX_EMBEDDED_GRAIN_BYTES * 4) / 3) + 8);
    const r = importBrushPackage({
      format: BRUSH_PACKAGE_FORMAT,
      version: 1,
      presets: [preset('a')],
      resources: [{ ...grain('x'), data: oversized }],
    });
    expect(r.issues.some((i) => i.code === 'resource-too-large')).toBe(true);
  });

  it('reports a grain reference the package does not carry', () => {
    const r = importBrushPackage({
      format: BRUSH_PACKAGE_FORMAT,
      version: 1,
      presets: [preset('a', 'absent-texture')],
    });
    expect(r.ok).toBe(true);
    // The reference survives so it can resolve locally or report missing —
    // it is never quietly swapped for a different texture.
    expect(r.presets[0]!.grainId).toBe('absent-texture');
    expect(r.issues.some((i) => i.code === 'missing-resource')).toBe(true);
  });

  it('keeps only the first of two presets sharing an id', () => {
    const r = importBrushPackage({
      format: BRUSH_PACKAGE_FORMAT,
      version: 1,
      presets: [
        { ...preset('dup'), name: 'First' },
        { ...preset('dup'), name: 'Second' },
      ],
    });
    expect(r.presets).toHaveLength(1);
    expect(r.presets[0]!.name).toBe('First');
  });
});

describe('import collisions', () => {
  const existing = new Set(['a', 'b']);

  it('adds a preset with a free id', () => {
    const [r] = resolveImportCollisions([preset('c')], existing, 'copy');
    expect(r!.action).toBe('added');
  });

  it('never overwrites silently — replacing is an explicit policy', () => {
    expect(resolveImportCollisions([preset('a')], existing, 'skip')[0]!.action).toBe('skipped');
    expect(resolveImportCollisions([preset('a')], existing, 'replace')[0]!.action).toBe('replaced');
  });

  it('gives a copy a fresh id and a distinguishable name', () => {
    const [r] = resolveImportCollisions([preset('a')], existing, 'copy');
    expect(r!.action).toBe('copied');
    expect(r!.preset.id).not.toBe('a');
    expect(r!.preset.name).toContain('copy');
  });

  it('keeps copies unique within one import', () => {
    const results = resolveImportCollisions([preset('a'), preset('a')], existing, 'copy');
    expect(new Set(results.map((r) => r.preset.id)).size).toBe(2);
  });
});
