import { describe, expect, it } from 'vitest';
import {
  type PaintTargetInput,
  paintTargetStatus,
  resolvePaintTarget,
  targetSupportsTool,
  targetUsesColor,
} from '../paintTarget';

function input(overrides: Partial<PaintTargetInput> = {}): PaintTargetInput {
  const rasterMask = {
    assetId: 'm1',
    coordinateSpace: 'container-local-pixels',
    sourceIdentity: { kind: 'source-metadata', locator: 'fixture:raster', revision: 1 },
  };
  return {
    document: {
      nodes: {
        raster: {
          id: 'raster',
          kind: 'rasterLayer',
          name: 'Sketch',
          visible: true,
          locked: false,
          mask: { rasterMask },
        },
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
      rootChildren: ['raster', 'text', 'locked', 'hidden'],
      rasterMaskAssets: {
        m1: {
          id: 'm1',
          mimeType: 'image/png',
          dataUrl: 'data:image/png;base64,AA==',
          width: 1,
          height: 1,
          byteLength: 1,
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

  it('does not redirect an explicit vector selection to the fallback raster layer', () => {
    const target = resolvePaintTarget(input({ selection: ['text'], fallbackLayerId: 'raster' }));
    expect(target).toMatchObject({ kind: 'none', canCreateLayer: true });
    expect(paintTargetStatus(target)).toContain('Create a paint layer');
  });

  it('treats a deleted fallback as a safe missing target instead of throwing', () => {
    expect(() => resolvePaintTarget(input({ fallbackLayerId: 'deleted' }))).not.toThrow();
    expect(resolvePaintTarget(input({ fallbackLayerId: 'deleted' }))).toMatchObject({
      kind: 'none',
      canCreateLayer: true,
    });
  });

  it('rejects a mask identity that does not match the layer mask', () => {
    const target = resolvePaintTarget(
      input({ maskEditTarget: { nodeId: 'raster', maskId: 'stale' } }),
    );
    expect(target).toMatchObject({ kind: 'none' });
    expect(paintTargetStatus(target)).toContain('no longer attached');
  });

  it('rejects a raster mask asset that is missing from the document', () => {
    const value = input({ maskEditTarget: { nodeId: 'raster', maskId: 'm1' } });
    const withoutAsset = {
      ...value.document,
      rasterMaskAssets: {},
    } as PaintTargetInput['document'];
    const target = resolvePaintTarget({ ...value, document: withoutAsset });
    expect(target).toMatchObject({ kind: 'none' });
    expect(paintTargetStatus(target)).toContain('asset is missing');
  });

  it('rejects a singular target transform', () => {
    const value = input({ selection: ['raster'] });
    const target = resolvePaintTarget({
      ...value,
      getWorldTransform: () => [1, 0, 0, 0, 0, 0],
    });
    expect(target).toMatchObject({ kind: 'none' });
    expect(paintTargetStatus(target)).toContain('invalid transform');
  });

  it('rejects a target under a hidden or locked ancestor', () => {
    const value = input();
    const raster = value.document.nodes.raster!;
    const doc = {
      ...value.document,
      rootChildren: ['parent'],
      nodes: {
        parent: {
          id: 'parent',
          kind: 'group',
          children: ['raster'],
          visible: false,
          locked: false,
        },
        raster,
      },
    } as unknown as PaintTargetInput['document'];
    const target = resolvePaintTarget({ ...value, document: doc, selection: ['raster'] });
    expect(target).toMatchObject({ kind: 'none' });
    expect(paintTargetStatus(target)).toContain('hidden');
  });

  it('rejects a target under a locked ancestor', () => {
    const value = input();
    const doc = {
      ...value.document,
      rootChildren: ['parent'],
      nodes: {
        parent: {
          id: 'parent',
          kind: 'group',
          children: ['raster'],
          visible: true,
          locked: true,
        },
        raster: value.document.nodes.raster,
      },
    } as unknown as PaintTargetInput['document'];
    const target = resolvePaintTarget({ ...value, document: doc, selection: ['raster'] });
    expect(target).toMatchObject({ kind: 'none' });
    expect(paintTargetStatus(target)).toContain('locked');
  });

  it('rejects a raster layer owned by an inactive page', () => {
    const value = input();
    const doc = {
      ...value.document,
      activePageId: 'p1',
      pages: [
        { id: 'p1', contentRoot: 'page-one', width: 100, height: 100 },
        { id: 'p2', contentRoot: 'page-two', width: 100, height: 100 },
      ],
      rootChildren: ['page-one', 'page-two'],
      nodes: {
        'page-one': { id: 'page-one', kind: 'group', children: [] },
        'page-two': { id: 'page-two', kind: 'group', children: ['raster'] },
        raster: value.document.nodes.raster,
      },
    } as unknown as PaintTargetInput['document'];
    const target = resolvePaintTarget({ ...value, document: doc, selection: ['raster'] });
    expect(target).toMatchObject({ kind: 'none' });
    expect(paintTargetStatus(target)).toContain('not on the active page');
  });

  it('reports a mask target whose layer has been deleted', () => {
    const target = resolvePaintTarget(input({ maskEditTarget: { nodeId: 'gone', maskId: 'm' } }));
    expect(target.kind).toBe('none');
  });

  it('disables colour controls while painting a mask', () => {
    const mask = resolvePaintTarget(input({ maskEditTarget: { nodeId: 'raster', maskId: 'm1' } }));
    const layer = resolvePaintTarget(input({ selection: ['raster'] }));
    expect(targetUsesColor(mask)).toBe(false);
    expect(targetUsesColor(layer)).toBe(true);
  });

  it('disables clone and heal against a grayscale mask', () => {
    const mask = resolvePaintTarget(input({ maskEditTarget: { nodeId: 'raster', maskId: 'm1' } }));
    expect(targetSupportsTool(mask, 'paint')).toBe(true);
    expect(targetSupportsTool(mask, 'cloneStamp')).toBe(false);
    expect(targetSupportsTool(mask, 'healBrush')).toBe(false);
  });
});
