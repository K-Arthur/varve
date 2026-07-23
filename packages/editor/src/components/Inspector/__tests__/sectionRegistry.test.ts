/**
 * Tests for section registry and section state — M1 foundation.
 *
 * Covers: stable IDs, availability predicates, default state, migration,
 * collapse/hide operations, and query helpers.
 */
import type { SceneNode } from '@strata/scene';
import { describe, expect, it } from 'vitest';
import {
  CATEGORY_LABELS,
  getAllSectionIds,
  getAllSections,
  getAvailableSections,
  getHideableSectionIds,
  getSectionDefinition,
  getSectionsByCategory,
  SECTION_DEFINITIONS,
  type SectionAvailabilityContext,
} from '../sectionRegistry';
import {
  countHiddenSections,
  createDefaultSectionState,
  getHiddenSectionIds,
  hideOptionalSections,
  hideSection,
  hideSubSection,
  isSectionCollapsed,
  isSectionVisible,
  isSubSectionCollapsed,
  migrateSectionState,
  restoreDefaultCollapsed,
  restoreDefaultSectionState,
  setCollapsed,
  setSubSectionCollapsed,
  showAllSections,
  showSection,
  showSubSection,
  toggleCollapsed,
  toggleSubSectionCollapsed,
} from '../sectionState';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNode(overrides: Partial<SceneNode> = {}): SceneNode {
  return {
    id: 'node-1',
    kind: 'shape',
    name: 'Shape 1',
    x: 0,
    y: 0,
    rotation: 0,
    opacity: 1,
    blendMode: 'passThrough',
    visible: true,
    locked: false,
    fills: [],
    strokes: [],
    effects: [],
    shape: { kind: 'rect', w: 100, h: 80 },
    ...overrides,
  } as unknown as SceneNode;
}

function makeFrameNode(overrides: Partial<SceneNode> = {}): SceneNode {
  return makeNode({ kind: 'frame', name: 'Frame 1', w: 200, h: 200, ...overrides });
}

function makeTextNode(overrides: Partial<SceneNode> = {}): SceneNode {
  return makeNode({ kind: 'text', name: 'Text 1', text: 'Hello', ...overrides });
}

function makeAdjustmentNode(overrides: Partial<SceneNode> = {}): SceneNode {
  return makeNode({ kind: 'adjustment', name: 'Adjustment 1', ...overrides });
}

/**
 * A placed image asset — a `shape` node with an image fill, exactly what
 * `isImageShape` (and every image section: placement, crop, denoise, lens
 * blur, etc.) checks for. Distinct from a `rasterLayer` node, which is a
 * paintable canvas layer created by the brush/smudge tools and is never
 * treated as "an image" by these sections.
 */
function makeImageNode(overrides: Partial<SceneNode> = {}): SceneNode {
  return makeNode({
    name: 'Image 1',
    fills: [{ type: 'image', image: { src: 'blob:image-1' } }],
    ...overrides,
  } as unknown as Partial<SceneNode>);
}

function makeComponentFrame(): SceneNode {
  return makeFrameNode({ componentId: 'comp-1' }) as unknown as SceneNode;
}

