/**
 * Shared structural flattening compositor for multi-format export.
 *
 * Determines which subtrees of the scene graph each export target (SVG, PDF,
 * raster) can handle natively, identifies the minimal set of nodes that need
 * pre-rasterization, and renders only those subtrees to raster assets at the
 * requested export resolution.
 *
 * Architecture decisions:
 * - Capability rules are deterministic: same input → same output.
 * - The live document is never mutated; all work operates on a snapshot.
 * - Rasterization delegates to `createRasterSurface` / `encodeRasterSurface`
 *   from `@varve/engine`, reusing the existing render-to-canvas pipeline.
 * - Unsupported subtrees are rasterized at the smallest enclosing boundary
 *   to minimise pixel output and preserve editable siblings.
 *
 * Research basis: Figma's multi-format export pipeline (raster fallback for
 * unsupported effects), SVG spec for supported features, PDF/X-4 transparency
 * groups, and the existing `flattenForExport.ts` adjustment-only flattener.
 */

import type { RasterAsset } from '@varve/codegen';
import {
  adjustmentsToFilters,
  anyRequiresRasterExport,
  createEngine,
  createRasterSurface,
  type Engine,
  encodeRasterSurface,
  type RasterSurface,
  totalEffectExpansion,
} from '@varve/engine';
import {
  activeSmartFilters,
  type Document,
  type Effect,
  type Fill,
  findCommonAncestor,
  hasActiveSmartFilters,
  isMockupFrame,
  type NodeId,
  resolveAdjustmentScope,
  type SceneNode,
  type ShapeNode,
} from '@varve/scene';
import { decorateMockupIr, MockupSurfaceCache } from '../render/mockup/mockupIr';
import { replayStructuredScene } from '../render/replayScene';
import { flattenSceneToEngine } from '../render/sceneToEngine';
import { settleEngineImageResources } from './resourceReadiness';

// ── Types ────────────────────────────────────────────────────────────────────

/** Describes what a specific exporter can handle natively. */
export interface FlattenCapability {
  /** Shape kinds the target renders natively (e.g. 'rect', 'circle'). */
  nativeShapeKinds: ReadonlySet<string>;
  /** Gradient types the target supports (e.g. 'linear'). */
  nativeGradientTypes: ReadonlySet<string>;
  /** Whether the target supports text nodes with font fallback. */
  supportsText: boolean;
  /** Whether the target supports groups/frames with clipping. */
  supportsGroups: boolean;
  /** Whether the target supports images (embedded or external). */
  supportsImages: boolean;
  /** Effect types the target can approximate natively (e.g. 'dropShadow' for PDF). */
  nativeEffectTypes: ReadonlySet<string>;
  /** Whether the target supports stacked fills (only topmost is used). */
  supportsStackedFills: boolean;
  /** Whether the target supports pattern fills. */
  supportsPatternFills: boolean;
  /** Whether the target supports blend modes beyond 'normal'. */
  supportsComplexBlend: boolean;
  /** Whether the target supports adjustment nodes without pre-rasterization. */
  supportsAdjustments: boolean;
  /** Whether the target supports masks (clip-path, alpha, luminance). */
  supportsMasks: boolean;
  /** Whether the target can keep an effect-local mask editable/native. */
  supportsEffectMasks: boolean;
  /** Whether the target supports rotation/skew transforms. */
  supportsTransforms: boolean;
  /** Whether the target supports opacity on nodes/groups. */
  supportsOpacity: boolean;
}

/** Export target format. */
export type ExportTarget = 'svg' | 'pdf' | 'raster';

/** The level at which to rasterize unsupported subtrees. */
export type FlattenBoundary = 'node' | 'group' | 'page';

/** Progress callback for long-running export operations. */
export type ExportProgressCallback = (phase: string, current: number, total: number) => void;

/** Options for composing an export snapshot. */
export interface ComposeSnapshotOptions {
  /** Export scale factor (1 = 100%). */
  scale: number;
  /** DPI for rasterization (default 96). */
  dpi?: number;
  /** AbortSignal for cancellation. */
  signal?: AbortSignal;
  /** Background colour for rasterized regions (RGBA 0-255). */
  background?: readonly [number, number, number, number];
  /** Optional progress callback. */
  onProgress?: ExportProgressCallback;
  /**
   * Render engine used to rasterize flattened boundaries. When omitted, a
   * software `'stub'` engine is created on demand. Callers exporting from a
   * live editor session should pass their real engine instance so flattened
   * output matches the live canvas exactly (gradients, images, masks, blend
   * modes, and adjustment compositing all resolve through the same IR the
   * live renderer uses).
   */
  engine?: Engine;
}

/** A node that needs to be rasterized for a given export target. */
export interface FlattenBoundaryEntry {
  /** The node ID to rasterize. */
  nodeId: string;
  /** The boundary level: 'node' for leaf unsupported, 'group' for container. */
  boundary: FlattenBoundary;
  /** The node itself (for rendering). */
  node: SceneNode;
  /** Bounding box in world coordinates. */
  bounds: { x: number; y: number; w: number; h: number };
  /** Whether this node has adjustment filters to apply. */
  hasAdjustmentFilters: boolean;
}

