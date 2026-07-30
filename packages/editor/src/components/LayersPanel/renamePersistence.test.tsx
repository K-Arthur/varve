import { fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { LayersRow } from './LayersRow';

/**
 * Renaming from the layers panel silently did nothing: the row used one
 * callback both to begin editing (double-click, passing the node's current
 * name) and to save the typed name, so the panel could not tell them apart and
 * treated every commit as another "start editing". The typed value never
 * reached the document.
 *
 * These pin the two as separate signals.
 */
function makeNode(name: string) {
  return {
    id: 'n1',
    name,
    kind: 'shape',
    visible: true,
    locked: false,
    blendMode: 'normal',
    opacity: 1,
    bindings: {},
    fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
    index: 0,
    order: 'a0',
    rotation: 0,
    shape: { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
  } as never;
}

function renderRow(overrides: Record<string, unknown> = {}) {
  const props = {
    node: makeNode('Layer 1'),
    depth: 0,
    selected: false,
    focused: false,
    expanded: false,
    editing: false,
    idx: 0,
    onToggleExpand: vi.fn(),
    onSelect: vi.fn(),
    onRename: vi.fn(),
    onRenameStart: vi.fn(),
    onRenameCommit: vi.fn(),
    onRenameCancel: vi.fn(),
    onToggleVisibility: vi.fn(),
    onToggleLock: vi.fn(),
    onFocus: vi.fn(),
    ...overrides,
  };
  const rowProps = props as unknown as ComponentProps<typeof LayersRow>;
  return { props, view: render(<LayersRow {...rowProps} />) };
}

describe('layers panel rename', () => {
  it('double-click begins editing without reporting a rename', () => {
    const onRename = vi.fn();
    const onRenameStart = vi.fn();
    const { view } = renderRow({ onRename, onRenameStart });

    fireEvent.doubleClick(view.container.querySelector('.layers-row') as Element);

    expect(onRenameStart).toHaveBeenCalledWith('n1');
    // Reporting the unchanged name here is what made a commit indistinguishable
    // from a start.
    expect(onRename).not.toHaveBeenCalled();
  });

  it('commits the typed name on Enter', () => {
    const onRename = vi.fn();
    const onRenameCommit = vi.fn();
    renderRow({ editing: true, onRename, onRenameCommit });

    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Hero image' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onRename).toHaveBeenCalledWith('n1', 'Hero image');
    expect(onRenameCommit).toHaveBeenCalled();
  });

  it('does not report a rename when the name is unchanged', () => {
    const onRename = vi.fn();
    renderRow({ editing: true, onRename });

    const input = screen.getByRole('textbox');
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onRename).not.toHaveBeenCalled();
  });

  it('discards the typed name on Escape', () => {
    const onRename = vi.fn();
    const onRenameCancel = vi.fn();
    renderRow({ editing: true, onRename, onRenameCancel });

    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Discarded' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(onRename).not.toHaveBeenCalled();
    expect(onRenameCancel).toHaveBeenCalled();
  });
});
