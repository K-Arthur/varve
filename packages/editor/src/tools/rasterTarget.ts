import type { RasterLayerNode } from '@varve/scene';
import { applyAffine, invertAffine } from '@varve/shared';
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

function isEditableRaster(node: unknown): node is RasterLayerNode {
  return (
    !!node &&
    typeof node === 'object' &&
    (node as { kind?: unknown }).kind === 'rasterLayer' &&
    (node as { visible?: unknown }).visible !== false &&
    (node as { locked?: unknown }).locked !== true
  );
}
