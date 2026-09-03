// Compound region model for boolean geometry operations.
//
// A Region2D represents one or more closed 2D contours with winding-based
// hole classification.  Every contour is a simple (non-self-intersecting)
// polygon of Point2D vertices.  The fill rule determines which regions are
// "inside" the compound shape.

export type FillRule = 'nonzero' | 'evenodd';

export interface Point2D {
  x: number;
  y: number;
}

/** Signed area of a simple polygon (positive = CCW). */
export function signedArea(pts: Point2D[]): number {
  let area = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % n]!;
    area += a.x * b.y - b.x * a.y;
  }
  return area / 2;
}

/** Winding number of point p with respect to polygon `pts`. */
export function windingNumber(p: Point2D, pts: Point2D[]): number {
  let wn = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % n]!;
    if (a.y <= p.y) {
      if (b.y > p.y && cross(a, b, p) > 0) wn++;
    } else {
      if (b.y <= p.y && cross(a, b, p) < 0) wn--;
    }
  }
  return wn;
}

/** 2D cross product of vectors (a→b) × (a→c). */
export function cross(a: Point2D, b: Point2D, c: Point2D): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

/** Point-in-polygon test using the specified fill rule. */
export function pointInRegion(p: Point2D, pts: Point2D[], fillRule: FillRule): boolean {
  if (fillRule === 'evenodd') {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const pi = pts[i]!;
      const pi1 = pts[j]!;
      if (
        pi.y > p.y !== pi1.y > p.y &&
        p.x < ((pi1.x - pi.x) * (p.y - pi.y)) / (pi1.y - pi.y) + pi.x
      ) {
        inside = !inside;
      }
    }
    return inside;
  }
  return windingNumber(p, pts) !== 0;
}

/**
 * Determine if `child` is inside `parent` by testing a single representative
 * point of `child`.  For nonzero fill rules the winding number must be
 * nonzero; for evenodd the ray-crossing parity suffices.
 */
export function isContourInside(child: Point2D[], parent: Point2D[], fillRule: FillRule): boolean {
  if (child.length < 1 || parent.length < 3) return false;
  const p = child[0]!;
  return pointInRegion(p, parent, fillRule);
}

/**
 * Build a Region2D by classifying contours into outer contours and holes.
 *
 * `outerContours` are already known to be exterior.  `innerContours` are
 * candidates that must be classified as holes (inside exactly one outer)
 * or additional outer contours (not inside any outer).
 *
 * For nonzero fill rules a hole must have opposite winding to its parent.
 * For evenodd fill rules any contour inside another is a hole regardless
 * of winding.
 */
export function buildRegion(contours: Point2D[][], fillRule: FillRule = 'evenodd'): Region2D {
  if (contours.length === 0) return { contours: [], holes: [], fillRule };

  // Ensure all contours are CCW (positive area = outer)
  const normalized = contours.map((c) => {
    const a = signedArea(c);
    return a < 0 ? [...c].reverse() : c;
  });

  // Sort by absolute area descending so larger contours are processed first
  const sorted = [...normalized].sort((a, b) => Math.abs(signedArea(b)) - Math.abs(signedArea(a)));

  const outers: Point2D[][] = [];
  const holes: Point2D[][] = [];

  for (const contour of sorted) {
    let placed = false;
    for (let i = 0; i < outers.length; i++) {
      const outer = outers[i]!;
      if (isContourInside(contour, outer, fillRule)) {
        // Check if it's a hole (opposite winding for nonzero) or nested
        const outerArea = signedArea(outer);
        const contourArea = signedArea(contour);
        if (fillRule === 'nonzero') {
          // For nonzero, hole must have opposite winding
          if (outerArea * contourArea < 0) {
            holes.push(contour);
            placed = true;
            break;
          }
        } else {
          // For evenodd, any inner contour is a hole
          holes.push(contour);
          placed = true;
          break;
        }
      }
    }
    if (!placed) {
      outers.push(contour);
    }
  }

  return { contours: outers, holes, fillRule };
}

/**
 * A compound region: one or more outer contours plus holes.
 * For a simple non-overlapping shape, there is exactly one outer and zero holes.
 * For subtract results, there may be one outer + one or more holes.
 * For complex overlaps, there may be multiple disconnected outers.
 */
export interface Region2D {
  /** Outer contours (CCW winding), ordered by decreasing area. */
  contours: Point2D[][];
  /** Hole contours (CW winding).  Each hole is inside exactly one outer. */
  holes: Point2D[][];
  /** Fill rule for the compound region. */
  fillRule: FillRule;
}

/** Create a Region2D from a single contour. */
export function singleContour(pts: Point2D[], fillRule: FillRule = 'evenodd'): Region2D {
  const a = signedArea(pts);
  const ccw = a < 0 ? [...pts].reverse() : pts;
  return { contours: [ccw], holes: [], fillRule };
}

/** Create an empty region. */
export function emptyRegion(fillRule: FillRule = 'evenodd'): Region2D {
  return { contours: [], holes: [], fillRule };
}

/** Is this region empty? */
export function isEmptyRegion(r: Region2D): boolean {
  return r.contours.length === 0;
}

/** Filled area of a region (outer areas minus hole areas). */
export function regionArea(r: Region2D): number {
  let area = 0;
  // Ring orientation is a serialization detail. The public Region2D contract
  // explicitly separates outer contours from holes, so its filled area must
  // not change when a source importer supplies either winding direction.
  for (const contour of r.contours) area += Math.abs(signedArea(contour));
  for (const hole of r.holes) area -= Math.abs(signedArea(hole));
  return area;
}

/** Flatten a Region2D to a list of contours (outers then holes, each tagged). */
export function flattenRegion(r: Region2D): { pts: Point2D[]; isHole: boolean }[] {
  const result: { pts: Point2D[]; isHole: boolean }[] = [];
  for (const c of r.contours) result.push({ pts: c, isHole: false });
  for (const h of r.holes) result.push({ pts: h, isHole: true });
  return result;
}

/**
 * Convert a Region2D into the Varve Shape path format:
 * the first outer contour becomes `points`, and holes become `holes`.
 * Multiple outer contours are stored as the first outer plus the rest
 * as "virtual holes" (their winding is set to indicate they are separate islands).
 */
export function regionToPathData(r: Region2D): {
  points: Point2D[];
  holes: Point2D[][];
  fillRule: FillRule;
} {
  if (r.contours.length === 0) return { points: [], holes: [], fillRule: r.fillRule };
  const first = r.contours[0]!;
  const restHoles = r.contours.slice(1); // Additional disconnected outers
  return {
    points: first,
    holes: [...r.holes, ...restHoles],
    fillRule: r.fillRule,
  };
}

/**
 * Test point containment against a compound path (outer + holes).
 * Uses the evenodd or nonzero fill rule.
 */
export function pointInCompoundPath(
  p: Point2D,
  outer: Point2D[],
  holes: Point2D[][],
  fillRule: FillRule,
): boolean {
  let winding = 0;
  // Count winding against outer
  if (fillRule === 'evenodd') {
    let inside = pointInRegion(p, outer, 'evenodd');
    for (const h of holes) {
      if (pointInRegion(p, h, 'evenodd')) inside = !inside;
    }
    return inside;
  }
  // nonzero: accumulate winding numbers
  winding = windingNumber(p, outer);
  for (const h of holes) {
    winding += windingNumber(p, h);
  }
  return winding !== 0;
}
