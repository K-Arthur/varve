/**
 * Mask replay helpers shared by the live canvas and export replays.
 *
 * Extracted from CanvasArea.tsx (hub-file complexity budget): the container
 * mask branch and the adjustment spatial-mask application are pure functions
 * of the scene + a replay callback, so the renderer hub only wires them up.
 */

import {
  acquireMaskSurface,
  applyMaskAlpha,
  getImageCache,
  mapBlendMode,
  primitiveBounds,
  releaseMaskSurface,
  renderEnhancedMask,
  traceSceneNodeOutline,
} from '@varve/engine';
import type { Document, Mask, NodeId, SceneNode } from '@varve/scene';
import type { TransformCache } from '../scene/transformCache';

type RasterContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/**
 * Trace a vector-mask point list (PathPoint[] with optional bezier handles)
 * into the given context as a single path.
 */
export function traceVectorMaskPoints(
  ctx: RasterContext,
  points: import('@varve/engine').PathPoint[],
  closed: boolean,
): void {
  if (points.length === 0) return;
  ctx.beginPath();
  ctx.moveTo(points[0]!.x, points[0]!.y);
  for (let i = 1; i < points.length; i++) {
    const p = points[i]!;
    const prev = points[i - 1]!;
    if (p.handleIn || p.handleOut) {
      ctx.bezierCurveTo(
        prev.handleOut?.[0] ?? prev.x,
        prev.handleOut?.[1] ?? prev.y,
        p.handleIn?.[0] ?? p.x,
        p.handleIn?.[1] ?? p.y,
        p.x,
        p.y,
      );
    } else {
      ctx.lineTo(p.x, p.y);
    }
  }
  if (closed) ctx.closePath();
}

/**
 * Clip the current context to a container's quad, in device space. The quad
 * is derived from the container's world transform (item.transform) and its
 * local w/h — the same construction the frame branch uses for `clipContent`.
 * Used to compose frame quad clipping with a container mask (intersection).
 */
export function clipFrameQuadToCtx(
  ctx: CanvasRenderingContext2D,
  transform: readonly [number, number, number, number, number, number],
  w: number,
  h: number,
): void {
  const [a, b, c, d, e, f] = transform;
  ctx.beginPath();
  ctx.moveTo(e, f);
  ctx.lineTo(a * w + e, b * w + f);
  ctx.lineTo(a * w + c * h + e, b * w + d * h + f);
  ctx.lineTo(c * h + e, d * h + f);
  ctx.closePath();
  ctx.clip();
}

export interface AdjustmentSpatialMaskOptions {
  /** The filtered backdrop canvas context (device space). */
  backdropCtx: RasterContext;
  /** The adjustment node's mask (must be visible). */
  mask: Mask;
  doc: Document;
  /** Current camera transform (doc → device). */
  camera: DOMMatrix;
  /**
   * Device-space origin represented by backdrop pixel (0, 0).
   *
   * Adjustment surfaces are deliberately cropped to their scoped targets.
   * Mask geometry remains in document/device space, so it must be translated
   * into this surface before it can be used as a destination-in source.
   */
  regionX: number;
  regionY: number;
  /**
   * Replay any scene node into a context — used to render the mask source
   * under the camera transform. Must force full-subtree replay (the matte
   * may lie outside the dirty set).
   */
  replayNode: (nodeId: NodeId, ctx: RasterContext) => void;
  /** Resolve a node's world transform (linked masks follow the matte). */
  getWorldTransform: (nodeId: NodeId) => readonly [number, number, number, number, number, number];
}

/**
 * Apply an adjustment's spatial mask to its filtered backdrop in place.
 *
 * The mask limits WHERE the filtered result is visible (the adjustment's
 * scope limits WHAT content is processed). It is applied via destination-in,
 * so everywhere the mask is transparent the backdrop keeps its original
 * (unfiltered) pixels — the underlying content shows through untouched. A
 * plain hard clip skips the ImageData round-trip; alpha/luminance masks (and
 * any clip with invert/feather/density) go through the post-processing path.
 */
