import { createAreaSelection } from '@varve/engine';
import { describe, expect, it, vi } from 'vitest';
import { applySelectionRefine, type SelectionRefineRequest } from './selectionRefineApply';

const rect = () =>
  createAreaSelection({
    kind: 'rectangle',
    x: 0,
    y: 0,
    w: 8,
    h: 8,
    feather: 0,
    antialias: false,
  });

const request: SelectionRefineRequest = {
  operation: 'feather',
  amount: 2,
  sigma: 2,
  threshold: 0.5,
  contrast: 0.6,
  placement: 'centered',
  minIslandArea: 16,
  maxHoleArea: 16,
};

describe('applySelectionRefine', () => {
  it('commits one refined raster selection through the undoable path', () => {
    const commit = vi.fn();
    const set = vi.fn();
    const announce = vi.fn();
    const applied = applySelectionRefine({ areaSelection: rect(), commit, set, announce }, request);
    expect(applied).toBe(true);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(set).not.toHaveBeenCalled();
    const committed = commit.mock.calls[0]![0] as { expression: { kind: string } };
    expect(committed.expression.kind).toBe('shape');
    expect(announce).toHaveBeenCalledWith('Feather applied to the pixel selection');
  });

  it('falls back to the non-undoable setter when no commit path exists', () => {
    const set = vi.fn();
    const applied = applySelectionRefine(
      { areaSelection: rect(), set, announce: vi.fn() },
      request,
    );
    expect(applied).toBe(true);
    expect(set).toHaveBeenCalledTimes(1);
  });

  it('does nothing and explains when there is no selection', () => {
    const commit = vi.fn();
    const announce = vi.fn();
    const applied = applySelectionRefine({ areaSelection: null, commit, announce }, request);
    expect(applied).toBe(false);
    expect(commit).not.toHaveBeenCalled();
    expect(announce).toHaveBeenCalledWith('Create a pixel selection before refining it');
  });

  it('keeps the previous selection when the operation cannot be computed', () => {
    const commit = vi.fn();
    const announce = vi.fn();
    const applied = applySelectionRefine(
      { areaSelection: null, commit, announce },
      { ...request, operation: 'grow' },
    );
    expect(applied).toBe(false);
    expect(commit).not.toHaveBeenCalled();
  });
});
