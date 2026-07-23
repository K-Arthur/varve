import { describe, expect, it, vi } from 'vitest';
import type { NudgeContext } from './nudge';
import { canNudge, executeNudge, getNudgeDisabledReason, getNudgeStep } from './nudge';

function makeCtx(overrides?: Partial<NudgeContext>): NudgeContext {
  return {
    document: { nodes: {} },
    selection: [],
    getNode: vi.fn(),
    setNodePosition: vi.fn(),
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
    const setNodePosition = vi.fn();
    const ctx = makeCtx({
      selection: ['n1'],
      getNode: vi.fn().mockReturnValue({ id: 'n1', transform: [1, 0, 0, 1, 100, 100] }),
      setNodePosition,
    });
    const result = executeNudge('right', 1, ctx);
    expect(setNodePosition).toHaveBeenCalledWith('n1', 101, 100);
    expect(result).toEqual({ moved: 1, locked: 0, skipped: 0, total: 1 });
  });

  it('moves a single node left by step', () => {
    const setNodePosition = vi.fn();
    const ctx = makeCtx({
      selection: ['n1'],
      getNode: vi.fn().mockReturnValue({ id: 'n1', transform: [1, 0, 0, 1, 100, 100] }),
      setNodePosition,
    });
    executeNudge('left', 10, ctx);
    expect(setNodePosition).toHaveBeenCalledWith('n1', 90, 100);
  });

  it('moves a single node up by step', () => {
    const setNodePosition = vi.fn();
    const ctx = makeCtx({
      selection: ['n1'],
      getNode: vi.fn().mockReturnValue({ id: 'n1', transform: [1, 0, 0, 1, 100, 100] }),
      setNodePosition,
    });
    executeNudge('up', 1, ctx);
    expect(setNodePosition).toHaveBeenCalledWith('n1', 100, 99);
  });

  it('moves a single node down by step', () => {
    const setNodePosition = vi.fn();
    const ctx = makeCtx({
      selection: ['n1'],
      getNode: vi.fn().mockReturnValue({ id: 'n1', transform: [1, 0, 0, 1, 100, 100] }),
      setNodePosition,
    });
    executeNudge('down', 1, ctx);
    expect(setNodePosition).toHaveBeenCalledWith('n1', 100, 101);
  });

  it('moves multiple selected nodes', () => {
    const setNodePosition = vi.fn();
    const getNode = vi.fn((id: string) => {
      if (id === 'n1') return { id: 'n1', transform: [1, 0, 0, 1, 100, 100] };
      if (id === 'n2') return { id: 'n2', transform: [1, 0, 0, 1, 200, 200] };
      return undefined;
    });
    const ctx = makeCtx({
      selection: ['n1', 'n2'],
      getNode,
      setNodePosition,
    });
    executeNudge('right', 1, ctx);
    expect(setNodePosition).toHaveBeenCalledWith('n1', 101, 100);
    expect(setNodePosition).toHaveBeenCalledWith('n2', 201, 200);
  });

  it('nudges rotated node along local axes', () => {
    const setNodePosition = vi.fn();
    const c = Math.cos(Math.PI / 4);
    const s = Math.sin(Math.PI / 4);
    const ctx = makeCtx({
      selection: ['n1'],
      getNode: vi.fn().mockReturnValue({
        id: 'n1',
        transform: [c, s, -s, c, 100, 100],
      }),
      setNodePosition,
    });
    executeNudge('right', 1, ctx);
    expect(setNodePosition).toHaveBeenCalledWith('n1', 100 + c, 100 + s);
  });

  it('nudges rotated node up along local axes', () => {
    const setNodePosition = vi.fn();
    const c = Math.cos(Math.PI / 4);
    const s = Math.sin(Math.PI / 4);
    const ctx = makeCtx({
      selection: ['n1'],
      getNode: vi.fn().mockReturnValue({
        id: 'n1',
        transform: [c, s, -s, c, 100, 100],
      }),
      setNodePosition,
    });
    executeNudge('up', 1, ctx);
    expect(setNodePosition).toHaveBeenCalledWith('n1', 100 + s, 100 - c);
  });

  it('skips locked nodes', () => {
    const setNodePosition = vi.fn();
    const ctx = makeCtx({
      selection: ['n1'],
      getNode: vi.fn().mockReturnValue({
        id: 'n1',
        locked: true,
        visible: true,
        transform: [1, 0, 0, 1, 100, 100],
      }),
      setNodePosition,
    });
    const result = executeNudge('right', 1, ctx);
    expect(setNodePosition).not.toHaveBeenCalled();
    expect(result).toEqual({ moved: 0, locked: 1, skipped: 0, total: 1 });
  });

  it('skips hidden nodes', () => {
    const setNodePosition = vi.fn();
    const ctx = makeCtx({
      selection: ['n1'],
      getNode: vi.fn().mockReturnValue({
        id: 'n1',
        locked: false,
        visible: false,
        transform: [1, 0, 0, 1, 100, 100],
      }),
      setNodePosition,
    });
    const result = executeNudge('right', 1, ctx);
    expect(setNodePosition).not.toHaveBeenCalled();
    expect(result).toEqual({ moved: 0, locked: 1, skipped: 0, total: 1 });
  });

  it('skips adjustment nodes', () => {
    const setNodePosition = vi.fn();
    const ctx = makeCtx({
      selection: ['n1'],
      getNode: vi.fn().mockReturnValue({
        id: 'n1',
        kind: 'adjustment',
        locked: false,
        visible: true,
      }),
      setNodePosition,
    });
    const result = executeNudge('right', 1, ctx);
    expect(setNodePosition).not.toHaveBeenCalled();
    expect(result).toEqual({ moved: 0, locked: 0, skipped: 1, total: 1 });
  });

  it('handles missing nodes gracefully', () => {
    const setNodePosition = vi.fn();
    const ctx = makeCtx({
      selection: ['n1'],
      getNode: vi.fn().mockReturnValue(undefined),
      setNodePosition,
    });
    const result = executeNudge('right', 1, ctx);
    expect(setNodePosition).not.toHaveBeenCalled();
    expect(result).toEqual({ moved: 0, locked: 0, skipped: 1, total: 1 });
  });

  it('handles missing transform (undefined) gracefully', () => {
    const setNodePosition = vi.fn();
    const ctx = makeCtx({
      selection: ['n1'],
      getNode: vi.fn().mockReturnValue({
        id: 'n1',
        locked: false,
        visible: true,
        transform: undefined,
      }),
      setNodePosition,
    });
    const result = executeNudge('right', 1, ctx);
    expect(setNodePosition).toHaveBeenCalledWith('n1', 1, 0);
    expect(result).toEqual({ moved: 1, locked: 0, skipped: 0, total: 1 });
  });

  it('empty selection returns moved 0', () => {
    const ctx = makeCtx({ selection: [] });
    const result = executeNudge('right', 1, ctx);
    expect(result).toEqual({ moved: 0, locked: 0, skipped: 0, total: 0 });
  });
});
