import { describe, expect, it } from 'vitest';
import { applyAffine, identity, multiplyAffine, type Point, rotateDeg, translate } from './affine';
import {
  boxDeltaMatrix,
  computeSelectionBox,
  handlePositions,
  resizeSelectionBox,
  rotateSelectionBox,
  type SelectionBox,
  selectionBoxCorners,
  selectionBoxMatrix,
} from './selectionBox';

const EPS = 1e-9;

function approx(a: number, b: number, tol = EPS): void {
  expect(Math.abs(a - b)).toBeLessThanOrEqual(tol);
}

function cornersEqual(actual: readonly Point[], expected: readonly Point[], tol = EPS): void {
  expect(actual).toHaveLength(expected.length);
  for (let i = 0; i < actual.length; i++) {
    const a = actual[i]!;
    const e = expected[i]!;
    approx(a[0], e[0], tol);
    approx(a[1], e[1], tol);
  }
}

describe('computeSelectionBox', () => {
  it('returns null for an empty candidate list', () => {
    expect(computeSelectionBox([])).toBeNull();
  });

  it('builds the OBB of a single rotated rect', () => {
    // 10x5 rect centered at origin, rotated 90° and translated to (100, 100).
    const world = multiplyAffine(translate(100, 100), rotateDeg(90));
    const box = computeSelectionBox([
      { localRect: { x: -5, y: -2.5, w: 10, h: 5 }, worldTransform: world },
    ]);
    expect(box).not.toBeNull();
    if (!box) return;
    approx(box.cx, 100);
    approx(box.cy, 100);
    approx(box.w, 10);
    approx(box.h, 5);
    approx(box.rotation, Math.PI / 2);
  });

  it('builds an axis-aligned union for multiple candidates', () => {
    const a = { localRect: { x: 0, y: 0, w: 10, h: 10 }, worldTransform: translate(0, 0) as any };
    const b = { localRect: { x: 0, y: 0, w: 10, h: 10 }, worldTransform: translate(30, 20) as any };
    const box = computeSelectionBox([a, b]);
    expect(box).not.toBeNull();
    if (!box) return;
    approx(box.cx, 20);
    approx(box.cy, 15);
    approx(box.w, 40);
    approx(box.h, 30);
    approx(box.rotation, 0);
  });

  it('ignores candidates with zero-area local rect', () => {
    const a = { localRect: { x: 0, y: 0, w: 0, h: 10 }, worldTransform: identity };
    const b = { localRect: { x: 0, y: 0, w: 10, h: 10 }, worldTransform: identity };
    expect(computeSelectionBox([a, b])).toEqual(computeSelectionBox([b]));
  });
});

describe('selectionBoxMatrix and corners', () => {
  it('maps the unit square to the correct corners', () => {
    const box: SelectionBox = { cx: 100, cy: 100, w: 10, h: 20, rotation: 0 };
    const corners = selectionBoxCorners(box);
    cornersEqual(corners, [
      [95, 90],
      [105, 90],
      [105, 110],
      [95, 110],
    ]);
  });

  it('produces a round-tripping matrix', () => {
    const box: SelectionBox = { cx: 12, cy: 7, w: 8, h: 4, rotation: Math.PI / 3 };
    const m = selectionBoxMatrix(box);
    const corners = selectionBoxCorners(box);
    const units: readonly Point[] = [
      [-0.5, -0.5],
      [0.5, -0.5],
      [0.5, 0.5],
      [-0.5, 0.5],
    ];
    for (let i = 0; i < corners.length; i++) {
      expect(applyAffine(m, units[i]!)).toEqual(corners[i]);
    }
  });
});

describe('boxDeltaMatrix', () => {
  it('is identity when the old and new boxes are identical', () => {
    const box: SelectionBox = { cx: 50, cy: 50, w: 10, h: 10, rotation: 0 };
    expect(boxDeltaMatrix(box, box)).toEqual(identity);
  });

  it('maps every old box corner to the matching new box corner', () => {
    const oldBox: SelectionBox = { cx: 0, cy: 0, w: 10, h: 10, rotation: 0 };
    const newBox: SelectionBox = { cx: 20, cy: 10, w: 20, h: 20, rotation: Math.PI / 4 };
    const delta = boxDeltaMatrix(oldBox, newBox);
    const oldCorners = selectionBoxCorners(oldBox);
    const newCorners = selectionBoxCorners(newBox);
    for (let i = 0; i < oldCorners.length; i++) {
      const old = oldCorners[i]!;
      const mapped = applyAffine(delta, old);
      const n = newCorners[i]!;
      approx(mapped[0], n[0]);
      approx(mapped[1], n[1]);
    }
  });

  it('returns identity when the old box is degenerate', () => {
    const oldBox: SelectionBox = { cx: 0, cy: 0, w: 0, h: 10, rotation: 0 };
    const newBox: SelectionBox = { cx: 5, cy: 5, w: 10, h: 10, rotation: 0 };
    expect(boxDeltaMatrix(oldBox, newBox)).toEqual(identity);
  });
});