/** The result of composing an export snapshot. */
export interface ExportSnapshot {
  /** Raster assets keyed by node ID. */
  rasterAssets: Record<string, RasterAsset>;
  /** The list of root node IDs that should be emitted (filtered). */
  rootNodeIds: string[];
  /** Set of node IDs that were rasterized (excluded from vector output). */
  rasterizedNodeIds: ReadonlySet<string>;
  /** Node IDs that are supported and should be emitted as-is. */
  supportedNodeIds: ReadonlySet<string>;
}

// ── Capability tables ─────────────────────────────────────────────────────────

const SVG_NATIVE_SHAPES = new Set([
  'rect',
  'ellipse',
  'circle',
  'line',
  'arrow',
  'polygon',
  'star',
  'path',
]);

const PDF_NATIVE_SHAPES = new Set([
  'rect',
  'ellipse',
  'circle',
  'line',
  'arrow',
  'polygon',
  'star',
  'path',
]);

/** SVG natively supports only linear gradients. */
const SVG_NATIVE_GRADIENTS = new Set(['linear']);

/** PDF natively supports linear gradients (Shading Type 2). */
const PDF_NATIVE_GRADIENTS = new Set(['linear']);

/**
 * The basic Rust PDF writer can emit an offset path for a drop shadow, but it
 * cannot represent the canonical alpha blur/spread result. Treat every effect
 * as unsupported so the structural compositor rasterizes the affected subtree
 * instead of silently exporting a hard-edged approximation.
 */
const PDF_NATIVE_EFFECTS: ReadonlySet<string> = new Set();

/** Raster supports everything — no restrictions. */
const RASTER_NATIVE_SHAPES: ReadonlySet<string> = new Set([
  'rect',
  'ellipse',
  'circle',
  'line',
  'arrow',
  'polygon',
  'star',
  'path',
]);

const RASTER_NATIVE_GRADIENTS: ReadonlySet<string> = new Set([
  'linear',
  'radial',
  'angular',
  'diamond',
]);

const ALL_EFFECT_TYPES: ReadonlySet<string> = new Set([
  'dropShadow',
  'innerShadow',
  'layerBlur',
  'backgroundBlur',
  'outerGlow',
  'innerGlow',
  'glassMaterial',
  'chromaticAberration',
  'glitch',
]);

/** Capability table per export target. */
export const CAPABILITY: Record<ExportTarget, FlattenCapability> = {
  svg: {
    nativeShapeKinds: SVG_NATIVE_SHAPES,
    nativeGradientTypes: SVG_NATIVE_GRADIENTS,
    supportsText: true,
    supportsGroups: true,
    supportsImages: true,
    nativeEffectTypes: new Set(),
    supportsStackedFills: false,
    supportsPatternFills: false,
    supportsComplexBlend: false,
    supportsAdjustments: false,
    supportsMasks: true, // clip-path and mask elements
    supportsEffectMasks: false, // codegen has no effect-stage mask emitter yet
    supportsTransforms: true,
    supportsOpacity: true,
  },
  pdf: {
    nativeShapeKinds: PDF_NATIVE_SHAPES,
    nativeGradientTypes: PDF_NATIVE_GRADIENTS,
    supportsText: true, // native PDF text via strata-print (WinAnsi + subset + outline fallback)
    supportsGroups: true,
    supportsImages: true,
    nativeEffectTypes: PDF_NATIVE_EFFECTS,
    supportsStackedFills: true,
    supportsPatternFills: true,
    supportsComplexBlend: false,
    supportsAdjustments: false,
    supportsMasks: false,
    supportsEffectMasks: false,
    supportsTransforms: false, // only axis-aligned
    supportsOpacity: true,
  },
  raster: {
    nativeShapeKinds: RASTER_NATIVE_SHAPES,
    nativeGradientTypes: RASTER_NATIVE_GRADIENTS,
    supportsText: true,
    supportsGroups: true,
    supportsImages: true,
    nativeEffectTypes: ALL_EFFECT_TYPES,
    supportsStackedFills: true,
    supportsPatternFills: true,
    supportsComplexBlend: true,
    supportsAdjustments: true,
    supportsMasks: true,
    supportsEffectMasks: true,
    supportsTransforms: true,
    supportsOpacity: true,
  },
};

// ── Capability assessment ─────────────────────────────────────────────────────

/**
 * Collect all visible effects from a node (effects array, strokes, fills).
 */
function collectNodeEffects(node: SceneNode): Effect[] {
  const effects: Effect[] = [];

  if ('effects' in node && Array.isArray(node.effects)) {
    for (const e of node.effects) {
      if (e.visible !== false) effects.push(e);
    }
  }

  if ('strokes' in node && Array.isArray((node as ShapeNode).strokes)) {
    for (const stroke of (node as ShapeNode).strokes) {
      if (stroke.visible !== false && 'effects' in stroke && Array.isArray(stroke.effects)) {
        for (const e of stroke.effects) {
          if (e.visible !== false) effects.push(e);
        }
      }
    }
  }

  return effects;
}

/**
 * Collect all visible fills from a node.
 */
function collectNodeFills(node: SceneNode): Fill[] {
  if ('fills' in node && Array.isArray(node.fills)) {
    return (node.fills as Fill[]).filter((f) => f.visible !== false);
  }
  return [];
}

