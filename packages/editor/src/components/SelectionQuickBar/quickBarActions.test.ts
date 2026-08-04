// @ts-nocheck
/**
 * Tests for quick-bar action helpers and dispatch.
 */
import { makeImageShapeNode, makeShapeNode } from '@varve/scene';
import { describe, expect, it, vi } from 'vitest';
import {
  cycleSelectedImageFit,
  dispatchQuickBarAction,
  nextImageFit,
  type QuickBarActionDeps,
} from './quickBarActions';

describe('nextImageFit', () => {
  it('cycles fill → fit → crop → stretch → tile → fill', () => {
    expect(nextImageFit('fill')).toBe('fit');
    expect(nextImageFit('fit')).toBe('crop');
    expect(nextImageFit('crop')).toBe('stretch');
    expect(nextImageFit('stretch')).toBe('tile');
    expect(nextImageFit('tile')).toBe('fill');
  });
});

describe('cycleSelectedImageFit', () => {
  it('returns null for non-image shape', () => {
    const rect = makeShapeNode('r', { kind: 'rect', x: 0, y: 0, w: 10, h: 10 });
    expect(cycleSelectedImageFit(rect)).toBeNull();
  });

  it('advances image fit on the fill stack', () => {
    const img = makeImageShapeNode('i1', { src: 'data:image/png;base64,AA' });
    const next = cycleSelectedImageFit(img);
    expect(next?.fills?.[0]?.image?.fit).toBe('fit');
  });
});

function makeDeps(overrides: Partial<QuickBarActionDeps> = {}): QuickBarActionDeps {
  const img = makeImageShapeNode('i1', { src: 'data:image/png;base64,AA' });
  return {
    selection: [img.id],
    setTool: vi.fn(),
    setSelectedFlipH: vi.fn(),
    setSelectedFlipV: vi.fn(),
    removeBackgroundWithOptions: vi.fn().mockResolvedValue(undefined),
    cancelBackgroundRemoval: vi.fn(),
    openUpscaleDialog: vi.fn(),
    traceSelectedImage: vi.fn().mockResolvedValue(undefined),
    setShowOriginalBg: vi.fn(),
    setRefineMaskOptions: vi.fn(),
    updateNode: vi.fn(),
    showOriginalBgNodeId: null,
    selectedImageNode: img,
    setNodeEditTargetId: vi.fn(),
    setTextEditTargetId: vi.fn(),
    groupSelected: vi.fn(),
    booleanOp: vi.fn(),
    announce: vi.fn(),
    ...overrides,
  };
}

describe('dispatchQuickBarAction', () => {
  it('wires removeBg to removeBackgroundWithOptions quick', async () => {
    const deps = makeDeps();
    await dispatchQuickBarAction('removeBg', deps);
    expect(deps.removeBackgroundWithOptions).toHaveBeenCalledWith('quick', 0.5, true);
  });

  it('wires upscale to openUpscaleDialog', async () => {
    const deps = makeDeps();
    await dispatchQuickBarAction('upscale', deps);
    expect(deps.openUpscaleDialog).toHaveBeenCalledWith();
  });

  it('wires vectorize to monochrome trace defaults', async () => {
    const deps = makeDeps();
    await dispatchQuickBarAction('vectorize', deps);
    expect(deps.traceSelectedImage).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'monochrome', threshold: 128 }),
    );
  });

  it('wires flipH/flipV', async () => {
    const deps = makeDeps();
    await dispatchQuickBarAction('flipH', deps);
    await dispatchQuickBarAction('flipV', deps);
    expect(deps.setSelectedFlipH).toHaveBeenCalled();
    expect(deps.setSelectedFlipV).toHaveBeenCalled();
  });

  it('cycles fit via updateNode', async () => {
    const deps = makeDeps();
    await dispatchQuickBarAction('fitCycle', deps);
    expect(deps.updateNode).toHaveBeenCalled();
  });

  it('toggles showOriginal', async () => {
    const deps = makeDeps();
    await dispatchQuickBarAction('showOriginal', deps);
    expect(deps.setShowOriginalBg).toHaveBeenCalledWith('i1');
    const deps2 = makeDeps({ showOriginalBgNodeId: 'i1' });
    await dispatchQuickBarAction('showOriginal', deps2);
    expect(deps2.setShowOriginalBg).toHaveBeenCalledWith(null);
  });

  it('sets crop tool', async () => {
    const deps = makeDeps();
    await dispatchQuickBarAction('crop', deps);
    expect(deps.setTool).toHaveBeenCalledWith('crop');
  });

  it('enters nodeEdit for editNodes', async () => {
    const path = makeShapeNode('p1', {
      kind: 'path',
      points: [
        { x: 0, y: 0, handleIn: null, handleOut: null },
        { x: 1, y: 0, handleIn: null, handleOut: null },
      ],
      closed: false,
    });
    const deps = makeDeps({
      selection: [path.id],
      selectedImageNode: null,
    });
    await dispatchQuickBarAction('editNodes', deps);
    expect(deps.setNodeEditTargetId).toHaveBeenCalledWith('p1');
    expect(deps.setTool).toHaveBeenCalledWith('nodeEdit');
  });

  it('starts text edit for editText', async () => {
    const deps = makeDeps({ selection: ['t1'], selectedImageNode: null });
    await dispatchQuickBarAction('editText', deps);
    expect(deps.setTextEditTargetId).toHaveBeenCalledWith('t1');
  });

  it('wires group and boolean ops', async () => {
    const deps = makeDeps();
    await dispatchQuickBarAction('group', deps);
    await dispatchQuickBarAction('booleanUnion', deps);
    expect(deps.groupSelected).toHaveBeenCalled();
    expect(deps.booleanOp).toHaveBeenCalledWith('union');
  });
});
