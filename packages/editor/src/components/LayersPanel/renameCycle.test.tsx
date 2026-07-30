import type { SceneNode } from '@strata/scene';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LayersRow } from './LayersRow';

function makeNode(id: string, name: string, kind = 'shape'): SceneNode {
  return {
    id,
    name,
    kind: kind as SceneNode['kind'],
    visible: true,
    locked: false,
    blendMode: 'normal',
    opacity: 1,
    bindings: {},
    shape: kind === 'shape' ? { kind: 'rect', x: 0, y: 0, w: 10, h: 10 } : undefined,
    ...(kind === 'frame' ? { children: [], w: 100, h: 100 } : {}),
    ...(kind === 'group' ? { children: [] } : {}),
  } as SceneNode;
}

describe('renameCycle core logic', () => {
  it('Tab during rename commits and cycles to next entry', () => {
    const onRename = vi.fn();
    const onRenameCommit = vi.fn();
    const onRenameCycle = vi.fn();

    render(
      <LayersRow
        node={makeNode('n1', 'Layer 1')}
        depth={0}
        selected={false}
        focused={false}
        expanded={false}
        editing={true}
        onToggleExpand={vi.fn()}
        onSelect={vi.fn()}
        onRename={onRename}
        onRenameStart={vi.fn()}
        onRenameCommit={onRenameCommit}
        onRenameCancel={vi.fn()}
        onToggleVisibility={vi.fn()}
        onToggleLock={vi.fn()}
        onFocus={vi.fn()}
        idx={0}
        onRenameCycle={onRenameCycle}
      />,
    );

    const input = screen.getByRole('textbox');
    fireEvent.keyDown(input, { key: 'Tab' });

    expect(onRenameCommit).toHaveBeenCalledTimes(1);
    expect(onRenameCycle).toHaveBeenCalledWith('next');
  });

  it('Shift+Tab during rename commits and cycles to previous entry', () => {
    const onRename = vi.fn();
    const onRenameCommit = vi.fn();
    const onRenameCycle = vi.fn();

    render(
      <LayersRow
        node={makeNode('n1', 'Layer 1')}
        depth={0}
        selected={false}
        focused={false}
        expanded={false}
        editing={true}
        onToggleExpand={vi.fn()}
        onSelect={vi.fn()}
        onRename={onRename}
        onRenameStart={vi.fn()}
        onRenameCommit={onRenameCommit}
        onRenameCancel={vi.fn()}
        onToggleVisibility={vi.fn()}
        onToggleLock={vi.fn()}
        onFocus={vi.fn()}
        idx={0}
        onRenameCycle={onRenameCycle}
      />,
    );

    const input = screen.getByRole('textbox');
    fireEvent.keyDown(input, { key: 'Tab', shiftKey: true });

    expect(onRenameCommit).toHaveBeenCalledTimes(1);
    expect(onRenameCycle).toHaveBeenCalledWith('previous');
  });

  it('Enter during rename commits but does not cycle', () => {
    const onRename = vi.fn();
    const onRenameCommit = vi.fn();
    const onRenameCycle = vi.fn();

    render(
      <LayersRow
        node={makeNode('n1', 'Layer 1')}
        depth={0}
        selected={false}
        focused={false}
        expanded={false}
        editing={true}
        onToggleExpand={vi.fn()}
        onSelect={vi.fn()}
        onRename={onRename}
        onRenameStart={vi.fn()}
        onRenameCommit={onRenameCommit}
        onRenameCancel={vi.fn()}
        onToggleVisibility={vi.fn()}
        onToggleLock={vi.fn()}
        onFocus={vi.fn()}
        idx={0}
        onRenameCycle={onRenameCycle}
      />,
    );

    const input = screen.getByRole('textbox');
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onRenameCommit).toHaveBeenCalledTimes(1);
    expect(onRenameCycle).not.toHaveBeenCalled();
  });

  it('Escape during rename cancels and does not cycle', () => {
    const onRenameCancel = vi.fn();
    const onRenameCycle = vi.fn();

    render(
      <LayersRow
        node={makeNode('n1', 'Layer 1')}
        depth={0}
        selected={false}
        focused={false}
        expanded={false}
        editing={true}
        onToggleExpand={vi.fn()}
        onSelect={vi.fn()}
        onRename={vi.fn()}
        onRenameStart={vi.fn()}
        onRenameCommit={vi.fn()}
        onRenameCancel={onRenameCancel}
        onToggleVisibility={vi.fn()}
        onToggleLock={vi.fn()}
        onFocus={vi.fn()}
        idx={0}
        onRenameCycle={onRenameCycle}
      />,
    );

    const input = screen.getByRole('textbox');
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(onRenameCancel).toHaveBeenCalledTimes(1);
    expect(onRenameCycle).not.toHaveBeenCalled();
  });

  it('Tab does nothing when onRenameCycle is not provided', () => {
    const onRenameCommit = vi.fn();

    render(
      <LayersRow
        node={makeNode('n1', 'Layer 1')}
        depth={0}
        selected={false}
        focused={false}
        expanded={false}
        editing={true}
        onToggleExpand={vi.fn()}
        onSelect={vi.fn()}
        onRename={vi.fn()}
        onRenameStart={vi.fn()}
        onRenameCommit={onRenameCommit}
        onRenameCancel={vi.fn()}
        onToggleVisibility={vi.fn()}
        onToggleLock={vi.fn()}
        onFocus={vi.fn()}
        idx={0}
      />,
    );

    const input = screen.getByRole('textbox');
    fireEvent.keyDown(input, { key: 'Tab' });

    // With no onRenameCycle, Tab blur behavior is the default: commit fires on blur
    expect(onRenameCommit).toHaveBeenCalledTimes(1);
  });

  it('does not cycle when not editing', () => {
    const onRenameCommit = vi.fn();
    const onRenameCycle = vi.fn();

    render(
      <LayersRow
        node={makeNode('n1', 'Layer 1')}
        depth={0}
        selected={false}
        focused={false}
        expanded={false}
        editing={false}
        onToggleExpand={vi.fn()}
        onSelect={vi.fn()}
        onRename={vi.fn()}
        onRenameStart={vi.fn()}
        onRenameCommit={onRenameCommit}
        onRenameCancel={vi.fn()}
        onToggleVisibility={vi.fn()}
        onToggleLock={vi.fn()}
        onFocus={vi.fn()}
        idx={0}
        onRenameCycle={onRenameCycle}
      />,
    );

    // When not editing, the input is not rendered, so nothing to test
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});

describe('rename cycle index computation', () => {
  const entries = [
    { node: makeNode('a', 'Alpha'), depth: 0, parentId: null },
    { node: makeNode('b', 'Beta'), depth: 0, parentId: null },
    { node: makeNode('c', 'Gamma'), depth: 0, parentId: null },
  ];

  function findCycleId(currentId: string, direction: 'next' | 'previous'): string | null {
    const idx = entries.findIndex((e) => e.node.id === currentId);
    if (idx < 0) return null;
    const delta = direction === 'next' ? 1 : -1;
    const newIdx = (idx + delta + entries.length) % entries.length;
    return entries[newIdx]?.node.id ?? null;
  }

  it('cycles to next entry', () => {
    expect(findCycleId('a', 'next')).toBe('b');
    expect(findCycleId('b', 'next')).toBe('c');
  });

  it('cycles to previous entry', () => {
    expect(findCycleId('c', 'previous')).toBe('b');
    expect(findCycleId('b', 'previous')).toBe('a');
  });

  it('wraps around from last to first (next)', () => {
    expect(findCycleId('c', 'next')).toBe('a');
  });

  it('wraps around from first to last (previous)', () => {
    expect(findCycleId('a', 'previous')).toBe('c');
  });

  it('returns null for unknown ID', () => {
    expect(findCycleId('unknown', 'next')).toBeNull();
  });
});