export function applyAdjustmentSpatialMask(options: AdjustmentSpatialMaskOptions): void {
  const { backdropCtx, mask, doc, camera, regionX, regionY, replayNode, getWorldTransform } =
    options;

  const maskSrcId = mask.sourceNodeId;
  const maskSource = maskSrcId ? doc.nodes[maskSrcId] : undefined;
  const maskHasVector = !!mask.vectorMask && mask.vectorMask.points.length > 0;
  // Adjustment nodes have no renderable geometry — a spatial mask whose
  // source is another adjustment contributes nothing.
  const maskUsable =
    maskHasVector ||
    (maskSrcId !== undefined && maskSource !== undefined && maskSource.kind !== 'adjustment');
  if (!maskUsable) return;

  const maskWorldTransform = maskSrcId
    ? mask.linked !== false
      ? getWorldTransform(maskSrcId)
      : (mask.transform ?? getWorldTransform(maskSrcId))
    : (mask.transform ?? ([1, 0, 0, 1, 0, 0] as const));

  const setMaskSurfaceTransform = (ctx: RasterContext): void => {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.translate(-regionX, -regionY);
    ctx.transform(camera.a, camera.b, camera.c, camera.d, camera.e, camera.f);
  };

  const fillClipGeometry = (ctx: RasterContext): void => {
    if (maskHasVector && mask.vectorMask) {
      ctx.transform(...maskWorldTransform);
      traceVectorMaskPoints(ctx, mask.vectorMask.points, mask.vectorMask.closed);
      ctx.fillStyle = 'rgba(255,255,255,1)';
      ctx.fill(mask.vectorMask.fillRule ?? 'nonzero');
    } else if (maskSrcId && maskSource) {
      ctx.transform(...maskWorldTransform);
      ctx.beginPath();
      traceSceneNodeOutline(
        ctx,
        maskSource as unknown as Parameters<typeof traceSceneNodeOutline>[1],
      );
      ctx.closePath();
      ctx.fillStyle = 'rgba(255,255,255,1)';
      ctx.fill(mask.fillRule ?? 'nonzero');
    }
  };
  const drawMaskAtDevice = (maskCtx: CanvasRenderingContext2D): void => {
    // The backdrop's local origin is the cropped target's device-space
    // origin, not the document origin. Project the document mask through
    // camera and then into that cropped surface. This shared transform is the
    // reason masks line up the same way in the live canvas and export replay.
    setMaskSurfaceTransform(maskCtx);
    if (maskHasVector) {
      fillClipGeometry(maskCtx);
    } else if (maskSrcId) {
      replayNode(maskSrcId, maskCtx);
    }
  };
  const hardClip =
    mask.type === 'clip' &&
    mask.inverted !== true &&
    (mask.feather ?? 0) <= 0 &&
    (mask.density ?? 1) >= 1;

  backdropCtx.save();
  backdropCtx.setTransform(1, 0, 0, 1, 0, 0);
  if (hardClip) {
    backdropCtx.globalCompositeOperation = 'destination-in';
    setMaskSurfaceTransform(backdropCtx);
    if (maskHasVector) {
      fillClipGeometry(backdropCtx);
    } else if (maskSrcId) {
      fillClipGeometry(backdropCtx);
    }
  } else {
    applyMaskAlpha(backdropCtx as CanvasRenderingContext2D, drawMaskAtDevice, {
      luminance: mask.type === 'luminance',
      inverted: mask.inverted === true,
      feather: mask.feather,
      density: mask.density,
    });
  }
  backdropCtx.restore();
}

/**
 * Options for replaying a mask on a leaf node (shape, text, raster layer).
 */
export interface LeafMaskReplayOptions {
  /** The masked leaf node. */
  node: SceneNode;
  /** The leaf's mask (must be visible and resolved). */
  mask: Mask;
  /** The leaf's IR item (transform baked in). */
  irItem: import('@varve/engine').RenderItem;
  doc: Document;
  /** Current doc → device transform. */
  baseTransform: DOMMatrix;
  /** Paint the leaf's content (IR item) to the given context. */
  paintContent: (ctx: CanvasRenderingContext2D) => void;
  getWorldTransform: (nodeId: NodeId) => readonly [number, number, number, number, number, number];
}

/**
 * Whether a leaf mask needs the structural Canvas2D compositing path.
 *
 * Image-filled shapes retain the engine's source-image alpha-mask fast path:
 * rendering them here as well would multiply the same mask twice. Vector and
 * node-local raster masks are composed after local effects and therefore use
 * this shared leaf replay path.
 */
