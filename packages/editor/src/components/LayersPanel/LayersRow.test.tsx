import { fireEvent, render } from '@testing-library/react';
import { makeAdjustment } from '@varve/engine';
import { createDocument, type Document, type SceneNode } from '@varve/scene';
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

const TRACE_META = {
  schemaVersion: 1 as const,
  sourceNodeId: 'src1',
  mode: 'color' as const,
  traceMode: 'silhouette' as const,
  threshold: 128,
  foreground: 'dark' as const,
  alphaThreshold: 0,
  minArea: 4,
  simplifyTolerance: 1,
  maxPaths: 1000,
  maxColors: 8,
  compoundHoles: true,
  cornerAngle: 45,
  centerlineWidth: 1,
  centerlinePrune: 0,
  engine: 'native' as const,
  stats: { pathCount: 12, pointCount: 240, holeCount: 0, omittedHoles: 0 },
  createdAt: 1,
};

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

function lockedParentDocument(): { doc: Document; parent: SceneNode; child: SceneNode } {
  const parent = makeNode('parent', 'Parent', 'frame', { locked: true, children: ['child'] });
  const child = makeNode('child', 'Child');
  const base = createDocument('locked-ancestor');
  return {
    doc: {
      ...base,
      rootChildren: ['parent'],
      nodes: { parent, child },
    },
    parent,
    child,
  };
}

function hiddenParentDocument(): { doc: Document; parent: SceneNode; child: SceneNode } {
  const parent = makeNode('parent', 'Parent', 'frame', { visible: false, children: ['child'] });
  const child = makeNode('child', 'Child');
  const base = createDocument('hidden-ancestor');
  return {
    doc: {
      ...base,
      rootChildren: ['parent'],
      nodes: { parent, child },
    },
    parent,
    child,
  };
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

  it('reports logical sibling position for virtualized nested rows', () => {
    const { container } = renderRow({
      idx: 7,
      totalRows: 20,
      siblingIndex: 2,
      siblingCount: 3,
    });
    const row = container.querySelector('[role="treeitem"]');
    expect(row).toHaveAttribute('aria-posinset', '2');
    expect(row).toHaveAttribute('aria-setsize', '3');
  });

  it('offers the details surface from the focused row without adding a selection marker', () => {
    const doc = createDocument('details');
    const { container } = renderRow({ doc, focused: true, selected: true });
    expect(container.querySelector('[data-row-action="details"]')).toHaveAttribute(
      'aria-label',
      'Show details for Layer 1',
    );
    expect(container.querySelector('.layers-row__selection-dot')).toBeNull();
  });
});

describe('LayersRow effective lock state', () => {
  it('shows an inherited lock and explains why the child cannot be unlocked here', () => {
    const { doc, child } = lockedParentDocument();
    const { container } = renderRow({ node: child, doc, depth: 1 });
    const row = container.querySelector('[role="treeitem"]');
    const lock = container.querySelector('button[aria-label*="locked by an ancestor"]');

    expect(row).toHaveClass('layers-row--locked');
    expect(lock).toHaveClass('layers-row__toggle--locked-on');
    expect(lock).toHaveAttribute('aria-pressed', 'true');
  });

  it('keeps visibility management available for an effectively locked child', () => {
    const { doc, child } = lockedParentDocument();
    const onToggleVisibility = vi.fn();
    const { container } = renderRow({ node: child, doc, onToggleVisibility });
    const visibility = container.querySelector('button[aria-label="Hide Child"]');

    expect(visibility).not.toBeNull();
    fireEvent.click(visibility!);
    expect(onToggleVisibility).toHaveBeenCalledWith('child');
  });

  it('keeps unlocking available on the ancestor row', () => {
    const { doc, parent } = lockedParentDocument();
    const { container } = renderRow({ node: parent, doc });

    expect(container.querySelector('button[aria-label="Unlock Parent"]')).not.toBeNull();
  });
});