/**
 * Check whether a node's non-linear gradient fills need flattening for SVG.
 */
function hasNonLinearGradients(node: SceneNode, cap: FlattenCapability): boolean {
  if (cap.nativeGradientTypes.size >= 4) return false; // supports all
  const fills = collectNodeFills(node);
  for (const fill of fills) {
    if (fill.type === 'gradient' && fill.gradient) {
      if (!cap.nativeGradientTypes.has(fill.gradient.type)) return true;
    }
  }
  return false;
}

/**
 * Check whether a node has effects that the target cannot handle natively.
 */
function hasUnsupportedEffects(node: SceneNode, cap: FlattenCapability): boolean {
  const effects = collectNodeEffects(node);
  for (const e of effects) {
    if (!cap.nativeEffectTypes.has(e.type)) return true;
    if (e.mask && !cap.supportsEffectMasks) return true;
  }
  return false;
}

/**
 * Check whether a node has stacked fills and the target only supports the
 * topmost fill.
 */
function hasStackedFills(node: SceneNode, cap: FlattenCapability): boolean {
  if (cap.supportsStackedFills) return false;
  const fills = collectNodeFills(node);
  return fills.length > 1;
}

/**
 * Check whether a node has pattern fills and the target doesn't support them.
 */
function hasPatternFills(node: SceneNode, cap: FlattenCapability): boolean {
  if (cap.supportsPatternFills) return false;
  const fills = collectNodeFills(node);
  for (const fill of fills) {
    if (fill.type === 'pattern') return true;
  }
  return false;
}

/**
 * Check whether a node has non-normal blend modes on groups with effects.
 */
function hasComplexBlend(node: SceneNode, cap: FlattenCapability): boolean {
  if (cap.supportsComplexBlend) return false;
  if (node.blendMode && node.blendMode !== 'normal' && node.blendMode !== 'passThrough') {
    // Only an issue if the node also has effects (plain blend on a leaf is fine)
    if (hasUnsupportedEffects(node, cap)) return true;
  }
  return false;
}

/** Object Filters are document-local effects, not SVG/PDF codegen primitives. */
function hasVisibleSmartFilters(node: SceneNode): boolean {
  return hasActiveSmartFilters(node);
}

/**
 * Check whether a node has rotation/skew that the target can't handle.
 */
function hasUnsupportedTransform(node: SceneNode, cap: FlattenCapability): boolean {
  if (cap.supportsTransforms) return false;
  // PDF only supports axis-aligned: check for rotation or skew
  const t = node.transform;
  // An axis-aligned transform has t[1] === 0 and t[2] === 0
  // (skewX/skewY components of the affine matrix)
  if (t[1] !== 0 || t[2] !== 0) return true;
  return false;
}

/**
 * Assess whether a single node is natively supported by a given export target.
 *
 * Returns `true` if the node can be exported without rasterization, `false`
 * if it needs to be flattened to a raster asset.
 */
export function assessNodeCapability(
  node: SceneNode,
  _doc: Document,
  target: ExportTarget,
): boolean {
  const cap = CAPABILITY[target];

  // Raster supports everything (canvas2D replay handles all features)
  if (target === 'raster') return true;

  // Adjustment nodes always need flattening unless the target supports them
  if (node.kind === 'adjustment') {
    if (!cap.supportsAdjustments) return false;
  }

  // Keep the live preview and every export format honest: Object Filters are
  // rendered by the shared replay compositor and are not emitted by the SVG
  // or PDF code generators. Raster export already returned above.
  if (hasVisibleSmartFilters(node) && !cap.supportsAdjustments) return false;

  // Shape nodes: check shape kind
  if (node.kind === 'shape') {
    const shape = (node as ShapeNode).shape;
    if (!cap.nativeShapeKinds.has(shape.kind)) return false;
  }

  // Text nodes
  if (node.kind === 'text') {
    if (!cap.supportsText) return false;
    // The native PDF writer currently supports straight text only. Route
    // curved text through the affected-node raster boundary so PDF output
    // matches the live Canvas2D result without flattening the whole page.
    if (target === 'pdf' && node.textMode === 'path') return false;
  }

  // Groups and frames
  if (node.kind === 'group' || node.kind === 'frame') {
    if (!cap.supportsGroups) return false;
  }

  // Images
  if (node.kind === 'shape') {
    const fills = collectNodeFills(node);
    for (const fill of fills) {
      if (fill.type === 'image') {
        if (!cap.supportsImages) return false;
      }
    }
  }

  // Effects check
  if (hasUnsupportedEffects(node, cap)) return false;

  // Non-linear gradients
  if (hasNonLinearGradients(node, cap)) return false;

  // Stacked fills
  if (hasStackedFills(node, cap)) return false;

  // Pattern fills
  if (hasPatternFills(node, cap)) return false;

  // Complex blend modes on groups with effects
  if (hasComplexBlend(node, cap)) return false;

  // Masks
  if ('mask' in node && node.mask && !cap.supportsMasks) return false;

  // Transform (rotation/skew) for PDF
  if (hasUnsupportedTransform(node, cap)) return false;

  return true;
}

// ── Tree walking: find flatten boundaries ─────────────────────────────────────