export function requiresLeafMaskReplay(mask: Mask): boolean {
  return Boolean(
    mask.vectorMask ||
      (mask.rasterMask && mask.rasterMask.coordinateSpace !== 'source-image-pixels') ||
      (mask.sourceNodeId && mask.type !== 'clip'),
  );
}

/**
 * Replay a mask on a single leaf node (shape, text, raster layer).
 *
 * Renders the leaf's content to an offscreen surface, applies the mask
 * (vector path, raster asset, or live matte), and composites the result
 * onto the target context. This is the leaf-node equivalent of
 * `replayMaskedContainer` for containers.
 *
 * The content is rendered via the caller's `paintContent` callback, which
 * should paint the leaf's IR item (with its transform already applied).
 * The mask is drawn in the leaf's local coordinate space, ensuring
 * correct compositing via `destination-in`.
 */
export function replayLeafMask(
  targetCtx: CanvasRenderingContext2D,
  options: LeafMaskReplayOptions,
): void {
  const { mask, irItem, doc, baseTransform, paintContent, getWorldTransform } = options;

  const maskSrcId = mask.sourceNodeId ?? undefined;
  const maskSource = maskSrcId ? doc.nodes[maskSrcId] : undefined;
  const maskHasVector = !!mask.vectorMask && mask.vectorMask.points.length > 0;
  // Resolve raster mask asset
  const rasterAsset = mask.rasterMask
    ? (doc.rasterMaskAssets?.[mask.rasterMask.assetId] ?? null)
    : null;
  const rasterMaskImage = rasterAsset ? getImageCache().getImage(rasterAsset.dataUrl) : null;
  if (rasterAsset && !rasterMaskImage) {
    getImageCache()
      .load(rasterAsset.dataUrl)
      .catch(() => undefined);
  }

  // If raster mask asset is still decoding, render unmasked
  if (mask.rasterMask && !rasterMaskImage) {
    paintContent(targetCtx);
    return;
  }

  // Resolve the mask transform: linked masks follow the leaf's world
  // transform; unlinked masks use their own independent transform.
  const maskTransform =
    mask.linked !== false ? irItem.transform : (mask.transform ?? irItem.transform);
  const projectToSurface = (
    transform: readonly [number, number, number, number, number, number],
  ): [number, number, number, number, number, number] => [
    baseTransform.a * transform[0] + baseTransform.c * transform[1],
    baseTransform.b * transform[0] + baseTransform.d * transform[1],
    baseTransform.a * transform[2] + baseTransform.c * transform[3],
    baseTransform.b * transform[2] + baseTransform.d * transform[3],
    baseTransform.a * transform[4] + baseTransform.c * transform[5] + baseTransform.e,
    baseTransform.b * transform[4] + baseTransform.d * transform[5] + baseTransform.f,
  ];

  const result = acquireMaskSurface(targetCtx.canvas.width, targetCtx.canvas.height);
  try {
    const resultCtx = result.getContext('2d');
    if (!resultCtx) {
      paintContent(targetCtx);
      return;
    }
    renderEnhancedMask(
      resultCtx,
      {
        draw: (maskCtx: CanvasRenderingContext2D) => {
          if (maskHasVector && mask.vectorMask) {
            // Vector mask: apply the resolved transform so the path is in
            // device space, matching the content's coordinate space.
            maskCtx.setTransform(...projectToSurface(maskTransform));
            traceVectorMaskPoints(maskCtx, mask.vectorMask.points, mask.vectorMask.closed);
            maskCtx.fillStyle = 'rgba(255,255,255,1)';
            maskCtx.fill(mask.vectorMask.fillRule ?? 'nonzero');
          } else if (mask.rasterMask && rasterMaskImage) {
            // Raster masks use the target's complete local paint bounds.
            // `primitiveBounds` handles vector paths, text, and tables as
            // well as rects and raster layers, so coverage is media-agnostic.
            const bounds = primitiveBounds(irItem.primitive);
            maskCtx.setTransform(...projectToSurface(maskTransform));
            maskCtx.drawImage(rasterMaskImage, bounds.x, bounds.y, bounds.w, bounds.h);
          } else if (maskSrcId && maskSource) {
            // Scene-node matte: replay the source node's outline into the
            // mask surface. For linked masks the source follows its own world
            // transform; for unlinked masks use the mask transform.
            const srcTransform =
              mask.linked !== false
                ? getWorldTransform(maskSrcId)
                : (mask.transform ?? getWorldTransform(maskSrcId));
            maskCtx.setTransform(...projectToSurface(srcTransform));
            traceSceneNodeOutline(
              maskCtx,
              maskSource as unknown as Parameters<typeof traceSceneNodeOutline>[1],
            );
            maskCtx.fillStyle = 'rgba(255,255,255,1)';
            maskCtx.fill(mask.fillRule ?? 'nonzero');
          }
        },
      },
      {
        draw: (contentCtx: CanvasRenderingContext2D) => {
          contentCtx.setTransform(
            baseTransform.a,
            baseTransform.b,
            baseTransform.c,
            baseTransform.d,
            baseTransform.e,
            baseTransform.f,
          );
          paintContent(contentCtx);
        },
      },
      {
        luminance: mask.type === 'luminance',
        inverted: mask.inverted === true,
        feather: mask.feather,
        density: mask.density,
      },
    );
    // Composite the masked surface onto the target
    targetCtx.save();
    try {
      targetCtx.setTransform(1, 0, 0, 1, 0, 0);
      targetCtx.drawImage(result, 0, 0);
    } finally {
      targetCtx.restore();
    }
  } finally {
    releaseMaskSurface(result);
  }
}

