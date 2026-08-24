/**
 * Mockup IR decoration — composes the render items that draw a mockup frame.
 *
 * A mockup frame's IR item is a plain rect (the frame's own paint). The
 * decoration step appends the template's plate shapes, per-surface content
 * (baked surface rasters as image-fill or `warpedImage` items), shadows,
 * and glows directly after the frame item in the IR list. Because surfaces
 * ride ordinary IR, the worker path, the live structural path, and the
 * export compositor all render them identically.
 *
 * Surface baking: a live source subtree is replayed (via an injected
 * structural replay callback) onto an offscreen surface at the slot
 * resolution, fitted with contain/cover/stretch/native + alignment, and
 * cached by (frame, surface, source digest, quality bucket). Perspective
 * surfaces additionally bake the slot-local device plate so body and screen
 * warp together; the resulting raster maps onto the expanded quad through
 * the engine's `warpedImage` primitive.
 *
 * Diagnostics counters are cheap and intentionally global (not per-frame
 * objects) to avoid allocation churn on the render path.
 */

import { type Affine, fitRect, getImageCache, type RenderItem } from '@varve/engine';
import {
  computeMockupSourceDigest,
  type Document,
  type FrameNode,
  getMockupTemplate,
  isMockupFrame,
  type MockupFitMode,
  type MockupInstanceData,
  type MockupSurfaceDefinition,
  type MockupSurfaceOverride,
  type MockupTemplateAsset,
  type MockupVec2,
  type NodeId,
  nodeWorldBounds,
} from '@varve/scene';

export interface MockupRenderDiagnostics {
  surfaceCacheHits: number;
  surfaceCacheMisses: number;
  surfacesBaked: number;
  flatSurfaces: number;
  quadSurfaces: number;
  placeholders: number;
  residentSurfaceBytes: number;
}

const diag: MockupRenderDiagnostics = {
  surfaceCacheHits: 0,
  surfaceCacheMisses: 0,
  surfacesBaked: 0,
  flatSurfaces: 0,
  quadSurfaces: 0,
  placeholders: 0,
  residentSurfaceBytes: 0,
};

export function getMockupRenderDiagnostics(): MockupRenderDiagnostics {
  return { ...diag };
}

export function resetMockupRenderDiagnostics(): void {
  diag.surfaceCacheHits = 0;
  diag.surfaceCacheMisses = 0;
  diag.surfacesBaked = 0;
  diag.flatSurfaces = 0;
  diag.quadSurfaces = 0;
  diag.placeholders = 0;
  diag.residentSurfaceBytes = 0;
}

/** LRU surface-raster cache keyed by frame|surface|digest|bucket. */
export class MockupSurfaceCache {
  private entries = new Map<string, { dataUrl: string; bytes: number }>();
  private budgetBytes: number;

  constructor(budgetBytes = 32 * 1024 * 1024) {
    this.budgetBytes = budgetBytes;
  }

  get(key: string): string | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    // LRU touch.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.dataUrl;
  }

  set(key: string, dataUrl: string): void {
    const bytes = dataUrl.length;
    this.entries.delete(key);
    this.entries.set(key, { dataUrl, bytes });
    diag.residentSurfaceBytes += bytes;
    this.evictForBudget();
  }

  private evictForBudget(): void {
    let total = 0;
    for (const [, entry] of this.entries) total += entry.bytes;
    while (total > this.budgetBytes && this.entries.size > 0) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      const entry = this.entries.get(oldest);
      this.entries.delete(oldest);
      if (entry) {
        total -= entry.bytes;
        diag.residentSurfaceBytes -= entry.bytes;
      }
    }
  }

  clear(): void {
    this.entries.clear();
    diag.residentSurfaceBytes = 0;
  }

  get size(): number {
    return this.entries.size;
  }

  /** Encoded surfaces currently retained by the cache. */
  sources(): readonly string[] {
    return [...this.entries.values()].map((entry) => entry.dataUrl);
  }
}

