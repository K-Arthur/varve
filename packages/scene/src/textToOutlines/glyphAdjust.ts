/**
 * Glyph-adjustment application for text-to-outline conversion.
 *
 * When a wordmark with per-cluster adjustments (or kerning-mode pair
 * spacing) is converted to outlines, the generated glyph shapes must keep
 * the adjusted visual placement: cluster offsets, advance overrides, pair
 * spacing, and cluster rotation/scale are applied to the absolute glyph
 * points so canvas rendering and outlined output agree.
 *
 * Points are mutated in place (they are freshly allocated by
 * textToOutlines). Width delta is returned so decoration geometry can match.
 */

import { graphemeClusters } from '../text/grapheme';
import type { GlyphAdjustment, ShapeNode } from '../types';

interface OutlineGlyphLike {
  char: string;
  points: Array<{ x: number; y: number }>;
}

export interface OutlineAdjustmentResult {
  /** Total advance added by adjustments and pair spacing (for decorations). */
  widthDelta: number;
  warnings: string[];
}

function isEmptyAdjustmentMap(map: Record<number, unknown> | undefined): boolean {
  return map === undefined || Object.keys(map).length === 0;
}

export function applyGlyphAdjustmentsToOutlines(
  rawText: string,
  glyphs: OutlineGlyphLike[],
  shapes: ShapeNode[],
  shapeIndexByGlyph: ReadonlyArray<number | null>,
  glyphAdjustments?: Record<number, GlyphAdjustment>,
  pairAdjustments?: Record<number, number>,
): OutlineAdjustmentResult {
  if (isEmptyAdjustmentMap(glyphAdjustments) && isEmptyAdjustmentMap(pairAdjustments)) {
    return { widthDelta: 0, warnings: [] };
  }
  const clusters = graphemeClusters(rawText);
  if (clusters.length === 0) {
    return { widthDelta: 0, warnings: [] };
  }

  // UTF-16 start offset of each cluster.
  const clusterStart: number[] = [];
  {
    let offset = 0;
    for (const cluster of clusters) {
      clusterStart.push(offset);
      offset += cluster.length;
    }
  }

  // Assign each glyph to its cluster by UTF-16 offset.
  const clusterOfGlyph: number[] = [];
  {
    let offset = 0;
    let clusterIndex = 0;
    for (const glyph of glyphs) {
      while (
        clusterIndex < clusters.length - 1 &&
        offset >= (clusterStart[clusterIndex] ?? 0) + clusters[clusterIndex]!.length
      ) {
        clusterIndex += 1;
      }
      clusterOfGlyph.push(clusterIndex);
      offset += glyph.char.length;
    }
  }

  const rotatePoint = (
    point: { x: number; y: number },
    origin: { x: number; y: number },
    angle: number,
    scaleX: number,
    scaleY: number,
  ): void => {
    const px = point.x - origin.x;
    const py = point.y - origin.y;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const sx = px * cos - py * sin;
    const sy = px * sin + py * cos;
    point.x = origin.x + sx * scaleX;
    point.y = origin.y + sy * scaleY;
  };

  const shiftShape = (
    shape: ShapeNode,
    dx: number,
    dy: number,
    clusterOrigin: { x: number; y: number },
    rotation: number,
    scaleX: number,
    scaleY: number,
  ): void => {
    const transform = (points: Array<{ x: number; y: number }>) => {
      for (const point of points) {
        point.x += dx;
        point.y += dy;
      }
      if (rotation !== 0 || scaleX !== 1 || scaleY !== 1) {
        const origin = { x: clusterOrigin.x + dx, y: clusterOrigin.y + dy };
        for (const point of points) {
          rotatePoint(point, origin, rotation, scaleX, scaleY);
        }
      }
    };
    if (shape.shape?.kind === 'path') {
      transform(shape.shape.points);
      for (const hole of shape.shape.holes ?? []) {
        transform(hole);
      }
    }
  };

  let dx = 0;
  const dy = 0;
  let currentCluster = -1;
  let clusterOrigin: { x: number; y: number } | null = null;
  let widthDelta = 0;
  const appliedClusters = new Set<number>();

  const advanceFromCluster = (clusterIndex: number): void => {
    const advance = glyphAdjustments?.[clusterIndex]?.advance ?? 0;
    const pair = pairAdjustments?.[clusterIndex] ?? 0;
    dx += advance + pair;
    widthDelta += advance + pair;
  };

  for (let gi = 0; gi < glyphs.length; gi += 1) {
    const clusterIndex = clusterOfGlyph[gi] as number;
    if (clusterIndex !== currentCluster) {
      if (currentCluster >= 0) advanceFromCluster(currentCluster);
      currentCluster = clusterIndex;
      clusterOrigin = null;
    }
    const shapeIndex = shapeIndexByGlyph[gi];
    if (shapeIndex === null || shapeIndex === undefined) continue;
    const shape = shapes[shapeIndex];
    if (shape?.shape?.kind !== 'path') continue;

    const adjustment = glyphAdjustments?.[clusterIndex];
    if (clusterOrigin === null) {
      const first = glyphs[gi]?.points[0];
      clusterOrigin = first ? { x: first.x, y: first.y } : { x: 0, y: 0 };
    }
    shiftShape(
      shape,
      dx + (adjustment?.dx ?? 0),
      dy + (adjustment?.dy ?? 0),
      clusterOrigin,
      adjustment?.rotation ?? 0,
      adjustment?.scaleX ?? 1,
      adjustment?.scaleY ?? 1,
    );
    appliedClusters.add(clusterIndex);
  }
  if (currentCluster >= 0) advanceFromCluster(currentCluster);

  return {
    widthDelta,
    warnings:
      appliedClusters.size > 0
        ? []
        : ['No glyph shapes matched the cluster adjustments; outlines kept unadjusted.'],
  };
}
