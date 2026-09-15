/**
 * v2.27 → v2.28 isometric-grid migration and NaN-safe sanitization.
 *
 * The migration test computes the expected legacy geometry independently
 * (line gap ÷ sin θ) and asserts the conversion preserves the drawn grid for
 * the standard preset. Malformed saved grids must not poison the model.
 */

import { describe, expect, it } from 'vitest';
import {
  createDefaultIsometricGrid,
  ISOMETRIC_PRESETS,
  sanitizeGrid,
  sanitizeIsometricGrid,
  validateIsometricAxes,
} from './gridTypes';
import { axisSeparationDegrees, DIMETRIC_2_1_ANGLE_DEG } from './isometricGeometry';
import { migrateV227ToV228 } from './version-migrations-v228';

const legacyStandardGrid = {
  id: 'grid-isometric-default',
  type: 'isometric',
  name: 'Isometric Grid',
  visible: true,
  snapEnabled: true,
  color: 'var(--color-text-muted)',
  opacity: 0.2,
  scope: 'document',
  preset: 'standard',
  axes: [
    { angle: 30, visible: true, label: 'Right' },
    { angle: 150, visible: true, label: 'Left' },
    { angle: 90, visible: true, label: 'Vertical' },
  ],
  originX: 40,
  originY: -25,
  rotation: 0,
  spacing: 24,
  version: 2,
};

function migrate(grid: Record<string, unknown>) {
  const result = migrateV227ToV228({
    formatVersion: '2.27',
    gridSettings: { isometricGrids: { 'grid-isometric-default': grid } },
  });
  const settings = result.gridSettings as Record<string, unknown>;
  const grids = settings.isometricGrids as Record<string, Record<string, unknown>>;
  return grids['grid-isometric-default']!;
}

describe('v2.27 → v2.28 isometric migration', () => {
  it('converts legacy line-gap spacing by 2/√3 so the drawn grid is preserved', () => {
    const migrated = migrate(legacyStandardGrid);
    const separation = axisSeparationDegrees(30, 150);
    const expected = 24 / Math.abs(Math.sin((separation * Math.PI) / 180));
    expect(migrated.spacing).toBeCloseTo(expected, 12);
    expect(migrated.spacing).toBeCloseTo((24 * 2) / Math.sqrt(3), 12);
    expect(migrated.spacingMode).toBe('axis-step');
  });

  it('adds explicit plane, major-line, and snap defaults', () => {
    const migrated = migrate(legacyStandardGrid);
    expect(migrated.activePlaneId).toBe('top');
    expect(migrated.majorEvery).toBe(4);
    expect(migrated.snapToSubdivisions).toBe(true);
    expect(migrated.snapToLines).toBe(false);
    expect(migrated.version).toBe(3);
  });

  it('preserves authored origin, rotation, axes, and visibility', () => {
    const migrated = migrate(legacyStandardGrid);
    expect(migrated.originX).toBe(40);
    expect(migrated.originY).toBe(-25);
    expect(migrated.visible).toBe(true);
    expect((migrated.axes as Array<Record<string, unknown>>).map((axis) => axis.angle)).toEqual([
      30, 150, 90,
    ]);
  });

  it('keeps a custom separation conversion honest (no 2/√3 assumption)', () => {
    const migrated = migrate({
      ...legacyStandardGrid,
      axes: [
        { angle: 20, visible: true },
        { angle: 80, visible: true },
        { angle: 90, visible: true },
      ],
      spacing: 10,
    });
    const separation = axisSeparationDegrees(20, 80);
    expect(migrated.spacing).toBeCloseTo(10 / Math.sin((separation * Math.PI) / 180), 12);
  });

  it('drops malformed axes and omits the grid instead of writing NaN', () => {
    const result = migrateV227ToV228({
      formatVersion: '2.27',
      gridSettings: {
        isometricGrids: {
          broken: { ...legacyStandardGrid, axes: [{ angle: 'x' }] },
          partial: { ...legacyStandardGrid, axes: [{ angle: Number.NaN }, { angle: 90 }] },
          healthy: legacyStandardGrid,
        },
      },
    });
    const grids = (result.gridSettings as Record<string, unknown>).isometricGrids as Record<
      string,
      Record<string, unknown>
    >;
    expect(grids.broken).toBeUndefined();
    expect(grids.partial).toBeUndefined();
    expect(grids.healthy).toBeDefined();
    expect(Number.isFinite(grids.healthy!.spacing)).toBe(true);
  });

  it('is idempotent when run twice', () => {
    const once = migrate(legacyStandardGrid);
    const twice = migrateV227ToV228({
      formatVersion: '2.28',
      gridSettings: { isometricGrids: { 'grid-isometric-default': once } },
    });
    const grids = (twice.gridSettings as Record<string, unknown>).isometricGrids as Record<
      string,
      Record<string, unknown>
    >;
    expect(grids['grid-isometric-default']!.spacing).toBeCloseTo(once.spacing as number, 12);
  });
});