export interface MockupDecorateInput {
  doc: Document;
  nodeIds: readonly NodeId[];
  items: RenderItem[];
  /** Structural replay of a subtree at the current ctx transform. */
  renderSubtree(ctx: CanvasRenderingContext2D, nodeId: NodeId): void;
  /** Surface raster quality bucket scale (preview ~0.5, export scale). */
  qualityScale: number;
  cache: MockupSurfaceCache;
  /**
   * Insert extras into the items list right after each frame's item (worker
   * and live-canvas hosts). When false, extras are only returned in
   * `extrasByNodeId` (export host replays them through the extras map so the
   * flattenedIds <-> items alignment stays intact).
   */
  insertIntoList?: boolean;
}

export interface MockupDecorateResult {
  /** frameId -> extra items painted right after the frame's own item. */
  extrasByNodeId: Map<NodeId, RenderItem[]>;
}

const MAX_SURFACE_PX = 4096;

/**
 * Decorate the IR list in place: mockup frames get their composed items
 * inserted immediately after their own item. Returns the extras per frame
 * so hosts can paint them in the structural path too.
 */
export function decorateMockupIr(input: MockupDecorateInput): MockupDecorateResult {
  const { doc, nodeIds, items, renderSubtree, qualityScale, cache, insertIntoList = true } = input;
  const extrasByNodeId = new Map<NodeId, RenderItem[]>();

  for (let i = 0; i < nodeIds.length; i++) {
    const nodeId = nodeIds[i]!;
    const node = doc.nodes[nodeId];
    if (!node || !isMockupFrame(node)) continue;
    const frameItem = items[i];
    if (!frameItem) continue;

    const template = getMockupTemplate(doc, node.mockup.templateId);
    if (!template) {
      // Missing template: deterministic placeholder over the frame bounds.
      const extras = [placeholderItem(frameItem, node.w, node.h, 'Template missing')];
      extrasByNodeId.set(nodeId, extras);
      spliceAfter(items, i, extras);
      diag.placeholders++;
      continue;
    }

    const scaleX = node.w / template.outputWidth;
    const scaleY = node.h / template.outputHeight;
    const extras = buildTemplateItems({
      doc,
      frameItem,
      node,
      template,
      scaleX,
      scaleY,
      renderSubtree,
      qualityScale,
      cache,
    });
    if (extras.length > 0) {
      extrasByNodeId.set(nodeId, extras);
      if (insertIntoList) spliceAfter(items, i, extras);
    }
  }
  return { extrasByNodeId };
}

function spliceAfter(items: RenderItem[], index: number, extras: RenderItem[]): void {
  items.splice(index + 1, 0, ...extras);
}

function placeholderItem(frameItem: RenderItem, w: number, h: number, _label: string): RenderItem {
  return {
    ...frameItem,
    primitive: { kind: 'rect', x: 0, y: 0, w, h },
    fill: { space: 'rgb', r: 232, g: 234, b: 237, a: 255 },
    fills: [],
    effects: [],
    strokes: [
      {
        color: { space: 'rgb', r: 184, g: 188, b: 194, a: 255 },
        weight: 2,
        align: 'center',
        dashPattern: [6, 4],
        dashOffset: 0,
        cap: 'round',
        join: 'round',
        miterLimit: 4,
        visible: true,
      },
    ],
  };
}

interface BuildTemplateItemsParams {
  doc: Document;
  frameItem: RenderItem;
  node: FrameNode & { mockup: MockupInstanceData };
  template: MockupTemplateAsset;
  scaleX: number;
  scaleY: number;
  renderSubtree(ctx: CanvasRenderingContext2D, nodeId: NodeId): void;
  qualityScale: number;
  cache: MockupSurfaceCache;
}

