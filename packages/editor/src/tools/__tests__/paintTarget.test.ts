import { describe, expect, it } from 'vitest';
import {
  type PaintTargetInput,
  paintTargetStatus,
  resolvePaintTarget,
  targetSupportsTool,
  targetUsesColor,
} from '../paintTarget';

function input(overrides: Partial<PaintTargetInput> = {}): PaintTargetInput {
  return {
    document: {
      nodes: {
        raster: { id: 'raster', kind: 'rasterLayer', name: 'Sketch', visible: true, locked: false },
        text: { id: 'text', kind: 'text', name: 'Title', visible: true, locked: false },
        locked: {
          id: 'locked',
          kind: 'rasterLayer',
          name: 'Background',
          visible: true,
          locked: true,
        },
        hidden: {
          id: 'hidden',
          kind: 'rasterLayer',
          name: 'Draft',
          visible: false,
          locked: false,
        },
      },
    } as unknown as PaintTargetInput['document'],
    selection: [],
    ...overrides,
  };
}

describe('paint target resolution', () => {
  it('targets a selected raster layer', () => {
    const target = resolvePaintTarget(input({ selection: ['raster'] }));
    expect(target).toMatchObject({ kind: 'rasterLayer', nodeId: 'raster', label: 'Sketch' });
  });

  it('falls back to the tool-supplied layer when nothing raster is selected', () => {
    const target = resolvePaintTarget(input({ fallbackLayerId: 'raster' }));
    expect(target).toMatchObject({ kind: 'rasterLayer', nodeId: 'raster' });
  });

  it('prefers an explicit mask target over the selection', () => {
    // The point of an explicit mode is that it is not inferred.
    const target = resolvePaintTarget(
      input({ selection: ['raster'], maskEditTarget: { nodeId: 'raster', maskId: 'm1' } }),
    );
    expect(target).toMatchObject({ kind: 'rasterMask', nodeId: 'raster', maskId: 'm1' });
    expect(paintTargetStatus(target)).toContain('Layer Mask');
  });

  it('refuses a locked layer with a reason instead of failing silently', () => {
    const target = resolvePaintTarget(input({ selection: ['locked'] }));
    expect(target.kind).toBe('none');
    expect(paintTargetStatus(target)).toContain('locked');
    // Never offers to auto-unlock.
    expect((target as { canCreateLayer: boolean }).canCreateLayer).toBe(false);
  });

  it('refuses a hidden layer with a reason', () => {
    const target = resolvePaintTarget(input({ selection: ['hidden'] }));
    expect(target.kind).toBe('none');
    expect(paintTargetStatus(target)).toContain('hidden');
  });

  it('refuses a locked layer even in mask mode', () => {
    const target = resolvePaintTarget(
      input({ maskEditTarget: { nodeId: 'locked', maskId: 'm1' } }),
    );
    expect(target.kind).toBe('none');
  });

  it('offers to create a layer when there is nothing to paint on', () => {
    const target = resolvePaintTarget(input());
    expect(target).toMatchObject({ kind: 'none', canCreateLayer: true });
  });

  it('explains that a non-pixel selection cannot be painted', () => {
    const target = resolvePaintTarget(input({ selection: ['text'] }));
    expect(target.kind).toBe('none');
    expect(paintTargetStatus(target)).toContain('not a pixel layer');
  });

  it('reports a mask target whose layer has been deleted', () => {
    const target = resolvePaintTarget(input({ maskEditTarget: { nodeId: 'gone', maskId: 'm' } }));
    expect(target.kind).toBe('none');
  });

  it('disables colour controls while painting a mask', () => {
    const mask = resolvePaintTarget(input({ maskEditTarget: { nodeId: 'raster', maskId: 'm' } }));
    const layer = resolvePaintTarget(input({ selection: ['raster'] }));
    expect(targetUsesColor(mask)).toBe(false);
    expect(targetUsesColor(layer)).toBe(true);
  });

  it('disables clone and heal against a grayscale mask', () => {
    const mask = resolvePaintTarget(input({ maskEditTarget: { nodeId: 'raster', maskId: 'm' } }));
    expect(targetSupportsTool(mask, 'paint')).toBe(true);
    expect(targetSupportsTool(mask, 'cloneStamp')).toBe(false);
    expect(targetSupportsTool(mask, 'healBrush')).toBe(false);
  });
});
