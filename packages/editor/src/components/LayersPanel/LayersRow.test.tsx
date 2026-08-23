import { fireEvent, render } from '@testing-library/react';
import type { SceneNode } from '@varve/scene';
import { describe, expect, it, vi } from 'vitest';
import { LayersRow } from './LayersRow';

function makeNode(
  id: string,
  name: string,
  kind = 'shape',
  overrides?: Partial<SceneNode>,
): SceneNode {
  const base: Record<string, unknown> = {
    id,
    name,
    kind,
    visible: true,
    locked: false,
    blendMode: 'normal',
    opacity: 1,
    bindings: {},
    fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
    index: 0,
    order: 'a0',
    rotation: 0,
  };
  if (kind === 'shape') {
    base.shape = { kind: 'rect', x: 0, y: 0, w: 10, h: 10 };
  }
  if (kind === 'frame' || kind === 'group') {
    base.children = [];
  }
  if (kind === 'frame') {
    base.w = 100;
    base.h = 100;
  }
  return { ...base, ...overrides } as unknown as SceneNode;
}

function renderRow(props?: Partial<React.ComponentProps<typeof LayersRow>>) {
  const defaultProps: React.ComponentProps<typeof LayersRow> = {
    node: makeNode('n1', 'Layer 1'),
    depth: 0,
    selected: false,
    focused: false,
    expanded: false,
    editing: false,
    totalRows: 1,
    onToggleExpand: vi.fn(),
    onSelect: vi.fn(),
    onRename: vi.fn(),
    onRenameStart: vi.fn(),
    onRenameCommit: vi.fn(),
    onRenameCancel: vi.fn(),
    onToggleVisibility: vi.fn(),
    onToggleLock: vi.fn(),
    onFocus: vi.fn(),
    idx: 0,
    ...props,
  };
  return render(<LayersRow {...defaultProps} />);
}

describe('LayersRow roving tabindex', () => {
  it('gives the treeitem tabIndex=0 when focused', () => {
    const { container } = renderRow({ focused: true });
    const row = container.querySelector('[role="treeitem"]');
    expect(row?.getAttribute('tabindex')).toBe('0');
  });

  it('gives the treeitem tabIndex=-1 when not focused', () => {
    const { container } = renderRow({ focused: false });
    const row = container.querySelector('[role="treeitem"]');
    expect(row?.getAttribute('tabindex')).toBe('-1');
  });
});

describe('LayersRow blend mode / opacity badge', () => {
  it('renders no badge when blend mode is normal and opacity is 1', () => {
    const { container } = renderRow();
    expect(container.querySelector('.layers-row__badge')).toBeNull();
  });

  it('renders no badge when blend mode is passThrough and opacity is 1', () => {
    const { container } = renderRow({
      node: makeNode('n1', 'Layer 1', 'group', { blendMode: 'passThrough', opacity: 1 }),
    });
    expect(container.querySelector('.layers-row__badge')).toBeNull();
  });

  it('renders blend mode badge for non-default blend mode', () => {
    const { container } = renderRow({
      node: makeNode('n1', 'Layer 1', 'shape', { blendMode: 'multiply', opacity: 1 }),
    });
    const badge = container.querySelector('.layers-row__badge');
    expect(badge).not.toBeNull();
    expect(badge?.textContent).toBe('Multiply');
  });

  it('renders opacity badge when opacity < 1', () => {
    const { container } = renderRow({
      node: makeNode('n1', 'Layer 1', 'shape', { blendMode: 'normal', opacity: 0.5 }),
    });
    const badge = container.querySelector('.layers-row__badge');
    expect(badge).not.toBeNull();
    expect(badge?.textContent).toBe('50%');
  });

  it('renders both badges when non-default blend mode AND opacity < 1', () => {
    const { container } = renderRow({
      node: makeNode('n1', 'Layer 1', 'shape', { blendMode: 'screen', opacity: 0.75 }),
    });
    const badge = container.querySelector('.layers-row__badge');
    expect(badge).not.toBeNull();
    expect(badge?.textContent).toBe('Screen 75%');
  });

  it('capitalizes compound blend mode names correctly', () => {
    const { container } = renderRow({
      node: makeNode('n1', 'Layer 1', 'shape', { blendMode: 'colorDodge', opacity: 1 }),
    });
    const badge = container.querySelector('.layers-row__badge');
    expect(badge).not.toBeNull();
    expect(badge?.textContent).toBe('ColorDodge');
  });

  it('renders rounded opacity correctly', () => {
    const { container } = renderRow({
      node: makeNode('n1', 'Layer 1', 'shape', { blendMode: 'normal', opacity: 0.333 }),
    });
    const badge = container.querySelector('.layers-row__badge');
    expect(badge).not.toBeNull();
    expect(badge?.textContent).toBe('33%');
  });
});