function buildTemplateItems(params: BuildTemplateItemsParams): RenderItem[] {
  const { doc, frameItem, node, template, scaleX, scaleY, renderSubtree, qualityScale, cache } =
    params;
  const items: RenderItem[] = [];

  // Template background plate (output-absolute shapes).
  for (const shape of template.plate) {
    const item = shapeItem(
      frameItem,
      shape.x * scaleX,
      shape.y * scaleY,
      shape.width * scaleX,
      shape.height * scaleY,
      shape,
    );
    if (item) items.push(item);
  }

  for (const surface of template.surfaces) {
    const override = node.mockup.overrides?.[surface.id];
    const effective = effectiveSurface(surface, override);
    const binding = node.mockup.surfaceBindings[surface.id];

    // Surface shadow (blurred dark rect behind the slot).
    const shadowItem = buildShadowItem(frameItem, effective, scaleX, scaleY, effective.shadow);
    if (shadowItem) items.push(shadowItem);

    const raster = bakeSurface({
      doc,
      node,
      surface: effective,
      binding,
      scaleX,
      scaleY,
      renderSubtree,
      qualityScale,
      cache,
    });

    if (!raster) {
      // Missing source: placeholder within the slot.
      items.push(
        placeholderItem(
          frameItem,
          effective.width * scaleX,
          effective.height * scaleY,
          'Source missing',
        ),
      );
      diag.placeholders++;
      continue;
    }

    if (effective.kind === 'quad') {
      diag.quadSurfaces++;
      items.push(buildWarpedItem(frameItem, effective, raster, scaleX, scaleY));
    } else {
      diag.flatSurfaces++;
      // Flat surfaces: the plate is output-absolute chrome — emit as IR
      // shape items so it stays vector-crisp; the content raster is the
      // fitted source only.
      for (const shape of surface.plate ?? []) {
        const item = shapeItem(
          frameItem,
          shape.x * scaleX,
          shape.y * scaleY,
          shape.width * scaleX,
          shape.height * scaleY,
          shape,
        );
        if (item) items.push(item);
      }
      items.push(buildFlatImageItem(frameItem, effective, raster, scaleX, scaleY));
    }

    if (override?.screenGlow ?? surface.screenGlow) {
      items.push(glowItem(frameItem, effective, scaleX, scaleY));
    }
  }

  // Template overlays (output-absolute shapes).
  for (const overlay of template.overlays) {
    for (const shape of overlay.shapes) {
      const item = shapeItem(
        frameItem,
        shape.x * scaleX,
        shape.y * scaleY,
        shape.width * scaleX,
        shape.height * scaleY,
        shape,
      );
      if (item) {
        items.push({ ...item, opacity: (item.opacity ?? 1) * overlay.opacity });
      }
    }
  }
  return items;
}

/** Merge template surface definition with the instance override. */
export function effectiveSurface(
  surface: MockupSurfaceDefinition,
  override: MockupSurfaceOverride | undefined,
): MockupSurfaceDefinition {
  if (!override) return surface;
  return {
    ...surface,
    x: override.x ?? surface.x,
    y: override.y ?? surface.y,
    width: override.width ?? surface.width,
    height: override.height ?? surface.height,
    quad: override.quad ?? surface.quad,
    fit: override.fit ?? surface.fit,
    alignment: override.alignment ?? surface.alignment,
    shadow: override.shadow === null ? undefined : (override.shadow ?? surface.shadow),
    screenGlow: override.screenGlow ?? surface.screenGlow,
  };
}

function shapeItem(
  frameItem: RenderItem,
  x: number,
  y: number,
  width: number,
  height: number,
  shape: {
    kind: 'rect' | 'ellipse';
    fill: string;
    opacity?: number;
    rx?: number;
    rotation?: number;
  },
): RenderItem | null {
  const fill = parseCssColor(shape.fill);
  if (!fill) return null;
  if (shape.kind === 'rect') {
    return {
      ...frameItem,
      primitive: {
        kind: 'rect',
        x,
        y,
        w: width,
        h: height,
        ...(shape.rx ? { cornerRadius: shape.rx } : {}),
      },
      fill,
      fills: [],
      effects: [],
      opacity: shape.opacity ?? 1,
      strokes: [],
    };
  }
  return {
    ...frameItem,
    primitive: {
      kind: 'ellipse',
      cx: x + width / 2,
      cy: y + height / 2,
      rx: width / 2,
      ry: height / 2,
    },
    fill,
    fills: [],
    effects: [],
    opacity: shape.opacity ?? 1,
    strokes: [],
  };
}

/** Parse '#rgb' | '#rrggbb' | '#rrggbbaa' into an sRGB EngineColor; null otherwise. */
export function parseCssColor(
  color: string,
): { space: 'rgb'; r: number; g: number; b: number; a: number } | null {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(color);
  if (hex) {
    let c = hex[1]!;
    if (c.length === 3 || c.length === 4) {
      c = c
        .split('')
        .map((ch) => ch + ch)
        .join('');
    }
    const r = parseInt(c.slice(0, 2), 16);
    const g = parseInt(c.slice(2, 4), 16);
    const b = parseInt(c.slice(4, 6), 16);
    const a = c.length === 8 ? parseInt(c.slice(6, 8), 16) : 255;
    return { space: 'rgb', r, g, b, a };
  }
  return null;
}

