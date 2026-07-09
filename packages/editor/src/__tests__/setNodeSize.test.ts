import { describe, expect, it } from 'vitest';

type SceneNode = {
  id: string;
  kind: 'shape' | 'frame';
  name: string;
  index: number;
  order: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
  blendMode: string;
  rotation: number;
  transform: [number, number, number, number, number, number];
  fill: number[];
  strokes: unknown[];
  effects: unknown[];
  // biome-ignore lint/suspicious/noExplicitAny: test-helper type for all shape variants
  shape?: any;
  w?: number;
  h?: number;
  children?: string[];
};

function setNodeSize(node: SceneNode, w: number, h: number): SceneNode {
  if (node.kind === 'frame') return { ...node, w, h };
  if (node.kind !== 'shape') return node;
  const s = node.shape;
  if (!s) return node;
  switch (s.kind) {
    case 'rect':
      return { ...node, shape: { ...s, w, h } };
    case 'ellipse':
      return { ...node, shape: { ...s, rx: w / 2, ry: h / 2 } };
    case 'circle':
      // Circle must stay circular: use max dimension
      return { ...node, shape: { ...s, r: Math.max(w, h) / 2 } };
    case 'line': {
      const oldW = Math.abs(s.to[0] - s.from[0]) || 1;
      const oldH = Math.abs(s.to[1] - s.from[1]) || 1;
      const sx = w / oldW;
      const sy = h / oldH;
      const cx = (s.from[0] + s.to[0]) / 2;
      const cy = (s.from[1] + s.to[1]) / 2;
      return {
        ...node,
        shape: {
          ...s,
          from: [cx + (s.from[0] - cx) * sx, cy + (s.from[1] - cy) * sy],
          to: [cx + (s.to[0] - cx) * sx, cy + (s.to[1] - cy) * sy],
        },
      };
    }
    case 'arrow': {
      const oldW2 = Math.abs(s.to[0] - s.from[0]) || 1;
      const oldH2 = Math.abs(s.to[1] - s.from[1]) || 1;
      const sx2 = w / oldW2;
      const sy2 = h / oldH2;
      const cx2 = (s.from[0] + s.to[0]) / 2;
      const cy2 = (s.from[1] + s.to[1]) / 2;
      return {
        ...node,
        shape: {
          ...s,
          from: [cx2 + (s.from[0] - cx2) * sx2, cy2 + (s.from[1] - cy2) * sy2],
          to: [cx2 + (s.to[0] - cx2) * sx2, cy2 + (s.to[1] - cy2) * sy2],
        },
      };
    }
    case 'polygon': {
      const oldR = s.radius || 1;
      const newR = Math.max(1, oldR * (w / 100));
      return { ...node, shape: { ...s, radius: newR } };
    }
    case 'star': {
      const oldOR = s.outerRadius || 1;
      const ratio = Math.max(0.1, w / 100);
      return {
        ...node,
        shape: {
          ...s,
          outerRadius: Math.max(1, oldOR * ratio),
          innerRadius: Math.max(1, s.innerRadius * ratio),
        },
      };
    }
    case 'path': {
      const points = s.points;
      if (points.length === 0) return node;
      let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;
      for (const p of points) {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
      }
      const pbw = maxX - minX || 1;
      const pbh = maxY - minY || 1;
      const sx3 = w / pbw;
      const sy3 = h / pbh;
      return {
        ...node,
        shape: {
          ...s,
          points: points.map(
            (p: {
              x: number;
              y: number;
              handleIn?: [number, number];
              handleOut?: [number, number];
            }) => ({
              x: (p.x - minX) * sx3 + minX,
              y: (p.y - minY) * sy3 + minY,
              handleIn: p.handleIn
                ? [(p.handleIn[0] - minX) * sx3 + minX, (p.handleIn[1] - minY) * sy3 + minY]
                : null,
              handleOut: p.handleOut
                ? [(p.handleOut[0] - minX) * sx3 + minX, (p.handleOut[1] - minY) * sy3 + minY]
                : null,
            }),
          ),
        },
      };
    }
    default:
      return node;
  }
}