describe('LayersRow effective visibility state', () => {
  it('marks a child of a hidden group as inherited-hidden and names the restricting layer', () => {
    const { doc, child } = hiddenParentDocument();
    const { container } = renderRow({ node: child, doc, depth: 1 });
    const row = container.querySelector('[role="treeitem"]');

    // Distinct from both a live row and a directly hidden row.
    expect(row).toHaveClass('layers-row--hidden-inherited');
    expect(row).not.toHaveClass('layers-row--hidden');

    const eye = container.querySelector('button[aria-label="Child is hidden by Parent"]');
    expect(eye).not.toBeNull();
    expect(eye).toHaveClass('layers-row__toggle--visibility-inherited');
    // The row's own visible flag is still on, so pressed state stays false.
    expect(eye).toHaveAttribute('aria-pressed', 'false');
  });

  it('keeps the direct-hidden treatment for a row hidden by its own flag', () => {
    const hidden = makeNode('n1', 'Hidden', 'shape', { visible: false });
    const { container } = renderRow({ node: hidden });
    const row = container.querySelector('[role="treeitem"]');

    expect(row).toHaveClass('layers-row--hidden');
    expect(row).not.toHaveClass('layers-row--hidden-inherited');
    expect(container.querySelector('button[aria-label="Show Hidden"]')).toHaveClass(
      'layers-row__toggle--visibility-off',
    );
  });

  it('keeps visibility toggling available for an inherited-hidden child', () => {
    const { doc, child } = hiddenParentDocument();
    const onToggleVisibility = vi.fn();
    const { container } = renderRow({ node: child, doc, onToggleVisibility });
    const eye = container.querySelector('button[aria-label="Child is hidden by Parent"]');

    fireEvent.click(eye!);
    expect(onToggleVisibility).toHaveBeenCalledWith('child');
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
    expect(badge).toHaveTextContent('Invert + Blur · 1/2');
    expect(badge).toHaveAttribute('aria-label', expect.stringContaining('2 Object Filters'));
    expect(badge?.tagName).toBe('BUTTON');
    expect(container.querySelectorAll('[role="treeitem"]')).toHaveLength(1);
  });

  it('offers a keyboard-accessible copy alternative to dragging a filter stack', () => {
    const onCopyEffectStack = vi.fn();
    const { getByRole } = renderRow({
      node: makeNode('n1', 'Layer 1', 'shape', {
        smartFilters: [
          { id: 'f1', kind: 'invert', visible: true, opacity: 1, blendMode: 'normal', value: 100 },
        ],
      }),
      onCopyEffectStack,
    });

    fireEvent.click(getByRole('button', { name: /1 of 1 Object Filters enabled on Layer 1/i }));
    expect(onCopyEffectStack).toHaveBeenCalledWith('n1', 'object-filters');
  });

  it('opens the Object Filters editor on normal activation when navigation is available', () => {
    const onOpenEffectStack = vi.fn();
    const onCopyEffectStack = vi.fn();
    const { getByRole } = renderRow({
      node: makeNode('n1', 'Layer 1', 'shape', {
        smartFilters: [
          { id: 'f1', kind: 'invert', visible: true, opacity: 1, blendMode: 'normal', value: 100 },
        ],
      }),
      onOpenEffectStack,
      onCopyEffectStack,
    });
    const badge = getByRole('button', { name: /1 of 1 Object Filters enabled on Layer 1/i });

    expect(badge).toHaveAttribute(
      'aria-label',
      expect.stringContaining('Adjustments > Object Filters'),
    );
    fireEvent.click(badge);
    expect(onOpenEffectStack).toHaveBeenCalledWith('n1', 'object-filters');
    expect(onCopyEffectStack).not.toHaveBeenCalled();

    fireEvent.click(badge, { shiftKey: true });
    expect(onCopyEffectStack).toHaveBeenCalledWith('n1', 'object-filters');
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
    expect(badge).toHaveTextContent('Invert + Blur · 0/2');
    expect(badge).toHaveAttribute('aria-label', expect.stringContaining('2 Object Filters'));
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
    expect(badge).toHaveTextContent('Invert + Blur + 1 more · 1/3');
  });
});

