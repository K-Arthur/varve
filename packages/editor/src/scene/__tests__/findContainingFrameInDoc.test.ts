import { addChild, addNode, createDocument, type Document, makeFrameNode } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { findContainingFrameInDoc } from '../findContainingFrame';

function makeDoc(): Document {
  return createDocument('test-doc');
}

function getContentRootId(doc: Document): string | null {
  const activePage = doc.pages?.find((p) => p.id === doc.activePageId);
  return activePage?.contentRoot ?? null;
}

function addFrame(
  doc: Document,
  id: string,
  x: number,
  y: number,
  w: number,
  h: number,
  overrides?: Partial<import('@varve/scene').FrameNode>,
): Document {
  const frame = makeFrameNode(id, {
    name: id,
    transform: [1, 0, 0, 1, x, y],
    w,
    h,
    ...overrides,
  });
  const contentRoot = getContentRootId(doc);
  if (contentRoot) return addChild(doc, contentRoot, frame);
  return addNode(doc, frame);
}

function addChildFrame(
  doc: Document,
  parentId: string,
  id: string,
  x: number,
  y: number,
  w: number,
  h: number,
): Document {
  const frame = makeFrameNode(id, {
    name: id,
    transform: [1, 0, 0, 1, x, y],
    w,
    h,
  });
  return addChild(doc, parentId, frame);
}

describe('findContainingFrameInDoc', () => {
  it('returns null when no user frames exist at point', () => {
    const doc = makeDoc();
    // activePageNodes returns contentRoot (r1) children; r1 itself is excluded.
    // With no user frames, walkNodes visits nothing and the function returns null.
    const result = findContainingFrameInDoc(doc, { x: 5000, y: 5000 });
    expect(result).toBeNull();
  });

  it('finds frame containing a point inside it', () => {
    let doc = makeDoc();
    doc = addFrame(doc, 'f1', 100, 100, 200, 160);
    // Point at center of f1 (200, 180)
    const result = findContainingFrameInDoc(doc, { x: 200, y: 180 });
    expect(result).toBe('f1');
  });

  it('returns null for point outside any user frame', () => {
    let doc = makeDoc();
    doc = addFrame(doc, 'f1', 100, 100, 200, 160);
    // Point (500, 500) is outside f1 (100-300 x, 100-260 y) and no other frame
    const result = findContainingFrameInDoc(doc, { x: 500, y: 500 });
    expect(result).toBeNull();
  });

  it('finds innermost frame for nested frames', () => {
    let doc = makeDoc();
    // Outer frame at (0,0) 400x300
    doc = addFrame(doc, 'outer', 0, 0, 400, 300);
    // Inner frame at (50,50) 200x150 as child of outer
    doc = addChildFrame(doc, 'outer', 'inner', 50, 50, 200, 150);
    // Point at center of inner (150, 125 in world = center of inner frame at 50+100, 50+75)
    const result = findContainingFrameInDoc(doc, { x: 150, y: 125 });
    expect(result).toBe('inner');
  });

  it('handles rotated frame containment', () => {
    let doc = makeDoc();
    // Frame at (100, 100) 200x160, rotated 45 degrees.
    const cos45 = Math.SQRT1_2;
    const sin45 = Math.SQRT1_2;
    doc = addFrame(doc, 'rot', 100, 100, 200, 160, {
      transform: [cos45, sin45, -sin45, cos45, 100, 100],
    });
    // The local center (100, 80) transformed:
    //   x = 100*cos45 - 80*sin45 + 100 ≈ 114.14
    //   y = 100*sin45 + 80*cos45 + 100 ≈ 227.28
    const resultCenter = findContainingFrameInDoc(doc, { x: 114, y: 227 });
    expect(resultCenter).toBe('rot');
  });

  it('skips locked frames', () => {
    let doc = makeDoc();
    doc = addFrame(doc, 'f1', 0, 0, 200, 160, { locked: true });
    // f1 is locked so it must be skipped. No other user frame at point.
    const result = findContainingFrameInDoc(doc, { x: 100, y: 80 });
    expect(result).toBeNull();
  });

  it('skips hidden frames', () => {
    let doc = makeDoc();
    doc = addFrame(doc, 'f1', 0, 0, 200, 160, { visible: false });
    const result = findContainingFrameInDoc(doc, { x: 100, y: 80 });
    expect(result).toBeNull();
  });

  it('returns deepest matching frame', () => {
    let doc = makeDoc();
    doc = addFrame(doc, 'f1', 0, 0, 400, 300);
    doc = addChildFrame(doc, 'f1', 'f2', 50, 50, 200, 150);
    // Point inside both frames should return innermost (f2)
    const result = findContainingFrameInDoc(doc, { x: 150, y: 125 });
    expect(result).toBe('f2');
  });
});

describe('page surfaces as drop targets', () => {
  it('adopts a drop over a page with no frame under it into that page', () => {
    // Dropping onto a page must make the page the owner, otherwise the node
    // renders on the canvas but never exports with the page it looks like it
    // belongs to.
    const doc = createDocument('page-drop');
    const page = doc.pages?.[0];
    expect(page).toBeTruthy();
    const inside = { x: 10, y: 10 };
    expect(findContainingFrameInDoc(doc, inside, null, { adoptIntoPage: true })).toBe(
      page!.contentRoot,
    );
  });

  it('returns null on bare pasteboard so the caller parents to the document root', () => {
    // The rule that keeps raw canvas placement working: no surface under the
    // point means world space, never an invented frame.
    const doc = createDocument('page-drop-2');
    const page = doc.pages?.[0];
    const outside = { x: (page?.width ?? 1000) + 5_000, y: (page?.height ?? 1000) + 5_000 };
    expect(findContainingFrameInDoc(doc, outside, null, { adoptIntoPage: true })).toBeNull();
  });

  it('leaves parenting unchanged when adoption is not requested', () => {
    // The default must stay exactly as it was: draw-to-create and every other
    // shared caller keep resolving to the document root over a bare page.
    const doc = createDocument('page-drop-default');
    expect(findContainingFrameInDoc(doc, { x: 10, y: 10 })).toBeNull();
  });

  it('prefers a frame over the page that contains it', () => {
    // Deepest surface wins; the page must not shadow a frame sitting on it.
    let doc = createDocument('page-drop-3');
    doc = addFrame(doc, 'f1', 20, 20, 100, 100);
    expect(findContainingFrameInDoc(doc, { x: 60, y: 60 }, null, { adoptIntoPage: true })).toBe(
      'f1',
    );
  });
});
