/**
 * Gradient-map portability tests: embedded-gradient recovery and round-trip.
 *
 * A document must keep rendering a gradient map when its referenced global
 * preset is renamed, moved, or deleted on another device. The guarantee is
 * implemented by snapshotting the gradient on the adjustment (`embeddedGradient`)
 * at apply time; `resolveGradientMapPreset` prefers that snapshot and only
 * falls back to legacy `stops`. These tests pin that contract.
 */
import { describe, expect, it } from 'vitest';
import { createDocument } from './document';
import {
  addGradientPresetsToDocument,
  embeddedGradientToGradientPreset,
  makeGradientPreset,
  removeGradientPresetsFromDocument,
  resolveGradientMapPreset,
} from './gradientPresets';

const embedded = {
  id: 'gpreset-snapshot',
  name: 'Sunset',
  kind: 'solid' as const,
  colorStops: [
    { position: 0, midpoint: 0.5, color: [40, 20, 120, 255] as const },
    { position: 1, midpoint: 0.5, color: [255, 140, 30, 255] as const },
  ],
  opacityStops: [
    { position: 0, opacity: 1 },
    { position: 1, opacity: 1 },
  ],
  interpolation: 'oklab' as const,
};

describe('resolveGradientMapPreset', () => {
  it('prefers the embedded gradient over legacy stops', () => {
    const resolved = resolveGradientMapPreset({
      stops: [
        { position: 0, color: [0, 0, 0, 255] },
        { position: 1, color: [255, 255, 255, 255] },
      ],
      embeddedGradient: embedded,
    });
    expect(resolved.id).toBe('gpreset-snapshot');
    expect(resolved.colorStops[1]!.color).toMatchObject({ r: 255, g: 140, b: 30 });
  });

  it('falls back to stops for legacy adjustments without an embedded snapshot', () => {
    const resolved = resolveGradientMapPreset({
      stops: [
        { position: 0, color: [0, 0, 0, 255] },
        { position: 0.5, color: [120, 120, 120, 255] },
        { position: 1, color: [255, 255, 255, 255] },
      ],
    });
    expect(resolved.colorStops).toHaveLength(3);
    expect(resolved.colorStops[0]!.color).toMatchObject({ r: 0, g: 0, b: 0 });
  });

  it('round-trips embedded gradient data without loss', () => {
    const restored = embeddedGradientToGradientPreset(embedded);
    expect(restored.id).toBe('gpreset-snapshot');
    expect(restored.name).toBe('Sunset');
    expect(restored.interpolation).toBe('oklab');
    expect(restored.colorStops).toHaveLength(2);
    expect(restored.opacityStops).toHaveLength(2);
  });
});

describe('deleted-global-preset recovery', () => {
  it('still resolves the gradient after the global preset is deleted from the document', () => {
    const preset = makeGradientPreset({
      id: 'gpreset-global',
      name: 'Sunset',
      colorStops: [
        { position: 0, color: { space: 'rgb', r: 40, g: 20, b: 120, a: 255 } },
        { position: 1, color: { space: 'rgb', r: 255, g: 140, b: 30, a: 255 } },
      ],
    });
    const withPreset = addGradientPresetsToDocument({}, [preset]).doc;

    // The adjustment references the global preset but carries its own snapshot.
    const adjustment = { presetId: 'gpreset-global', stops: [], embeddedGradient: embedded };
    const beforeDelete = resolveGradientMapPreset(adjustment);
    expect(beforeDelete.name).toBe('Sunset');

    // Delete the global preset (simulating rename/move/unavailable-on-device).
    const afterDelete = removeGradientPresetsFromDocument(withPreset, ['gpreset-global']);
    expect(afterDelete.gradientPresets ?? []).toHaveLength(0);

    // Rendering still resolves from the embedded copy.
    const still = resolveGradientMapPreset(adjustment);
    expect(still.id).toBe('gpreset-snapshot');
    expect(still.colorStops[0]!.color).toMatchObject({ r: 40, g: 20, b: 120 });
  });

  it('preserves the embedded gradient through document serialization', () => {
    const doc = createDocument('portability', true) as unknown as {
      nodes: Record<string, unknown>;
    };
    const adjustment = {
      kind: 'gradientMap',
      id: 'adj-1',
      stops: [],
      dither: false,
      preserveLuminosity: false,
      embeddedGradient: embedded,
    };
    (doc.nodes as Record<string, unknown>).n1 = {
      kind: 'adjustment',
      adjustments: [adjustment],
    };

    const roundTrip = JSON.parse(JSON.stringify(doc)) as typeof doc;
    const node = roundTrip.nodes.n1 as {
      adjustments?: Array<{ embeddedGradient?: typeof embedded }>;
    };
    expect(node.adjustments?.[0]?.embeddedGradient?.id).toBe('gpreset-snapshot');
    expect(node.adjustments?.[0]?.embeddedGradient?.colorStops).toHaveLength(2);
  });
});
