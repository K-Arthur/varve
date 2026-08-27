/**
 * Local-space bounds computation for scene nodes.
 *
 * Computes the axis-aligned bounding box of a node's geometry in its own
 * local coordinate space (before applying any transform).
 *
 * This is the canonical implementation — the editor package re-exports from
 * here. The renderer, hit-tester, and CoordinateService all depend on this.
 *
 * Research basis: Figma node geometry, Illustrator bounding-box conventions.
 */

import { hasLiveWarps } from '@varve/engine';
import type { Rect } from '@varve/shared';
import { DEFAULT_ARTWORK_FONT_FAMILY, measureText, measureWrappedText } from '@varve/shared';
import { deriveGeometryFromPaints, resolveNodePaints } from './paint';
import type { Paint, SceneNode } from './types';
import { nodeWarpedLocalBounds } from './warpBounds';
import { warpsOnNode } from './warpOps';

/**
 * Compute the axis-aligned bounding box of a node's geometry in its own local
 * coordinate space (before applying any transform).
 *
 * Returns `null` for node types whose bounds cannot be determined from the
 * scene model alone (e.g. groups whose bounds depend on children, or
 * arrow/path shapes without a clear box).
 *
 * Warp-aware: nodes with live warp modifiers return their conservative
 * evaluated bounds (warped geometry may extend far beyond the source bounds).
 * Layout dimensions (`w`/`h`, auto-layout) are never derived from these
 * bounds, so warp never triggers reflow loops.
 *
 * @param doc Optional document for resolving paintRefs on shapeless nodes.
 *            When provided, shapeless nodes with paintRefs resolve their
 *            geometry from the referenced paints. When omitted, only inline
 *            fills are used for shapeless geometry derivation.
 */
export function nodeLocalBounds(
  node: SceneNode,
  doc?: { paints?: Record<string, Paint> },
): Rect | null {
  if (hasLiveWarps(warpsOnNode(node))) {
    const warped = nodeWarpedLocalBounds(node, doc);
    if (warped) return warped;
  }
  return nodeLocalBoundsSource(node, doc);
}

/**
 * Source (unwarped) local bounds — the canonical geometry bounds without any
 * warp evaluation. Used by the warp evaluator itself and by layout.
 */
