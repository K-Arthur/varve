/**
 * Stage-aware group effect execution shared by the live Canvas2D replay and
 * structured export replay.
 *
 * The scene keeps one authored effect array for identity and editing. Render
 * consumers must nevertheless evaluate backdrop effects before the group's
 * surface, content effects against the composited surface, and appearance
 * effects after that surface exists. Keeping the content/backdrop operations
 * here prevents the live and export paths from quietly growing different
 * semantics.
 */

import {
  applyBackgroundBlurBackdrop,
  applyChromaticAberration,
  applyDepthBlur,
  applyGlassMaterialBackdrop,
  applyGlitch,
  applySpatialBlur,
  CompositeCanvas,
  compositeMaskedEffectPixels,
  computeScreenBounds,
  createRasterSurface,
  deserializeDepthMap,
  type EffectMaskResolver,
  getImageCache,
  type RenderItem,
  resizeDepthMap,
} from '@varve/engine';
import { type Document, type Effect, layerEffectStage } from '@varve/scene';
import { tryInvertAffine } from '@varve/shared';

type SceneContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
type GroupBackdropEffect = Extract<Effect, { type: 'backgroundBlur' | 'glassMaterial' }>;
type GroupContentEffect = Extract<
  Effect,
  {
    type:
      | 'layerBlur'
      | 'depthBlur'
      | 'gaussianBlur'
      | 'fieldBlur'
      | 'irisBlur'
      | 'tiltShiftBlur'
      | 'pathBlur'
      | 'spinBlur'
      | 'chromaticAberration'
      | 'glitch';
  }
>;

export interface GroupContentEffectOptions {
  /** Resolve scene/vector/raster sources for an effect-local mask. */
  effectMaskResolver?: EffectMaskResolver;
  /** Synthetic item describing the group's surface in document coordinates. */
  effectTarget?: RenderItem;
}

type EngineChromaticEffect = Parameters<typeof applyChromaticAberration>[3];
type EngineGlitchEffect = Parameters<typeof applyGlitch>[3];

type MaskReplayContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function traceVectorMask(
  ctx: MaskReplayContext,
  vector: {
    points: readonly {
      x: number;
      y: number;
      handleIn?: readonly [number, number] | null;
      handleOut?: readonly [number, number] | null;
    }[];
    closed: boolean;
    fillRule: 'nonzero' | 'evenodd';
  },
): void {
  const first = vector.points[0];
  if (!first) return;
  ctx.beginPath();
  ctx.moveTo(first.x, first.y);
  for (let index = 1; index < vector.points.length; index++) {
    const point = vector.points[index]!;
    const previous = vector.points[index - 1]!;
    if (previous.handleOut || point.handleIn) {
      ctx.bezierCurveTo(
        previous.handleOut?.[0] ?? previous.x,
        previous.handleOut?.[1] ?? previous.y,
        point.handleIn?.[0] ?? point.x,
        point.handleIn?.[1] ?? point.y,
        point.x,
        point.y,
      );
    } else {
      ctx.lineTo(point.x, point.y);
    }
  }
  if (vector.closed) ctx.closePath();
  ctx.fillStyle = 'rgba(255,255,255,1)';
  ctx.fill(vector.fillRule);
}

/**
 * Build the scene/vector resolver used by live structural replay. Raster
 * effect-mask assets remain in the engine's image-cache path; this resolver
 * covers the two sources that need a scene callback and therefore cannot be
 * reconstructed from the flattened item alone.
 */
export function createEffectMaskResolver(options: {
  document: Document;
  replayNode: (nodeId: string, target: MaskReplayContext) => void;
}): EffectMaskResolver {
  const activeSources = new Set<string>();
  return (binding, item, target, width, height) => {
    let maskSurface: ReturnType<typeof createRasterSurface>;
    try {
      maskSurface = createRasterSurface(width, height);
    } catch {
      return undefined;
    }

    if (binding.visible === false) return undefined;
    if (binding.source.kind === 'raster-asset') {
      const asset = options.document.rasterMaskAssets?.[binding.source.assetId];
      const image = asset ? getImageCache().getImage(asset.dataUrl) : null;
      if (!image) {
        if (asset)
          void getImageCache()
            .load(asset.dataUrl)
            .catch(() => undefined);
        return undefined;
      }
      const maskCtx = maskSurface.context;
      maskCtx.setTransform(1, 0, 0, 1, 0, 0);
      if (binding.linked === false && binding.transform) {
        maskCtx.transform(...binding.transform);
      }
      maskCtx.drawImage(image as CanvasImageSource, 0, 0, width, height);
      try {
        return maskCtx.getImageData(0, 0, width, height);
      } catch {
        return undefined;
      }
    }

    const current = target.getTransform?.();
    const inverse = tryInvertAffine(item.transform);
    if (!current || !inverse) return undefined;
    const maskCtx = maskSurface.context;
    maskCtx.setTransform(current.a, current.b, current.c, current.d, current.e, current.f);
    maskCtx.save();
    try {
      // A source node is replayed in document/world coordinates. Project it
      // into the target-local effect surface so mask and effect stay
      // registered under rotation, scale, and pan. Vector sources may be
      // authored directly in target-local coordinates; only world-space
      // vectors need the target inverse.
      if (binding.source.kind === 'scene-node' || binding.coordinateSpace === 'world') {
        maskCtx.transform(...inverse);
      }
      if (binding.linked === false && binding.transform) {
        maskCtx.transform(...binding.transform);
      }
      if (binding.source.kind === 'scene-node') {
        const sourceId = binding.source.nodeId;
        if (!options.document.nodes[sourceId] || activeSources.has(sourceId)) return undefined;
        activeSources.add(sourceId);
        try {
          options.replayNode(sourceId, maskCtx);
        } finally {
          activeSources.delete(sourceId);
        }
      } else {
        traceVectorMask(maskCtx, binding.source.vectorMask);
      }
    } finally {
      maskCtx.restore();
    }

    try {
      return maskCtx.getImageData(0, 0, width, height);
    } catch {
      return undefined;
    }
  };
}

