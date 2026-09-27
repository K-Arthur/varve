/**
 * The world-space reach pre-check and the single-affine rectangle projector
 * must not change which name labels are placed, or where.
 */
import type { Camera, Point, Rect } from '@varve/shared';
import { computeFloatingOrigin, worldToScreen } from '@varve/shared';
import { describe, expect, it } from 'vitest';
import {
  screenRectToWorldRect,
  worldRectToScreenAabb,
  worldRectToScreenAabbProjector,
} from '../../scene/world';
import {
  type NameLabelCandidate,
  nameLabelReach,
  pickNameLabelCandidates,
} from '../nameLabelPolicy';

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** The corner projection used before the single-affine projector. */
function previousAabb(rect: Rect, camera: Camera, viewport: { width: number; height: number }) {
  const origin = computeFloatingOrigin(camera, viewport);
  const corners: Point[] = [
    [rect.x, rect.y],
    [rect.x + rect.w, rect.y],
    [rect.x, rect.y + rect.h],
    [rect.x + rect.w, rect.y + rect.h],
  ];
  const projected = corners.map(([x, y]) => worldToScreen(camera, x, y, viewport, origin));
  const xs = projected.map(([x]) => x);
  const ys = projected.map(([, y]) => y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

const viewport = { width: 1280, height: 720 };

describe('worldRectToScreenAabbProjector', () => {
  it('matches the per-rectangle corner projection bit for bit, rotated or not', () => {
    const random = rng(7);
    for (let i = 0; i < 500; i++) {
      const camera: Camera = {
        zoom: 10 ** (random() * 5 - 3),
        pan: { x: (random() - 0.5) * 1e6, y: (random() - 0.5) * 1e6 },
        rotation: i % 3 === 0 ? (random() - 0.5) * 6 : 0,
      };
      const rect = {
        x: (random() - 0.5) * 1e7,
        y: (random() - 0.5) * 1e7,
        w: random() * 1e4,
        h: random() * 1e4,
      };
      const expected = previousAabb(rect, camera, viewport);
      expect(worldRectToScreenAabbProjector(camera, viewport)(rect)).toEqual(expected);
      expect(worldRectToScreenAabb(rect, camera, viewport)).toEqual(expected);
    }
  });
});

describe('screenRectToWorldRect', () => {
  it('is null for a rotated camera', () => {
    expect(
      screenRectToWorldRect(
        { x: 0, y: 0, w: 10, h: 10 },
        { zoom: 1, pan: { x: 0, y: 0 }, rotation: 0.3 },
        viewport,
      ),
    ).toBeNull();
  });

  it('maps back onto the screen rectangle for an unrotated camera', () => {
    const camera: Camera = { zoom: 0.004, pan: { x: 523.25, y: -91.5 }, rotation: 0 };
    const screen = { x: -305, y: -25, w: 1610, h: 792 };
    const world = screenRectToWorldRect(screen, camera, viewport);
    if (!world) throw new Error('expected a world rect');
    const back = worldRectToScreenAabb(world, camera, viewport);
    expect(back.x).toBeCloseTo(screen.x, 6);
    expect(back.y).toBeCloseTo(screen.y, 6);
    expect(back.w).toBeCloseTo(screen.w, 6);
    expect(back.h).toBeCloseTo(screen.h, 6);
  });
});

describe('pickNameLabelCandidates reach pre-check', () => {
  function candidates(random: () => number, count: number, spread: number): NameLabelCandidate[] {
    const kinds = ['frame', 'shape', 'text', 'group'];
    return Array.from({ length: count }, (_, i) => ({
      id: `n${i}`,
      nodeId: `n${i}`,
      name: i % 17 === 0 ? '' : `Layer ${i} ${'x'.repeat(Math.floor(random() * 90))}`,
      kind: kinds[Math.floor(random() * kinds.length)]!,
      x: (random() - 0.5) * spread,
      y: (random() - 0.5) * spread,
      w: random() * spread * 0.02,
      h: random() * spread * 0.02,
      depth: random() < 0.8 ? 0 : 1,
      parentId: null,
      selected: i === 5,
      hovered: i === 9,
      paintOrder: i,
    }));
  }

  it('places exactly the same labels as projecting every candidate', () => {
    const random = rng(42);
    for (let trial = 0; trial < 60; trial++) {
      const spread = 10 ** (2 + random() * 5);
      const list = candidates(random, 400, spread);
      const camera: Camera = {
        zoom: 10 ** (random() * 4 - 3),
        pan: { x: (random() - 0.5) * 2000, y: (random() - 0.5) * 2000 },
        rotation: 0,
      };
      const project = worldRectToScreenAabbProjector(camera, viewport);
      const opts = {
        zoom: camera.zoom,
        viewportW: viewport.width,
        viewportH: viewport.height,
        project: (c: NameLabelCandidate) => {
          const s = project({ x: c.x, y: c.y, w: c.w, h: c.h });
          return { screenX: s.x, screenY: s.y, screenW: s.w, screenH: s.h };
        },
      };
      const reach = screenRectToWorldRect(
        nameLabelReach(viewport.width, viewport.height),
        camera,
        viewport,
      );
      if (!reach) throw new Error('unrotated camera must give a reach');
      const withReach = pickNameLabelCandidates(list, {
        ...opts,
        mayBeVisible: (c) =>
          c.x <= reach.x + reach.w &&
          c.x + c.w >= reach.x &&
          c.y <= reach.y + reach.h &&
          c.y + c.h >= reach.y,
      });
      expect(withReach).toEqual(pickNameLabelCandidates(list, opts));
    }
  });
});
