/**
 * SelectionOverlay must place its handles with the SAME camera transform the
 * renderer uses.
 *
 * Regression: the overlay went through `simpleScreenToWorld` /
 * `simpleWorldToScreen`, which drop `cameraRotation`. At rotation 0 those
 * reduce to the identical affine, so the defect was invisible until the view
 * was rotated — and then the selection box was drawn somewhere the artwork was
 * not, and handle drags mapped the pointer to the wrong world point, so
 * resize/rotate/skew stopped following the pointer.
 */

import { render } from '@testing-library/react';
import type { Document, SceneNode, ShapeNode } from '@varve/scene';
import { computeFloatingOrigin, worldToScreen } from '@varve/shared';
import { describe, expect, it, vi } from 'vitest';
import { SelectionOverlay } from './SelectionOverlay';

vi.mock('./context', () => ({ useEditor: vi.fn() }));

import { useEditor } from './context';

const VIEWPORT = { width: 1200, height: 800 };

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
  } as unknown as Document;
}

function rectNode(id: string, shape: ShapeNode['shape']): SceneNode {
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
  } as unknown as SceneNode;
}

/** A canvas ref whose client size drives the camera's rotation centre. */
function canvasRef(): React.RefObject<HTMLCanvasElement | null> {
  const el = document.createElement('canvas');
  Object.defineProperty(el, 'clientWidth', { value: VIEWPORT.width });
  Object.defineProperty(el, 'clientHeight', { value: VIEWPORT.height });
  return { current: el };
}

function renderAt(cameraRotation: number, zoom: number, pan: { x: number; y: number }) {
  const node = rectNode('r1', {
    kind: 'rect',
    x: 100,
    y: 60,
    w: 200,
    h: 120,
  } as ShapeNode['shape']);
  const mockUseEditor = useEditor as unknown as { mockReturnValue: (v: unknown) => void };
  mockUseEditor.mockReturnValue({
    state: {
      document: buildDoc({ r1: node }),
      selection: ['r1'],
      pan,
      zoom,
      cameraRotation,
    },
    selectedNodes: () => [node],
    updateDoc: vi.fn(),
    beginTransaction: vi.fn(),
    commitTransaction: vi.fn(),
  });
  const { container } = render(<SelectionOverlay canvasRef={canvasRef()} />);
  return container;
}

/** Screen position the renderer would put the selection centre at. */
function rendererCentre(cameraRotation: number, zoom: number, pan: { x: number; y: number }) {
  const cam = { pan, zoom, rotation: cameraRotation };
  const origin = computeFloatingOrigin(cam, VIEWPORT);
  // Selection box centre for the fixture rect above.
  return worldToScreen(cam, 100 + 200 / 2, 60 + 120 / 2, VIEWPORT, origin);
}

/** The selection box rect carries `rotate(deg, cx, cy)` around the box centre. */
function overlayCentre(container: Element): [number, number] {
  const rotated = container.querySelector('rect[filter="url(#selection-glow)"]');
  expect(rotated, 'overlay should render its selection box').toBeTruthy();
  const transform = rotated?.getAttribute('transform') ?? '';
  const match = /rotate\(\s*[-\d.]+\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)/.exec(transform);
  expect(match, `unparsed overlay transform: ${transform}`).toBeTruthy();
  return [Number(match?.[1]), Number(match?.[2])];
}

describe('SelectionOverlay camera agreement', () => {
  const cases: { name: string; rotation: number; zoom: number; pan: { x: number; y: number } }[] = [
    { name: 'unrotated', rotation: 0, zoom: 1, pan: { x: 0, y: 0 } },
    { name: 'unrotated, panned and zoomed', rotation: 0, zoom: 2.5, pan: { x: -140, y: 75 } },
    { name: 'rotated 15deg', rotation: Math.PI / 12, zoom: 1, pan: { x: 0, y: 0 } },
    { name: 'rotated 90deg', rotation: Math.PI / 2, zoom: 1.5, pan: { x: 40, y: -30 } },
    {
      name: 'rotated -45deg, zoomed out',
      rotation: -Math.PI / 4,
      zoom: 0.25,
      pan: { x: 12, y: 9 },
    },
  ];

  it.each(cases)('places handles where the renderer draws the artwork ($name)', (c) => {
    const container = renderAt(c.rotation, c.zoom, c.pan);
    const [ox, oy] = overlayCentre(container);
    const [rx, ry] = rendererCentre(c.rotation, c.zoom, c.pan);
    expect(ox).toBeCloseTo(rx, 6);
    expect(oy).toBeCloseTo(ry, 6);
  });

  it('moves the overlay when only the camera rotates', () => {
    // Guards against a fix that satisfies the comparison by ignoring rotation
    // on both sides.
    const zoom = 1;
    const pan = { x: 0, y: 0 };
    const [x0] = overlayCentre(renderAt(0, zoom, pan));
    const [x1] = overlayCentre(renderAt(Math.PI / 3, zoom, pan));
    expect(Math.abs(x1 - x0)).toBeGreaterThan(1);
  });
});