/**
 * Compute the axis-aligned bounding box of a node in world coordinates.
 */
function computeNodeBounds(
  node: SceneNode,
  doc: Document,
): { x: number; y: number; w: number; h: number } {
  const tx = node.transform[4] ?? 0;
  const ty = node.transform[5] ?? 0;

  if (node.kind === 'shape') {
    const s = (node as ShapeNode).shape;
    switch (s.kind) {
      case 'rect':
        return { x: tx + s.x, y: ty + s.y, w: s.w, h: s.h };
      case 'ellipse':
        return { x: tx + s.cx - s.rx, y: ty + s.cy - s.ry, w: s.rx * 2, h: s.ry * 2 };
      case 'circle':
        return { x: tx + s.cx - s.r, y: ty + s.cy - s.r, w: s.r * 2, h: s.r * 2 };
      case 'line':
      case 'arrow': {
        const minX = Math.min(s.from[0], s.to[0]);
        const minY = Math.min(s.from[1], s.to[1]);
        return {
          x: tx + minX,
          y: ty + minY,
          w: Math.abs(s.to[0] - s.from[0]) || 1,
          h: Math.abs(s.to[1] - s.from[1]) || 1,
        };
      }
      case 'polygon':
        return {
          x: tx + s.cx - s.radius,
          y: ty + s.cy - s.radius,
          w: s.radius * 2,
          h: s.radius * 2,
        };
      case 'star':
        return {
          x: tx + s.cx - s.outerRadius,
          y: ty + s.cy - s.outerRadius,
          w: s.outerRadius * 2,
          h: s.outerRadius * 2,
        };
      case 'path': {
        if (s.points.length === 0) return { x: tx, y: ty, w: 1, h: 1 };
        const xs = s.points.map((p: { x: number }) => p.x);
        const ys = s.points.map((p: { y: number }) => p.y);
        const minX = Math.min(...xs);
        const minY = Math.min(...ys);
        return {
          x: tx + minX,
          y: ty + minY,
          w: Math.max(...xs) - minX || 1,
          h: Math.max(...ys) - minY || 1,
        };
      }
      default:
        return { x: tx, y: ty, w: 200, h: 160 };
    }
  }

  if (node.kind === 'text') {
    const fs = node.fontSize ?? 16;
    const textLen = (node as unknown as { text?: string }).text?.length ?? 1;
    return { x: tx, y: ty, w: textLen * fs * 0.6, h: fs * 1.4 };
  }

  if (node.kind === 'frame' || node.kind === 'group') {
    const children = (node.children ?? [])
      .map((cid: string) => doc.nodes[cid])
      .filter(Boolean) as SceneNode[];
    if (children.length === 0)
      return {
        x: tx,
        y: ty,
        w: (node as unknown as { w?: number }).w ?? 200,
        h: (node as unknown as { h?: number }).h ?? 160,
      };

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const child of children) {
      const b = computeNodeBounds(child, doc);
      minX = Math.min(minX, b.x);
      minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.w);
      maxY = Math.max(maxY, b.y + b.h);
    }
    if (!Number.isFinite(minX)) return { x: tx, y: ty, w: 200, h: 160 };
    return { x: minX, y: minY, w: Math.max(maxX - minX, 1), h: Math.max(maxY - minY, 1) };
  }

  if (node.kind === 'adjustment') {
    // For adjustment nodes, compute bounds from their scope targets
    const scope = (
      node as unknown as {
        scope?: { mode: string; targetNodeId?: string; targetNodeIds?: string[] };
      }
    ).scope;
    if (scope?.mode === 'image-local' && scope.targetNodeId) {
      const target = doc.nodes[scope.targetNodeId];
      if (target) return computeNodeBounds(target, doc);
    }
    if (scope?.mode === 'explicit-targets' && scope.targetNodeIds?.length) {
      let minX2 = Infinity;
      let minY2 = Infinity;
      let maxX2 = -Infinity;
      let maxY2 = -Infinity;
      for (const tid of scope.targetNodeIds) {
        const t = doc.nodes[tid];
        if (t) {
          const b = computeNodeBounds(t, doc);
          minX2 = Math.min(minX2, b.x);
          minY2 = Math.min(minY2, b.y);
          maxX2 = Math.max(maxX2, b.x + b.w);
          maxY2 = Math.max(maxY2, b.y + b.h);
        }
      }
      if (Number.isFinite(minX2)) return { x: minX2, y: minY2, w: maxX2 - minX2, h: maxY2 - minY2 };
    }
    // Fallback: use the node's own transform
    return { x: tx, y: ty, w: 200, h: 160 };
  }

  return { x: tx, y: ty, w: 200, h: 160 };
}

/**
 * Check whether a node has any adjustment children that require rasterization.
 */