function buildShadowItem(
  frameItem: RenderItem,
  surface: MockupSurfaceDefinition,
  scaleX: number,
  scaleY: number,
  shadow: { blur: number; offsetY: number; opacity: number } | undefined,
): RenderItem | null {
  if (!shadow || shadow.blur <= 0 || shadow.opacity <= 0) return null;
  const pad = shadow.blur * 0.6;
  const x = (surface.x - pad) * scaleX;
  const y = (surface.y - pad + shadow.offsetY) * scaleY;
  const w = (surface.width + pad * 2) * scaleX;
  const h = (surface.height + pad * 2) * scaleY;
  const a = Math.round(255 * Math.min(1, shadow.opacity));
  return {
    ...frameItem,
    primitive: { kind: 'rect', x, y, w, h },
    fill: { space: 'rgb', r: 0, g: 0, b: 0, a },
    fills: [],
    effects: [
      {
        type: 'layerBlur',
        radius: Math.max(1, shadow.blur * Math.min(scaleX, scaleY)),
        visible: true,
      },
    ],
    strokes: [],
    opacity: 1,
  };
}

function glowItem(
  frameItem: RenderItem,
  surface: MockupSurfaceDefinition,
  scaleX: number,
  scaleY: number,
): RenderItem {
  return {
    ...frameItem,
    primitive: {
      kind: 'rect',
      x: surface.x * scaleX,
      y: surface.y * scaleY,
      w: surface.width * scaleX,
      h: surface.height * scaleY,
    },
    fill: { space: 'rgb', r: 255, g: 255, b: 255, a: 18 },
    fills: [],
    effects: [],
    strokes: [],
    opacity: 1,
  };
}

function buildFlatImageItem(
  frameItem: RenderItem,
  surface: MockupSurfaceDefinition,
  raster: string,
  scaleX: number,
  scaleY: number,
): RenderItem {
  return {
    ...frameItem,
    primitive: {
      kind: 'rect',
      x: surface.x * scaleX,
      y: surface.y * scaleY,
      w: surface.width * scaleX,
      h: surface.height * scaleY,
    },
    fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 0 },
    fills: [
      {
        type: 'image',
        src: raster,
        fit: 'stretch',
        x: 0,
        y: 0,
        scale: 1,
        imageWidth: surface.width * scaleX,
        imageHeight: surface.height * scaleY,
        opacity: 1,
        blendMode: 'normal',
        visible: true,
      },
    ],
    effects: [],
    strokes: [],
    opacity: 1,
  };
}

/** Expand a slot quad about its centroid by the plate padding ratio. */
export function expandQuadForPadding(
  quad: [MockupVec2, MockupVec2, MockupVec2, MockupVec2],
  slotW: number,
  slotH: number,
  padX: number,
  padY: number,
): [MockupVec2, MockupVec2, MockupVec2, MockupVec2] {
  const cx = (quad[0].x + quad[1].x + quad[2].x + quad[3].x) / 4;
  const cy = (quad[0].y + quad[1].y + quad[2].y + quad[3].y) / 4;
  const sx = slotW > 0 ? (slotW + padX * 2) / slotW : 1;
  const sy = slotH > 0 ? (slotH + padY * 2) / slotH : 1;
  return quad.map((p) => ({ x: cx + (p.x - cx) * sx, y: cy + (p.y - cy) * sy })) as [
    MockupVec2,
    MockupVec2,
    MockupVec2,
    MockupVec2,
  ];
}

function buildWarpedItem(
  frameItem: RenderItem,
  surface: MockupSurfaceDefinition,
  raster: string,
  scaleX: number,
  scaleY: number,
): RenderItem {
  const quad = surface.quad!;
  const pad = surface.platePadding ?? { x: 0, y: 0 };
  const expanded = expandQuadForPadding(quad, surface.width, surface.height, pad.x, pad.y);
  const scaledQuad = expanded.map((p) => [p.x * scaleX, p.y * scaleY] as [number, number]) as [
    [number, number],
    [number, number],
    [number, number],
    [number, number],
  ];
  return {
    ...frameItem,
    primitive: {
      kind: 'warpedImage',
      src: raster,
      sourceW: Math.max(1, Math.round((surface.width + pad.x * 2) * scaleX)),
      sourceH: Math.max(1, Math.round((surface.height + pad.y * 2) * scaleY)),
      fit: 'stretch',
      alignX: 'center',
      alignY: 'center',
      quad: scaledQuad,
    },
    fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 0 },
    fills: [],
    effects: [],
    strokes: [],
    opacity: 1,
  };
}

