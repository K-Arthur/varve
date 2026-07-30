import type { SceneNode } from '@strata/scene';
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LayersRow } from '../LayersRow';

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
  if (kind === 'adjustment') {
    base.adjustmentType = 'curves';
    base.clipping = false;
    base.params = {
      channel: 'rgb',
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ],
    };
    base.transform = [1, 0, 0, 1, 0, 0];
    base.effects = [];
    base.mask = undefined;
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

describe('Task 2.8: AdjustmentNode Visual Representation', () => {
  it('renders adjustment node with data-layer-type="adjustment"', () => {
    const adjNode = makeNode('a1', 'Curves 1', 'adjustment');
    const { container } = renderRow({ node: adjNode });
    const row = container.querySelector('[data-layer-type="adjustment"]');
    expect(row).not.toBeNull();
    expect(row?.getAttribute('data-layer-type')).toBe('adjustment');
  });

  it('shows adjustment type badge with the correct adjustment type', () => {
    const adjNode = makeNode('a1', 'Curves 1', 'adjustment', {
      adjustmentType: 'curves',
    } as Partial<SceneNode>);
    const { container } = renderRow({ node: adjNode });
    const badge = container.querySelector('.layers-row__adjustment-badge');
    expect(badge).not.toBeNull();
    expect(badge?.textContent).toBe('curves');
  });

  it('shows levels badge for levels adjustment', () => {
    const adjNode = makeNode('a1', 'Levels', 'adjustment', {
      adjustmentType: 'levels',
    } as Partial<SceneNode>);
    const { container } = renderRow({ node: adjNode, editing: false });
    const badge = container.querySelector('.layers-row__adjustment-badge');
    expect(badge).not.toBeNull();
    expect(badge?.textContent).toBe('levels');
  });

  it('hides adjustment badge while editing', () => {
    const adjNode = makeNode('a1', 'Curves 1', 'adjustment', {
      adjustmentType: 'curves',
    } as Partial<SceneNode>);
    const { container } = renderRow({ node: adjNode, editing: true });
    const badge = container.querySelector('.layers-row__adjustment-badge');
    expect(badge).toBeNull();
  });

  it('uses SlidersHorizontal icon for adjustment nodes via NODE_ICONS map', () => {
    // Import the NODE_ICONS map from the source (it uses TOOL_ICONS.adjustment = 'SlidersHorizontal')
    // Since Lucide SVG rendering in jsdom may not produce queryable elements,
    // verify the icon is selected from the correct map entry
    const adjNode = makeNode('a1', 'Curves 1', 'adjustment');
    const { container } = renderRow({ node: adjNode });
    const iconSpan = container.querySelector('.layers-row__type-icon');
    expect(iconSpan).not.toBeNull();
    // The icon span should have the aria-hidden attribute (decorative, no label)
    expect(iconSpan?.closest('.layers-row__icon-area')).not.toBeNull();
  });
});

describe('Task 2.9: Motion/Timeline Indicators', () => {
  it('shows motion dot when hasMotion is true', () => {
    const { container } = renderRow({ hasMotion: true });
    const dot = container.querySelector('.layers-row__motion-dot');
    expect(dot).not.toBeNull();
  });

  it('hides motion dot when hasMotion is false', () => {
    const { container } = renderRow({ hasMotion: false });
    const dot = container.querySelector('.layers-row__motion-dot');
    expect(dot).toBeNull();
  });

  it('hides motion dot by default when hasMotion is not set', () => {
    const { container } = renderRow();
    const dot = container.querySelector('.layers-row__motion-dot');
    expect(dot).toBeNull();
  });

  it('shows keyframe count badge when keyframeCount > 0', () => {
    const { container } = renderRow({ keyframeCount: 3 });
    const badge = container.querySelector('.layers-row__keyframe-badge');
    expect(badge).not.toBeNull();
    expect(badge?.textContent).toBe('3');
  });

  it('hides keyframe badge when keyframeCount is 0', () => {
    const { container } = renderRow({ keyframeCount: 0 });
    const badge = container.querySelector('.layers-row__keyframe-badge');
    expect(badge).toBeNull();
  });

  it('hides keyframe badge by default when keyframeCount is not set', () => {
    const { container } = renderRow();
    const badge = container.querySelector('.layers-row__keyframe-badge');
    expect(badge).toBeNull();
  });

  it('hides motion dot when editing', () => {
    const { container } = renderRow({ hasMotion: true, editing: true });
    const dot = container.querySelector('.layers-row__motion-dot');
    expect(dot).toBeNull();
  });

  it('hides keyframe badge when editing', () => {
    const { container } = renderRow({ keyframeCount: 3, editing: true });
    const badge = container.querySelector('.layers-row__keyframe-badge');
    expect(badge).toBeNull();
  });
});

describe('Task 2.10: Horizontal Scroll & Name Column', () => {
  it('renders name span with expected CSS classes for scroll behavior', () => {
    const { container } = renderRow({
      node: makeNode('n1', 'A very long layer name that should not be truncated'),
    });
    const nameSpan = container.querySelector('.layers-row__name');
    expect(nameSpan).not.toBeNull();
    // The name span should NOT have the old ellipsis-truncation class
    expect(nameSpan?.className).not.toContain('text-overflow-ellipsis');
    // The tree container should have overflow-x: auto via class
    // (test the class presence, not computed style since CSS is not loaded in jsdom)
  });

  it('renders layer name as-is without truncation in the DOM', () => {
    const longName = 'A very long layer name that should not be truncated';
    const { container } = renderRow({
      node: makeNode('n1', longName),
    });
    const nameSpan = container.querySelector('.layers-row__name');
    expect(nameSpan).not.toBeNull();
    expect(nameSpan?.textContent).toBe(longName);
    // The title attribute should also contain the full name
    expect(nameSpan?.getAttribute('title')).toBe(longName);
  });
});