function subtreeHasAdjustmentFilters(node: SceneNode, doc: Document): boolean {
  const smartFilters = activeSmartFilters(node);
  if (smartFilters.length > 0) {
    const irFilters = adjustmentsToFilters(smartFilters);
    if (anyRequiresRasterExport(irFilters)) return true;
  }

  if (node.kind === 'adjustment') {
    const rawFilters =
      (node as unknown as { adjustments?: Array<Record<string, unknown>> }).adjustments ?? [];
    const visibleFilters = rawFilters.filter(
      (a) => a.visible !== false && (a.opacity as number) > 0,
    );
    if (visibleFilters.length > 0) {
      const irFilters = adjustmentsToFilters(
        visibleFilters as unknown as Parameters<typeof adjustmentsToFilters>[0],
      );
      if (anyRequiresRasterExport(irFilters)) return true;
    }
  }

  if (node.kind === 'frame' || node.kind === 'group') {
    const children = (node.children ?? [])
      .map((cid: string) => doc.nodes[cid])
      .filter(Boolean) as SceneNode[];
    for (const child of children) {
      if (subtreeHasAdjustmentFilters(child, doc)) return true;
    }
  }

  return false;
}

/**
 * Walk the scene tree DFS and return the minimal set of nodes that need
 * rasterization for the given export target.
 *
 * Strategy:
 * - Leaf unsupported nodes → rasterize at 'node' boundary
 * - Container with some unsupported children → rasterize unsupported
 *   children individually (not the whole container)
 * - Container where all children are unsupported → rasterize at 'group' boundary
 * - Container that is itself unsupported (effects, etc.) → rasterize at 'group'
 * - Last resort: rasterize at 'page' boundary
 */
export function findFlattenBoundaries(
  nodes: SceneNode[],
  doc: Document,
  target: ExportTarget,
): FlattenBoundaryEntry[] {
  if (target === 'raster') return []; // raster supports everything

  const result: FlattenBoundaryEntry[] = [];

  /**
   * Walk a container's children and collect flatten boundaries.
   * Returns true if ALL children are unsupported (container can be rasterized
   * as a whole), false if only some children are unsupported (individual
   * children were pushed to `result`).
   */
  function walkContainer(containerId: string): boolean {
    const container = doc.nodes[containerId];
    if (!container || (container.kind !== 'frame' && container.kind !== 'group')) return false;

    const children = (container.children ?? [])
      .map((cid: string) => doc.nodes[cid])
      .filter((n): n is SceneNode => n != null && n.visible !== false);

    if (children.length === 0) return false; // empty container — nothing to rasterize

    let allUnsupported = true;
    const deferredGroupPushes: FlattenBoundaryEntry[] = [];

    for (const child of children) {
      if (assessNodeCapability(child, doc, target)) {
        allUnsupported = false;
        continue;
      }

      // Child is unsupported — decide whether to rasterize individually or as group
      if (child.kind === 'frame' || child.kind === 'group') {
        // If the container itself is unsupported (e.g. has effects), rasterize
        // the whole container as a group boundary — don't try to walk children
        // individually since the container's own properties need compositing.
        if (hasUnsupportedEffects(child, CAPABILITY[target])) {
          deferredGroupPushes.push({
            nodeId: child.id,
            boundary: 'group',
            node: child,
            bounds: computeNodeBounds(child, doc),
            hasAdjustmentFilters: subtreeHasAdjustmentFilters(child, doc),
          });
        } else {
          // Container is supported but some children may not be — recurse
          const childAllUnsupported = walkContainer(child.id);
          if (childAllUnsupported) {
            // All children unsupported — rasterize the group as a whole
            deferredGroupPushes.push({
              nodeId: child.id,
              boundary: 'group',
              node: child,
              bounds: computeNodeBounds(child, doc),
              hasAdjustmentFilters: subtreeHasAdjustmentFilters(child, doc),
            });
          }
        }
      } else {
        // Leaf unsupported node — record but defer push until we know
        // if all siblings are also unsupported (then we rasterize the parent)
        deferredGroupPushes.push({
          nodeId: child.id,
          boundary: 'node',
          node: child,
          bounds: computeNodeBounds(child, doc),
          hasAdjustmentFilters: subtreeHasAdjustmentFilters(child, doc),
        });
      }
    }

    if (allUnsupported) {
      // All children unsupported — the caller should rasterize this container
      // as a whole; don't push individual children
    } else {
      // Mixed container — push individual unsupported children
      for (const entry of deferredGroupPushes) {
        result.push(entry);
      }
    }

    return allUnsupported;
  }

  for (const rootNode of nodes) {
    if (rootNode.visible === false) continue;

    if (!assessNodeCapability(rootNode, doc, target)) {
      // Root node itself is unsupported
      if (rootNode.kind === 'frame' || rootNode.kind === 'group') {
        // Check if the container itself is unsupported (has effects, etc.)
        if (hasUnsupportedEffects(rootNode, CAPABILITY[target])) {
          result.push({
            nodeId: rootNode.id,
            boundary: 'group',
            node: rootNode,
            bounds: computeNodeBounds(rootNode, doc),
            hasAdjustmentFilters: subtreeHasAdjustmentFilters(rootNode, doc),
          });
        } else {
          const allUnsupported = walkContainer(rootNode.id);
          if (allUnsupported) {
            result.push({
              nodeId: rootNode.id,
              boundary: 'group',
              node: rootNode,
              bounds: computeNodeBounds(rootNode, doc),
              hasAdjustmentFilters: subtreeHasAdjustmentFilters(rootNode, doc),
            });
          }
        }
      } else {
        // Leaf unsupported root node
        result.push({
          nodeId: rootNode.id,
          boundary: 'node',
          node: rootNode,
          bounds: computeNodeBounds(rootNode, doc),
          hasAdjustmentFilters: subtreeHasAdjustmentFilters(rootNode, doc),
        });
      }
    } else if (rootNode.kind === 'frame' || rootNode.kind === 'group') {
      // Root node is supported but may contain unsupported descendants — recurse
      const allUnsupported = walkContainer(rootNode.id);
      if (allUnsupported) {
        result.push({
          nodeId: rootNode.id,
          boundary: 'group',
          node: rootNode,
          bounds: computeNodeBounds(rootNode, doc),
          hasAdjustmentFilters: subtreeHasAdjustmentFilters(rootNode, doc),
        });
      }
    }
  }

  return widenAdjustmentBoundaries(result, doc);
}