/**
 * Describe a flattened group/frame surface for the effect-mask resolver.
 * The item is never painted; it supplies the surface-to-world transform that
 * the engine's effect-mask contract already expects for leaf items.
 */
export function createGroupEffectTargetItem(
  x: number,
  y: number,
  width: number,
  height: number,
): RenderItem {
  return {
    transform: [1, 0, 0, 1, x, y],
    primitive: { kind: 'rect', x: 0, y: 0, w: width, h: height },
    fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 0 },
    fills: [],
    strokes: [],
  };
}

function isGroupContentEffect(effect: Effect): effect is GroupContentEffect {
  return layerEffectStage(effect) === 'content';
}

/**
 * Apply content-stage effects to an already-composited group surface.
 *
 * Group effects must not be routed through leaf replay: doing so either
 * paints children independently or paints them twice. Each visible content
 * effect is applied in authored order within the fixed content stage.
 */
export function applyGroupContentEffects(
  documentModel: Document,
  gCanvas: CompositeCanvas,
  effects: readonly Effect[],
  options: GroupContentEffectOptions = {},
): void {
  for (const effect of effects) {
    if (!effect.visible || !isGroupContentEffect(effect)) continue;

    // Group/frame effects do not have a leaf RenderItem in the authored IR.
    // Capture the pre-effect surface only when a mask is present, then use
    // the engine's canonical premultiplied cross-fade after the effect has
    // been evaluated. An unavailable source leaves the evaluated effect
    // intact, matching leaf replay's missing-source-safe policy.
    const masked =
      effect.mask?.visible !== false &&
      effect.mask !== undefined &&
      options.effectMaskResolver &&
      options.effectTarget;
    const input = masked ? gCanvas.getImageData(0, 0, gCanvas.width, gCanvas.height) : undefined;

    const applyMask = (): void => {
      if (!input || !effect.mask || !options.effectMaskResolver || !options.effectTarget) return;
      try {
        const mask = options.effectMaskResolver(
          effect.mask as Parameters<EffectMaskResolver>[0],
          options.effectTarget,
          gCanvas.ctx as unknown as Parameters<EffectMaskResolver>[2],
          input.width,
          input.height,
        );
        if (!mask) return;
        const evaluated = gCanvas.getImageData(0, 0, gCanvas.width, gCanvas.height);
        const composited = compositeMaskedEffectPixels(input, evaluated, mask, effect.mask);
        const compositedImage = new ImageData(composited.width, composited.height);
        compositedImage.data.set(composited.data);
        gCanvas.putImageData(compositedImage, 0, 0);
      } catch {
        // A refused mask readback must not blank the evaluated group surface.
      }
    };

    if (effect.type === 'layerBlur') {
      try {
        gCanvas.applyBlur(effect.radius);
      } catch {
        // A refused readback leaves the authoritative pre-effect surface.
      }
      applyMask();
      continue;
    }

    if (effect.type === 'depthBlur') {
      const resource = documentModel.depthMaps?.[effect.depthMapId];
      if (!resource) continue;
      try {
        const input = gCanvas.getImageData(0, 0, gCanvas.width, gCanvas.height);
        const decoded = deserializeDepthMap(resource);
        const depthMap = resizeDepthMap(decoded, input.width, input.height);
        gCanvas.putImageData(
          applyDepthBlur(input, depthMap, {
            blurAmount: effect.blurStrength,
            focalDepth: effect.focusDepth,
            transitionRange: effect.focusRange * Math.max(0, effect.falloff),
            invert: effect.invert,
            edgeProtection: effect.edgeProtection,
          }),
          0,
          0,
        );
      } catch {
        // A missing/corrupt depth resource must not blank the group. The
        // unmodified surface remains the safe, visible rendering fallback.
      }
      applyMask();
      continue;
    }

    if (
      effect.type === 'gaussianBlur' ||
      effect.type === 'fieldBlur' ||
      effect.type === 'irisBlur' ||
      effect.type === 'tiltShiftBlur' ||
      effect.type === 'pathBlur' ||
      effect.type === 'spinBlur'
    ) {
      try {
        const input = gCanvas.getImageData(0, 0, gCanvas.width, gCanvas.height);
        gCanvas.putImageData(applySpatialBlur(input, effect), 0, 0);
      } catch {
        // Constrained runtimes keep the authoritative pre-effect surface.
      }
      applyMask();
      continue;
    }

    if (effect.type === 'chromaticAberration') {
      try {
        applyChromaticAberration(
          gCanvas,
          gCanvas.width,
          gCanvas.height,
          effect as unknown as EngineChromaticEffect,
        );
      } catch {
        // Keep the source surface if a pixel allocation is refused.
      }
      applyMask();
      continue;
    }

    if (effect.type === 'glitch') {
      try {
        applyGlitch(
          gCanvas,
          gCanvas.width,
          gCanvas.height,
          effect as unknown as EngineGlitchEffect,
        );
      } catch {
        // Keep the source surface if a pixel allocation is refused.
      }
      applyMask();
    }
  }
}

