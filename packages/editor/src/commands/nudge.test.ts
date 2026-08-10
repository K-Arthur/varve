import type { SceneNode } from '@varve/scene';
import { describe, expect, it, vi } from 'vitest';
import type { NudgeContext } from './nudge';
import { canNudge, executeNudge, getNudgeDisabledReason, getNudgeStep } from './nudge';

function makeCtx(overrides?: Partial<NudgeContext>): NudgeContext {
  return {
    document: { nodes: {} },
    selection: [],
    getNode: vi.fn(),
    setNodePosition: vi.fn(),
    setNodePositions: vi.fn(),
    ...overrides,
  };
}

describe('getNudgeStep', () => {
  it('returns 1 for standard', () => {
    expect(getNudgeStep('standard')).toBe(1);
  });

  it('returns 10 for large', () => {
    expect(getNudgeStep('large')).toBe(10);
  });

  it('returns 0.5 for fine', () => {
    expect(getNudgeStep('fine')).toBe(0.5);
  });
});

describe('canNudge / getNudgeDisabledReason', () => {
  it('canNudge returns true when selection is non-empty', () => {
    expect(canNudge(['a'])).toBe(true);
  });

  it('canNudge returns false when selection is empty', () => {
    expect(canNudge([])).toBe(false);
  });

  it('getNudgeDisabledReason returns "No selection" when empty', () => {
    expect(getNudgeDisabledReason([])).toBe('No selection');
  });

  it('getNudgeDisabledReason returns null when selection exists', () => {
    expect(getNudgeDisabledReason(['a'])).toBeNull();
  });
});