/**
 * Adjustment nodes have no visual content of their own — they modify
 * whatever nodes their `scope` resolves to (a sibling below by legacy
 * clipping rules, an explicit target list, a container's descendants, or
 * the whole document). Rasterizing the bare adjustment node (as the
 * generic leaf-boundary walk above does) would flatten nothing, since the
 * adjustment node paints no pixels itself.
 *
 * Widen each adjustment boundary to the smallest ancestor that contains
 * both the adjustment and everything its scope affects, using the same
 * `resolveAdjustmentScope` resolution the live renderer relies on. When no
 * shared container ancestor exists (root-level siblings, or `document`
 * scope), fall back to flattening every root node — the explicit
 * last-resort "whole page" boundary.
 */
function widenAdjustmentBoundaries(
  entries: FlattenBoundaryEntry[],
  doc: Document,
): FlattenBoundaryEntry[] {
  if (entries.every((e) => e.node.kind !== 'adjustment')) return entries;

  const widenedIds = new Set<string>();
  const kept: FlattenBoundaryEntry[] = [];

  for (const entry of entries) {
    if (entry.node.kind !== 'adjustment') {
      kept.push(entry);
      continue;
    }

    const adjNode = entry.node as unknown as {
      id: string;
      scope?: import('@varve/scene').AdjustmentScope;
    };
    const targets = resolveAdjustmentScope(doc, adjNode.scope, adjNode.id);
    if (targets.length === 0) continue; // no-op adjustment — nothing to flatten

    const ancestor = findCommonAncestor(doc, [adjNode.id, ...targets]);
    if (ancestor) {
      widenedIds.add(ancestor);
    } else {
      // No shared container — widen to the whole page (every visible root).
      for (const rootId of doc.rootChildren) {
        const rootNode = doc.nodes[rootId];
        if (rootNode && rootNode.visible !== false) widenedIds.add(rootId);
      }
    }
  }

  for (const id of widenedIds) {
    if (kept.some((e) => e.nodeId === id)) continue;
    const node = doc.nodes[id];
    if (!node) continue;
    kept.push({
      nodeId: id,
      boundary: 'group',
      node,
      bounds: computeNodeBounds(node, doc),
      hasAdjustmentFilters: subtreeHasAdjustmentFilters(node, doc),
    });
  }

  return kept;
}

// ── Rasterization helpers ─────────────────────────────────────────────────────

/**
 * Render a flatten boundary to a raster surface using the same IR-replay
 * pipeline the live canvas and whole-document raster export use
 * (`flattenSceneToEngine` → `Engine.buildIr` → `replayStructuredScene`).
 *
 * This is deliberately not a bespoke renderer: gradients, image fills,
 * patterns, blend modes, masks, and adjustment compositing all need to
 * match the live document exactly, and that fidelity already lives in the
 * engine/replay pipeline. Reimplementing a parallel subset here is how the
 * previous flattening attempts (`flattenForExport.ts`, and an earlier
 * version of this file) silently produced blank or wrong output for
 * anything beyond solid-fill rects.
 */
/** Live-bound source ids of the given mockup frames (for export flattening). */
function mockupLiveSourceIds(doc: Document, rootIds: readonly NodeId[]): NodeId[] {
  const ids: NodeId[] = [];
  const seen = new Set<NodeId>();
  for (const id of rootIds) {
    const node = doc.nodes[id];
    if (!isMockupFrame(node)) continue;
    for (const binding of Object.values(node.mockup.surfaceBindings)) {
      if (binding.mode === 'live' && binding.nodeId && !seen.has(binding.nodeId)) {
        seen.add(binding.nodeId);
        ids.push(binding.nodeId);
      }
    }
  }
  return ids;
}

let exportMockupSurfaceCache: MockupSurfaceCache | null = null;

/** Module-level export cache (export runs are sequential and infrequent). */
function getExportMockupSurfaceCache(): MockupSurfaceCache {
  if (!exportMockupSurfaceCache) exportMockupSurfaceCache = new MockupSurfaceCache();
  return exportMockupSurfaceCache;
}

