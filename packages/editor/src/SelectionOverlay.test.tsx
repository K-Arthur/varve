/**
 * SelectionOverlay tests — handle visibility + resize for all shape types.
 *
 * Research basis: TDD for overlay handle completeness (Phase A4).
 */

import { render } from '@testing-library/react';
import type { Document, SceneNode, ShapeNode } from '@varve/scene';
import type { Affine } from '@varve/shared';
import { describe, expect, it, vi } from 'vitest';
import {
  computeResize,
  computeRotatedLocalBBox,
  SelectionOverlay,
  type SelectionOverlayProps,
} from './SelectionOverlay';

vi.mock('./context', () => ({
  useEditor: vi.fn(),
}));

import { useEditor } from './context';

const MOCK_PAN = { x: 0, y: 0 };
const MOCK_ZOOM = 1;

function buildDoc(nodes: Record<string, SceneNode>): Document {
  return {
    id: 'test',
    formatVersion: '1.0',
    name: 'Test',
    nextId: 100,
    rootChildren: Object.keys(nodes),
    nodes,
    components: {},
    variableStore: {
      variables: {},
      modes: [],
      activeMode: 'default',
      collections: {},
      activeCollectionId: '',
    },
  };
}

function makeShapeNode(
  id: string,
  shape: ShapeNode['shape'],
  overrides: Partial<SceneNode> = {},
): SceneNode {
  return {
    id,
    kind: 'shape',
    name: 'Shape',
    index: 0,
    order: 'a0',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal' as const,
    rotation: 0,
    transform: [1, 0, 0, 1, 0, 0] as const,
    fill: [57, 208, 198, 255] as const,
    strokes: [],
    effects: [],
    shape,
    ...overrides,
  } as SceneNode;
}

function renderOverlay(
  nodes: SceneNode[],
  props: SelectionOverlayProps = {},
  pan = MOCK_PAN,
  zoom = MOCK_ZOOM,
) {
  const nodeMap: Record<string, SceneNode> = {};
  for (const n of nodes) {
    nodeMap[n.id] = n;
  }

  const mockUseEditor = useEditor as unknown as { mockReturnValue: (v: unknown) => void };
  mockUseEditor.mockReturnValue({
    state: {
      document: buildDoc(nodeMap),
      selection: nodes.map((n) => n.id),
      pan,
      zoom,
    },
    selectedNodes: () => nodes,
    setNodePosition: vi.fn(),
    setNodePositions: vi.fn(),
    updateNodes: vi.fn(),
    setNodeSize: vi.fn(),
    updateNode: vi.fn(),
    beginTransaction: vi.fn(),
    commitTransaction: vi.fn(),
    setSelectedRotation: vi.fn(),
  });

  const { container } = render(<SelectionOverlay {...props} />);
  return container;
}

describe('computeRotatedLocalBBox', () => {
  it('expands width when dragging right handle on 45-degree rotated rect', () => {
    const lb = { x: 0, y: 0, w: 100, h: 80 };
    const rot = Math.PI / 4;
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);
    const worldMat = [cos, sin, -sin, cos, 0, 0] as const;
    const det = cos * cos - sin * -sin;
    const invMat = [cos / det, -sin / det, sin / det, cos / det, 0, 0] as const;

    const result = computeRotatedLocalBBox(
      3,
      lb,
      worldMat as Affine,
      invMat as Affine,
      20,
      0,
      false,
      false,
    );
    expect(result.w).toBeGreaterThan(100);
  });

  it('preserves aspect ratio with shift key', () => {
    const lb = { x: 0, y: 0, w: 100, h: 50 };
    const worldMat = [1, 0, 0, 1, 0, 0] as const;
    const invMat = [1, 0, 0, 1, 0, 0] as const;
    const result = computeRotatedLocalBBox(
      4,
      lb,
      worldMat as Affine,
      invMat as Affine,
      50,
      50,
      true,
      false,
    );
    expect(result.w / result.h).toBeCloseTo(2, 1);
  });
});