export function nodeLocalBoundsSource(
  node: SceneNode,
  doc?: { paints?: Record<string, Paint> },
): Rect | null {
  if (node.kind === 'shape') {
    // V1.8+: shapeless nodes derive geometry from paints, not the shape field.
    // The shape field is a one-time snapshot that can become stale when paints
    // are updated independently (e.g., image fill resolution changes).
    if (node.shapeless === true) {
      // Resolve effective fills: paintRefs → inline fills → legacy fill
      const fills = doc
        ? resolveNodePaints(
            { paintRefs: node.paintRefs, fills: node.fills, fill: { ...node.fill } },
            doc,
          )
        : node.fills && node.fills.length > 0
          ? node.fills
          : [];
      if (fills.length > 0) {
        const geom = deriveGeometryFromPaints(fills);
        return { x: 0, y: 0, w: geom.w, h: geom.h };
      }
    }
    const s = node.shape;
    switch (s.kind) {
      case 'rect':
        return { x: s.x, y: s.y, w: s.w, h: s.h };
      case 'ellipse':
        return { x: s.cx - s.rx, y: s.cy - s.ry, w: s.rx * 2, h: s.ry * 2 };
      case 'circle':
        return { x: s.cx - s.r, y: s.cy - s.r, w: s.r * 2, h: s.r * 2 };
      case 'line': {
        const minX = Math.min(s.from[0], s.to[0]);
        const minY = Math.min(s.from[1], s.to[1]);
        return {
          x: minX,
          y: minY,
          w: Math.max(Math.abs(s.to[0] - s.from[0]), 4),
          h: Math.max(Math.abs(s.to[1] - s.from[1]), 4),
        };
      }
      case 'polygon':
        return { x: s.cx - s.radius, y: s.cy - s.radius, w: s.radius * 2, h: s.radius * 2 };
      case 'star':
        return {
          x: s.cx - s.outerRadius,
          y: s.cy - s.outerRadius,
          w: s.outerRadius * 2,
          h: s.outerRadius * 2,
        };
      case 'arrow': {
        const xs = [s.from[0], s.to[0]];
        const ys = [s.from[1], s.to[1]];
        const minX = Math.min(...xs);
        const minY = Math.min(...ys);
        return {
          x: minX,
          y: minY,
          w: Math.max(Math.abs(s.to[0] - s.from[0]), 4),
          h: Math.max(Math.abs(s.to[1] - s.from[1]), 4),
        };
      }
      case 'path': {
        if (s.points.length === 0) return null;
        const pts = s.points;
        const allX = pts.flatMap((p) => {
          const vals = [p.x];
          if (p.handleIn) vals.push(p.x + p.handleIn[0]);
          if (p.handleOut) vals.push(p.x + p.handleOut[0]);
          return vals;
        });
        const allY = pts.flatMap((p) => {
          const vals = [p.y];
          if (p.handleIn) vals.push(p.y + p.handleIn[1]);
          if (p.handleOut) vals.push(p.y + p.handleOut[1]);
          return vals;
        });
        const minX = Math.min(...allX);
        const minY = Math.min(...allY);
        return {
          x: minX,
          y: minY,
          w: Math.max(...allX) - minX || 4,
          h: Math.max(...allY) - minY || 4,
        };
      }
    }
  }
  if (node.kind === 'path') {
    if (node.points.length === 0) return null;
    const pts = node.points;
    const allX = pts.flatMap((p) => {
      const vals = [p.x];
      if (p.handleIn) vals.push(p.x + p.handleIn[0]);
      if (p.handleOut) vals.push(p.x + p.handleOut[0]);
      return vals;
    });
    const allY = pts.flatMap((p) => {
      const vals = [p.y];
      if (p.handleIn) vals.push(p.y + p.handleIn[1]);
      if (p.handleOut) vals.push(p.y + p.handleOut[1]);
      return vals;
    });
    const minX = Math.min(...allX);
    const minY = Math.min(...allY);
    return {
      x: minX,
      y: minY,
      w: Math.max(...allX) - minX || 4,
      h: Math.max(...allY) - minY || 4,
    };
  }
  if (node.kind === 'text') {
    const fs = node.fontSize ?? 16;
    const options = {
      fontSize: fs,
      fontFamily: node.fontFamily ?? DEFAULT_ARTWORK_FONT_FAMILY,
      fontWeight: node.fontWeight ?? 400,
      fontStyle: node.fontStyle ?? 'normal',
      letterSpacing: node.letterSpacing ?? 0,
      lineHeight: node.lineHeight ?? 1.4,
      textCase: node.textCase ?? 'none',
    } as const;
    const measured =
      node.textResizing === 'autoHeight' && node.w !== undefined
        ? measureWrappedText(node.text, Math.max(0, node.w), options)
        : measureText(node.text, options);
    const isFixedContainer =
      node.textResizing === 'fixed' ||
      (node.textMode === 'area' && node.textResizing !== 'autoHeight' && node.w !== undefined);
    return {
      x: 0,
      y: 0,
      w: isFixedContainer
        ? (node.w ?? measured.width)
        : (node.w ?? Math.max(measured.width, fs * 3)),
      h: node.textResizing === 'autoHeight' ? measured.height : (node.h ?? measured.height),
    };
  }
  if (node.kind === 'table') {
    return { x: 0, y: 0, w: node.w ?? 480, h: node.h ?? 240 };
  }
  if (node.kind === 'frame') {
    const w = 'w' in node ? (node.w ?? 100) : 100;
    const h = 'h' in node ? (node.h ?? 100) : 100;
    return { x: 0, y: 0, w, h };
  }
  if (node.kind === 'group') {
    return null;
  }
  if (node.kind === 'rasterLayer') {
    return { x: 0, y: 0, w: node.width, h: node.height };
  }
  // Adjustment nodes have no geometry — their bounds are the parent frame's bounds.
  return null;
}