async function renderBoundaryToSurface(
  surface: RasterSurface,
  boundaryNodeId: NodeId,
  doc: Document,
  eng: Engine,
  exportScale: number,
  bounds: { x: number; y: number; w: number; h: number },
  expansion?: RasterAsset['expansion'],
): Promise<void> {
  // Mockup frames present live-bound sources: include them in the flattened
  // set so the surface bake can replay them at export resolution.
  const sourceIds = mockupLiveSourceIds(doc, [boundaryNodeId]);
  const flattened = flattenSceneToEngine(doc, [boundaryNodeId, ...sourceIds]);
  // Export barrier: no replay may begin until every required image resource
  // has settled. Permanent failures throw so the export fails clearly rather
  // than silently baking a gray placeholder; pending resources throw a
  // transient timeout the caller reports distinctly.
  const settlement = await settleEngineImageResources(flattened.nodes, {
    signal: undefined,
  });
  if (settlement.status === 'cancelled') {
    throw new DOMException('Export cancelled', 'AbortError');
  }
  if (settlement.status === 'timeout') {
    throw new Error(
      `Export timed out waiting for ${settlement.pending.length} image resource(s) to load; retry once images appear on canvas.`,
    );
  }
  if (settlement.status === 'failed') {
    const details = settlement.failures
      .map((f) => `${f.resource.context}: ${f.message}`)
      .join('; ');
    throw new Error(
      `Export cannot include ${settlement.failures.length} failed image(s): ${details}`,
    );
  }
  const ir = await eng.buildIr({ nodes: flattened.nodes });

  const decorated = decorateMockupIr({
    doc,
    nodeIds: [boundaryNodeId, ...sourceIds],
    items: ir,
    renderSubtree: (ctx, nodeId) => {
      replayStructuredScene(ctx, {
        document: doc,
        rootIds: [nodeId],
        flattenedIds: flattened.ids,
        items: ir,
      });
    },
    qualityScale: exportScale,
    cache: getExportMockupSurfaceCache(),
    insertIntoList: false,
  });

  const ctx = surface.context as CanvasRenderingContext2D;
  ctx.save();
  ctx.scale(exportScale, exportScale);
  // The surface is padded by the effect expansion; anchor the content at
  // the expansion offset so the source bounds land at their true position
  // inside the padded image.
  ctx.translate(-bounds.x + (expansion?.left ?? 0), -bounds.y + (expansion?.top ?? 0));
  replayStructuredScene(ctx, {
    document: doc,
    rootIds: [boundaryNodeId],
    flattenedIds: flattened.ids,
    items: ir,
    extrasByNodeId: decorated.extrasByNodeId,
  });
  ctx.restore();
}

/** Visible adjustments attached to a node (kind + base fields). */
function collectVisibleAdjustments(node: SceneNode): Array<Record<string, unknown>> {
  const adjustments =
    node.kind === 'adjustment'
      ? (node as unknown as { adjustments?: Array<Record<string, unknown>> }).adjustments
      : [];
  const smartFilters = activeSmartFilters(node) as unknown as Array<Record<string, unknown>>;
  return [...(adjustments ?? []), ...smartFilters].filter(
    (a) => a.visible !== false && ((a.opacity as number | undefined) ?? 1) > 0,
  );
}

// ── Main entry point ─────────────────────────────────────────────────────────

/**
 * Compose a flattened export snapshot for the given document.
 *
 * For each export target, identifies unsupported subtrees, renders only
 * those subtrees to raster assets at export resolution, and returns an
 * `ExportSnapshot` with raster assets and a filtered node list.
 *
 * This function never mutates the live document. It is deterministic:
 * the same document snapshot + options always produces the same output.
 *
 * @param doc - The immutable document snapshot.
 * @param targets - Export targets to prepare (e.g. ['svg', 'pdf']).
 * @param opts - Export options (scale, DPI, signal, background, progress).
 * @returns ExportSnapshot with raster assets and filtered node lists per target.
 */