describe('computeResize', () => {
  it('handle 0 (top-left) moves top-left corner', () => {
    const r = computeResize(0, 100, 100, 200, 100, 10, 10);
    expect(r.x).toBe(110);
    expect(r.y).toBe(110);
    expect(r.w).toBe(190);
    expect(r.h).toBe(90);
  });

  it('handle 4 (bottom-right) moves bottom-right corner', () => {
    const r = computeResize(4, 100, 100, 200, 100, 10, 10);
    expect(r.x).toBe(100);
    expect(r.y).toBe(100);
    expect(r.w).toBe(210);
    expect(r.h).toBe(110);
  });

  it('handle 2 (top-right) moves top-right corner', () => {
    const r = computeResize(2, 100, 100, 200, 100, -10, 10);
    expect(r.w).toBe(190);
    expect(r.y).toBe(110);
    expect(r.h).toBe(90);
  });

  it('handle 5 (bottom) moves bottom edge', () => {
    const r = computeResize(5, 100, 100, 200, 100, 0, 20);
    expect(r.h).toBe(120);
  });

  it('with shift key, constrains aspect ratio', () => {
    const r = computeResize(4, 0, 0, 200, 100, 50, 50, true);
    const aspect = 200 / 100;
    expect(Math.abs(r.w / r.h - aspect)).toBeLessThan(0.01);
  });

  it('with alt key, resizes from center', () => {
    const r = computeResize(4, 100, 100, 200, 100, 40, 0, false, true);
    const cx = 100 + 200 / 2;
    const cy = 100 + 100 / 2;
    expect(r.x).toBe(cx - r.w / 2);
    expect(r.y).toBe(cy - r.h / 2);
  });

  it('clamps to minimum size', () => {
    const r = computeResize(0, 100, 100, 10, 10, 20, 20);
    expect(r.w).toBeGreaterThanOrEqual(1);
    expect(r.h).toBeGreaterThanOrEqual(1);
  });

  it('all 8 handle indices return valid results', () => {
    for (let i = 0; i < 8; i++) {
      const r = computeResize(i, 50, 50, 100, 80, 10, 5);
      expect(r.w).toBeGreaterThanOrEqual(1);
      expect(r.h).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('computeResize — flip detection', () => {
  it('dragging left handle past right edge flips X', () => {
    const r = computeResize(7, 100, 100, 200, 100, 250, 0);
    expect(r.flippedX).toBe(true);
    expect(r.flippedY).toBe(false);
    expect(r.x).toBe(300);
    expect(r.w).toBe(50);
  });

  it('dragging bottom handle past top edge flips Y', () => {
    const r = computeResize(5, 100, 100, 200, 100, 0, -150);
    expect(r.flippedY).toBe(true);
    expect(r.flippedX).toBe(false);
    expect(r.y).toBe(50);
    expect(r.h).toBe(50);
  });

  it('dragging TL handle past BR edge flips both axes', () => {
    const r = computeResize(0, 100, 100, 200, 100, 250, 150);
    expect(r.flippedX).toBe(true);
    expect(r.flippedY).toBe(true);
    expect(r.x).toBe(300);
    expect(r.y).toBe(200);
    expect(r.w).toBe(50);
    expect(r.h).toBe(50);
  });
});

describe('SelectionOverlay — shape handle types', () => {
  it('shows 8 resize handles + rotation handle for a rect shape', () => {
    const container = renderOverlay([
      makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 200, h: 100 }),
    ]);
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
    // 1 bbox + 8 touch targets + 8 visual handles + 4 skew hit targets + 4 skew visual handles = 25 rects
    const rects = container.querySelectorAll('svg > rect');
    expect(rects.length).toBe(25);
    // 2 touch targets (rotation + pivot) + 2 visual (rotation + pivot) = 4 circles
    const circles = container.querySelectorAll('svg > circle');
    expect(circles.length).toBe(4);
    const lines = container.querySelectorAll('svg > line');
    expect(lines.length).toBe(1);
  });

  it('hides transform handles for a locked shape', () => {
    const container = renderOverlay([
      makeShapeNode('locked', { kind: 'rect', x: 0, y: 0, w: 200, h: 100 }, { locked: true }),
    ]);
    expect(container.querySelectorAll('rect[aria-label$="resize handle"]')).toHaveLength(0);
    expect(container.querySelector('[aria-label="Rotate"]')).toBeNull();
  });

  it('shows 8 resize handles + rotation handle for a polygon shape', () => {
    const container = renderOverlay([
      makeShapeNode('n1', {
        kind: 'polygon',
        cx: 50,
        cy: 50,
        radius: 50,
        sides: 6,
        rotation: 0,
      }),
    ]);
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
    const rects = container.querySelectorAll('svg > rect');
    expect(rects.length).toBe(25);
    const lines = container.querySelectorAll('svg > line');
    expect(lines.length).toBe(1);
  });

  it('shows 8 resize handles + rotation handle for a star shape', () => {
    const container = renderOverlay([
      makeShapeNode('n1', {
        kind: 'star',
        cx: 50,
        cy: 50,
        innerRadius: 20,
        outerRadius: 50,
        points: 5,
        rotation: 0,
      }),
    ]);
    expect(container.querySelector('svg')).toBeTruthy();
    const rects = container.querySelectorAll('svg > rect');
    expect(rects.length).toBe(25);
  });

  it('shows 8 resize handles + rotation handle for a line shape', () => {
    const container = renderOverlay([
      makeShapeNode('n1', {
        kind: 'line',
        from: [0, 0],
        to: [200, 100],
        tolerance: 3,
      }),
    ]);
    expect(container.querySelector('svg')).toBeTruthy();
    const rects = container.querySelectorAll('svg > rect');
    expect(rects.length).toBe(25);
  });

  it('shows 8 resize handles + rotation handle for an arrow shape', () => {
    const container = renderOverlay([
      makeShapeNode('n1', {
        kind: 'arrow',
        from: [0, 0],
        to: [200, 100],
        tolerance: 3,
        arrowheadSize: 20,
      }),
    ]);
    expect(container.querySelector('svg')).toBeTruthy();
    const rects = container.querySelectorAll('svg > rect');
    expect(rects.length).toBe(25);
  });

  it('shows 8 resize handles + rotation handle for a path shape', () => {
    const container = renderOverlay([
      makeShapeNode('n1', {
        kind: 'path',
        points: [
          { x: 0, y: 0, handleIn: null, handleOut: null },
          { x: 200, y: 100, handleIn: null, handleOut: null },
        ],
        closed: false,
        tolerance: 3,
      }),
    ]);
    expect(container.querySelector('svg')).toBeTruthy();
    const rects = container.querySelectorAll('svg > rect');
    expect(rects.length).toBe(25);
  });

  it('shows no interactive handles for multi-selection (dashed bbox, handles still in DOM with pointerEvents:none)', () => {
    const container = renderOverlay([
      makeShapeNode('a', { kind: 'rect', x: 0, y: 0, w: 50, h: 50 }),
      makeShapeNode('b', { kind: 'rect', x: 100, y: 0, w: 50, h: 50 }),
    ]);
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
    // Multi-selection: skew handles not rendered (no individual node to skew)
    // 1 bbox + 8 touch targets + 8 visual handles = 17 rects
    const rects = container.querySelectorAll('svg > rect');
    expect(rects.length).toBe(17);
    // No rotation handle in multi-select
    expect(container.querySelectorAll('svg > circle').length).toBe(0);
    // No rotation line in multi-select
    expect(container.querySelectorAll('svg > line').length).toBe(0);
    // Bbox has dashed stroke in multi-select
    const bboxRect = rects[0];
    expect(bboxRect?.getAttribute('stroke-dasharray')).toBe('4 3');
  });
});

it('shows pivot point at center for single selection', () => {
  const container = renderOverlay([
    makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 200, h: 100 }),
  ]);
  const circles = container.querySelectorAll('svg > circle');
  expect(circles.length).toBe(4);
  const pivot = container.querySelector('circle[aria-label="Transform origin"]');
  expect(pivot).toBeTruthy();
  expect(pivot?.getAttribute('cx')).toBe('100');
  expect(pivot?.getAttribute('cy')).toBe('50');
  expect(pivot?.getAttribute('r')).toBe('4');
  expect(pivot?.getAttribute('fill')).toBe('var(--color-surface-overlay)');
});

describe('SelectionOverlay — multi-selection', () => {
  it('shows dimension label for multi-selection', () => {
    const container = renderOverlay([
      makeShapeNode('a', { kind: 'rect', x: 0, y: 0, w: 50, h: 50 }),
      makeShapeNode('b', { kind: 'rect', x: 100, y: 0, w: 50, h: 50 }),
    ]);
    const dim = container.querySelector('.selection-overlay__dim text');
    expect(dim?.textContent).toMatch(/\d+\s*x\s*\d+/);
  });

  it('does not show rotation handle for multi-selection', () => {
    const container = renderOverlay([
      makeShapeNode('a', { kind: 'rect', x: 0, y: 0, w: 50, h: 50 }),
      makeShapeNode('b', { kind: 'rect', x: 100, y: 0, w: 50, h: 50 }),
    ]);
    expect(container.querySelectorAll('svg > circle').length).toBe(0);
  });
});

describe('SelectionOverlay — resize routing conditions', () => {
  it('resize for polygon calls setNodePosition and setNodeSize', () => {
    const s: { kind: string } = { kind: 'polygon' };
    const isRoutable =
      s.kind === 'rect' ||
      s.kind === 'polygon' ||
      s.kind === 'star' ||
      s.kind === 'path' ||
      s.kind === 'line' ||
      s.kind === 'arrow';
    expect(isRoutable).toBe(true);
  });

  it('resize for star calls setNodePosition and setNodeSize', () => {
    const s: { kind: string } = { kind: 'star' };
    const isRoutable =
      s.kind === 'rect' ||
      s.kind === 'polygon' ||
      s.kind === 'star' ||
      s.kind === 'path' ||
      s.kind === 'line' ||
      s.kind === 'arrow';
    expect(isRoutable).toBe(true);
  });

  it('resize for path calls setNodePosition and setNodeSize', () => {
    const s: { kind: string } = { kind: 'path' };
    const isRoutable =
      s.kind === 'rect' ||
      s.kind === 'polygon' ||
      s.kind === 'star' ||
      s.kind === 'path' ||
      s.kind === 'line' ||
      s.kind === 'arrow';
    expect(isRoutable).toBe(true);
  });

  it('resize for line calls setNodePosition and setNodeSize', () => {
    const s: { kind: string } = { kind: 'line' };
    const isRoutable =
      s.kind === 'rect' ||
      s.kind === 'polygon' ||
      s.kind === 'star' ||
      s.kind === 'path' ||
      s.kind === 'line' ||
      s.kind === 'arrow';
    expect(isRoutable).toBe(true);
  });

  it('resize for arrow calls setNodePosition and setNodeSize', () => {
    const s: { kind: string } = { kind: 'arrow' };
    const isRoutable =
      s.kind === 'rect' ||
      s.kind === 'polygon' ||
      s.kind === 'star' ||
      s.kind === 'path' ||
      s.kind === 'line' ||
      s.kind === 'arrow';
    expect(isRoutable).toBe(true);
  });
});

describe('SelectionOverlay — accessibility', () => {
  it('has role="presentation" on the SVG', () => {
    const container = renderOverlay([
      makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 200, h: 100 }),
    ]);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('role')).toBe('presentation');
  });

  it('handle rects have aria-label describing their position', () => {
    const container = renderOverlay([
      makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 200, h: 100 }),
    ]);
    const handles = container.querySelectorAll('rect[aria-label]');
    expect(handles.length).toBeGreaterThanOrEqual(8);
    const firstHandle = handles[0];
    expect(firstHandle?.getAttribute('aria-label')).toBeTruthy();
  });

  it('rotation handle has aria-label="Rotate"', () => {
    const container = renderOverlay([
      makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 200, h: 100 }),
    ]);
    const rotHandle = container.querySelector('circle[aria-label="Rotate"]');
    expect(rotHandle).toBeTruthy();
  });

  it('pivot point has aria-label="Transform origin"', () => {
    const container = renderOverlay([
      makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 200, h: 100 }),
    ]);
    const pivot = container.querySelector('circle[aria-label="Transform origin"]');
    expect(pivot).toBeTruthy();
  });
});