describe('setNodeSize', () => {
  it('resizes rect shape', () => {
    const node: SceneNode = {
      id: '1',
      kind: 'shape',
      name: 'Rect',
      index: 0,
      order: 'a0',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      rotation: 0,
      transform: [1, 0, 0, 1, 0, 0],
      fill: [0, 0, 0, 255],
      strokes: [],
      effects: [],
      shape: { kind: 'rect', x: 0, y: 0, w: 100, h: 80 },
    };
    const result = setNodeSize(node, 200, 160);
    expect(result).not.toBe(node);
    expect(result.shape?.w).toBe(200);
    expect(result.shape?.h).toBe(160);
  });

  it('resizes circle shape to square bounding box', () => {
    const node: SceneNode = {
      id: '1',
      kind: 'shape',
      name: 'Circle',
      index: 0,
      order: 'a0',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      rotation: 0,
      transform: [1, 0, 0, 1, 0, 0],
      fill: [0, 0, 0, 255],
      strokes: [],
      effects: [],
      shape: { kind: 'circle', cx: 50, cy: 40, r: 50 },
    };
    const result = setNodeSize(node, 200, 200);
    expect(result.shape?.r).toBe(100);
  });

  it('resizes circle to non-square uses max dimension for radius', () => {
    const node: SceneNode = {
      id: '1',
      kind: 'shape',
      name: 'Circle',
      index: 0,
      order: 'a0',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      rotation: 0,
      transform: [1, 0, 0, 1, 0, 0],
      fill: [0, 0, 0, 255],
      strokes: [],
      effects: [],
      shape: { kind: 'circle', cx: 50, cy: 40, r: 50 },
    };
    // When bounding box is non-square (200×300), use max(200,300)/2 = 150
    const result = setNodeSize(node, 200, 300);
    expect(result.shape?.r).toBe(150);
  });

  it('resizes ellipse shape', () => {
    const node: SceneNode = {
      id: '1',
      kind: 'shape',
      name: 'Ellipse',
      index: 0,
      order: 'a0',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      rotation: 0,
      transform: [1, 0, 0, 1, 0, 0],
      fill: [0, 0, 0, 255],
      strokes: [],
      effects: [],
      shape: { kind: 'ellipse', cx: 50, cy: 40, rx: 50, ry: 40 },
    };
    const result = setNodeSize(node, 200, 160);
    expect(result.shape?.rx).toBe(100);
    expect(result.shape?.ry).toBe(80);
  });

  it('resizes line shape (was silent no-op before fix)', () => {
    const node: SceneNode = {
      id: '1',
      kind: 'shape',
      name: 'Line',
      index: 0,
      order: 'a0',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      rotation: 0,
      transform: [1, 0, 0, 1, 0, 0],
      fill: [0, 0, 0, 255],
      strokes: [],
      effects: [],
      shape: { kind: 'line', from: [0, 0], to: [100, 80], tolerance: 3 },
    };
    const result = setNodeSize(node, 200, 160);
    // Bounding box grows to 200 × 160 (2× scale from center)
    const toX = result.shape?.to[0];
    const fromX = result.shape?.from[0];
    const toY = result.shape?.to[1];
    const fromY = result.shape?.from[1];
    expect(Math.abs(toX - fromX)).toBe(200);
    expect(Math.abs(toY - fromY)).toBe(160);
  });

  it('resizes polygon shape', () => {
    const node: SceneNode = {
      id: '1',
      kind: 'shape',
      name: 'Polygon',
      index: 0,
      order: 'a0',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      rotation: 0,
      transform: [1, 0, 0, 1, 0, 0],
      fill: [0, 0, 0, 255],
      strokes: [],
      effects: [],
      shape: { kind: 'polygon', cx: 50, cy: 40, radius: 50, sides: 6, rotation: 0 },
    };
    const result = setNodeSize(node, 200, 160);
    expect(result.shape?.radius).toBeGreaterThan(50);
  });

  it('resizes star shape', () => {
    const node: SceneNode = {
      id: '1',
      kind: 'shape',
      name: 'Star',
      index: 0,
      order: 'a0',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      rotation: 0,
      transform: [1, 0, 0, 1, 0, 0],
      fill: [0, 0, 0, 255],
      strokes: [],
      effects: [],
      shape: {
        kind: 'star',
        cx: 50,
        cy: 40,
        innerRadius: 20,
        outerRadius: 50,
        points: 5,
        rotation: 0,
      },
    };
    const result = setNodeSize(node, 200, 160);
    expect(result.shape?.outerRadius).toBeGreaterThan(50);
    expect(result.shape?.innerRadius).toBeGreaterThan(20);
  });

  it('resizes path shape', () => {
    const node: SceneNode = {
      id: '1',
      kind: 'shape',
      name: 'Path',
      index: 0,
      order: 'a0',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      rotation: 0,
      transform: [1, 0, 0, 1, 0, 0],
      fill: [0, 0, 0, 255],
      strokes: [],
      effects: [],
      shape: {
        kind: 'path',
        points: [
          { x: 0, y: 0, handleIn: null, handleOut: null },
          { x: 100, y: 50, handleIn: null, handleOut: null },
        ],
        closed: false,
        tolerance: 3,
      },
    };
    const result = setNodeSize(node, 200, 100);
    // Path points scale with their bounding box
    const px = result.shape?.points[1].x;
    const py = result.shape?.points[1].y;
    expect(px).toBeGreaterThan(100);
    expect(py).toBeGreaterThan(50);
  });

  it('resizes frame shape', () => {
    const node: SceneNode = {
      id: '1',
      kind: 'frame',
      name: 'Frame',
      index: 0,
      order: 'a0',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      rotation: 0,
      transform: [1, 0, 0, 1, 0, 0],
      fill: [0, 0, 0, 255],
      strokes: [],
      effects: [],
      w: 200,
      h: 160,
      children: [],
    };
    const result = setNodeSize(node, 300, 250);
    expect(result.w).toBe(300);
    expect(result.h).toBe(250);
  });
});