/** Rasterize a set of flatten boundaries, producing one asset per boundary node. */
async function rasterizeBoundaries(
  boundaries: FlattenBoundaryEntry[],
  doc: Document,
  eng: Engine,
  exportScale: number,
  dpi: number,
  opts: Pick<ComposeSnapshotOptions, 'signal' | 'background' | 'onProgress'>,
): Promise<{ rasterAssets: Record<string, RasterAsset>; rasterizedIds: Set<string> }> {
  const rasterAssets: Record<string, RasterAsset> = {};
  const rasterizedIds = new Set<string>();
  let processed = 0;

  for (const boundary of boundaries) {
    if (opts.signal?.aborted) {
      throw new DOMException('Export cancelled', 'AbortError');
    }

    opts.onProgress?.('rasterizing', processed, boundaries.length);
    processed++;

    const { node, bounds } = boundary;

    const cssWidth = Math.max(1, bounds.w);
    const cssHeight = Math.max(1, bounds.h);

    // Effect expansion: effects that generate pixels outside the source
    // bounds (bloom, flares, RGB displacement) must render on a padded
    // surface or the export clips them at the boundary rectangle. The
    // expansion is recorded on the asset so emitters can place the image
    // with the correct offset and size.
    let expansion: RasterAsset['expansion'];
    if (boundary.hasAdjustmentFilters) {
      const filters = adjustmentsToFilters(
        collectVisibleAdjustments(boundary.node) as unknown as Parameters<
          typeof adjustmentsToFilters
        >[0],
      );
      const [expL, expT, expR, expB] = totalEffectExpansion(filters);
      if (expL > 0 || expT > 0 || expR > 0 || expB > 0) {
        expansion = { left: expL, top: expT, right: expR, bottom: expB };
      }
    }
    const expandedCssW = cssWidth + (expansion?.left ?? 0) + (expansion?.right ?? 0);
    const expandedCssH = cssHeight + (expansion?.top ?? 0) + (expansion?.bottom ?? 0);
    const pixelW = Math.max(1, Math.round(expandedCssW * exportScale));
    const pixelH = Math.max(1, Math.round(expandedCssH * exportScale));

    // Skip if exceeds pixel budget (32 MiB = 33,554,432 pixels)
    if (pixelW * pixelH > 33_554_432) {
      rasterAssets[node.id] = {
        nodeId: node.id,
        dataUrl: '',
        pixelWidth: 0,
        pixelHeight: 0,
        cssWidth,
        cssHeight,
        dpi,
      };
      rasterizedIds.add(node.id);
      continue;
    }

    let surface: ReturnType<typeof createRasterSurface>;
    try {
      surface = createRasterSurface(pixelW, pixelH);
    } catch {
      // Renderer unavailable — skip this boundary
      continue;
    }

    const { context } = surface;

    // Paint background if provided
    const bg = opts.background;
    if (bg && bg[3] > 0) {
      context.fillStyle = `rgba(${bg[0]},${bg[1]},${bg[2]},${bg[3] / 255})`;
      context.fillRect(0, 0, pixelW, pixelH);
    }

    // Render the boundary through the real IR-replay pipeline so
    // gradients, images, masks, blend modes, and adjustment compositing
    // match the live document exactly. Content is anchored at the expansion
    // offset inside the padded surface.
    await renderBoundaryToSurface(surface, node.id, doc, eng, exportScale, bounds, expansion);

    let dataUrl: string;
    try {
      const blob = await encodeRasterSurface(surface, 'image/png');
      dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('Failed to encode raster surface'));
        reader.readAsDataURL(blob);
      });
    } catch {
      continue;
    }

    rasterAssets[node.id] = {
      nodeId: node.id,
      dataUrl,
      pixelWidth: Math.round(expandedCssW * exportScale),
      pixelHeight: Math.round(expandedCssH * exportScale),
      cssWidth,
      cssHeight,
      dpi,
      ...(expansion ? { expansion } : {}),
    };
    rasterizedIds.add(node.id);
  }

  return { rasterAssets, rasterizedIds };
}

export async function composeFlattenedExportSnapshot(
  doc: Document,
  targets: ExportTarget[],
  opts: ComposeSnapshotOptions,
): Promise<Record<ExportTarget, ExportSnapshot>> {
  const scale = Math.max(0.01, opts.scale);
  const dpi = opts.dpi ?? 96;
  const eng = opts.engine ?? (await createEngine('stub'));
  const results: Record<string, ExportSnapshot> = {};

  const rootIds = doc.rootChildren.filter((id) => {
    const node = doc.nodes[id];
    return node && node.visible !== false;
  });

  const totalPhases = targets.length;
  let currentPhase = 0;

  for (const target of targets) {
    if (opts.signal?.aborted) {
      throw new DOMException('Export cancelled', 'AbortError');
    }

    opts.onProgress?.('assessing', currentPhase, totalPhases);

    // Find boundaries that need rasterization
    const rootNodes = rootIds.map((id) => doc.nodes[id]).filter(Boolean) as SceneNode[];
    const boundaries = findFlattenBoundaries(rootNodes, doc, target);

    const supportedIds = new Set<string>();
    for (const id of rootIds) {
      const node = doc.nodes[id];
      if (node && assessNodeCapability(node, doc, target)) {
        supportedIds.add(id);
      }
    }

    const exportScale = scale * (dpi / 96);
    const { rasterAssets, rasterizedIds } = await rasterizeBoundaries(
      boundaries,
      doc,
      eng,
      exportScale,
      dpi,
      opts,
    );

    results[target] = {
      rasterAssets,
      rootNodeIds: rootIds,
      rasterizedNodeIds: rasterizedIds,
      supportedNodeIds: supportedIds,
    };

    currentPhase++;
  }

  opts.onProgress?.('complete', totalPhases, totalPhases);

  return results as Record<ExportTarget, ExportSnapshot>;
}

/**
 * Compose flattened raster assets for a single arbitrary node's subtree
 * (not necessarily a document root child) — the shape SVG/PDF single-node
 * export needs, as opposed to `composeFlattenedExportSnapshot`'s
 * whole-document batch export.
 */
export async function composeFlattenedRasterAssetsForNode(
  node: SceneNode,
  doc: Document,
  target: ExportTarget,
  opts: ComposeSnapshotOptions,
): Promise<Record<string, RasterAsset>> {
  if (opts.signal?.aborted) {
    throw new DOMException('Export cancelled', 'AbortError');
  }
  const scale = Math.max(0.01, opts.scale);
  const dpi = opts.dpi ?? 96;
  const eng = opts.engine ?? (await createEngine('stub'));
  const exportScale = scale * (dpi / 96);

  const boundaries = findFlattenBoundaries([node], doc, target);
  const { rasterAssets } = await rasterizeBoundaries(boundaries, doc, eng, exportScale, dpi, opts);
  return rasterAssets;
}