describe('resizeSelectionBox', () => {
  it('scales the south-east handle from the opposite corner', () => {
    const box: SelectionBox = { cx: 0, cy: 0, w: 10, h: 10, rotation: 0 };
    const next = resizeSelectionBox(box, 'se', [10, 20]);
    approx(next.w, 20);
    approx(next.h, 30);
    approx(next.cx, 5);
    approx(next.cy, 10);
  });

  it('scales the north-west handle', () => {
    const box: SelectionBox = { cx: 0, cy: 0, w: 10, h: 10, rotation: 0 };
    const next = resizeSelectionBox(box, 'nw', [-10, -20]);
    approx(next.w, 20);
    approx(next.h, 30);
    approx(next.cx, -5);
    approx(next.cy, -10);
  });

  it('scales from the center when centered is true', () => {
    const box: SelectionBox = { cx: 0, cy: 0, w: 10, h: 10, rotation: 0 };
    const next = resizeSelectionBox(box, 'se', [5, 5], { centered: true });
    approx(next.w, 20);
    approx(next.h, 20);
    approx(next.cx, 0);
    approx(next.cy, 0);
  });

  it('maintains aspect ratio for corners with proportional', () => {
    const box: SelectionBox = { cx: 0, cy: 0, w: 20, h: 10, rotation: 0 };
    const next = resizeSelectionBox(box, 'se', [10, 5], { proportional: true });
    approx(next.w, 30);
    approx(next.h, 15);
    approx(next.cx, 5);
    approx(next.cy, 2.5);
  });

  it('maintains aspect ratio for east edge with proportional', () => {
    const box: SelectionBox = { cx: 0, cy: 0, w: 20, h: 10, rotation: 0 };
    const next = resizeSelectionBox(box, 'e', [10, 0], { proportional: true });
    approx(next.w, 30);
    approx(next.h, 15);
    approx(next.cx, 5);
    approx(next.cy, 0);
  });

  it('flips width when east handle dragged past left edge', () => {
    const box: SelectionBox = { cx: 0, cy: 0, w: 10, h: 10, rotation: 0 };
    const next = resizeSelectionBox(box, 'e', [-100, 0], { minSize: 2 });
    // East handle crosses center: new right edge = old right + dx = 5 + (-100) = -95
    // Left edge stays at -5. Center becomes (-5 + -95)/2 = -50. Width = 90
    approx(next.w, 90, 1);
    approx(next.cx, -50, 1);
    approx(next.h, 10);
  });

  it('flips height when south handle dragged past top edge', () => {
    const box: SelectionBox = { cx: 0, cy: 0, w: 10, h: 10, rotation: 0 };
    const next = resizeSelectionBox(box, 's', [0, -100]);
    approx(next.h, 90, 1);
    approx(next.cy, -50, 1);
    approx(next.w, 10);
  });

  it('flips X with proportional edge handle', () => {
    const box: SelectionBox = { cx: 0, cy: 0, w: 20, h: 10, rotation: 0 };
    const next = resizeSelectionBox(box, 'e', [-100, 0], { proportional: true });
    // rawW = 20 + (-100) = -80, flip to 80, newH = 10 * 80/20 = 40
    // newCx = 0 + (1 * (-80 - 20)) / 2 = -50
    approx(next.w, 80, 1);
    approx(next.h, 40, 1);
    approx(next.cx, -50, 1);
  });

  it('flips Y with north handle', () => {
    const box: SelectionBox = { cx: 0, cy: 0, w: 10, h: 10, rotation: 0 };
    const next = resizeSelectionBox(box, 'n', [0, 100]);
    // Drag north handle down past center: ny = 0+50+100...
    // n: sx=0,sy=-1. newH = 10 + 1*(-1)*100 = -90. rawH=-90, flip to 90.
    // newH = 90, newCy = 0 + (-1 * (-90 - 10)) / 2 = 0 + 100/2 = 50
    approx(next.h, 90, 1);
    approx(next.cy, 50, 1);
    approx(next.w, 10);
  });
});

