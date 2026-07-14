/**
 * Structural scene replay shared by deterministic exports and previews.
 *
 * Render IR intentionally contains leaf drawing commands, while frames,
 * groups, and masks remain scene-graph semantics. This module applies those
 * semantics without flattening descendants into an un-clipped paint list.
 *
 * Supports enhanced masks: clip, alpha, luminance, inversion, feather, density.
 *
 * Research basis: W3C Compositing and Blending Level 1 group isolation;
 * WHATWG Canvas 2D clipping and state-stack behavior; Strata ADR-0001.
 */

import {
  createRasterSurface,
  mapBlendMode,
  type RenderItem,
  type ReplayTarget,
  renderEnhancedMask,
  replayIr,
  traceSceneNodeOutline,
} from '@strata/engine';
import type { Document, Mask, NodeId } from '@strata/scene';
import { tryInvertAffine } from '@strata/shared';
import { nodeWorldTransform } from '../scene/world';

type SceneContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface StructuredReplayInput {
  document: Document;
  rootIds: readonly NodeId[];
  flattenedIds: readonly NodeId[];
  items: readonly RenderItem[];
}

function setMatrix(context: SceneContext, matrix: DOMMatrix): void {
  context.setTransform(matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f);
}

export function replayStructuredScene(context: SceneContext, input: StructuredReplayInput): void {
  const itemById = new Map<NodeId, RenderItem>();
  for (let index = 0; index < input.flattenedIds.length; index++) {
    const id = input.flattenedIds[index];
    const item = input.items[index];
    if (id && item) itemById.set(id, item);
  }

  const replayChildren = (nodeId: NodeId, target: SceneContext): void => {
    const node = input.document.nodes[nodeId];
    if (!node || !('children' in node)) return;
    for (const childId of node.children) replayNode(childId, target);
  };

  const compositeIsolated = (
    target: SceneContext,
    draw: (isolated: SceneContext) => void,
    opacity: number,
    blendMode: string,
  ): void => {
    const surface = createRasterSurface(target.canvas.width, target.canvas.height);
    setMatrix(surface.context, target.getTransform());
    draw(surface.context);
    target.save();
    try {
      target.setTransform(1, 0, 0, 1, 0, 0);
      target.globalAlpha = opacity;
      target.globalCompositeOperation = mapBlendMode(blendMode) as GlobalCompositeOperation;
      target.drawImage(surface.canvas as CanvasImageSource, 0, 0);
    } finally {
      target.restore();
    }
  };

  const replayNode = (nodeId: NodeId, target: SceneContext): void => {
    const node = input.document.nodes[nodeId];
    if (!node || node.visible === false) return;
    const item = itemById.get(nodeId);

    const mask: Mask | null = 'mask' in node && node.mask?.visible ? node.mask : null;
    const maskSourceId = mask?.sourceNodeId;
    const maskSource = maskSourceId ? input.document.nodes[maskSourceId] : null;
    if (mask && maskSourceId && maskSource && 'children' in node) {
      if (mask.type === 'alpha' || mask.type === 'luminance') {
        const w = target.canvas.width;
        const h = target.canvas.height;
        const maskSurface = createRasterSurface(w, h);
        const contentSurface = createRasterSurface(w, h);
        // Apply unlinked mask transform for the mask source rendering
        setMatrix(maskSurface.context, target.getTransform());
        if (mask.linked === false && mask.transform) {
          maskSurface.context.setTransform(
            mask.transform[0],
            mask.transform[1],
            mask.transform[2],
            mask.transform[3],
            mask.transform[4],
            mask.transform[5],
          );
        }
        setMatrix(contentSurface.context, target.getTransform());
        replayNode(maskSourceId, maskSurface.context);
        // Render content: all children including mask source (unless hidden)
        for (const childId of node.children) {
          if (childId !== maskSourceId) replayNode(childId, contentSurface.context);
        }
        // Render mask source on top of content unless hideMaskSource
        if (!mask.hideMaskSource) {
          replayNode(maskSourceId, contentSurface.context);
        }

        // Use enhanced mask compositing with luminance/invert/feather/density support
        contentSurface.context.save();
        contentSurface.context.setTransform(1, 0, 0, 1, 0, 0);
        try {
          const imageData = contentSurface.context.getImageData(0, 0, w, h);
          if (imageData) {
            renderEnhancedMask(
              contentSurface.context,
              { draw: (ctx) => ctx.drawImage(maskSurface.canvas as CanvasImageSource, 0, 0) },
              {
                draw: (_ctx) => {
                  // content is already rendered on contentSurface
                },
              },
              {
                luminance: mask.type === 'luminance',
                inverted: mask.inverted === true,
                feather: mask.feather,
                density: mask.density,
              },
            );
          }
        } catch {
          // Fallback: standard destination-in (no post-processing)
          contentSurface.context.setTransform(1, 0, 0, 1, 0, 0);
          contentSurface.context.globalCompositeOperation = 'destination-in';
          contentSurface.context.drawImage(maskSurface.canvas as CanvasImageSource, 0, 0);
        }
        contentSurface.context.restore();

        target.save();
        try {
          target.setTransform(1, 0, 0, 1, 0, 0);
          target.globalAlpha = node.kind === 'group' ? (node.opacity ?? 1) : 1;
          const blendMode = node.kind === 'group' ? (node.blendMode ?? 'passThrough') : 'normal';
          target.globalCompositeOperation = mapBlendMode(
            blendMode === 'passThrough' ? 'normal' : blendMode,
          ) as GlobalCompositeOperation;
          target.drawImage(contentSurface.canvas as CanvasImageSource, 0, 0);
        } finally {
          target.restore();
        }
        return;
      }

      // Clip mask (type === 'clip')
      const world =
        mask.linked !== false
          ? nodeWorldTransform(input.document, maskSourceId)
          : (mask.transform ?? nodeWorldTransform(input.document, maskSourceId));
      const inverse = tryInvertAffine(world);
      if (inverse) {
        const drawClippedChildren = (clipTarget: SceneContext): void => {
          // Handle inverted clip mask via offscreen compositing
          if (mask.inverted) {
            const w = clipTarget.canvas.width;
            const h = clipTarget.canvas.height;
            const offscreen = createRasterSurface(w, h);
            setMatrix(offscreen.context, clipTarget.getTransform());
            // Render all non-mask-source children to offscreen canvas
            for (const childId of node.children) {
              if (childId !== maskSourceId) replayNode(childId, offscreen.context);
            }
            // Render mask source on top unless hideMaskSource
            if (!mask.hideMaskSource) {
              replayNode(maskSourceId, offscreen.context);
            }
            // Punch out the clip region using destination-out
            offscreen.context.save();
            offscreen.context.setTransform(1, 0, 0, 1, 0, 0);
            offscreen.context.globalCompositeOperation = 'destination-out';
            offscreen.context.transform(...world);
            offscreen.context.beginPath();
            traceSceneNodeOutline(
              offscreen.context as CanvasRenderingContext2D,
              maskSource as unknown as Parameters<typeof traceSceneNodeOutline>[1],
            );
            offscreen.context.closePath();
            offscreen.context.fillStyle = 'rgba(255,255,255,1)';
            offscreen.context.fill();
            offscreen.context.restore();
            // Draw the result onto clipTarget
            clipTarget.save();
            clipTarget.setTransform(1, 0, 0, 1, 0, 0);
            clipTarget.drawImage(offscreen.canvas as CanvasImageSource, 0, 0);
            clipTarget.restore();
            return;
          }
          clipTarget.save();
          try {
            clipTarget.transform(...world);
            clipTarget.beginPath();
            traceSceneNodeOutline(
              clipTarget as CanvasRenderingContext2D,
              maskSource as unknown as Parameters<typeof traceSceneNodeOutline>[1],
            );
            clipTarget.closePath();
            clipTarget.clip();
            clipTarget.transform(...inverse);
            for (const childId of node.children) {
              if (childId !== maskSourceId) replayNode(childId, clipTarget);
            }
            // Render mask source on top of clipped children unless hideMaskSource
            if (!mask.hideMaskSource) {
              clipTarget.transform(...inverse);
              replayNode(maskSourceId, clipTarget);
            }
          } finally {
            clipTarget.restore();
          }
        };
        if (node.kind === 'group') {
          const blendMode = node.blendMode ?? 'passThrough';
          const needsIsolation =
            node.isolated === true ||
            (blendMode !== 'normal' && blendMode !== 'passThrough') ||
            (node.opacity ?? 1) < 1;
          if (needsIsolation) {
            compositeIsolated(
              target,
              drawClippedChildren,
              node.opacity ?? 1,
              blendMode === 'passThrough' ? 'normal' : blendMode,
            );
          } else {
            drawClippedChildren(target);
          }
        } else {
          drawClippedChildren(target);
        }
        return;
      }
    }

    if (node.kind === 'frame') {
      if (item) replayIr(target as unknown as ReplayTarget, [item]);
      if (node.children.length === 0) return;
      if (node.clipContent === false) {
        replayChildren(nodeId, target);
        return;
      }
      const transform = item?.transform ?? nodeWorldTransform(input.document, nodeId);
      const [a, b, c, d, e, f] = transform;
      target.save();
      try {
        target.beginPath();
        target.moveTo(e, f);
        target.lineTo(a * node.w + e, b * node.w + f);
        target.lineTo(a * node.w + c * node.h + e, b * node.w + d * node.h + f);
        target.lineTo(c * node.h + e, d * node.h + f);
        target.closePath();
        target.clip();
        replayChildren(nodeId, target);
      } finally {
        target.restore();
      }
      return;
    }

    if (node.kind === 'group') {
      const blendMode = node.blendMode ?? 'passThrough';
      const needsIsolation =
        node.isolated === true ||
        (blendMode !== 'normal' && blendMode !== 'passThrough') ||
        (node.opacity ?? 1) < 1;
      if (needsIsolation && node.children.length > 0) {
        compositeIsolated(
          target,
          (isolated) => replayChildren(nodeId, isolated),
          node.opacity ?? 1,
          blendMode === 'passThrough' ? 'normal' : blendMode,
        );
      } else {
        replayChildren(nodeId, target);
      }
      return;
    }

    if (item) replayIr(target as unknown as ReplayTarget, [item]);
  };

  for (const rootId of input.rootIds) replayNode(rootId, context);
}