describe('executeNudge', () => {
  it('moves a single node right by step', () => {
    const setNodePositions = vi.fn();
    const ctx = makeCtx({
      selection: ['n1'],
      getNode: vi.fn().mockReturnValue({ id: 'n1', transform: [1, 0, 0, 1, 100, 100] }),
      setNodePositions,
    });
    const result = executeNudge('right', 1, ctx);
    expect(setNodePositions).toHaveBeenCalledWith([{ id: 'n1', x: 101, y: 100 }]);
    expect(result).toEqual({ moved: 1, locked: 0, skipped: 0, total: 1 });
  });

  it('moves a single node left by step', () => {
    const setNodePositions = vi.fn();
    const ctx = makeCtx({
      selection: ['n1'],
      getNode: vi.fn().mockReturnValue({ id: 'n1', transform: [1, 0, 0, 1, 100, 100] }),
      setNodePositions,
    });
    executeNudge('left', 10, ctx);
    expect(setNodePositions).toHaveBeenCalledWith([{ id: 'n1', x: 90, y: 100 }]);
  });

  it('moves a single node up by step', () => {
    const setNodePositions = vi.fn();
    const ctx = makeCtx({
      selection: ['n1'],
      getNode: vi.fn().mockReturnValue({ id: 'n1', transform: [1, 0, 0, 1, 100, 100] }),
      setNodePositions,
    });
    executeNudge('up', 1, ctx);
    expect(setNodePositions).toHaveBeenCalledWith([{ id: 'n1', x: 100, y: 99 }]);
  });

  it('moves a single node down by step', () => {
    const setNodePositions = vi.fn();
    const ctx = makeCtx({
      selection: ['n1'],
      getNode: vi.fn().mockReturnValue({ id: 'n1', transform: [1, 0, 0, 1, 100, 100] }),
      setNodePositions,
    });
    executeNudge('down', 1, ctx);
    expect(setNodePositions).toHaveBeenCalledWith([{ id: 'n1', x: 100, y: 101 }]);
  });

  it('moves multiple selected nodes', () => {
    const setNodePositions = vi.fn();
    const getNode = vi.fn((id: string) => {
      if (id === 'n1')
        return { id: 'n1', transform: [1, 0, 0, 1, 100, 100] } as unknown as SceneNode;
      if (id === 'n2')
        return { id: 'n2', transform: [1, 0, 0, 1, 200, 200] } as unknown as SceneNode;
      return undefined;
    });
    const ctx = makeCtx({
      selection: ['n1', 'n2'],
      getNode,
      setNodePositions,
    });
    executeNudge('right', 1, ctx);
    expect(setNodePositions).toHaveBeenCalledWith([
      { id: 'n1', x: 101, y: 100 },
      { id: 'n2', x: 201, y: 200 },
    ]);
  });

  it('nudges rotated node along local axes', () => {
    const setNodePositions = vi.fn();
    const c = Math.cos(Math.PI / 4);
    const s = Math.sin(Math.PI / 4);
    const ctx = makeCtx({
      selection: ['n1'],
      getNode: vi.fn().mockReturnValue({
        id: 'n1',
        transform: [c, s, -s, c, 100, 100],
      }),
      setNodePositions,
    });
    executeNudge('right', 1, ctx);
    expect(setNodePositions).toHaveBeenCalledWith([{ id: 'n1', x: 100 + c, y: 100 + s }]);
  });

  it('nudges rotated node up along local axes', () => {
    const setNodePositions = vi.fn();
    const c = Math.cos(Math.PI / 4);
    const s = Math.sin(Math.PI / 4);
    const ctx = makeCtx({
      selection: ['n1'],
      getNode: vi.fn().mockReturnValue({
        id: 'n1',
        transform: [c, s, -s, c, 100, 100],
      }),
      setNodePositions,
    });
    executeNudge('up', 1, ctx);
    expect(setNodePositions).toHaveBeenCalledWith([{ id: 'n1', x: 100 + s, y: 100 - c }]);
  });

  it('skips locked nodes', () => {
    const setNodePositions = vi.fn();
    const ctx = makeCtx({
      selection: ['n1'],
      getNode: vi.fn().mockReturnValue({
        id: 'n1',
        locked: true,
        visible: true,
        transform: [1, 0, 0, 1, 100, 100],
      }),
      setNodePositions,
    });
    const result = executeNudge('right', 1, ctx);
    expect(setNodePositions).not.toHaveBeenCalled();
    expect(result).toEqual({ moved: 0, locked: 1, skipped: 0, total: 1 });
  });

  it('skips hidden nodes', () => {
    const setNodePositions = vi.fn();
    const ctx = makeCtx({
      selection: ['n1'],
      getNode: vi.fn().mockReturnValue({
        id: 'n1',
        locked: false,
        visible: false,
        transform: [1, 0, 0, 1, 100, 100],
      }),
      setNodePositions,
    });
    const result = executeNudge('right', 1, ctx);
    expect(setNodePositions).not.toHaveBeenCalled();
    expect(result).toEqual({ moved: 0, locked: 1, skipped: 0, total: 1 });
  });

  it('skips adjustment nodes', () => {
    const setNodePositions = vi.fn();
    const ctx = makeCtx({
      selection: ['n1'],
      getNode: vi.fn().mockReturnValue({
        id: 'n1',
        kind: 'adjustment',
        locked: false,
        visible: true,
      }),
      setNodePositions,
    });
    const result = executeNudge('right', 1, ctx);
    expect(setNodePositions).not.toHaveBeenCalled();
    expect(result).toEqual({ moved: 0, locked: 0, skipped: 1, total: 1 });
  });

  it('handles missing nodes gracefully', () => {
    const setNodePositions = vi.fn();
    const ctx = makeCtx({
      selection: ['n1'],
      getNode: vi.fn().mockReturnValue(undefined),
      setNodePositions,
    });
    const result = executeNudge('right', 1, ctx);
    expect(setNodePositions).not.toHaveBeenCalled();
    expect(result).toEqual({ moved: 0, locked: 0, skipped: 1, total: 1 });
  });

  it('handles missing transform (undefined) gracefully', () => {
    const setNodePositions = vi.fn();
    const ctx = makeCtx({
      selection: ['n1'],
      getNode: vi.fn().mockReturnValue({
        id: 'n1',
        locked: false,
        visible: true,
        transform: undefined,
      }),
      setNodePositions,
    });
    const result = executeNudge('right', 1, ctx);
    expect(setNodePositions).toHaveBeenCalledWith([{ id: 'n1', x: 1, y: 0 }]);
    expect(result).toEqual({ moved: 1, locked: 0, skipped: 0, total: 1 });
  });

  it('empty selection returns moved 0', () => {
    const ctx = makeCtx({ selection: [] });
    const result = executeNudge('right', 1, ctx);
    expect(result).toEqual({ moved: 0, locked: 0, skipped: 0, total: 0 });
  });
});