describe('LayersRow Object Filter badge', () => {
  it('keeps attached Object Filters discoverable without adding tree nodes', () => {
    const { container } = renderRow({
      node: makeNode('n1', 'Layer 1', 'shape', {
        smartFilters: [
          { id: 'f1', kind: 'invert', visible: true, opacity: 1, blendMode: 'normal', value: 100 },
          { id: 'f2', kind: 'blur', visible: false, opacity: 1, blendMode: 'normal', radius: 4 },
        ],
      }),
    });
    const badge = container.querySelector('.layers-row__object-filter-badge');
    expect(badge).not.toBeNull();
    expect(badge).toHaveTextContent('1/2 filters');
    expect(badge).toHaveAttribute('aria-label', '1 of 2 Object Filters enabled');
    expect(container.querySelectorAll('[role="treeitem"]')).toHaveLength(1);
  });

  it('agrees with the renderer when the whole filter stack is bypassed', () => {
    // smartFiltersEnabled === false disables every entry for rendering
    // (sceneToEngine/sceneCompositing consume activeSmartFilters). The row
    // badge must report the same thing — not claim filters are still live.
    const { container } = renderRow({
      node: makeNode('n1', 'Layer 1', 'shape', {
        smartFiltersEnabled: false,
        smartFilters: [
          { id: 'f1', kind: 'invert', visible: true, opacity: 1, blendMode: 'normal', value: 100 },
          { id: 'f2', kind: 'blur', visible: true, opacity: 1, blendMode: 'normal', radius: 4 },
        ],
      }),
    });
    const badge = container.querySelector('.layers-row__object-filter-badge');
    expect(badge).not.toBeNull();
    expect(badge).toHaveTextContent('0/2 filters');
    expect(badge).toHaveAttribute('aria-label', '0 of 2 Object Filters enabled');
  });

  it('keeps the stack discoverable but honest when only some entries are disabled', () => {
    const { container } = renderRow({
      node: makeNode('n1', 'Layer 1', 'shape', {
        smartFilters: [
          { id: 'f1', kind: 'invert', visible: true, opacity: 1, blendMode: 'normal', value: 100 },
          { id: 'f2', kind: 'blur', visible: false, opacity: 1, blendMode: 'normal', radius: 4 },
          {
            id: 'f3',
            kind: 'blur',
            visible: true,
            opacity: 0,
            blendMode: 'normal',
            radius: 4,
          },
        ],
      }),
    });
    const badge = container.querySelector('.layers-row__object-filter-badge');
    expect(badge).not.toBeNull();
    expect(badge).toHaveTextContent('1/3 filters');
  });
});

describe('LayersRow clipping relationship', () => {
  it('identifies mask sources and clipped content accessibly', () => {
    const source = renderRow({ maskRole: 'source' });
    // The badge is labelled accessibly; the Tooltip wrapper no longer uses a
    // native title attribute.
    const sourceBadge = source.container.querySelector('[data-mask-role="source"]');
    expect(sourceBadge).not.toBeNull();
    expect(sourceBadge?.textContent).toBe('mask');
    expect(sourceBadge).toHaveAttribute('aria-label', 'Clipping mask source');
    expect(sourceBadge?.getAttribute('title')).toBeNull();
    source.unmount();

    const content = renderRow({ maskRole: 'content' });
    const contentBadge = content.container.querySelector('[data-mask-role="content"]');
    expect(contentBadge).not.toBeNull();
    expect(contentBadge?.textContent).toBe('clipped');
    expect(contentBadge).toHaveAttribute('aria-label', 'Clipped content');
  });
});

describe('LayersRow double-click icon', () => {
  it('calls onDoubleClickIcon when type icon is double-clicked', () => {
    const onDoubleClickIcon = vi.fn();
    const { container } = renderRow({ onDoubleClickIcon });
    const icon = container.querySelector('.layers-row__type-icon');
    expect(icon).not.toBeNull();
    fireEvent.doubleClick(icon!);
    expect(onDoubleClickIcon).toHaveBeenCalledTimes(1);
    expect(onDoubleClickIcon).toHaveBeenCalledWith('n1');
  });

  it('does not call onDoubleClickIcon when row div is double-clicked', () => {
    const onDoubleClickIcon = vi.fn();
    const onToggleExpand = vi.fn();
    const onRename = vi.fn();
    const { container } = renderRow({
      onDoubleClickIcon,
      onToggleExpand,
      onRename,
      node: makeNode('n1', 'Layer 1', 'shape'),
    });
    const row = container.querySelector('.layers-row');
    expect(row).not.toBeNull();
    fireEvent.doubleClick(row!);
    expect(onDoubleClickIcon).not.toHaveBeenCalled();
  });

  it('does not fire row double-click when icon is double-clicked', () => {
    const onDoubleClickIcon = vi.fn();
    const onToggleExpand = vi.fn();
    const onRename = vi.fn();
    const { container } = renderRow({
      onDoubleClickIcon,
      onToggleExpand,
      onRename,
      node: makeNode('n1', 'Layer 1', 'shape'),
    });
    const icon = container.querySelector('.layers-row__type-icon');
    expect(icon).not.toBeNull();
    fireEvent.doubleClick(icon!);
    expect(onToggleExpand).not.toHaveBeenCalled();
    expect(onRename).not.toHaveBeenCalled();
  });
});
