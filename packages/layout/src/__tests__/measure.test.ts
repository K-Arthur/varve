import type { SceneNode } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { measureNodeSize } from '../measure';

/**
 * measureNodeSize is the single source of truth for a node's intrinsic size
 * across flex/grid/hug layout. Text nodes must honour their `w` /
 * `textResizing` mode: area (fixed-width) text wraps, so its intrinsic height
 * is the wrapped height and its width is the authored container width — not
 * the single-line width (#30 / #134).
 */
describe('measureNodeSize — text resizing modes', () => {
  it('autoWidth point text measures single-line natural width', () => {
    const node: SceneNode = {
      id: 't',
      name: 't',
      kind: 'text',
      transform: [1, 0, 0, 1, 0, 0],
      text: 'Hello World',
      fontSize: 24,
      fontFamily: 'Inter',
      textResizing: 'autoWidth',
      strokes: [],
      effects: [],
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 1 },
      index: 0,
      order: 'a0',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      rotation: 0,
    } as SceneNode;
    const sz = measureNodeSize(node);
    expect(sz.w).toBeGreaterThan(100);
    expect(sz.h).toBeCloseTo(24 * 1.4, 0);
  });

  it('autoHeight area text honours fixed width and wraps height', () => {
    const node: SceneNode = {
      id: 't',
      name: 't',
      kind: 'text',
      transform: [1, 0, 0, 1, 0, 0],
      text: 'The quick brown fox jumps over the lazy dog',
      fontSize: 24,
      fontFamily: 'Inter',
      textResizing: 'autoHeight',
      w: 200,
      strokes: [],
      effects: [],
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 1 },
      index: 0,
      order: 'a0',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      rotation: 0,
    } as SceneNode;
    const sz = measureNodeSize(node);
    expect(sz.w).toBe(200);
    // Wrapped across several lines, far taller than a single line (~33.6px).
    expect(sz.h).toBeGreaterThan(24 * 1.4 * 2);
  });

  it('fixed text uses authored width and height verbatim', () => {
    const node: SceneNode = {
      id: 't',
      name: 't',
      kind: 'text',
      transform: [1, 0, 0, 1, 0, 0],
      text: 'x',
      fontSize: 16,
      textResizing: 'fixed',
      w: 120,
      h: 40,
      strokes: [],
      effects: [],
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 1 },
      index: 0,
      order: 'a0',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      rotation: 0,
    } as SceneNode;
    const sz = measureNodeSize(node);
    expect(sz).toMatchObject({ w: 120, h: 40 });
  });
});