interface BakeSurfaceParams {
  doc: Document;
  node: FrameNode & { mockup: MockupInstanceData };
  surface: MockupSurfaceDefinition;
  binding:
    | {
        mode: string;
        nodeId?: NodeId;
        assetId?: string;
        capturedWidth?: number;
        capturedHeight?: number;
      }
    | undefined;
  scaleX: number;
  scaleY: number;
  renderSubtree(ctx: CanvasRenderingContext2D, nodeId: NodeId): void;
  qualityScale: number;
  cache: MockupSurfaceCache;
}

const EMPTY_FIT: MockupFitMode = 'contain';

function bakeSurface(params: BakeSurfaceParams): string | null {
  const { doc, node, surface, binding, scaleX, scaleY, renderSubtree, qualityScale, cache } =
    params;
  if (!binding) return null;

  const slotW = surface.width * scaleX;
  const slotH = surface.height * scaleY;
  const pad = surface.kind === 'quad' ? (surface.platePadding ?? { x: 0, y: 0 }) : { x: 0, y: 0 };
  const regionW = slotW + pad.x * 2 * scaleX;
  const regionH = slotH + pad.y * 2 * scaleY;

  // Quality bucket: cap the long edge for interactive preview.
  const longEdge = Math.max(regionW, regionH);
  const bucketScale = Math.min(qualityScale, longEdge > 0 ? 512 / longEdge : 1, 1);
  const outW = Math.max(1, Math.min(MAX_SURFACE_PX, Math.round(regionW * bucketScale)));
  const outH = Math.max(1, Math.min(MAX_SURFACE_PX, Math.round(regionH * bucketScale)));
  const bucket =
    bucketScale === qualityScale ? String(qualityScale) : `capped-${bucketScale.toFixed(3)}`;

  let digest = '';
  if (binding.mode === 'live' && binding.nodeId) {
    if (!doc.nodes[binding.nodeId]) return null; // deleted source
    digest = computeMockupSourceDigest(doc, binding.nodeId);
  } else if (binding.mode === 'snapshot' && binding.assetId) {
    digest = `snapshot:${binding.assetId}`;
  } else {
    return null;
  }

  const cacheKey = `${node.id}|${surface.id}|${digest}|${bucket}|${surface.fit}|${surface.alignment.x}${surface.alignment.y}|${surface.kind}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    diag.surfaceCacheHits++;
    return cached;
  }
  diag.surfaceCacheMisses++;

  const surfaceCanvas = document.createElement('canvas');
  surfaceCanvas.width = outW;
  surfaceCanvas.height = outH;
  const ctx = surfaceCanvas.getContext('2d');
  if (!ctx) return null;

  // 1. Plate (slot-local for quad surfaces; drawn with the region offset).
  if (surface.kind === 'quad' && surface.plate) {
    for (const shape of surface.plate) {
      drawShape(
        ctx,
        shape,
        (shape.x + pad.x) * scaleX * bucketScale,
        (shape.y + pad.y) * scaleY * bucketScale,
        shape.width * scaleX * bucketScale,
        shape.height * scaleY * bucketScale,
      );
    }
  }

  // 2. Source content fitted into the slot.
  if (binding.mode === 'live' && binding.nodeId) {
    const sourceBounds = nodeWorldBounds(doc, binding.nodeId);
    if (sourceBounds && sourceBounds.w > 0 && sourceBounds.h > 0) {
      const sourceCanvas = document.createElement('canvas');
      sourceCanvas.width = Math.max(
        1,
        Math.min(MAX_SURFACE_PX, Math.round(sourceBounds.w * bucketScale)),
      );
      sourceCanvas.height = Math.max(
        1,
        Math.min(MAX_SURFACE_PX, Math.round(sourceBounds.h * bucketScale)),
      );
      const sourceCtx = sourceCanvas.getContext('2d');
      if (sourceCtx) {
        sourceCtx.setTransform(
          bucketScale,
          0,
          0,
          bucketScale,
          -sourceBounds.x * bucketScale,
          -sourceBounds.y * bucketScale,
        );
        renderSubtree(sourceCtx, binding.nodeId);
        const fit = fitRect(
          Math.max(1, sourceBounds.w),
          Math.max(1, sourceBounds.h),
          slotW,
          slotH,
          surface.fit ?? EMPTY_FIT,
          surface.alignment.x,
          surface.alignment.y,
        );
        if (fit) {
          drawImageFitted(
            ctx,
            sourceCanvas,
            fit,
            pad.x * scaleX * bucketScale,
            pad.y * scaleY * bucketScale,
            bucketScale,
          );
        }
      }
    }
  } else if (binding.mode === 'snapshot' && binding.assetId) {
    const asset = doc.assets?.[binding.assetId];
    if (asset) {
      const imageCache = getImageCache();
      const entry = imageCache.get(asset.dataUrl);
      if (entry?.state === 'loaded' && entry.image) {
        const fit = fitRect(
          Math.max(1, binding.capturedWidth ?? asset.naturalWidth),
          Math.max(1, binding.capturedHeight ?? asset.naturalHeight),
          slotW,
          slotH,
          surface.fit ?? EMPTY_FIT,
          surface.alignment.x,
          surface.alignment.y,
        );
        if (fit) {
          drawImageFitted(
            ctx,
            entry.image,
            fit,
            pad.x * scaleX * bucketScale,
            pad.y * scaleY * bucketScale,
            bucketScale,
          );
        }
      } else {
        if (!entry || entry.state === 'idle') {
          imageCache.load(asset.dataUrl).catch(() => undefined);
        }
        return null; // not loaded yet: placeholder this frame, reframe on load
      }
    } else {
      return null;
    }
  }

  let dataUrl: string;
  try {
    dataUrl = surfaceCanvas.toDataURL('image/png');
  } catch {
    return null;
  }
  cache.set(cacheKey, dataUrl);
  diag.surfacesBaked++;
  return dataUrl;
}

function drawImageFitted(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  fit: {
    dx: number;
    dy: number;
    dw: number;
    dh: number;
    sx: number;
    sy: number;
    sw: number;
    sh: number;
  },
  offsetX: number,
  offsetY: number,
  bucketScale: number,
): void {
  ctx.drawImage(
    image,
    fit.sx,
    fit.sy,
    fit.sw,
    fit.sh,
    fit.dx * bucketScale + offsetX,
    fit.dy * bucketScale + offsetY,
    fit.dw * bucketScale,
    fit.dh * bucketScale,
  );
}

function drawShape(
  ctx: CanvasRenderingContext2D,
  shape: {
    kind: 'rect' | 'ellipse';
    fill: string;
    opacity?: number;
    rx?: number;
    rotation?: number;
  },
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  const fill = parseCssColor(shape.fill);
  if (!fill) return;
  ctx.save();
  if (shape.opacity !== undefined) ctx.globalAlpha = shape.opacity;
  if (shape.rotation && shape.rotation !== 0) {
    ctx.translate(x + width / 2, y + height / 2);
    ctx.rotate((shape.rotation * Math.PI) / 180);
    ctx.translate(-(x + width / 2), -(y + height / 2));
  }
  ctx.fillStyle = `rgba(${fill.r}, ${fill.g}, ${fill.b}, ${fill.a / 255})`;
  if (shape.kind === 'rect') {
    const rx = shape.rx ?? 0;
    if (rx > 0 && 'roundRect' in ctx) {
      ctx.beginPath();
      (ctx as CanvasRenderingContext2D).roundRect(x, y, width, height, rx);
      ctx.fill();
    } else {
      ctx.fillRect(x, y, width, height);
    }
  } else {
    ctx.beginPath();
    ctx.ellipse(x + width / 2, y + height / 2, width / 2, height / 2, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** Apply a frame-local affine to a point (for overlay handle math). */
export function applyFrameTransform(
  t: Affine,
  p: { x: number; y: number },
): { x: number; y: number } {
  return {
    x: t[0] * p.x + t[2] * p.y + t[4],
    y: t[1] * p.x + t[3] * p.y + t[5],
  };
}