export type { Mask, SceneNode };

export interface ContainerMaskReplayOptions {
  /** The masked container node (frame/group). */
  node: SceneNode;
  mask: Mask;
  maskSrcId: NodeId | null;
  maskChild: SceneNode | null;
  /** The container's own IR item transform (frame quad clipping). */
  itemTransform?: readonly [number, number, number, number, number, number];
  doc: Document;
  cache: TransformCache;
  /** Current doc → device transform. */
  baseTransform: DOMMatrix;
  /** Replay a scene node into a context (recursive structural replay). */
  replayNode: (nodeId: NodeId, ctx: CanvasRenderingContext2D) => void;
  getWorldTransform: (nodeId: NodeId) => readonly [number, number, number, number, number, number];
}

/**
 * Replay a masked container (clip/alpha/luminance group or frame) onto the
 * target context.
 *
 * Returns true when the node was handled. Non-container nodes (shapes) are
 * deliberately NOT handled: this module renders a node's children, which
 * shapes do not have, and iterating `children` on a shape throws
 * (`n.children is not iterable`), aborting the whole frame mid-paint.
 * Shape-level raster masks (background removal) composite through the flat
 * engine IR alphaMask path instead. Callers must fall through to the leaf
 * paint path when this returns false.
 *
 * - Plain hard clips use ctx.clip(); clips with invert/feather/density
 *   require per-pixel mask alpha and route through the alpha-compositing
 *   path (renderEnhancedMask).
 * - Frame quad clipping composes with the mask as an intersection.
 * - Inverted/dangling/adjustment sources never make content vanish: a
 *   missing or geometry-less source renders the children unmasked.
 * - Group opacity/blend/isolation apply when compositing the masked surface.
 * - All offscreen surfaces come from the bounded mask-surface pool.
 */
