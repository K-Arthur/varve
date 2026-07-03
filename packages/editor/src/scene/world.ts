/**
 * World-space transform and bounds helpers for the editor.
 *
 * These are the single source of truth for converting between a node's local
 * coordinate space and the world coordinate space used by the renderer,
 * hit-tester, selection overlay, and reveal logic.
 *
 * Research basis: scene-graph transform composition (standard affine chain).
 * Each node's `transform` is a local→parent affine; the world matrix is the
 * product of all ancestor transforms left-multiplied by the node's own.
 */

import type { Document, NodeId, SceneNode } from '@strata/scene';
import { getParent } from '@strata/scene';
import type { Affine, Rect } from '@strata/shared';
import {
  transformRect as affineTransformRect,
  identity,
  measureText,
  multiplyAffine,
} from '@strata/shared';

/**
 * Walk the ancestor chain from `id` up to the root, composing local→parent
 * transforms into a single world→local affine.
 *
 * Composes in scene-graph order: for parent transforms P₁, P₂, …, Pₙ where
 * P₁ is the root ancestor, the world transform is
 *   Pₙ · … · P₂ · P₁ · node.transform
 * (node's transform applied first in local space, then each parent's in order).
 */
export function nodeWorldTransform(doc: Document, id: NodeId): Affine {
  const node = doc.nodes[id];
  if (!node) return identity;

  // SceneNode union guarantees transform on all member types (ShapeNode,
  // TextNode, GroupNode, FrameNode all have `transform: Affine`).
  const nodeTransform = node.transform as Affine;
  const chain: Affine[] = [nodeTransform];

  // Walk up: getParent does a linear scan — for deep chains we could cache.
  let parentId = getParent(doc, id);
  while (parentId) {
    const parent = doc.nodes[parentId];
    if (!parent) break;
    chain.push(parent.transform as Affine);
    parentId = getParent(doc, parentId);
  }

  // Compose in scene-graph order (children last → applied first, parents first → applied last).
  let world: Affine = identity;
  for (let i = chain.length - 1; i >= 0; i--) {
    const m = chain[i];
    if (!m) continue;
    world = multiplyAffine(world, m);
  }
  return world;
}

/**
 * Compute the axis-aligned bounding box of a node's geometry in its own local
 * coordinate space (before applying any transform).
 *
 * Returns `null` for node types whose bounds cannot be determined from the
 * scene model alone (e.g. groups whose bounds depend on children, or
 * arrow/path shapes without a clear box).
 */
export function nodeLocalBounds(node: SceneNode): Rect | null {
  if (node.kind === 'shape') {
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
  if (node.kind === 'text') {
    const fs = node.fontSize ?? 16;
    const measured = measureText(node.text, {
      fontSize: fs,
      fontFamily: node.fontFamily ?? 'sans-serif',
      fontWeight: node.fontWeight ?? 400,
      fontStyle: node.fontStyle ?? 'normal',
      letterSpacing: node.letterSpacing ?? 0,
      lineHeight: node.lineHeight ?? 1.4,
    });
    return { x: 0, y: 0, w: Math.max(measured.width, fs * 3), h: measured.height };
  }
  if (node.kind === 'frame') {
    return { x: 0, y: 0, w: node.w, h: node.h };
  }
  if (node.kind === 'group') {
    return null;
  }
  return null;
}

/**
 * Compute the axis-aligned world-space bounding box of a group node by
 * unioning all children's world bounds. Groups have no own geometry.
 */
export function groupWorldBounds(doc: Document, groupId: NodeId): Rect | null {
  const node = doc.nodes[groupId];
  if (node?.kind !== 'group') return null;
  let union: Rect | null = null;
  for (const childId of node.children) {
    const b = nodeWorldBounds(doc, childId);
    if (!b) continue;
    if (!union) {
      union = { x: b.x, y: b.y, w: b.w, h: b.h };
    } else {
      const minX = Math.min(union.x, b.x);
      const minY = Math.min(union.y, b.y);
      const maxX = Math.max(union.x + union.w, b.x + b.w);
      const maxY = Math.max(union.y + union.h, b.y + b.h);
      union = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    }
  }
  return union;
}

/**
 * Compute the node's geometry bounds in world space.
 *
 * This is the canonical function for selection overlay, reveal, and
 * zoom-to-fit. Returns `null` when bounds cannot be determined.
 * Groups return the union of all their children's world bounds.
 */
export function nodeWorldBounds(doc: Document, id: NodeId): Rect | null {
  const node = doc.nodes[id];
  if (!node) return null;
  if (node.kind === 'group') return groupWorldBounds(doc, id);
  const local = nodeLocalBounds(node);
  if (!local) return null;
  const worldMat = nodeWorldTransform(doc, id);
  return affineTransformRect(worldMat, local);
}