describe('isometric sanitization', () => {
  it('replaces NaN and Infinity with finite defaults', () => {
    const sanitized = sanitizeIsometricGrid({
      ...createDefaultIsometricGrid(),
      spacing: Number.NaN,
      originX: Number.POSITIVE_INFINITY,
      originY: Number.NEGATIVE_INFINITY,
      rotation: Number.NaN,
      opacity: Number.NaN,
      majorEvery: Number.NaN,
      axes: [
        { angle: Number.NaN, visible: true },
        { angle: Number.POSITIVE_INFINITY, visible: true },
      ],
    });
    expect(Number.isFinite(sanitized.spacing)).toBe(true);
    expect(Number.isFinite(sanitized.originX)).toBe(true);
    expect(Number.isFinite(sanitized.originY)).toBe(true);
    expect(Number.isFinite(sanitized.rotation)).toBe(true);
    expect(Number.isFinite(sanitized.opacity)).toBe(true);
    expect(sanitized.majorEvery).toBe(4);
    for (const axis of sanitized.axes) {
      expect(Number.isFinite(axis.angle)).toBe(true);
    }
    expect(sanitized.axes.length).toBeGreaterThanOrEqual(2);
  });

  it('restores a usable axis set when saved axes are missing', () => {
    const sanitized = sanitizeIsometricGrid({
      ...createDefaultIsometricGrid(),
      axes: [],
    });
    expect(sanitized.axes.length).toBe(3);
    expect(sanitized.axes.map((axis) => axis.angle)).toEqual([30, 150, 90]);
  });

  it('clamps rather than discards a valid but extreme configuration', () => {
    const sanitized = sanitizeIsometricGrid({
      ...createDefaultIsometricGrid(),
      spacing: 1e12,
      originX: -1e12,
      rotation: 725,
      majorEvery: 5000,
    });
    expect(sanitized.spacing).toBe(100000);
    expect(sanitized.originX).toBe(-1e7);
    expect(sanitized.rotation).toBeCloseTo(5, 9);
    expect(sanitized.majorEvery).toBe(64);
  });

  it('routes sanitizeGrid through the isometric sanitizer', () => {
    const sanitized = sanitizeGrid({
      ...createDefaultIsometricGrid(),
      spacing: Number.NaN,
    });
    expect(sanitized.type).toBe('isometric');
    if (sanitized.type === 'isometric') {
      expect(Number.isFinite(sanitized.spacing)).toBe(true);
      expect(sanitized.spacingMode).toBe('axis-step');
    }
  });
});

describe('presets', () => {
  it('labels presets honestly and supplies exact 2:1 angles', () => {
    const dimetric = ISOMETRIC_PRESETS.find((preset) => preset.id === 'dimetric')!;
    expect(dimetric.label).toContain('2:1');
    expect(dimetric.ratio).toEqual({ height: 1, width: 2 });
    expect(dimetric.axes[0]!.angle).toBe(DIMETRIC_2_1_ANGLE_DEG);
    const standard = ISOMETRIC_PRESETS.find((preset) => preset.id === 'standard')!;
    expect(standard.label).toContain('True isometric');
    expect(standard.axes.map((axis) => axis.angle)).toEqual([30, 150, 90]);
    const trimetric = ISOMETRIC_PRESETS.find((preset) => preset.id === 'trimetric')!;
    expect(trimetric.description.toLowerCase()).toContain('not a measured');
  });

  it('rejects near-parallel axes and NaN angles through validation', () => {
    expect(
      validateIsometricAxes([
        { angle: 30, visible: true },
        { angle: 30.2, visible: true },
      ]).valid,
    ).toBe(false);
    expect(
      validateIsometricAxes([
        { angle: Number.NaN, visible: true },
        { angle: 150, visible: true },
      ]).valid,
    ).toBe(false);
    expect(
      validateIsometricAxes([
        { angle: 30, visible: true },
        { angle: 150, visible: true },
      ]).valid,
    ).toBe(true);
    expect(
      validateIsometricAxes([
        { angle: 30, visible: true },
        { angle: 150, visible: true },
        { angle: 210, visible: true },
      ]).valid,
    ).toBe(false);
  });
});
