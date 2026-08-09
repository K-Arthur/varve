/**
 * Color round-trip test: serialize → deserialize preserves bit depth,
 * ICC profile, and channel values.
 *
 * Research basis: ADR-0009 document color architecture.
 */

import { describe, expect, it } from 'vitest';
import { migrateDocument, serializeDocument } from '../version';

describe('color round-trip', () => {
  it('preserves float32 CMYK bit depth through serialize → deserialize', () => {
    const doc = {
      formatVersion: '2.5',
      id: 'rt1',
      name: 'RoundTrip',
      nodes: {
        n1: {
          id: 'n1',
          kind: 'shape',
          name: 'CyanSwatch',
          shape: { kind: 'rect', x: 0, y: 0, w: 100, h: 50 },
          transform: [1, 0, 0, 1, 0, 0],
          fill: {
            space: 'cmyk',
            bitDepth: 'float32',
            c: 0.5,
            m: 0.0,
            y: 0.0,
            k: 0.0,
            a: 1,
          } as const,
        },
      },
      rootChildren: ['n1'],
      colorConfig: {
        mode: 'cmyk',
        bitDepth: 'float32',
        workingSpace: 'linear',
        rgbProfile: { id: 'srgb', name: 'sRGB' },
        cmykProfile: { id: 'fogra39', name: 'Fogra39' },
        blackGeneration: { type: 'none' },
      },
    };

    const json = serializeDocument(doc);
    const parsed = JSON.parse(json) as Record<string, unknown>;
    const migrated = migrateDocument(parsed);

    expect(migrated).not.toBeNull();
    const config = migrated!.colorConfig as Record<string, unknown> | undefined;
    expect(config?.bitDepth).toBe('float32');
    expect(config?.workingSpace).toBe('linear');

    const nodes = migrated!.nodes as Record<string, Record<string, unknown>>;
    const fill = nodes.n1?.fill as Record<string, unknown> | undefined;
    expect(fill?.bitDepth).toBe('float32');
    expect(fill?.space).toBe('cmyk');
    expect(fill?.c).toBeCloseTo(0.5, 5);
  });

  it('preserves ICC profile assignment on color', () => {
    const doc = {
      formatVersion: '2.5',
      id: 'rt2',
      name: 'ProfileTest',
      nodes: {
        n1: {
          id: 'n1',
          kind: 'shape',
          name: 'P3Red',
          shape: { kind: 'rect', x: 0, y: 0, w: 100, h: 50 },
          transform: [1, 0, 0, 1, 0, 0],
          fill: {
            space: 'rgb',
            bitDepth: 'float16',
            r: 0.5,
            g: 0.2,
            b: 0.8,
            a: 1,
            profile: 'display-p3',
          } as const,
        },
      },
      rootChildren: ['n1'],
      colorConfig: {
        mode: 'rgb',
        bitDepth: 'float16',
        workingSpace: 'linear',
        rgbProfile: { id: 'display-p3', name: 'Display P3' },
        cmykProfile: { id: 'fogra39', name: 'Fogra39' },
        blackGeneration: { type: 'none' },
      },
    };

    const json = serializeDocument(doc);
    const parsed = JSON.parse(json) as Record<string, unknown>;
    const migrated = migrateDocument(parsed);

    const nodes = migrated!.nodes as Record<string, Record<string, unknown>>;
    const fill = nodes.n1?.fill as Record<string, unknown> | undefined;
    expect(fill?.profile).toBe('display-p3');
    expect(fill?.bitDepth).toBe('float16');
    expect(fill?.r).toBeCloseTo(0.5, 5);
  });

  it('preserves spot color reference', () => {
    const doc = {
      formatVersion: '2.5',
      id: 'rt3',
      name: 'SpotTest',
      nodes: {
        n1: {
          id: 'n1',
          kind: 'shape',
          name: 'Spot',
          shape: { kind: 'rect', x: 0, y: 0, w: 100, h: 50 },
          transform: [1, 0, 0, 1, 0, 0],
          fill: {
            space: 'spot',
            name: 'PANTONE 185 C',
            tint: 80,
            a: 255,
            processFallback: { c: 0, m: 91, y: 76, k: 0 },
          } as const,
        },
      },
      rootChildren: ['n1'],
      colorConfig: {
        mode: 'cmyk',
        bitDepth: 'uint8',
        workingSpace: 'srgb',
        rgbProfile: { id: 'srgb', name: 'sRGB' },
        cmykProfile: { id: 'fogra39', name: 'Fogra39' },
        blackGeneration: { type: 'none' },
      },
    };

    const json = serializeDocument(doc);
    const parsed = JSON.parse(json) as Record<string, unknown>;
    const migrated = migrateDocument(parsed);

    const nodes = migrated!.nodes as Record<string, Record<string, unknown>>;
    const fill = nodes.n1?.fill as Record<string, unknown> | undefined;
    expect(fill?.space).toBe('spot');
    expect(fill?.name).toBe('PANTONE 185 C');
    expect(fill?.tint).toBe(80);
  });

  it('loads v2.3 document (no bitDepth) with uint8 default', () => {
    // Simulate a v2.3 document: no bitDepth, no workingSpace on colorConfig,
    // and colors without bitDepth field.
    const v23Fixture = {
      formatVersion: '2.3',
      id: 'v23',
      name: 'Legacy',
      nodes: {
        n1: {
          id: 'n1',
          kind: 'shape',
          name: 'Red',
          shape: { kind: 'rect', x: 0, y: 0, w: 100, h: 50 },
          transform: [1, 0, 0, 1, 0, 0],
          fill: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 },
        },
      },
      rootChildren: ['n1'],
      colorConfig: {
        mode: 'rgb',
        rgbProfile: { id: 'srgb', name: 'sRGB' },
        cmykProfile: { id: 'fogra39', name: 'Fogra39' },
        blackGeneration: { type: 'none' },
      },
    };

    const migrated = migrateDocument(v23Fixture as unknown as Record<string, unknown>);
    expect(migrated).not.toBeNull();
    expect(migrated!.formatVersion).toBe('2.19');

    const config = migrated!.colorConfig as Record<string, unknown> | undefined;
    expect(config).toBeDefined();
    expect(config!.bitDepth).toBe('uint8');
    expect(config!.workingSpace).toBe('srgb');

    // Color should have no bitDepth (default is uint8 at read time)
    const nodes = migrated!.nodes as Record<string, Record<string, unknown>>;
    const fill = nodes.n1?.fill as Record<string, unknown> | undefined;
    expect(fill?.r).toBe(255);
    expect(fill?.g).toBe(0);
    expect(fill?.b).toBe(0);
  });
});