/**
 * Paint a group backdrop effect through the group's rendered alpha
 * silhouette. Capturing and drawing a rectangle is incorrect for sparse or
 * non-rectangular groups: it changes pixels outside the authored coverage.
 */
export function compositeGroupBackdropEffect(
  target: SceneContext,
  effect: GroupBackdropEffect,
  gCanvas: CompositeCanvas,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
  groupOpacity: number,
): void {
  const source = target.canvas as HTMLCanvasElement | OffscreenCanvas;
  const transform = target.getTransform?.();
  if (!source || !transform) return;

  const radius = effect.type === 'backgroundBlur' ? effect.radius : effect.blur;
  const blurPad = Math.ceil(Math.max(0, radius) * 3);
  const screen = computeScreenBounds(transform, dx, dy, dw, dh);
  const scaleX = Math.max(1e-6, Math.hypot(transform.a, transform.b));
  const scaleY = Math.max(1e-6, Math.hypot(transform.c, transform.d));
  const padX = Math.ceil(blurPad * scaleX);
  const padY = Math.ceil(blurPad * scaleY);
  const capX = screen.x - padX;
  const capY = screen.y - padY;
  const capW = Math.max(1, screen.w + padX * 2);
  const capH = Math.max(1, screen.h + padY * 2);

  try {
    const backdrop = new CompositeCanvas({
      width: capW,
      height: capH,
      devicePixelRatio: 1,
    });
    backdrop.captureSource(source, capX, capY, capW, capH, 0, 0);
    if (effect.type === 'backgroundBlur') {
      applyBackgroundBlurBackdrop(backdrop, capW, capH, effect.radius);
    } else {
      backdrop.applyBlur(effect.blur);
      applyGlassMaterialBackdrop(backdrop, capW, capH, effect);
    }

    const silhouette = new CompositeCanvas({
      width: capW,
      height: capH,
      devicePixelRatio: 1,
    });
    const silhouetteCtx = silhouette.ctx;
    silhouetteCtx.save();
    silhouetteCtx.setTransform(
      transform.a,
      transform.b,
      transform.c,
      transform.d,
      transform.e - capX,
      transform.f - capY,
    );
    silhouetteCtx.drawImage(
      gCanvas.canvas as CanvasImageSource,
      0,
      0,
      gCanvas.canvas.width,
      gCanvas.canvas.height,
      dx,
      dy,
      dw,
      dh,
    );
    silhouetteCtx.restore();

    const backdropCtx = backdrop.ctx;
    backdropCtx.save();
    backdropCtx.setTransform(1, 0, 0, 1, 0, 0);
    backdropCtx.globalCompositeOperation = 'destination-in';
    backdropCtx.drawImage(silhouette.canvas as CanvasImageSource, 0, 0);
    backdropCtx.restore();

    target.save();
    target.setTransform(1, 0, 0, 1, 0, 0);
    target.globalAlpha = groupOpacity;
    target.globalCompositeOperation = 'source-over';
    target.drawImage(
      backdrop.canvas as CanvasImageSource,
      0,
      0,
      capW,
      capH,
      capX,
      capY,
      capW,
      capH,
    );
    target.restore();
  } catch {
    // Backdrop effects are optional preview stages. A refused allocation
    // leaves the original target intact; group content is still painted.
  }
}
