import { describe, expect, it } from 'vitest';
import { makePathNode, makeShapeNode, makeTextNode } from './document';
import { nodeLocalBounds } from './nodeBounds';
import { nodeLocalBoundsSource } from './sourceBounds';
import type { SceneNode } from './types';

describe('nodeLocalBounds', () => {
  it('computes rect shape bounds', () => {
    expect(
      nodeLocalBounds(makeShapeNode('s', { kind: 'rect', x: 10, y: 20, w: 30, h: 40 })),
    ).toEqual({ x: 10, y: 20, w: 30, h: 40 });
  });

  it('computes ellipse shape bounds from center and radii', () => {
    expect(
      nodeLocalBounds(makeShapeNode('s', { kind: 'ellipse', cx: 0, cy: 0, rx: 5, ry: 7 })),
    ).toEqual({ x: -5, y: -7, w: 10, h: 14 });
  });

  it('computes line shape bounds with a minimum extent', () => {
    expect(
      nodeLocalBounds(
        makeShapeNode('s', { kind: 'line', from: [0, 0], to: [10, 0], tolerance: 0 }),
      ),
    ).toEqual({ x: 0, y: 0, w: 10, h: 4 });
  });

  it('computes path node bounds including bezier handles', () => {
    const path = makePathNode('p', {
      closed: true,
      points: [
        { x: 0, y: 0, handleIn: null, handleOut: [50, 0] },
        { x: 100, y: 20, handleIn: null, handleOut: null },
        { x: 40, y: 80, handleIn: null, handleOut: null },
      ],
    });
    // handleOut [50, 0] extends x to 50; points span y 0..80.
    expect(nodeLocalBounds(path)).toEqual({ x: 0, y: 0, w: 100, h: 80 });
  });

  it('returns null for empty path nodes', () => {
    const path = makePathNode('p', { closed: true, points: [] });
    expect(nodeLocalBounds(path)).toBeNull();
  });

  it('computes text bounds from measured width when w is absent', () => {
    const text = makeTextNode('t', 'abc', { w: undefined, h: undefined });
    const bounds = nodeLocalBounds(text);
    expect(bounds).not.toBeNull();
    expect(bounds!.w).toBeGreaterThan(0);
    expect(bounds!.h).toBeGreaterThan(0);
  });

  it('includes explicit blank and trailing lines in point-text height', () => {
    const one = makeTextNode('one', 'A', { w: undefined, h: undefined });
    const three = makeTextNode('three', 'A\n\nB', { w: undefined, h: undefined });
    expect(nodeLocalBounds(three)!.h).toBeGreaterThan(nodeLocalBounds(one)!.h);
    expect(nodeLocalBounds(three)!.h).toBeCloseTo(nodeLocalBounds(one)!.h * 3);
  });

  it('derives auto-height from wrapped content without changing its container width', () => {
    const text = makeTextNode('wrapped', 'one two three four', {
      w: 40,
      h: 12,
      textResizing: 'autoHeight',
      textMode: 'area',
    });
    const bounds = nodeLocalBounds(text)!;
    expect(bounds.w).toBe(40);
    expect(bounds.h).toBeGreaterThan(12);
  });

  it('grows point-text height past a stale explicit h', () => {
    // Imports and older documents leave a one-line `h` on auto-width nodes.
    // Honouring it as a container pinned multi-line selection to the first
    // line while the renderer painted all three.
    const text = makeTextNode('stale', 'One\nTwo\nThree', {
      h: 22,
      textResizing: 'autoWidth',
    });
    const oneLine = makeTextNode('one', 'One', { textResizing: 'autoWidth' });
    expect(nodeLocalBounds(text)!.h).toBeCloseTo(nodeLocalBounds(oneLine)!.h * 3);
  });

  it('keeps a fixed container when its content overflows', () => {
    const text = makeTextNode('fixed', 'one two three four five six seven', {
      w: 60,
      h: 24,
      textResizing: 'fixed',
      textMode: 'area',
    });
    expect(nodeLocalBounds(text)).toMatchObject({ w: 60, h: 24 });
  });

  it('measures rich-text paragraphs rather than the flat text mirror', () => {
    const text = makeTextNode('rich', 'One', {
      textResizing: 'autoWidth',
      richText: {
        paragraphs: [
          { runs: [{ text: 'One' }] },
          { runs: [{ text: 'Two' }] },
          { runs: [{ text: 'Three' }] },
        ],
      },
    });
    const oneLine = makeTextNode('plain', 'One', { textResizing: 'autoWidth' });
    expect(nodeLocalBounds(text)!.h).toBeCloseTo(nodeLocalBounds(oneLine)!.h * 3);
  });

  it('agrees with the unwarped source-bounds implementation', () => {
    // These two entry points each used to carry their own text branch.
    const text = makeTextNode('shared', 'One\nTwo', { textResizing: 'autoWidth' });
    expect(nodeLocalBoundsSource(text)).toEqual(nodeLocalBounds(text));
  });

  it('returns null for groups (bounds derive from children)', () => {
    expect(nodeLocalBounds({ kind: 'group' } as unknown as SceneNode)).toBeNull();
  });
});
