import type { Document, NodeId, RasterLayerNode, SceneNode } from '@varve/scene';
import { applyAffine, invertAffine, tryInvertAffine } from '@varve/shared';
import type { ToolContext } from './types';

/** Return the selected or nearest editable raster layer in the active page. */
export function findEditableRasterLayer(ctx: ToolContext): string | null {
  const doc = ctx.document;
  for (const selectedId of ctx.selection) {
    const selected = doc.nodes[selectedId];
    if (isEditableRaster(selected)) return selectedId;
  }

  const page = doc.pages?.find((candidate) => candidate.id === doc.activePageId);
  const contentRoot = page?.contentRoot;
  const candidates = contentRoot
    ? ((doc.nodes[contentRoot] as { children?: string[] })?.children ?? doc.rootChildren)
    : doc.rootChildren;

  const visit = (ids: readonly string[]): string | null => {
    for (const nodeId of ids) {
      const node = doc.nodes[nodeId];
      if (!node || node.visible === false || node.locked) continue;
      if (isEditableRaster(node)) return nodeId;
      if ('children' in node) {
        const nested = visit(node.children);
        if (nested) return nested;
      }
    }
    return null;
  };
  return visit(candidates);
}

export interface RetouchTargetLayer {
  kind: 'raster';
  nodeId: string;
  label: string;
}

export interface RetouchTargetRefusal {
  kind: 'none';
  /** Why no layer can receive retouch pixels, phrased for the user. */
  reason: string;
}

export type RetouchTarget = RetouchTargetLayer | RetouchTargetRefusal;

/**
 * Resolve the writable retouch destination with explicit ownership rules.
 *
 * A selected raster layer is the target. A selected non-raster object (an
 * image-filled shape, text, a vector node) is a deliberate refusal: retouch
 * tools must not silently pick some other pixel layer — the user asked to edit
 * the selection, and quietly writing elsewhere is how "editing the wrong
 * layer" reports start. With no object selected, the nearest editable raster
 * layer in the active page is a reasonable canvas-level fallback.
 *
 * Unlike paint, clone/heal/patch never create an implicit empty layer: an
 * empty destination with no source pixels produces invisible work and stray
 * artwork. The deliberate creation paths remain the Layers panel and the
 * Photo source "Prepare retouch layers" action.
 */
export function resolveRetouchTarget(ctx: ToolContext): RetouchTarget {
  return retouchTargetFromDocument(ctx.document, ctx.selection ?? []);
}

/**
 * Document-state form of {@link resolveRetouchTarget}.
 *
 * Lets presentation surfaces (the canvas retouch badge) compute the same
 * target the tools will use, without constructing a ToolContext.
 */
export function retouchTargetFromDocument(
  doc: Document,
  selection: readonly NodeId[],
): RetouchTarget {
  const selectedRaster = selection.find((id) => doc.nodes[id]?.kind === 'rasterLayer');
  if (selectedRaster) {
    const node = doc.nodes[selectedRaster] as RasterLayerNode;
    if (node.locked === true) {
      return {
        kind: 'none',
        reason: `${nodeName(node, 'Layer')} is locked. Unlock it or select a writable pixel layer.`,
      };
    }
    if (node.visible === false) {
      return {
        kind: 'none',
        reason: `${nodeName(node, 'Layer')} is hidden. Show it to retouch it.`,
      };
    }
    return { kind: 'raster', nodeId: selectedRaster, label: nodeName(node, 'Layer') };
  }

  const selectedNonRaster = selection.find((id) => doc.nodes[id]);
  if (selectedNonRaster) {
    const node = doc.nodes[selectedNonRaster]!;
    return {
      kind: 'none',
      reason: `${nodeName(node, 'This object')} is not a pixel layer. Retouch writes raster pixels: select the photo's repair layer or a pixel layer.`,
    };
  }

  const page = doc.pages?.find((candidate) => candidate.id === doc.activePageId);
  const contentRoot = page?.contentRoot;
  const candidates = contentRoot
    ? ((doc.nodes[contentRoot] as { children?: string[] })?.children ?? doc.rootChildren)
    : doc.rootChildren;
  const fallback = visitForEditableRaster(doc.nodes, candidates, new Set<string>());
  if (fallback) {
    return { kind: 'raster', nodeId: fallback, label: nodeName(doc.nodes[fallback], 'Layer') };
  }

  return {
    kind: 'none',
    reason:
      'No editable pixel layer is available. Add a pixel layer or prepare one from the photo before retouching.',
  };
}

function visitForEditableRaster(
  nodes: Record<string, SceneNode>,
  ids: readonly string[],
  visited: Set<string>,
): string | null {
  for (const nodeId of ids) {
    if (visited.has(nodeId)) continue;
    visited.add(nodeId);
    const node = nodes[nodeId];
    if (!node || node.visible === false || node.locked === true) continue;
    if (node.kind === 'rasterLayer') return nodeId;
    if ('children' in node && Array.isArray(node.children)) {
      const nested = visitForEditableRaster(nodes, node.children, visited);
      if (nested) return nested;
    }
  }
  return null;
}

/**
 * Express a clone/heal source point in another layer's local pixel space.
 *
 * The source is stored in the local space of the layer it was picked on. If
 * the write target changes (or was already a different layer), the point must
 * be mapped through world space before it can be used as a sampling offset;
 * comparing raw layer-local numbers across two transforms would anchor the
 * source in the wrong place.
 */
export function sourcePointInLayerSpace(
  ctx: Pick<ToolContext, 'getWorldTransform'>,
  source: { nodeId: string; x: number; y: number },
  targetNodeId: string,
): { x: number; y: number } {
  if (source.nodeId === targetNodeId || !ctx.getWorldTransform) {
    return { x: source.x, y: source.y };
  }
  const sourceTransform = ctx.getWorldTransform?.(source.nodeId);
  const targetTransform = ctx.getWorldTransform?.(targetNodeId);
  if (!sourceTransform || !targetTransform) return { x: source.x, y: source.y };
  const inverseTarget = tryInvertAffine(targetTransform);
  if (!inverseTarget) return { x: source.x, y: source.y };
  const [worldX, worldY] = applyAffine(sourceTransform, [source.x, source.y]);
  const [localX, localY] = applyAffine(inverseTarget, [worldX, worldY]);
  return { x: localX, y: localY };
}

export function createRasterTarget(
  ctx: ToolContext,
  world: { x: number; y: number },
): string | null {
  const page = ctx.document.pages?.find((candidate) => candidate.id === ctx.document.activePageId);
  return ctx.createRasterLayer(
    page?.width ?? 4096,
    page?.height ?? 4096,
    ctx.findContainingFrame(world),
  );
}

export function rasterLocalPoint(
  ctx: ToolContext,
  rasterNodeId: string | null,
  world: { x: number; y: number },
): { x: number; y: number } {
  if (!rasterNodeId || !ctx.getWorldTransform) return world;
  const [x, y] = applyAffine(invertAffine(ctx.getWorldTransform(rasterNodeId)), [world.x, world.y]);
  return { x, y };
}

function nodeName(node: SceneNode | undefined, fallback: string): string {
  const name = (node as { name?: unknown } | undefined)?.name;
  return typeof name === 'string' && name ? name : fallback;
}

function isEditableRaster(node: unknown): node is RasterLayerNode {
  return (
    !!node &&
    typeof node === 'object' &&
    (node as { kind?: unknown }).kind === 'rasterLayer' &&
    (node as { visible?: unknown }).visible !== false &&
    (node as { locked?: unknown }).locked !== true
  );
}