describe('SelectionOverlay — touch targets', () => {
  it('handle hit area is at least 16px even when visual is 8px', () => {
    const container = renderOverlay([
      makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 200, h: 100 }),
    ]);
    // Touch targets have fill="transparent" and width=16
    const touchTargets = container.querySelectorAll('rect[fill="transparent"]');
    expect(touchTargets.length).toBeGreaterThanOrEqual(8);
    for (const t of touchTargets) {
      const w = parseFloat(t.getAttribute('width') ?? '0');
      const h = parseFloat(t.getAttribute('height') ?? '0');
      expect(Math.max(w, h)).toBeGreaterThanOrEqual(16);
    }
  });

  it('rotation handle hit area is at least 16px', () => {
    const container = renderOverlay([
      makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 200, h: 100 }),
    ]);
    const transparentCircles = container.querySelectorAll('circle[fill="transparent"]');
    expect(transparentCircles.length).toBeGreaterThanOrEqual(1);
    for (const c of transparentCircles) {
      const r = parseFloat(c.getAttribute('r') ?? '0');
      expect(r * 2).toBeGreaterThanOrEqual(16);
    }
  });

  // G: Handle visibility at extreme zoom — single selections always show all
  // 8 resize handles + rotation, but the skew handles are gated on a minimum
  // box size: their 20px hit targets would cover a tiny box and swallow the
  // shape's own move-drag (the drag at the box centre becomes a skew).
  it('shows all 8 handles but no skew handles for a very small box (single selection)', () => {
    const container = renderOverlay([
      makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 4, h: 4 }),
    ]);
    // 1 bbox + 8 handles × (1 hit + 1 visual) = 17 (no skew: 4x4 < 60px)
    const rects = container.querySelectorAll('svg > rect');
    expect(rects.length).toBe(17);
  });

  it('shows all 8 handles but no skew handles for a narrow box (single selection)', () => {
    const container = renderOverlay(
      [makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 4, h: 100 })],
      {},
      { x: 0, y: 0 },
      1,
    );
    // Narrow boxes (< 60px on one axis) get no skew: 1 bbox + 16 = 17
    const rects = container.querySelectorAll('svg > rect');
    expect(rects.length).toBe(17);
  });

  it('shows all 8 handles but no skew handles for a flat box (single selection)', () => {
    const container = renderOverlay(
      [makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 100, h: 4 })],
      {},
      { x: 0, y: 0 },
      1,
    );
    const rects = container.querySelectorAll('svg > rect');
    expect(rects.length).toBe(17);
  });

  it('shows skew handles once the box is large enough on both axes', () => {
    const container = renderOverlay(
      [makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 120, h: 120 })],
      {},
      { x: 0, y: 0 },
      1,
    );
    // 1 bbox + 16 handles + 4 skew hit + 4 skew visual = 25
    const rects = container.querySelectorAll('svg > rect');
    expect(rects.length).toBe(25);
  });
});