export function replayMaskedContainer(
  targetCtx: CanvasRenderingContext2D,
  options: ContainerMaskReplayOptions,
): boolean {
  const {
    node: n,
    mask,
    maskSrcId,
    maskChild,
    itemTransform,
    doc,
    baseTransform,
    replayNode,
    getWorldTransform,
  } = options;
  if (n.kind !== 'frame' && n.kind !== 'group') {
    return false;
  }
  {
    // Adjustment nodes never reach here (kind guard above); the container
    // machinery below is the only consumer of this module.
    const compositeMaskedSurface = (surface: HTMLCanvasElement): void => {
      targetCtx.save();
      try {
        targetCtx.setTransform(1, 0, 0, 1, 0, 0);
        if (n.kind === 'group') {
          const blendMode = n.blendMode ?? 'passThrough';
          targetCtx.globalAlpha = n.opacity ?? 1;
          targetCtx.globalCompositeOperation = mapBlendMode(
            blendMode === 'passThrough' ? 'normal' : blendMode,
          ) as GlobalCompositeOperation;
        }
        targetCtx.drawImage(surface, 0, 0);
      } finally {
        targetCtx.restore();
      }
    };
    // A clip mask must route through the alpha-compositing path
    // whenever its parameters require per-pixel mask alpha: inversion
    // (ctx.clip has no inverse), feather (soft edges), or density
    // (partial strength). Plain hard clips keep the fast ctx.clip()
    // path. The mask source for this path is the solid white fill of
    // the clip geometry (node outline or vector path).
    const clipNeedsAlphaPath =
      mask.type === 'clip' &&
      (mask.inverted === true || (mask.feather ?? 0) > 0 || (mask.density ?? 1) < 1);
    const maskSourceIsRenderable =
      !maskSrcId ||
      (maskChild !== null && maskChild !== undefined && maskChild.kind !== 'adjustment');
    const maskSourceMissing = maskSrcId !== null && maskChild == null;
    const maskSourceUsable = maskSourceIsRenderable && !maskSourceMissing;
    // Container-local raster masks (brush-painted layer masks on frames)
    // need the decoded asset before compositing. If the decode is not ready,
    // kick the load and render the children unmasked this frame — a mask
    // must never make content vanish because its image is still loading.
    const rasterAsset = mask.rasterMask
      ? (doc.rasterMaskAssets?.[mask.rasterMask.assetId] ?? null)
      : null;
    const rasterMaskImage = rasterAsset ? getImageCache().getImage(rasterAsset.dataUrl) : null;
    if (rasterAsset && !rasterMaskImage) {
      getImageCache()
        .load(rasterAsset.dataUrl)
        .catch(() => undefined);
    }
    if (
      (mask.type === 'alpha' || mask.type === 'luminance' || clipNeedsAlphaPath) &&
      maskSourceUsable
    ) {
      if (mask.rasterMask && !rasterMaskImage) {
        // Asset still decoding — replay the subtree unmasked and return.
        const children = (n as import('@varve/scene').ContainerNode).children;
        for (const childId of children) {
          if (childId !== maskSrcId) replayNode(childId, targetCtx);
        }
        if (!mask.hideMaskSource && maskSrcId) replayNode(maskSrcId, targetCtx);
        return true;
      }
      const result = acquireMaskSurface(targetCtx.canvas.width, targetCtx.canvas.height);
      try {
        const resultCtx = result.getContext('2d');
        if (!resultCtx) return true;
        renderEnhancedMask(
          resultCtx,
          {
            draw: (maskCtx: CanvasRenderingContext2D) => {
              if (maskSrcId) {
                maskCtx.setTransform(baseTransform);
                replayNode(maskSrcId, maskCtx);
              } else if (mask.vectorMask && mask.vectorMask.points.length > 0) {
                const t = mask.transform ?? ([1, 0, 0, 1, 0, 0] as const);
                maskCtx.setTransform(t[0], t[1], t[2], t[3], t[4], t[5]);
                traceVectorMaskPoints(maskCtx, mask.vectorMask.points, mask.vectorMask.closed);
                maskCtx.fillStyle = 'rgba(255,255,255,1)';
                maskCtx.fill(mask.vectorMask.fillRule ?? 'nonzero');
              } else if (mask.rasterMask && rasterMaskImage) {
                // Container-local painted mask: the asset stretches over the
                // frame's local box (0..w, 0..h) under its world transform.
                const cw = getWorldTransform(n.id);
                maskCtx.setTransform(cw[0], cw[1], cw[2], cw[3], cw[4], cw[5]);
                maskCtx.drawImage(
                  rasterMaskImage,
                  0,
                  0,
                  'w' in n && typeof n.w === 'number' ? n.w : 1,
                  'h' in n && typeof n.h === 'number' ? n.h : 1,
                );
              }
            },
          },
          {
            draw: (contentCtx: CanvasRenderingContext2D) => {
              contentCtx.setTransform(baseTransform);
              // A frame's own quad clip composes with the mask as an
              // intersection (content must satisfy both boundaries).
              const clipFrame =
                n.kind === 'frame' &&
                n.kind === 'frame' &&
                n.clipContent !== false &&
                itemTransform !== undefined;
              if (clipFrame) {
                contentCtx.save();
                clipFrameQuadToCtx(
                  contentCtx,
                  itemTransform ?? ([1, 0, 0, 1, 0, 0] as const),
                  (n as import('@varve/scene').FrameNode).w,
                  (n as import('@varve/scene').FrameNode).h,
                );
              }
              for (const childId of (n as import('@varve/scene').ContainerNode).children) {
                if (childId !== maskSrcId) replayNode(childId, contentCtx);
              }
              // Render mask source on top of masked content unless hideMaskSource is true
              if (!mask.hideMaskSource && maskSrcId) {
                replayNode(maskSrcId, contentCtx);
              }
              if (clipFrame) contentCtx.restore();
            },
          },
          {
            luminance: mask.type === 'luminance',
            inverted: mask.inverted === true,
            feather: mask.feather,
            density: mask.density,
          },
        );
        compositeMaskedSurface(result);
        return true;
      } finally {
        releaseMaskSurface(result);
      }
    }
    const drawClippedChildren = (clipCtx: CanvasRenderingContext2D): void => {
      // Inverted clips are handled by the alpha-compositing path above
      // (destination-in inversion); only plain hard clips reach here.
      clipCtx.save();
      try {
        // Frame quad clip composes with the mask clip (intersection).
        const clipFrame =
          n.kind === 'frame' &&
          n.kind === 'frame' &&
          n.clipContent !== false &&
          itemTransform !== undefined;
        if (clipFrame) {
          clipFrameQuadToCtx(
            clipCtx,
            itemTransform ?? ([1, 0, 0, 1, 0, 0] as const),
            (n as import('@varve/scene').FrameNode).w,
            (n as import('@varve/scene').FrameNode).h,
          );
        }
        const maskWorldTransform = maskSrcId
          ? mask.linked !== false
            ? getWorldTransform(maskSrcId)
            : (mask.transform ?? getWorldTransform(maskSrcId))
          : (mask.transform ?? ([1, 0, 0, 1, 0, 0] as const));
        clipCtx.transform(...maskWorldTransform);
        if (mask.vectorMask && mask.vectorMask.points.length > 0) {
          traceVectorMaskPoints(clipCtx, mask.vectorMask.points, mask.vectorMask.closed);
          clipCtx.clip(mask.vectorMask.fillRule ?? 'nonzero');
        } else if (maskChild && maskChild.kind !== 'adjustment') {
          clipCtx.beginPath();
          traceSceneNodeOutline(
            clipCtx,
            maskChild as unknown as Parameters<typeof traceSceneNodeOutline>[1],
          );
          clipCtx.closePath();
          clipCtx.clip(mask.fillRule ?? 'nonzero');
        }
        // A dangling source (maskChild === null) or an adjustment
        // source (no geometry, legacy documents) cannot establish a
        // clip — the children render unmasked rather than vanishing.
        clipCtx.setTransform(baseTransform);
        for (const childId of (n as import('@varve/scene').ContainerNode).children) {
          if (childId !== maskSrcId) replayNode(childId, clipCtx);
        }
        // Render mask source on top of clipped children unless hideMaskSource
        if (!mask.hideMaskSource && maskSrcId) {
          clipCtx.setTransform(baseTransform);
          replayNode(maskSrcId, clipCtx);
        }
      } finally {
        clipCtx.restore();
      }
    };
    const blendMode = n.kind === 'group' ? (n.blendMode ?? 'passThrough') : 'normal';
    const needsContainerSurface =
      n.kind === 'group' &&
      (n.isolated === true ||
        (blendMode !== 'normal' && blendMode !== 'passThrough') ||
        (n.opacity ?? 1) < 1);
    if (needsContainerSurface) {
      const result = acquireMaskSurface(targetCtx.canvas.width, targetCtx.canvas.height);
      try {
        const resultCtx = result.getContext('2d');
        if (!resultCtx) return true;
        resultCtx.setTransform(baseTransform);
        drawClippedChildren(resultCtx);
        compositeMaskedSurface(result);
      } finally {
        releaseMaskSurface(result);
      }
    } else {
      drawClippedChildren(targetCtx);
    }
    return true;
  }
}