describe('LayersRow adjustment stack identity', () => {
  it('shows the ordered adjustment names and active count on the layer row', () => {
    const node = makeNode('a1', 'Grade', 'adjustment', {
      adjustments: [
        makeAdjustment('threshold-1', 'threshold'),
        makeAdjustment('map-1', 'gradientMap'),
      ],
    } as Partial<SceneNode>);
    const { container } = renderRow({ node });
    const row = container.querySelector('[role="treeitem"]');
    const summary = container.querySelector('[data-adjustment-summary]');
    const badge = container.querySelector('.layers-row__adjustment-badge');

    expect(summary).toHaveTextContent('Threshold + Gradient Map');
    expect(badge).toHaveTextContent('2/2');
    expect(badge).toHaveAttribute('aria-label', '2 of 2 adjustments active');
    expect(row).toHaveAttribute(
      'aria-label',
      'Grade, Adjustment Layer, Threshold, Gradient Map. 2 of 2 active.',
    );
  });

  it('keeps disabled adjustment names discoverable while showing their inactive count', () => {
    const node = makeNode('a1', 'Grade', 'adjustment', {
      adjustments: [
        makeAdjustment('threshold-1', 'threshold'),
        makeAdjustment('map-1', 'gradientMap', { visible: false }),
      ],
    } as Partial<SceneNode>);
    const { container } = renderRow({ node });

    expect(container.querySelector('[data-adjustment-summary]')).toHaveTextContent(
      'Threshold + Gradient Map',
    );
    expect(container.querySelector('.layers-row__adjustment-badge')).toHaveTextContent('1/2');
    expect(container.querySelector('[role="treeitem"]')).toHaveAttribute(
      'aria-label',
      'Grade, Adjustment Layer, Threshold, Gradient Map (off). 1 of 2 active.',
    );
  });

  it('uses a named Effect Studio treatment instead of exposing only its recipe steps', () => {
    const reticulationMember = (id: string, kind: 'dither' | 'grain', effectIndex: number) => ({
      ...makeAdjustment(id, kind),
      studioTreatment: {
        treatmentId: 'studio-reticulation',
        instanceId: 'reticulation-1',
        effectIndex,
        controls: {},
      },
    });
    const node = makeNode('n1', 'Overlay', 'shape', {
      smartFilters: [
        reticulationMember('dither-1', 'dither', 0),
        reticulationMember('grain-1', 'grain', 1),
      ],
    } as Partial<SceneNode>);
    const { container } = renderRow({ node });
    const badge = container.querySelector('.layers-row__object-filter-badge');

    expect(badge).toHaveTextContent('Reticulation');
    expect(badge).not.toHaveTextContent('Dither + Grain');
    expect(badge).toHaveAttribute(
      'aria-label',
      expect.stringContaining('Reticulation (Dither, Grain)'),
    );
  });

  it('opens the Adjustment Layer editor when its summary is activated', () => {
    const onOpenAdjustment = vi.fn();
    const node = makeNode('a1', 'Grade', 'adjustment', {
      adjustments: [makeAdjustment('threshold-1', 'threshold')],
    } as Partial<SceneNode>);
    const { container } = renderRow({ node, onOpenAdjustment });

    fireEvent.click(container.querySelector('[data-adjustment-summary]')!);
    expect(onOpenAdjustment).toHaveBeenCalledWith('a1');
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

describe('LayersRow visual differentiation', () => {
  it('exposes a semantic search-match cue on the matching row and name', () => {
    const { container } = renderRow({ searchMatch: true });
    const row = container.querySelector('[role="treeitem"]');

    expect(row).toHaveAttribute('data-search-match', 'true');
    expect(container.querySelector('.layers-row__name')).toHaveClass('layers-row__name--match');
  });

  it('renders an assigned layer colour as a row backdrop cue without a marker shape', () => {
    const { container } = renderRow({
      node: makeNode('n1', 'Tagged artwork', 'shape', { layerColor: 'purple' }),
    });
    const row = container.querySelector('[role="treeitem"]');

    expect(row).toHaveAttribute('data-layer-category', 'vector');
    expect(row).toHaveAttribute('data-layer-color', 'purple');
    expect(container.querySelector('.layers-row__color-tag')).toBeNull();
    expect(row?.getAttribute('style')).toContain('--layers-row-color');
  });

  it('falls back to an auto-generated name instead of rendering nothing when the layer has no name', () => {
    const node = makeNode('n1', '');
    const base = createDocument('empty-name-doc');
    const doc: Document = { ...base, rootChildren: ['n1'], nodes: { n1: node } };
    const { container } = renderRow({ node, doc });

    const nameEl = container.querySelector('.layers-row__name');
    expect(nameEl).toHaveClass('layers-row__name--ghost');
    expect(nameEl?.textContent?.trim()).not.toBe('');
    const row = container.querySelector('[role="treeitem"]');
    // The row's own accessible name must not start with an empty name
    // fragment (a bare leading comma) either.
    expect(row?.getAttribute('aria-label')).not.toMatch(/^,/);
  });

  it('keeps inactive masks visible and explains their source form', () => {
    const { container } = renderRow({
      node: makeNode('n1', 'Masked artwork', 'shape', {
        mask: {
          type: 'alpha',
          visible: false,
          rasterMask: {} as never,
        },
      }),
    });
    const badge = container.querySelector('.layers-row__mask-badge');

    expect(badge).toHaveTextContent('alpha mask');
    expect(badge).toHaveClass('layers-row__mask-badge--disabled');
    expect(badge).toHaveAttribute('aria-label', 'raster alpha mask, disabled');
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

  it('renders modern row elements without blank checkbox, and includes selection dot and category icon', () => {
    const frameNode = makeNode('f1', 'Page 1', 'frame', { w: 840, h: 1188 });
    const { container, rerender } = renderRow({
      node: frameNode,
      selected: false,
    });

    // Unselected: no checkbox, no dot, name clearly visible, type category class present
    expect(container.querySelector('.layers-row__selection-checkbox')).toBeNull();
    expect(container.querySelector('.layers-row__selection-dot')).toBeNull();
    expect(container.querySelector('.layers-row__name')?.textContent).toBe('Page 1');
    expect(container.querySelector('.layers-row__type-icon--frame')).not.toBeNull();

    // Selected: row styling/focus carry selection; the old competing dot is
    // intentionally gone so the type icon remains the single identity slot.
    rerender(
      <LayersRow
        node={frameNode}
        depth={0}
        selected={true}
        focused={false}
        expanded={false}
        editing={false}
        totalRows={1}
        onToggleExpand={vi.fn()}
        onSelect={vi.fn()}
        onRename={vi.fn()}
        onRenameStart={vi.fn()}
        onRenameCommit={vi.fn()}
        onRenameCancel={vi.fn()}
        onToggleVisibility={vi.fn()}
        onToggleLock={vi.fn()}
        onFocus={vi.fn()}
        idx={0}
      />,
    );

    expect(container.querySelector('.layers-row__selection-checkbox')).toBeNull();
    expect(container.querySelector('.layers-row__selection-dot')).toBeNull();
    expect(container.querySelector('.layers-row__name')?.textContent).toBe('Page 1');
  });
});

describe('LayersRow — workspace projection', () => {
  const maskedGroup = () =>
    makeNode('n1', 'Masked group', 'group', {
      children: [],
      mask: { type: 'clip', sourceNodeId: 'n2', visible: true },
    });

  it('pins every badge group when no projection is provided (isolated renders)', () => {
    const { container } = renderRow({ node: maskedGroup() });
    const slot = container.querySelector('[data-badge-group="mask"]');
    expect(slot).not.toBeNull();
    expect(slot).toHaveAttribute('data-badge-pinned', 'true');
  });

  it('marks groups the workspace does not pin as revealed', () => {
    const { container } = renderRow({
      node: maskedGroup(),
      pinnedBadgeGroups: ['appearance'],
    });
    const slot = container.querySelector('[data-badge-group="mask"]');
    expect(slot).toHaveAttribute('data-badge-pinned', 'false');
  });

  it('keeps the badge state in the accessible name regardless of pinning', () => {
    const { container } = renderRow({
      node: maskedGroup(),
      pinnedBadgeGroups: [],
    });
    const row = container.querySelector('[role="treeitem"]');
    expect(row?.getAttribute('aria-label')).toContain('mask');
  });

  it('pins solo only when the workspace configures it', () => {
    const onToggleSolo = vi.fn();
    const { container } = renderRow({ onToggleSolo, pinSolo: false });
    expect(container.querySelector('[data-row-action="solo"]')).toHaveAttribute(
      'data-row-action-pinned',
      'false',
    );
  });

  it('marks solo pinned when the workspace configures it', () => {
    const onToggleSolo = vi.fn();
    const { container } = renderRow({ onToggleSolo, pinSolo: true });
    expect(container.querySelector('[data-row-action="solo"]')).toHaveAttribute(
      'data-row-action-pinned',
      'true',
    );
  });
});

describe('LayersRow — trace provenance', () => {
  const tracedGroup = () =>
    makeNode('g1', 'Traced mark', 'group', {
      children: [],
      traceMetadata: TRACE_META,
    } as Partial<SceneNode>);

  it('renders the trace badge with its badge group', () => {
    const { container } = renderRow({ node: tracedGroup() });
    const badge = container.querySelector('.layers-row__trace-badge');
    expect(badge).not.toBeNull();
    expect(badge).toHaveAttribute('data-trace-group', 'true');
    const slot = badge?.closest('[data-badge-group]');
    expect(slot).toHaveAttribute('data-badge-group', 'trace');
  });

  it('is revealed (not pinned) because no built-in workspace pins trace', () => {
    const { container } = renderRow({
      node: tracedGroup(),
      pinnedBadgeGroups: ['component', 'layout', 'appearance'],
    });
    const slot = container.querySelector('[data-badge-group="trace"]');
    expect(slot).toHaveAttribute('data-badge-pinned', 'false');
  });

  it('keeps the trace state in the accessible name when the badge is revealed', () => {
    const { container } = renderRow({
      node: tracedGroup(),
      pinnedBadgeGroups: [],
    });
    const row = container.querySelector('[role="treeitem"]');
    expect(row?.getAttribute('aria-label')).toContain('traced artwork');
  });

  it('does not render for an untraced group', () => {
    const { container } = renderRow({
      node: makeNode('g1', 'Plain group', 'group', { children: [] } as Partial<SceneNode>),
    });
    expect(container.querySelector('.layers-row__trace-badge')).toBeNull();
  });
});

describe('LayersRow — appearance labels', () => {
  it('labels the blend/opacity chip with its full wording and states it on the row', () => {
    const node = makeNode('n1', 'Treated hero', 'shape', {
      blendMode: 'multiply',
      opacity: 0.5,
    } as Partial<SceneNode>);
    const { container } = renderRow({ node });

    const badge = container.querySelector('.layers-row__badge');
    expect(badge?.textContent).toBe('Multiply 50%');
    // Compact visible text, complete accessible label.
    expect(badge).toHaveAttribute('aria-label', 'Blend mode Multiply, Opacity 50%');

    const row = container.querySelector('[role="treeitem"]');
    const rowLabel = row?.getAttribute('aria-label') ?? '';
    expect(rowLabel).toContain('Blend mode Multiply');
    expect(rowLabel).toContain('Opacity 50%');
  });

  it('omits the appearance chip entirely for a default layer', () => {
    const { container } = renderRow({ node: makeNode('n1', 'Plain layer') });
    expect(container.querySelector('.layers-row__badge')).toBeNull();
    expect(container.querySelector('[role="treeitem"]')?.getAttribute('aria-label')).not.toContain(
      'Blend mode',
    );
  });

  it('announces opacity alone when the blend mode is default', () => {
    const node = makeNode('n1', 'Faded layer', 'shape', { opacity: 0.4 } as Partial<SceneNode>);
    const { container } = renderRow({ node });
    expect(container.querySelector('.layers-row__badge')?.textContent).toBe('40%');
    expect(container.querySelector('.layers-row__badge')).toHaveAttribute(
      'aria-label',
      'Opacity 40%',
    );
  });

  it('states layer effects and object filters in the row name even when their chips are hidden', () => {
    const node = makeNode('n1', 'Treated hero', 'shape', {
      effects: [{ id: 'fx-1', type: 'blur', visible: true, opacity: 0.5, blendMode: 'normal' }],
      smartFilters: [{ id: 'sf-1', kind: 'brightness', visible: true, opacity: 1, value: 20 }],
    } as unknown as Partial<SceneNode>);
    const { container } = renderRow({ node });
    const rowLabel = container.querySelector('[role="treeitem"]')?.getAttribute('aria-label') ?? '';
    expect(rowLabel).toContain('1 layer effect');
    expect(rowLabel).toContain('1 object filter');
  });
});
