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
  applyLayerBlur,
  CompositeCanvas,
  createRasterSurface,
  gaussianBlurSeparable,
  mapBlendMode,
  primitiveBounds,
  type RenderItem,
  type ReplayTarget,
  renderEnhancedMask,
  replayIr,
  traceSceneNodeOutline,
} from '@strata/engine';
import type { Document, Effect, ManagedColor, Mask, NodeId } from '@strata/scene';
import { nodeEffectPadding } from '@strata/scene';
import { managedColorToRgba, tryInvertAffine } from '@strata/shared';
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

// ── Group-level effects (parity with the live canvas) ─────────────────────────

/** Maximum effect expansion over a subtree, used to pad the flatten surface. */
function subtreeEffectPadding(document: Document, rootIds: readonly NodeId[]): number {
  let padding = 2;
  const stack = [...rootIds];
  while (stack.length > 0) {
    const node = document.nodes[stack.pop()!];
    if (!node) continue;
    if ('effects' in node && node.effects) {
      const p = nodeEffectPadding(node as { effects?: Array<Record<string, unknown>> });
      padding = Math.max(padding, p.left, p.right, p.top, p.bottom);
    }
    if ('children' in node) stack.push(...node.children);
  }
  return Math.ceil(padding);
}

/** Convert a managed effect colour to an rgba() string. */
function effectColorToCss(color: ManagedColor): string {
  const [r, g, b, a] = managedColorToRgba(color);
  return `rgba(${r}, ${g}, ${b}, ${a / 255})`;
}

/**
 * Composite a group-level drop shadow or outer glow in front of the target's
 * backdrop but behind the group content. The flattened group canvas is drawn
 * with the Canvas shadow API onto a scratch canvas, the content is erased
 * (`destination-out`), and the remaining shadow-only pixels are composited
 * with the effect's own blend mode. This is the same technique the live
 * canvas uses, so exported output matches the editor preview.
 */
function compositeGroupOuterEffect(
  target: SceneContext,
  effect: Effect,
  gCanvas: CompositeCanvas,
  renderScale: number,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
  groupOpacity: number,
): void {
  if (effect.type !== 'dropShadow' && effect.type !== 'outerGlow') return;
  const w = gCanvas.canvas.width;
  const h = gCanvas.canvas.height;
  if (w <= 0 || h <= 0) return;

  const effectCanvas = document.createElement('canvas');
  effectCanvas.width = w;
  effectCanvas.height = h;
  const effectCtx = effectCanvas.getContext('2d');
  if (!effectCtx) return;

  const offsetX = effect.type === 'dropShadow' ? (effect.x ?? 0) : 0;
  const offsetY = effect.type === 'dropShadow' ? (effect.y ?? 0) : 0;

  effectCtx.save();
  effectCtx.shadowColor = effectColorToCss(effect.color);
  effectCtx.shadowBlur = (effect.blur + Math.max(0, effect.spread) / 2) * renderScale;
  effectCtx.shadowOffsetX = offsetX * renderScale;
  effectCtx.shadowOffsetY = offsetY * renderScale;
  effectCtx.drawImage(gCanvas.canvas as unknown as CanvasImageSource, 0, 0);
  effectCtx.globalCompositeOperation = 'destination-out';
  effectCtx.shadowColor = 'transparent';
  effectCtx.drawImage(gCanvas.canvas as unknown as CanvasImageSource, 0, 0);
  effectCtx.restore();

  target.save();
  target.globalAlpha = (effect.opacity ?? 1) * groupOpacity;
  target.globalCompositeOperation = mapBlendMode(effect.blendMode) as GlobalCompositeOperation;
  target.drawImage(effectCanvas as unknown as CanvasImageSource, dx, dy, dw, dh);
  target.restore();
}

/**
 * Apply a group-level inner shadow or inner glow to the flattened group
 * canvas in place, using the same silhouette-difference algorithm as the live
 * canvas (`renderGroupInsetEffect` in CanvasArea.tsx).
 */