describe('resizeSelectionBox — image aspect ratio', () => {
  const box16x9: SelectionBox = { cx: 0, cy: 0, w: 1920, h: 1080, rotation: 0 };

  it('preserves 16:9 aspect ratio on SE corner with proportional', () => {
    const next = resizeSelectionBox(box16x9, 'se', [-400, 0], { proportional: true });
    // Width reduced, height must follow to keep 16:9
    const ratio = next.w / next.h;
    approx(ratio, 1920 / 1080, 1e-6);
  });

  it('preserves 16:9 aspect ratio on NW corner with proportional', () => {
    const next = resizeSelectionBox(box16x9, 'nw', [400, 0], { proportional: true });
    const ratio = next.w / next.h;
    approx(ratio, 1920 / 1080, 1e-6);
  });

  it('preserves aspect ratio on east edge with proportional', () => {
    const next = resizeSelectionBox(box16x9, 'e', [-900, 0], { proportional: true });
    const ratio = next.w / next.h;
    approx(ratio, 1920 / 1080, 1e-6);
  });

  it('preserves aspect ratio on south edge with proportional', () => {
    const next = resizeSelectionBox(box16x9, 's', [0, -400], { proportional: true });
    const ratio = next.w / next.h;
    approx(ratio, 1920 / 1080, 1e-6);
  });

  it('free resize distorts aspect ratio without proportional', () => {
    const next = resizeSelectionBox(box16x9, 'se', [-900, 0]);
    // Width changed, height unchanged → ratio differs from 16:9
    expect(next.w / next.h).not.toBeCloseTo(1920 / 1080, 6);
  });

  it('proportional from center preserves ratio', () => {
    const next = resizeSelectionBox(box16x9, 'se', [200, 0], {
      proportional: true,
      centered: true,
    });
    const ratio = next.w / next.h;
    approx(ratio, 1920 / 1080, 1e-6);
  });
});

describe('resizeSelectionBox — centered + combined modifiers', () => {
  it('centered + proportional on edge handle correctly scales opposite axis', () => {
    const box: SelectionBox = { cx: 0, cy: 0, w: 20, h: 10, rotation: 0 };
    const next = resizeSelectionBox(box, 'e', [5, 0], { centered: true, proportional: true });
    approx(next.w, 30);
    approx(next.h, 15);
    approx(next.cx, 0);
    approx(next.cy, 0);
  });

  it('centered + free resize does not shift center when only one axis changes', () => {
    const box: SelectionBox = { cx: 0, cy: 0, w: 20, h: 10, rotation: 0 };
    const next = resizeSelectionBox(box, 'e', [5, 0], { centered: true });
    approx(next.w, 30);
    approx(next.h, 10);
    approx(next.cx, 0);
    approx(next.cy, 0);
  });

  it('centered + free resize on south handle does not shift center', () => {
    const box: SelectionBox = { cx: 0, cy: 0, w: 20, h: 10, rotation: 0 };
    const next = resizeSelectionBox(box, 's', [0, 5], { centered: true });
    approx(next.w, 20);
    approx(next.h, 20);
    approx(next.cx, 0);
    approx(next.cy, 0);
  });

  it('centered + proportional on corner handle preserves ratio and center', () => {
    const box: SelectionBox = { cx: 100, cy: 50, w: 20, h: 10, rotation: 0 };
    const next = resizeSelectionBox(box, 'se', [10, 5], {
      centered: true,
      proportional: true,
    });
    approx(next.w, 40);
    approx(next.h, 20);
    approx(next.cx, 100);
    approx(next.cy, 50);
  });
});

describe('rotateSelectionBox', () => {
  it('rotates around the box center by default', () => {
    const box: SelectionBox = { cx: 10, cy: 10, w: 10, h: 10, rotation: 0 };
    const next = rotateSelectionBox(box, Math.PI / 2);
    approx(next.cx, 10);
    approx(next.cy, 10);
    approx(next.rotation, Math.PI / 2);
  });

  it('rotates around a custom pivot', () => {
    const box: SelectionBox = { cx: 10, cy: 10, w: 10, h: 10, rotation: 0 };
    const pivot: [number, number] = [0, 0];
    const next = rotateSelectionBox(box, Math.PI / 2, pivot);
    // Center (10,10) rotated 90° about origin lands at (-10, 10).
    approx(next.cx, -10);
    approx(next.cy, 10);
    approx(next.rotation, Math.PI / 2);
  });
});

describe('handlePositions', () => {
  it('places the rotation handle above the top edge', () => {
    const box: SelectionBox = { cx: 0, cy: 0, w: 10, h: 10, rotation: 0 };
    const handles = handlePositions(box);
    expect(handles.rotation).toEqual([0, -5]);
  });
});
