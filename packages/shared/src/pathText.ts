/**
 * Path text utilities — placing glyphs along a bezier path.
 *
 * Research basis: SVG textPath, CSS offset-path, Figma path text.
 */

export interface PathSample {
  x: number;
  y: number;
  tangent: number;
}

export interface GlyphPlacement {
  x: number;
  y: number;
  rotation: number;
  advance: number;
}

export interface GlyphPlaceOptions {
  fontSize: number;
  letterSpacing?: number;
  startOffset?: number;
  flip?: boolean;
}

export function pathLength(points: { x: number; y: number }[]): number {
  let len = 0;
  for (let i = 1; i < points.length; i++) {
    const p0 = points[i - 1];
    const p1 = points[i];
    if (!p0 || !p1) continue;
    len += Math.hypot(p1.x - p0.x, p1.y - p0.y);
  }
  return len;
}

export function samplePathAtLength(
  points: { x: number; y: number }[],
  distance: number,
): PathSample {
  if (points.length === 0) return { x: 0, y: 0, tangent: 0 };
  if (points.length === 1) return { x: points[0]?.x ?? 0, y: points[0]?.y ?? 0, tangent: 0 };

  let accumulated = 0;
  for (let i = 1; i < points.length; i++) {
    const p0 = points[i - 1]!;
    const p1 = points[i]!;
    const segLen = Math.hypot(p1.x - p0.x, p1.y - p0.y);
    if (accumulated + segLen >= distance) {
      const t = segLen > 0 ? (distance - accumulated) / segLen : 0;
      const x = p0.x + (p1.x - p0.x) * t;
      const y = p0.y + (p1.y - p0.y) * t;
      const tangent = Math.atan2(p1.y - p0.y, p1.x - p0.x);
      return { x, y, tangent };
    }
    accumulated += segLen;
  }

  const last = points[points.length - 1]!;
  const prev = points[points.length - 2]!;
  return {
    x: last.x,
    y: last.y,
    tangent: Math.atan2(last.y - prev.y, last.x - prev.x),
  };
}

export function placeGlyphsOnPath(
  points: { x: number; y: number }[],
  text: string,
  options: GlyphPlaceOptions,
): GlyphPlacement[] {
  const totalLen = pathLength(points);
  const charWidth = options.fontSize * 0.6;
  const spacing = options.letterSpacing ?? 0;
  const startOffset = options.startOffset ?? 0;
  const placements: GlyphPlacement[] = [];

  let currentDist = startOffset;
  for (let i = 0; i < text.length; i++) {
    if (currentDist > totalLen) break;
    const sample = samplePathAtLength(points, currentDist);
    placements.push({
      x: sample.x,
      y: sample.y,
      rotation: options.flip ? sample.tangent + Math.PI : sample.tangent,
      advance: charWidth + spacing,
    });
    currentDist += charWidth + spacing;
  }

  return placements;
}