function applyGroupInsetEffect(
  effect: Effect,
  gCanvas: CompositeCanvas,
  renderScale: number,
  mode: 'shadow' | 'glow',
): void {
  if (effect.type !== 'innerShadow' && effect.type !== 'innerGlow') return;
  const w = gCanvas.canvas.width;
  const h = gCanvas.canvas.height;
  if (w <= 0 || h <= 0) return;

  const blur = effect.blur * renderScale;
  const spread = effect.spread * renderScale;
  const ctx = gCanvas.ctx;

  const silhouetteData = ctx.getImageData(0, 0, w, h);
  const insetCanvas = document.createElement('canvas');
  insetCanvas.width = w;
  insetCanvas.height = h;
  const insetCtx = insetCanvas.getContext('2d');
  if (!insetCtx) return;
  insetCtx.putImageData(silhouetteData, 0, 0);

  const [r, g, b] = managedColorToRgba(effect.color);

  if (mode === 'shadow') {
    // Inner shadow: colour the silhouette, blur, then cut the offset hole.
    insetCtx.save();
    insetCtx.globalCompositeOperation = 'source-in';
    insetCtx.fillStyle = `rgba(${r},${g},${b},1)`;
    insetCtx.fillRect(0, 0, w, h);
    insetCtx.restore();
    if (blur > 0) {
      const blurred = gaussianBlurSeparable(insetCtx.getImageData(0, 0, w, h), Math.max(1, blur));
      insetCtx.putImageData(blurred, 0, 0);
    }
    insetCtx.save();
    insetCtx.globalCompositeOperation = 'destination-out';
    insetCtx.translate(
      -('x' in effect ? (effect.x ?? 0) : 0) * renderScale,
      -('y' in effect ? (effect.y ?? 0) : 0) * renderScale,
    );
    insetCtx.putImageData(silhouetteData, 0, 0);
    insetCtx.restore();
    const insetData = insetCtx.getImageData(0, 0, w, h).data;
    const dst = ctx.getImageData(0, 0, w, h);
    const opacity = effect.opacity ?? 1;
    for (let i = 3; i < dst.data.length; i += 4) {
      const sa = insetData[i]! / 255;
      dst.data[i - 3] = dst.data[i - 3]! * (1 - sa * opacity);
      dst.data[i - 2] = dst.data[i - 2]! * (1 - sa * opacity);
      dst.data[i - 1] = dst.data[i - 1]! * (1 - sa * opacity);
      dst.data[i] = Math.max(dst.data[i]!, insetData[i]! * opacity);
    }
    ctx.putImageData(dst, 0, 0);
    return;
  }

  // Inner glow: erode by spread, colourise, blur, then keep only where the
  // original silhouette had content.
  const shrinkPx = Math.max(1, Math.round(spread));
  if (spread > 0) {
    const erodeCanvas = document.createElement('canvas');
    erodeCanvas.width = w;
    erodeCanvas.height = h;
    const erodeCtx = erodeCanvas.getContext('2d');
    if (erodeCtx) {
      erodeCtx.putImageData(silhouetteData, 0, 0);
      erodeCtx.filter = `blur(${shrinkPx}px)`;
      erodeCtx.globalCompositeOperation = 'source-over';
      erodeCtx.drawImage(insetCanvas, 0, 0);
      const erodeResult = erodeCtx.getImageData(0, 0, w, h);
      insetCtx.putImageData(erodeResult, 0, 0);
    }
  }
  insetCtx.save();
  insetCtx.globalCompositeOperation = 'source-in';
  insetCtx.fillStyle = `rgba(${r},${g},${b},1)`;
  insetCtx.fillRect(0, 0, w, h);
  insetCtx.restore();
  if (blur > 0) {
    const blurred = gaussianBlurSeparable(insetCtx.getImageData(0, 0, w, h), Math.max(1, blur));
    insetCtx.putImageData(blurred, 0, 0);
  }
  insetCtx.save();
  insetCtx.globalCompositeOperation = 'destination-in';
  insetCtx.putImageData(silhouetteData, 0, 0);
  insetCtx.restore();

  const glowData = insetCtx.getImageData(0, 0, w, h);
  const dst = ctx.getImageData(0, 0, w, h);
  const opacity = effect.opacity ?? 1;
  for (let i = 0; i < dst.data.length; i += 4) {
    const ga = glowData.data[i + 3]! / 255;
    dst.data[i] = dst.data[i]! * (1 - ga * opacity) + glowData.data[i]! * ga * opacity;
    dst.data[i + 1] = dst.data[i + 1]! * (1 - ga * opacity) + glowData.data[i + 1]! * ga * opacity;
    dst.data[i + 2] = dst.data[i + 2]! * (1 - ga * opacity) + glowData.data[i + 2]! * ga * opacity;
    dst.data[i + 3] = Math.max(dst.data[i + 3]!, glowData.data[i + 3]!);
  }
  ctx.putImageData(dst, 0, 0);
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
              contentSurface.context as CanvasRenderingContext2D,
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
            offscreen.context.fill(mask.fillRule ?? 'nonzero');
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
            clipTarget.clip(mask.fillRule ?? 'nonzero');
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
      const visibleEffects = (node.effects ?? []).filter((effect) => effect.visible);
      if ((needsIsolation || visibleEffects.length > 0) && node.children.length > 0) {
        const gopacity = node.opacity ?? 1;

        // Flatten the subtree to a bounded surface so group-level effects can
        // shadow the composited silhouette (matching the live canvas).
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        for (const childId of node.children) {
          const childItem = itemById.get(childId);
          if (!childItem) continue;
          const childBounds = primitiveBounds(childItem.primitive);
          const t = childItem.transform ?? nodeWorldTransform(input.document, childId);
          const a = t[0];
          const b = t[1];
          const c = t[2];
          const d = t[3];
          const e = t[4];
          const f = t[5];
          const corners: Array<[number, number]> = [
            [childBounds.x, childBounds.y],
            [childBounds.x + childBounds.w, childBounds.y],
            [childBounds.x, childBounds.y + childBounds.h],
            [childBounds.x + childBounds.w, childBounds.y + childBounds.h],
          ];
          for (const corner of corners) {
            const wx = a * corner[0] + c * corner[1] + e;
            const wy = b * corner[0] + d * corner[1] + f;
            minX = Math.min(minX, wx);
            minY = Math.min(minY, wy);
            maxX = Math.max(maxX, wx);
            maxY = Math.max(maxY, wy);
          }
        }
        if (Number.isFinite(minX)) {
          const padding = subtreeEffectPadding(input.document, node.children);
          const groupWidth = Math.max(1, maxX - minX + padding * 2);
          const groupHeight = Math.max(1, maxY - minY + padding * 2);
          const m = target.getTransform();
          const renderScale = Math.max(1, Math.hypot(m.a, m.b));
          let gCanvas: CompositeCanvas;
          try {
            gCanvas = new CompositeCanvas({
              width: groupWidth,
              height: groupHeight,
              devicePixelRatio: renderScale,
              testCanvas: document.createElement('canvas'),
            });
          } catch {
            replayChildren(nodeId, target);
            return;
          }
          const gCtx = gCanvas.ctx;
          gCtx.save();
          gCtx.translate(-minX + padding, -minY + padding);
          replayChildren(nodeId, gCtx as unknown as SceneContext);
          gCtx.restore();

          const dx = minX - padding;
          const dy = minY - padding;
          for (const effect of visibleEffects) {
            if (effect.type === 'dropShadow' || effect.type === 'outerGlow') {
              compositeGroupOuterEffect(
                target,
                effect,
                gCanvas,
                renderScale,
                dx,
                dy,
                groupWidth,
                groupHeight,
                gopacity,
              );
            }
          }
          for (const effect of visibleEffects) {
            if (effect.type === 'innerShadow') {
              applyGroupInsetEffect(effect, gCanvas, renderScale, 'shadow');
            } else if (effect.type === 'innerGlow') {
              applyGroupInsetEffect(effect, gCanvas, renderScale, 'glow');
            }
          }

          target.save();
          if (blendMode !== 'passThrough') {
            target.globalCompositeOperation = mapBlendMode(blendMode) as GlobalCompositeOperation;
          }
          target.globalAlpha = gopacity;
          const layerBlur = visibleEffects.find((effect) => effect.type === 'layerBlur');
          if (layerBlur && layerBlur.type === 'layerBlur' && layerBlur.radius > 0) {
            applyLayerBlur(
              target as unknown as {
                drawImage?: (
                  src: CanvasImageSource,
                  dx: number,
                  dy: number,
                  dw: number,
                  dh: number,
                ) => void;
                save?: () => void;
                restore?: () => void;
                filter?: string;
              },
              gCanvas,
              layerBlur.radius,
              dx,
              dy,
              groupWidth,
              groupHeight,
            );
          } else {
            target.drawImage(
              gCanvas.canvas as unknown as CanvasImageSource,
              0,
              0,
              gCanvas.canvas.width,
              gCanvas.canvas.height,
              dx,
              dy,
              groupWidth,
              groupHeight,
            );
          }
          target.restore();
          return;
        }
      }
      if (needsIsolation) {
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