function baseCtx(overrides: Partial<SectionAvailabilityContext> = {}): SectionAvailabilityContext {
  return {
    selectionKind: 'single',
    selectedNodes: [makeNode()],
    workspaceMode: 'design',
    activeTool: 'select',
    prototypeMode: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Section Registry Tests
// ---------------------------------------------------------------------------

describe('Section Registry', () => {
  it('has unique IDs for all sections', () => {
    const ids = SECTION_DEFINITIONS.map((d) => d.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it('has no duplicate order values', () => {
    const orders = SECTION_DEFINITIONS.map((d) => d.order);
    // Orders don't need to be unique (multiple sections can share),
    // but they should be in ascending order within each category
    expect(orders.length).toBeGreaterThan(0);
  });

  it('getSectionDefinition returns definition for valid ID', () => {
    const def = getSectionDefinition('position-size');
    expect(def).toBeDefined();
    expect(def?.title).toBe('Position & Size');
    expect(def?.id).toBe('position-size');
  });

  it('getSectionDefinition returns undefined for unknown ID', () => {
    // @ts-expect-error testing unknown ID
    expect(getSectionDefinition('nonexistent')).toBeUndefined();
  });

  it('getAllSections returns all definitions', () => {
    const all = getAllSections();
    expect(all.length).toBe(SECTION_DEFINITIONS.length);
  });

  it('getAllSectionIds returns all IDs', () => {
    const ids = getAllSectionIds();
    expect(ids.length).toBe(SECTION_DEFINITIONS.length);
    expect(ids).toContain('position-size');
    expect(ids).toContain('fills');
    expect(ids).toContain('effects');
  });

  it('getHideableSectionIds excludes essential sections', () => {
    const hideable = getHideableSectionIds();
    const all = getAllSectionIds();
    expect(hideable.length).toBeLessThan(all.length);
    // Essential sections should NOT be in hideable list
    expect(hideable).not.toContain('position-size');
    expect(hideable).not.toContain('fills');
    expect(hideable).not.toContain('stroke');
    expect(hideable).not.toContain('appearance');
    // Optional sections SHOULD be in hideable list
    expect(hideable).toContain('effects');
    expect(hideable).toContain('typography');
    expect(hideable).toContain('corner-radius');
  });

  it('every definition has required fields', () => {
    for (const def of SECTION_DEFINITIONS) {
      expect(typeof def.id).toBe('string');
      expect(typeof def.title).toBe('string');
      expect(typeof def.defaultExpanded).toBe('boolean');
      expect(typeof def.canHide).toBe('boolean');
      expect(typeof def.essential).toBe('boolean');
      expect(typeof def.order).toBe('number');
      expect(typeof def.category).toBe('string');
      expect(typeof def.isAvailable).toBe('function');
    }
  });

  it('essential sections are not hideable', () => {
    for (const def of SECTION_DEFINITIONS) {
      if (def.essential) {
        expect(def.canHide).toBe(false);
      }
    }
  });

  it('getSectionsByCategory groups correctly', () => {
    const grouped = getSectionsByCategory();
    expect(grouped.has('geometry')).toBe(true);
    expect(grouped.has('appearance')).toBe(true);
    expect(grouped.has('content')).toBe(true);
    expect(grouped.has('advanced')).toBe(true);
    expect(grouped.has('prototype')).toBe(true);
    expect(grouped.has('tool')).toBe(true);
    // Every section is in some group
    let total = 0;
    for (const sections of grouped.values()) {
      total += sections.length;
    }
    expect(total).toBe(SECTION_DEFINITIONS.length);
  });

  it('CATEGORY_LABELS covers all categories', () => {
    const grouped = getSectionsByCategory();
    for (const cat of grouped.keys()) {
      expect(CATEGORY_LABELS[cat]).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// Availability Predicates
// ---------------------------------------------------------------------------

describe('Section availability predicates', () => {
  it('position-size is available when there are selected nodes', () => {
    const def = getSectionDefinition('position-size')!;
    expect(def.isAvailable(baseCtx({ selectionKind: 'empty', selectedNodes: [] }))).toBe(false);
    expect(def.isAvailable(baseCtx({ selectionKind: 'single', selectedNodes: [makeNode()] }))).toBe(
      true,
    );
    expect(
      def.isAvailable(baseCtx({ selectionKind: 'multi', selectedNodes: [makeNode(), makeNode()] })),
    ).toBe(true);
  });

  it('corner-radius only available for single rect or frame', () => {
    const def = getSectionDefinition('corner-radius')!;
    expect(def.isAvailable(baseCtx({ selectedNodes: [makeNode()] }))).toBe(true);
    expect(def.isAvailable(baseCtx({ selectedNodes: [makeFrameNode()] }))).toBe(true);
    expect(def.isAvailable(baseCtx({ selectedNodes: [makeTextNode()] }))).toBe(false);
    expect(
      def.isAvailable(baseCtx({ selectionKind: 'multi', selectedNodes: [makeNode(), makeNode()] })),
    ).toBe(false);
  });

  it('layout only available for single frame', () => {
    const def = getSectionDefinition('layout')!;
    expect(def.isAvailable(baseCtx({ selectedNodes: [makeFrameNode()] }))).toBe(true);
    expect(def.isAvailable(baseCtx({ selectedNodes: [makeNode()] }))).toBe(false);
  });

  it('component only available for component instances', () => {
    const def = getSectionDefinition('component')!;
    expect(def.isAvailable(baseCtx({ selectedNodes: [makeComponentFrame()] }))).toBe(true);
    expect(def.isAvailable(baseCtx({ selectedNodes: [makeFrameNode()] }))).toBe(false);
  });

  it('adjustment only available for adjustment nodes', () => {
    const def = getSectionDefinition('adjustment')!;
    expect(def.isAvailable(baseCtx({ selectedNodes: [makeAdjustmentNode()] }))).toBe(true);
    expect(def.isAvailable(baseCtx({ selectedNodes: [makeNode()] }))).toBe(false);
  });

  it('background-removal stays available for nodes with prior mask/removal state, not just live image fills', () => {
    const def = getSectionDefinition('background-removal')!;
    expect(def.isAvailable(baseCtx({ selectedNodes: [makeImageNode()] }))).toBe(true);
    expect(
      def.isAvailable(
        baseCtx({
          selectedNodes: [makeNode({ mask: { rasterMask: 'mask-1' } } as never)],
        }),
      ),
    ).toBe(true);
    expect(
      def.isAvailable(
        baseCtx({
          selectedNodes: [makeNode({ backgroundRemoval: { method: 'ai' } } as never)],
        }),
      ),
    ).toBe(true);
    expect(def.isAvailable(baseCtx({ selectedNodes: [makeNode()] }))).toBe(false);
  });

  it('image-placement only available for single image nodes', () => {
    const def = getSectionDefinition('image-placement')!;
    expect(def.isAvailable(baseCtx({ selectedNodes: [makeImageNode()] }))).toBe(true);
    expect(def.isAvailable(baseCtx({ selectedNodes: [makeNode()] }))).toBe(false);
  });

  it('image sections match isImageShape, not node kind or fill position', () => {
    const def = getSectionDefinition('image-placement')!;
    // A rasterLayer (paint-tool canvas layer) is never "an image" to these
    // sections — only a shape node with an image fill is.
    expect(def.isAvailable(baseCtx({ selectedNodes: [makeNode({ kind: 'rasterLayer' })] }))).toBe(
      false,
    );
    // Any shape kind counts, not just rect/ellipse.
    expect(
      def.isAvailable(
        baseCtx({
          selectedNodes: [
            makeImageNode({ shape: { kind: 'polygon', sides: 5, w: 100, h: 100 } } as never),
          ],
        }),
      ),
    ).toBe(true);
    // An image fill anywhere in the stack counts, not just fills[0].
    expect(
      def.isAvailable(
        baseCtx({
          selectedNodes: [
            makeImageNode({
              fills: [
                { type: 'solid', color: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 } },
                { type: 'image', image: { src: 'blob:image-2' } },
              ],
            } as never),
          ],
        }),
      ),
    ).toBe(true);
  });

  it('align-distribute only available for multi selection', () => {
    const def = getSectionDefinition('align-distribute')!;
    expect(
      def.isAvailable(baseCtx({ selectionKind: 'multi', selectedNodes: [makeNode(), makeNode()] })),
    ).toBe(true);
    expect(def.isAvailable(baseCtx({ selectionKind: 'single', selectedNodes: [makeNode()] }))).toBe(
      false,
    );
  });

  it('brush-settings only available for paint/eraser/pencil/smudge tools', () => {
    const def = getSectionDefinition('brush-settings')!;
    expect(def.isAvailable(baseCtx({ activeTool: 'paint' }))).toBe(true);
    expect(def.isAvailable(baseCtx({ activeTool: 'eraser' }))).toBe(true);
    expect(def.isAvailable(baseCtx({ activeTool: 'pencil' }))).toBe(true);
    expect(def.isAvailable(baseCtx({ activeTool: 'smudge' }))).toBe(true);
    expect(def.isAvailable(baseCtx({ activeTool: 'select' }))).toBe(false);
    expect(def.isAvailable(baseCtx({ activeTool: 'rect' }))).toBe(false);
  });

  it('frame-presets only available when frame tool is active', () => {
    const def = getSectionDefinition('frame-presets')!;
    expect(def.isAvailable(baseCtx({ activeTool: 'frame' }))).toBe(true);
    expect(def.isAvailable(baseCtx({ activeTool: 'select' }))).toBe(false);
  });

  it('interaction is available for any single selection, independent of prototypeMode', () => {
    // InteractionSection lets you author interactions on any node; it does
    // not gate on prototypeMode (which has no UI toggle anywhere in the app —
    // gating on it here previously made this section permanently unreachable).
    const def = getSectionDefinition('interaction')!;
    expect(def.isAvailable(baseCtx({ prototypeMode: true, selectionKind: 'single' }))).toBe(true);
    expect(def.isAvailable(baseCtx({ prototypeMode: false, selectionKind: 'single' }))).toBe(true);
    expect(def.isAvailable(baseCtx({ prototypeMode: true, selectionKind: 'multi' }))).toBe(false);
  });

  it('prototype-flow only available in prototype mode', () => {
    const def = getSectionDefinition('prototype-flow')!;
    expect(def.isAvailable(baseCtx({ prototypeMode: true }))).toBe(true);
    expect(def.isAvailable(baseCtx({ prototypeMode: false }))).toBe(false);
  });

  it('getAvailableSections returns only matching sections', () => {
    const ellipseNode = makeNode({
      shape: { kind: 'ellipse', rx: 50, ry: 30 },
    } as unknown as SceneNode);
    const available = getAvailableSections(
      baseCtx({
        selectionKind: 'single',
        selectedNodes: [ellipseNode],
        activeTool: 'select',
      }),
    );
    const ids = available.map((d) => d.id);
    expect(ids).toContain('position-size');
    expect(ids).toContain('fills');
    expect(ids).toContain('stroke');
    // Not available for a single ellipse (not rect/frame):
    expect(ids).not.toContain('corner-radius');
    expect(ids).not.toContain('layout');
    expect(ids).not.toContain('component');
    expect(ids).not.toContain('adjustment');
    expect(ids).not.toContain('image-placement');
    expect(ids).not.toContain('align-distribute');
    expect(ids).not.toContain('brush-settings');
  });

  it('does not expose generic appearance or legacy effects sections for an adjustment node', () => {
    const available = getAvailableSections(
      baseCtx({
        selectionKind: 'single',
        selectedNodes: [makeAdjustmentNode()],
      }),
    );

    expect(available.map((definition) => definition.id)).toEqual(['adjustment']);
  });
});

// ---------------------------------------------------------------------------
// Section State
// ---------------------------------------------------------------------------

describe('Section state', () => {
  it('createDefaultSectionState creates state for all sections', () => {
    const state = createDefaultSectionState();
    const ids = getAllSectionIds();
    expect(Object.keys(state).length).toBe(ids.length);
    for (const id of ids) {
      expect(state[id]).toBeDefined();
      expect(typeof state[id].collapsed).toBe('boolean');
      expect(typeof state[id].hidden).toBe('boolean');
    }
  });

  it('default state respects section defaultExpanded', () => {
    const state = createDefaultSectionState();
    // Sections with defaultExpanded=true should have collapsed=false
    expect(state['position-size'].collapsed).toBe(false);
    expect(state.fills.collapsed).toBe(false);
    // Sections with defaultExpanded=false should have collapsed=true
    expect(state['cognitive-load'].collapsed).toBe(true);
  });

  it('default state has no hidden sections', () => {
    const state = createDefaultSectionState();
    for (const id of getAllSectionIds()) {
      expect(state[id].hidden).toBe(false);
    }
  });

  it('toggleCollapsed toggles collapsed state', () => {
    const initial = createDefaultSectionState();
    expect(initial['position-size'].collapsed).toBe(false);
    const toggled = toggleCollapsed(initial, 'position-size');
    expect(toggled['position-size'].collapsed).toBe(true);
    const toggledBack = toggleCollapsed(toggled, 'position-size');
    expect(toggledBack['position-size'].collapsed).toBe(false);
  });

  it('setCollapsed sets collapsed state', () => {
    const initial = createDefaultSectionState();
    const collapsed = setCollapsed(initial, 'position-size', true);
    expect(collapsed['position-size'].collapsed).toBe(true);
    const expanded = setCollapsed(collapsed, 'position-size', false);
    expect(expanded['position-size'].collapsed).toBe(false);
  });

  it('hideSection sets hidden=true', () => {
    const initial = createDefaultSectionState();
    expect(initial.effects.hidden).toBe(false);
    const hidden = hideSection(initial, 'effects');
    expect(hidden.effects.hidden).toBe(true);
  });

  it('showSection sets hidden=false', () => {
    const initial = createDefaultSectionState();
    const hidden = hideSection(initial, 'effects');
    const shown = showSection(hidden, 'effects');
    expect(shown.effects.hidden).toBe(false);
  });

  it('showAllSections unhides all', () => {
    let state = createDefaultSectionState();
    state = hideSection(state, 'effects');
    state = hideSection(state, 'typography');
    state = hideSection(state, 'corner-radius');
    const shown = showAllSections(state);
    expect(shown.effects.hidden).toBe(false);
    expect(shown.typography.hidden).toBe(false);
    expect(shown['corner-radius'].hidden).toBe(false);
  });

  it('restoreDefaultSectionState resets everything', () => {
    let state = createDefaultSectionState();
    state = hideSection(state, 'effects');
    state = setCollapsed(state, 'fills', true);
    const restored = restoreDefaultSectionState(state);
    expect(restored.effects.hidden).toBe(false);
    expect(restored.fills.collapsed).toBe(false);
  });

  it('restoreDefaultCollapsed resets only collapsed state', () => {
    let state = createDefaultSectionState();
    state = hideSection(state, 'effects');
    state = setCollapsed(state, 'fills', true);
    const restored = restoreDefaultCollapsed(state);
    expect(restored.effects.hidden).toBe(true); // hidden preserved
    expect(restored.fills.collapsed).toBe(false); // collapsed reset
  });

  it('hideOptionalSections hides all non-essential sections', () => {
    const state = createDefaultSectionState();
    const hidden = hideOptionalSections(state);
    // Essential sections remain visible
    expect(hidden['position-size'].hidden).toBe(false);
    expect(hidden.fills.hidden).toBe(false);
    expect(hidden.stroke.hidden).toBe(false);
    expect(hidden.appearance.hidden).toBe(false);
    // Optional sections are hidden
    expect(hidden.effects.hidden).toBe(true);
    expect(hidden.typography.hidden).toBe(true);
    expect(hidden['corner-radius'].hidden).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

describe('Section state queries', () => {
  it('isSectionVisible returns true for non-hidden sections', () => {
    const state = createDefaultSectionState();
    expect(isSectionVisible(state, 'position-size')).toBe(true);
  });

  it('isSectionVisible returns false for hidden sections', () => {
    const state = hideSection(createDefaultSectionState(), 'effects');
    expect(isSectionVisible(state, 'effects')).toBe(false);
  });

  it('isSectionCollapsed returns correct state', () => {
    const state = createDefaultSectionState();
    expect(isSectionCollapsed(state, 'position-size')).toBe(false);
    expect(isSectionCollapsed(state, 'cognitive-load')).toBe(true);
  });

  it('countHiddenSections counts correctly', () => {
    let state = createDefaultSectionState();
    expect(countHiddenSections(state)).toBe(0);
    state = hideSection(state, 'effects');
    state = hideSection(state, 'typography');
    expect(countHiddenSections(state)).toBe(2);
  });

  it('getHiddenSectionIds returns correct IDs', () => {
    let state = createDefaultSectionState();
    state = hideSection(state, 'effects');
    state = hideSection(state, 'typography');
    const hidden = getHiddenSectionIds(state);
    expect(hidden).toContain('effects');
    expect(hidden).toContain('typography');
    expect(hidden).not.toContain('position-size');
  });
});

// ---------------------------------------------------------------------------
// Subsection state
// ---------------------------------------------------------------------------

describe('Subsection state', () => {
  it('default state has no subsections', () => {
    const state = createDefaultSectionState();
    expect(state.typography.subsections).toBeUndefined();
  });

  it('toggleSubSectionCollapsed toggles nested collapsed state', () => {
    // Start by opening the parent so subsections are accessible
    let state = createDefaultSectionState();
    state = toggleSubSectionCollapsed(state, 'typography', 'openTypeFeatures');
    // After toggle, subsection collapsed should be true (started as false/expanded)
    expect(isSubSectionCollapsed(state, 'typography', 'openTypeFeatures')).toBe(true);
    // Toggle back
    state = toggleSubSectionCollapsed(state, 'typography', 'openTypeFeatures');
    expect(isSubSectionCollapsed(state, 'typography', 'openTypeFeatures')).toBe(false);
  });

  it('setSubSectionCollapsed sets nested collapsed state', () => {
    let state = createDefaultSectionState();
    state = setSubSectionCollapsed(state, 'typography', 'openTypeFeatures', true);
    expect(isSubSectionCollapsed(state, 'typography', 'openTypeFeatures')).toBe(true);
    state = setSubSectionCollapsed(state, 'typography', 'openTypeFeatures', false);
    expect(isSubSectionCollapsed(state, 'typography', 'openTypeFeatures')).toBe(false);
  });

  it('multiple subsections have independent state', () => {
    let state = createDefaultSectionState();
    state = toggleSubSectionCollapsed(state, 'typography', 'openTypeFeatures');
    expect(isSubSectionCollapsed(state, 'typography', 'openTypeFeatures')).toBe(true);
    // Variable font axes remains expanded
    expect(isSubSectionCollapsed(state, 'typography', 'variableFontAxes')).toBe(false);
  });

  it('subsections survive parent collapse and reopen', () => {
    let state = createDefaultSectionState();
    // Expand the subsection
    state = setSubSectionCollapsed(state, 'typography', 'openTypeFeatures', false);
    expect(isSubSectionCollapsed(state, 'typography', 'openTypeFeatures')).toBe(false);
    // Collapse the parent
    state = setCollapsed(state, 'typography', true);
    expect(isSectionCollapsed(state, 'typography')).toBe(true);
    // Subsection state is preserved under the parent
    expect(isSubSectionCollapsed(state, 'typography', 'openTypeFeatures')).toBe(false);
    // Reopen parent
    state = setCollapsed(state, 'typography', false);
    // Subsection state is still preserved
    expect(isSubSectionCollapsed(state, 'typography', 'openTypeFeatures')).toBe(false);
  });

  it('unknown subsectionId returns false for collapse', () => {
    const state = createDefaultSectionState();
    expect(isSubSectionCollapsed(state, 'typography', 'nonexistent')).toBe(false);
  });

  it('hideSubSection and showSubSection toggle hidden state', () => {
    let state = createDefaultSectionState();
    state = hideSubSection(state, 'typography', 'openTypeFeatures');
    expect(state.typography.subsections?.openTypeFeatures?.hidden).toBe(true);
    state = showSubSection(state, 'typography', 'openTypeFeatures');
    expect(state.typography.subsections?.openTypeFeatures?.hidden).toBe(false);
  });

  it('subsections with no parent state get defaults', () => {
    const state = createDefaultSectionState();
    // Default collapsed = false (not collapsed) for subsection with no stored state
    expect(isSubSectionCollapsed(state, 'typography', 'openTypeFeatures')).toBe(false);
  });

  it('different section parents have independent subsection trees', () => {
    // Simulate having subsections on two different parents
    let state = createDefaultSectionState();
    state = toggleSubSectionCollapsed(state, 'typography', 'openTypeFeatures');
    state = toggleSubSectionCollapsed(state, 'typography', 'variableFontAxes');
    // Both subsections on `typography` are collapsed
    expect(isSubSectionCollapsed(state, 'typography', 'openTypeFeatures')).toBe(true);
    expect(isSubSectionCollapsed(state, 'typography', 'variableFontAxes')).toBe(true);
    // Unrelated section has no subsections
    expect(state.fills.subsections).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------

describe('Section state migration', () => {
  it('migrateSectionState with null returns defaults', () => {
    const state = migrateSectionState(null);
    expect(state['position-size']).toBeDefined();
    expect(state['position-size'].hidden).toBe(false);
  });

  it('migrateSectionState with undefined returns defaults', () => {
    const state = migrateSectionState(undefined);
    expect(state['position-size']).toBeDefined();
  });

  it('migrateSectionState with empty object returns defaults', () => {
    const state = migrateSectionState({});
    expect(state['position-size'].collapsed).toBe(false);
  });

  it('migrateSectionState preserves valid state', () => {
    const state = migrateSectionState({
      'position-size': { collapsed: true, hidden: false },
      effects: { collapsed: false, hidden: true },
    });
    expect(state['position-size'].collapsed).toBe(true);
    expect(state['position-size'].hidden).toBe(false);
    expect(state.effects.collapsed).toBe(false);
    expect(state.effects.hidden).toBe(true);
  });

  it('migrateSectionState ignores unknown IDs', () => {
    const state = migrateSectionState({
      'nonexistent-section': { collapsed: true, hidden: true },
      'position-size': { collapsed: true, hidden: false },
    });
    // @ts-expect-error testing unknown key
    expect(state['nonexistent-section']).toBeUndefined();
    expect(state['position-size'].collapsed).toBe(true);
  });

  it('migrateSectionState handles malformed data gracefully', () => {
    const state = migrateSectionState({
      'position-size': 'not-an-object',
      effects: null,
    });
    // Falls back to defaults for malformed entries
    expect(state['position-size'].collapsed).toBe(false);
    expect(state.effects.hidden).toBe(false);
  });

  it('migrateSectionState handles wrapped format', () => {
    const state = migrateSectionState({
      version: 1,
      sections: {
        'position-size': { collapsed: true, hidden: false },
      },
    } as unknown as Record<string, unknown>);
    expect(state['position-size'].collapsed).toBe(true);
  });
});
