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

import {
  type Affine,
  fitRect,
  getImageCache,
  type RenderItem,
  warpImageToCylinder,
} from '@varve/engine';
import {
  computeMockupSourceDigest,
  type Document,
  type FrameNode,
  getMockupTemplate,
  isMockupFrame,
  type MockupFitMode,
  type MockupInstanceData,
  type MockupPlateImage,
  type MockupSurfaceDefinition,
  type MockupSurfaceOverride,
  type MockupTemplateAsset,
  type MockupVec2,
  type NodeId,
  nodeWorldBounds,
} from '@varve/scene';
import { multiplyAffine } from '@varve/shared';

export interface MockupRenderDiagnostics {
  surfaceCacheHits: number;
  surfaceCacheMisses: number;
  surfacesBaked: number;
  flatSurfaces: number;
  quadSurfaces: number;
  cylindricalSurfaces: number;
  placeholders: number;
  /** Preview frames that fell back to the last good raster for a lost source. */
  staleFallbacks: number;
  residentSurfaceBytes: number;
}

const diag: MockupRenderDiagnostics = {
  surfaceCacheHits: 0,
  surfaceCacheMisses: 0,
  surfacesBaked: 0,
  flatSurfaces: 0,
  quadSurfaces: 0,
  cylindricalSurfaces: 0,
  placeholders: 0,
  staleFallbacks: 0,
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
  diag.cylindricalSurfaces = 0;
  diag.placeholders = 0;
  diag.staleFallbacks = 0;
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

  /**
   * Most recently baked raster for a surface, regardless of source digest or
   * quality bucket. Used as a clearly-labelled recovery preview when a live
   * source disappears; never used for export (`allowStalePreview: false`).
   */
  getLatest(frameId: string, surfaceId: string): string | undefined {
    const prefix = `${frameId}|${surfaceId}|`;
    let matchKey: string | undefined;
    for (const key of this.entries.keys()) {
      if (key.startsWith(prefix)) matchKey = key;
    }
    if (!matchKey) return undefined;
    const entry = this.entries.get(matchKey);
    if (!entry) return undefined;
    this.entries.delete(matchKey);
    this.entries.set(matchKey, entry);
    return entry.dataUrl;
  }

  set(key: string, dataUrl: string): void {
    const bytes = dataUrl.length;
    const previous = this.entries.get(key);
    if (previous) diag.residentSurfaceBytes -= previous.bytes;
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

export interface MockupMissingSurface {
  frameId: NodeId;
  surfaceId: string;
  surfaceName: string;
  reason: 'no-binding' | 'source-missing' | 'asset-missing' | 'invalid-geometry';
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
  /**
   * When a live source or its snapshot is unavailable, draw the most recent
   * raster for that surface instead of the empty placeholder (live preview
   * recovery only). Export sets this to false so obsolete pixels can never
   * be presented as a current result.
   */
  allowStalePreview?: boolean;
}

export interface MockupDecorateResult {
  /** frameId -> extra items painted right after the frame's own item. */
  extrasByNodeId: Map<NodeId, RenderItem[]>;
  /** Surfaces that could not be rendered from current content. */
  missingSurfaces: MockupMissingSurface[];
}

const MAX_SURFACE_PX = 4096;

/**
 * Decorate the IR list in place: mockup frames get their composed items
 * inserted immediately after their own item. Returns the extras per frame
 * so hosts can paint them in the structural path too.
 */
export function decorateMockupIr(input: MockupDecorateInput): MockupDecorateResult {
  const {
    doc,
    nodeIds,
    items,
    renderSubtree,
    qualityScale,
    cache,
    insertIntoList = true,
    allowStalePreview = true,
  } = input;
  const extrasByNodeId = new Map<NodeId, RenderItem[]>();
  const missingSurfaces: MockupMissingSurface[] = [];
  // The decorator may insert extras into `items`; keep the original
  // node-to-item relationship so later frames cannot inherit an earlier
  // frame's plate/content RenderItem.
  const baseItems = items.slice();
  let insertedCount = 0;

  for (let i = 0; i < nodeIds.length; i++) {
    const nodeId = nodeIds[i]!;
    const node = doc.nodes[nodeId];
    if (!node || !isMockupFrame(node)) continue;
    const frameItem = baseItems[i];
    if (!frameItem) continue;

    const template = getMockupTemplate(doc, node.mockup.templateId);
    if (!template) {
      // Missing template: deterministic placeholder over the frame bounds.
      const extras = [placeholderItem(frameItem, node.w, node.h, 'Template missing')];
      extrasByNodeId.set(nodeId, extras);
      if (insertIntoList) {
        spliceAfter(items, i + insertedCount, extras);
        insertedCount += extras.length;
      }
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
      allowStalePreview,
      onMissing: (surfaceId, reason) => {
        const surface = template.surfaces.find((s) => s.id === surfaceId);
        missingSurfaces.push({
          frameId: nodeId,
          surfaceId,
          surfaceName: surface?.name ?? surfaceId,
          reason,
        });
      },
    });
    if (extras.length > 0) {
      extrasByNodeId.set(nodeId, extras);
      if (insertIntoList) {
        spliceAfter(items, i + insertedCount, extras);
        insertedCount += extras.length;
      }
    }
  }
  return { extrasByNodeId, missingSurfaces };
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
  allowStalePreview: boolean;
  onMissing(surfaceId: string, reason: MockupMissingSurface['reason']): void;
}

const OVERLAY_BLEND_MODES: Record<string, string> = {
  normal: 'normal',
  multiply: 'multiply',
  screen: 'screen',
  overlay: 'overlay',
  'soft-light': 'softLight',
  'hard-light': 'hardLight',
  'color-dodge': 'colorDodge',
  'color-burn': 'colorBurn',
  darken: 'darken',
  lighten: 'lighten',
  difference: 'difference',
  exclusion: 'exclusion',
};

function buildTemplateItems(params: BuildTemplateItemsParams): RenderItem[] {
  const {
    doc,
    frameItem,
    node,
    template,
    scaleX,
    scaleY,
    renderSubtree,
    qualityScale,
    cache,
    allowStalePreview,
    onMissing,
  } = params;
  const items: RenderItem[] = [];

  // Template background colour (explicit, parsed; unknown CSS colours are
  // skipped rather than guessed at).
  const backgroundFill = parseCssColor(template.backgroundColor);
  if (backgroundFill && backgroundFill.a > 0 && template.backgroundColor !== 'transparent') {
    items.push({
      ...frameItem,
      primitive: {
        kind: 'rect',
        x: 0,
        y: 0,
        w: template.outputWidth * scaleX,
        h: template.outputHeight * scaleY,
      },
      fill: backgroundFill,
      fills: [],
      effects: [],
      strokes: [],
      opacity: 1,
    });
  }

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

  // Photographic base plate: the untouched source photo drawn once beneath
  // every surface. Occlusion masks erase surface content so these pixels
  // show through where a foreground object must stay in front.
  if (template.plateImage) {
    const asset = doc.assets?.[template.plateImage.assetId];
    if (asset) {
      const item = plateImageItem(
        frameItem,
        template,
        template.plateImage,
        asset.dataUrl,
        scaleX,
        scaleY,
      );
      if (item) items.push(item);
    }
  }

  for (const surface of template.surfaces) {
    const override = node.mockup.overrides?.[surface.id];
    const effective = effectiveSurface(surface, override);
    const binding = node.mockup.surfaceBindings[surface.id];

    // Surface shadow (blurred dark rect behind the slot).
    const shadowItem = buildShadowItem(frameItem, effective, scaleX, scaleY, effective.shadow);
    if (shadowItem) items.push(shadowItem);

    // Flat and cylindrical plates are output-absolute chrome and remain
    // visible even while their source is missing or still decoding. Quad
    // plates are slot-local and are baked together with the projective warp.
    if (effective.kind !== 'quad') {
      for (const shape of effective.plate ?? []) {
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
    }

    const raster = bakeSurface({
      doc,
      node,
      surface: effective,
      override,
      binding,
      template,
      scaleX,
      scaleY,
      renderSubtree,
      qualityScale,
      cache,
      allowStalePreview,
      onMissing,
    });

    if (!raster) {
      // Missing source: placeholder within the slot. `onMissing` has already
      // recorded the explicit reason for hosts that warn (exports).
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
      if (effective.kind === 'cylindrical') diag.cylindricalSurfaces++;
      else diag.flatSurfaces++;
      // Flat and cylindrical content rasters are clipped to their slot; the
      // plate above remains vector-crisp and independent of source decoding.
      items.push(buildFlatImageItem(frameItem, effective, raster, scaleX, scaleY));
    }

    if (override?.screenGlow ?? surface.screenGlow) {
      items.push(glowItem(frameItem, effective, scaleX, scaleY));
    }
  }

  // Template overlays (output-absolute shapes). Blend modes are mapped to
  // engine names; unknown modes fall back to normal rather than dropping the
  // shape.
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
      if (!item) continue;
      const blend = overlay.blendMode ? OVERLAY_BLEND_MODES[overlay.blendMode] : undefined;
      items.push({
        ...item,
        opacity: (item.opacity ?? 1) * overlay.opacity,
        ...(blend && blend !== 'normal' ? { blendMode: blend as RenderItem['blendMode'] } : {}),
      });
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
    cylindrical: override.cylindrical ?? surface.cylindrical,
    shadow: override.shadow === null ? undefined : (override.shadow ?? surface.shadow),
    screenGlow: override.screenGlow ?? surface.screenGlow,
  };
}

/** Artwork placement within a surface: rotation (degrees) and flips. */
export interface MockupSurfacePlacement {
  rotation: number;
  flipH: boolean;
  flipV: boolean;
}

export function surfacePlacement(
  override: MockupSurfaceOverride | undefined,
): MockupSurfacePlacement {
  return {
    rotation: override?.rotation ?? 0,
    flipH: override?.flipH ?? false,
    flipV: override?.flipV ?? false,
  };
}

function placementKey(placement: MockupSurfacePlacement): string {
  return `${placement.rotation}|${placement.flipH ? 1 : 0}${placement.flipV ? 1 : 0}`;
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
  const rotation = shape.rotation ?? 0;
  const transform =
    rotation === 0
      ? frameItem.transform
      : multiplyAffine(frameItem.transform, rotationAroundCenter(x, y, width, height, rotation));
  if (shape.kind === 'rect') {
    return {
      ...frameItem,
      transform,
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
    transform,
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

function rotationAroundCenter(
  x: number,
  y: number,
  width: number,
  height: number,
  degrees: number,
): [number, number, number, number, number, number] {
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const cx = x + width / 2;
  const cy = y + height / 2;
  return [cos, sin, -sin, cos, cx - cos * cx + sin * cy, cy - sin * cx - cos * cy];
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
  shadow: { blur: number; offsetX?: number; offsetY: number; opacity: number } | undefined,
): RenderItem | null {
  if (!shadow || shadow.blur <= 0 || shadow.opacity <= 0) return null;
  const pad = shadow.blur * 0.6;
  const x = (surface.x - pad + (shadow.offsetX ?? 0)) * scaleX;
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

const PLATE_IMAGE_FITS: Record<MockupPlateImage['fit'], 'fill' | 'fit' | 'stretch'> = {
  cover: 'fill',
  contain: 'fit',
  stretch: 'stretch',
};

/** Photographic base plate drawn once under every surface. */
function plateImageItem(
  frameItem: RenderItem,
  template: MockupTemplateAsset,
  plate: MockupPlateImage,
  src: string,
  scaleX: number,
  scaleY: number,
): RenderItem | null {
  if (!src || plate.width <= 0 || plate.height <= 0) return null;
  return {
    ...frameItem,
    primitive: {
      kind: 'rect',
      x: 0,
      y: 0,
      w: template.outputWidth * scaleX,
      h: template.outputHeight * scaleY,
    },
    fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 0 },
    fills: [
      {
        type: 'image',
        src,
        fit: PLATE_IMAGE_FITS[plate.fit] ?? 'stretch',
        x: 0,
        y: 0,
        scale: 1,
        imageWidth: plate.width * scaleX,
        imageHeight: plate.height * scaleY,
        opacity: plate.opacity ?? 1,
        blendMode: 'normal',
        visible: true,
      },
    ],
    effects: [],
    strokes: [],
    opacity: 1,
  };
}

interface ResolvedSurfaceMask {
  kind: 'clip' | 'occlusion';
  src: string;
  invert: boolean;
  feather: number;
  placement?: { x: number; y: number; width: number; height: number };
}

/**
 * Resolve a surface's clip/occlusion coverage assets. Missing assets are
 * skipped (the validator/normalizer warn about them) rather than dropped
 * silently mid-composite. Only the `alpha` channel is implemented;
 * `luminance` is rejected by validation until a renderer path exists.
 */
function resolveSurfaceMasks(
  doc: Document,
  surface: MockupSurfaceDefinition,
): ResolvedSurfaceMask[] {
  const resolved: ResolvedSurfaceMask[] = [];
  const kinds: Array<{
    kind: ResolvedSurfaceMask['kind'];
    assetId: string | undefined;
    options: MockupSurfaceDefinition['maskOptions'];
    placement: MockupSurfaceDefinition['clipMaskPlacement'];
  }> = [
    {
      kind: 'clip',
      assetId: surface.clipMaskAssetId,
      options: surface.clipMaskOptions ?? surface.maskOptions,
      placement: surface.clipMaskPlacement,
    },
    {
      kind: 'occlusion',
      assetId: surface.occlusionMaskAssetId,
      options: surface.occlusionMaskOptions ?? surface.maskOptions,
      placement: surface.occlusionMaskPlacement,
    },
  ];
  for (const { kind, assetId, options = {}, placement } of kinds) {
    if (!assetId) continue;
    const asset = doc.assets?.[assetId];
    if (!asset) continue;
    resolved.push({
      kind,
      src: asset.dataUrl,
      invert: options.invert === true,
      feather: Math.max(0, options.feather ?? 0),
      placement,
    });
  }
  return resolved;
}

interface SurfaceMaskGeometry {
  template: MockupTemplateAsset;
  regionX: number;
  regionY: number;
  scaleX: number;
  scaleY: number;
  bucketScale: number;
}

/**
 * Apply clip/occlusion coverage to the content layer.
 * - clip keeps content where coverage exists (`destination-in`), or removes
 *   it when inverted (`destination-out`).
 * - occlusion removes content where foreground coverage exists
 *   (`destination-out`), or keeps only covered content when inverted.
 *
 * A mask that has not decoded yet is deferred: content stays unclipped for
 * this frame and the image-cache listener schedules a reframe. Coverage is
 * never interpreted as colour, so no ICC/gamma transform touches mask data.
 */
function applySurfaceMasks(
  ctx: CanvasRenderingContext2D,
  masks: readonly ResolvedSurfaceMask[],
  geometry: SurfaceMaskGeometry,
): void {
  const cache = getImageCache();
  for (const mask of masks) {
    const entry = cache.get(mask.src);
    if (entry?.state !== 'loaded' || !entry.image) {
      if (!entry || entry.state === 'idle') cache.load(mask.src).catch(() => undefined);
      continue;
    }
    const operation =
      mask.kind === 'clip'
        ? mask.invert
          ? 'destination-out'
          : 'destination-in'
        : mask.invert
          ? 'destination-in'
          : 'destination-out';
    const featherPx =
      mask.feather * Math.min(geometry.scaleX, geometry.scaleY) * geometry.bucketScale;
    ctx.save();
    ctx.globalCompositeOperation = operation;
    if (featherPx > 0.05) ctx.filter = `blur(${featherPx}px)`;
    const placement = mask.placement ?? {
      x: 0,
      y: 0,
      width: geometry.template.outputWidth,
      height: geometry.template.outputHeight,
    };
    ctx.drawImage(
      entry.image,
      (placement.x - geometry.regionX) * geometry.scaleX * geometry.bucketScale,
      (placement.y - geometry.regionY) * geometry.scaleY * geometry.bucketScale,
      placement.width * geometry.scaleX * geometry.bucketScale,
      placement.height * geometry.scaleY * geometry.bucketScale,
    );
    ctx.restore();
  }
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
  override: MockupSurfaceOverride | undefined;
  template: MockupTemplateAsset;
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
  allowStalePreview: boolean;
  onMissing(surfaceId: string, reason: MockupMissingSurface['reason']): void;
}

const EMPTY_FIT: MockupFitMode = 'contain';

function geometryKey(
  node: FrameNode,
  surface: MockupSurfaceDefinition,
  placement: MockupSurfacePlacement,
): string {
  const pad = surface.kind === 'quad' ? (surface.platePadding ?? { x: 0, y: 0 }) : { x: 0, y: 0 };
  const maskOptions = surface.maskOptions ?? {};
  return [
    `${node.w}x${node.h}`,
    `${surface.x},${surface.y},${surface.width},${surface.height}`,
    surface.quad ? surface.quad.map((p) => `${p.x},${p.y}`).join(';') : '',
    `${pad.x},${pad.y}`,
    surface.fit ?? EMPTY_FIT,
    `${surface.alignment.x}${surface.alignment.y}`,
    placementKey(placement),
    JSON.stringify(surface.cylindrical ?? null),
    surface.clipMaskAssetId ?? '',
    surface.occlusionMaskAssetId ?? '',
    JSON.stringify({
      shared: maskOptions,
      clip: surface.clipMaskOptions ?? null,
      occlusion: surface.occlusionMaskOptions ?? null,
      clipPlacement: surface.clipMaskPlacement ?? null,
      occlusionPlacement: surface.occlusionMaskPlacement ?? null,
    }),
  ].join('|');
}

function bakeSurface(params: BakeSurfaceParams): string | null {
  const {
    doc,
    node,
    surface,
    override,
    template,
    binding,
    scaleX,
    scaleY,
    renderSubtree,
    qualityScale,
    cache,
    allowStalePreview,
    onMissing,
  } = params;

  const placement = surfacePlacement(override);
  const stalePreview = (): string | null => {
    if (!allowStalePreview) return null;
    const latest = cache.getLatest(node.id, surface.id);
    if (latest) diag.staleFallbacks++;
    return latest ?? null;
  };

  if (!binding) {
    onMissing(surface.id, 'no-binding');
    return stalePreview();
  }

  const slotW = surface.width * scaleX;
  const slotH = surface.height * scaleY;
  const pad = surface.kind === 'quad' ? (surface.platePadding ?? { x: 0, y: 0 }) : { x: 0, y: 0 };
  const regionW = slotW + pad.x * 2 * scaleX;
  const regionH = slotH + pad.y * 2 * scaleY;

  // Quality bucket: preview caps the long edge at 512 px for interaction;
  // export scales above 1 bake at the requested output scale so the warp
  // samples real pixels instead of upscaling a frame-resolution raster.
  const longEdge = Math.max(regionW, regionH);
  const requestedBucketScale =
    qualityScale > 1 ? qualityScale : Math.min(qualityScale, longEdge > 0 ? 512 / longEdge : 1, 1);
  // Cap the common scale, rather than each axis independently. Independent
  // clamping changes the source footprint and visibly stretches large slots.
  const bucketScale = Math.min(
    requestedBucketScale,
    regionW > 0 ? MAX_SURFACE_PX / regionW : requestedBucketScale,
    regionH > 0 ? MAX_SURFACE_PX / regionH : requestedBucketScale,
  );
  const outW = Math.max(1, Math.round(regionW * bucketScale));
  const outH = Math.max(1, Math.round(regionH * bucketScale));
  const bucket =
    bucketScale === qualityScale ? String(qualityScale) : `capped-${bucketScale.toFixed(3)}`;

  let digest = '';
  let liveNodeId: NodeId | undefined;
  if (binding.mode === 'live' && binding.nodeId) {
    if (!doc.nodes[binding.nodeId]) {
      onMissing(surface.id, 'source-missing');
      return stalePreview();
    }
    liveNodeId = binding.nodeId;
    digest = computeMockupSourceDigest(doc, binding.nodeId);
  } else if (binding.mode === 'snapshot' && binding.assetId) {
    if (!doc.assets?.[binding.assetId]) {
      onMissing(surface.id, 'asset-missing');
      return stalePreview();
    }
    const snapshotAsset = doc.assets?.[binding.assetId];
    digest = `snapshot:${binding.assetId}:${snapshotAsset?.hash ?? snapshotAsset?.dataUrl ?? 'missing'}`;
  } else {
    onMissing(surface.id, 'no-binding');
    return stalePreview();
  }

  const cacheKey = [
    node.id,
    surface.id,
    digest,
    bucket,
    template.contentHash,
    surface.kind,
    geometryKey(node, surface, placement),
    JSON.stringify(
      [surface.clipMaskAssetId, surface.occlusionMaskAssetId].map((assetId) =>
        assetId ? [assetId, doc.assets?.[assetId]?.hash ?? doc.assets?.[assetId]?.dataUrl] : null,
      ),
    ),
    template.plateImage?.assetId
      ? `${template.plateImage.assetId}:${doc.assets?.[template.plateImage.assetId]?.hash ?? doc.assets?.[template.plateImage.assetId]?.dataUrl ?? 'missing'}`
      : '',
  ].join('|');
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

  // 2. Source content fitted into the slot. When clip/occlusion masks are
  // present the content is composed on its own layer so coverage is applied
  // exactly once (destination-in/destination-out, per the compositing
  // contract) before it meets the plate and chrome.
  const masks = resolveSurfaceMasks(doc, surface);
  let contentCtx: CanvasRenderingContext2D = ctx;
  let contentCanvas: HTMLCanvasElement | null = null;
  if (masks.length > 0) {
    contentCanvas = document.createElement('canvas');
    contentCanvas.width = outW;
    contentCanvas.height = outH;
    const created = contentCanvas.getContext('2d');
    if (created) contentCtx = created;
    else contentCanvas = null;
  }

  // `offsetX/Y` already places the slot inside a padded quad capture region;
  // the placement pivot is therefore relative to the slot, not the region.
  const centerX = (surface.width / 2) * scaleX;
  const centerY = (surface.height / 2) * scaleY;
  let sourceImage: CanvasImageSource | null = null;
  let sourceImageScale = 1;
  let sourceWidth = 0;
  let sourceHeight = 0;
  if (liveNodeId) {
    const sourceBounds = nodeWorldBounds(doc, liveNodeId);
    if (sourceBounds && sourceBounds.w > 0 && sourceBounds.h > 0) {
      const sourceCanvas = document.createElement('canvas');
      sourceImageScale = sourceCaptureScale(
        sourceBounds.w,
        sourceBounds.h,
        slotW,
        slotH,
        surface,
        bucketScale,
      );
      sourceCanvas.width = Math.max(1, Math.round(sourceBounds.w * sourceImageScale));
      sourceCanvas.height = Math.max(1, Math.round(sourceBounds.h * sourceImageScale));
      const sourceCtx = sourceCanvas.getContext('2d');
      if (sourceCtx) {
        sourceCtx.setTransform(
          sourceImageScale,
          0,
          0,
          sourceImageScale,
          -sourceBounds.x * sourceImageScale,
          -sourceBounds.y * sourceImageScale,
        );
        renderSubtree(sourceCtx, liveNodeId);
        sourceImage = sourceCanvas;
        sourceWidth = sourceBounds.w;
        sourceHeight = sourceBounds.h;
      } else {
        onMissing(surface.id, 'invalid-geometry');
        return stalePreview();
      }
    } else {
      onMissing(surface.id, 'source-missing');
      return stalePreview();
    }
  } else if (binding.mode === 'snapshot' && binding.assetId) {
    const asset = doc.assets?.[binding.assetId];
    if (asset) {
      const imageCache = getImageCache();
      const entry = imageCache.get(asset.dataUrl);
      if (entry?.state === 'loaded' && entry.image) {
        sourceImage = entry.image;
        sourceWidth = Math.max(1, binding.capturedWidth ?? asset.naturalWidth);
        sourceHeight = Math.max(1, binding.capturedHeight ?? asset.naturalHeight);
      } else {
        if (!entry || entry.state === 'idle') {
          imageCache.load(asset.dataUrl).catch(() => undefined);
        }
        return stalePreview(); // not loaded yet: placeholder this frame
      }
    } else {
      onMissing(surface.id, 'asset-missing');
      return stalePreview();
    }
  }

  if (sourceImage) {
    const fit = fitRect(
      sourceWidth,
      sourceHeight,
      slotW,
      slotH,
      surface.fit ?? EMPTY_FIT,
      surface.alignment.x,
      surface.alignment.y,
    );
    if (fit) {
      const offsetX = pad.x * scaleX * bucketScale;
      const offsetY = pad.y * scaleY * bucketScale;
      let rendered = true;
      if (surface.kind === 'cylindrical') {
        rendered = drawCylindricalInSlot(
          contentCtx,
          sourceImage,
          fit,
          outW,
          outH,
          offsetX,
          offsetY,
          bucketScale,
          centerX,
          centerY,
          placement,
          sourceImageScale,
          surface.cylindrical,
        );
      } else {
        drawFittedInSlot(
          contentCtx,
          sourceImage,
          fit,
          offsetX,
          offsetY,
          bucketScale,
          centerX,
          centerY,
          placement,
          sourceImageScale,
        );
      }
      if (!rendered) {
        onMissing(surface.id, 'invalid-geometry');
        return stalePreview();
      }
    }
  }

  if (contentCanvas) {
    applySurfaceMasks(contentCtx, masks, {
      template,
      regionX: surface.x - pad.x,
      regionY: surface.y - pad.y,
      scaleX,
      scaleY,
      bucketScale,
    });
    ctx.drawImage(contentCanvas, 0, 0);
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

/**
 * Capture vector/live sources at the projected output footprint. Capturing at
 * source bounds alone makes small text and linework soft when a production
 * surface is larger than the source node. The scale is capped by the same
 * per-surface texture bound used by the baked raster.
 */
function sourceCaptureScale(
  sourceWidth: number,
  sourceHeight: number,
  slotWidth: number,
  slotHeight: number,
  surface: MockupSurfaceDefinition,
  bucketScale: number,
): number {
  const fit = fitRect(
    sourceWidth,
    sourceHeight,
    slotWidth,
    slotHeight,
    surface.fit ?? EMPTY_FIT,
    surface.alignment.x,
    surface.alignment.y,
  );
  const footprintX = fit && fit.sw > 0 ? (fit.dw * bucketScale) / fit.sw : bucketScale;
  const footprintY = fit && fit.sh > 0 ? (fit.dh * bucketScale) / fit.sh : bucketScale;
  return Math.min(
    Math.max(bucketScale, footprintX, footprintY),
    sourceWidth > 0 ? MAX_SURFACE_PX / sourceWidth : bucketScale,
    sourceHeight > 0 ? MAX_SURFACE_PX / sourceHeight : bucketScale,
  );
}

/**
 * Draw a fitted source into a baked surface with the instance placement
 * (rotation about the slot centre, horizontal/vertical flips) applied to the
 * artwork only — surface geometry, plate and masks are unaffected.
 */
function drawFittedInSlot(
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
  centerX: number,
  centerY: number,
  placement: MockupSurfacePlacement,
  sourceScale: number,
): void {
  const needsPlacement = placement.rotation !== 0 || placement.flipH || placement.flipV;
  if (!needsPlacement) {
    drawImageFitted(ctx, image, fit, offsetX, offsetY, bucketScale, sourceScale);
    return;
  }
  const cx = offsetX + centerX * bucketScale;
  const cy = offsetY + centerY * bucketScale;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((placement.rotation * Math.PI) / 180);
  ctx.scale(placement.flipH ? -1 : 1, placement.flipV ? -1 : 1);
  ctx.translate(-cx, -cy);
  drawImageFitted(ctx, image, fit, offsetX, offsetY, bucketScale, sourceScale);
  ctx.restore();
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
  sourceScale: number,
): void {
  ctx.drawImage(
    image,
    fit.sx * sourceScale,
    fit.sy * sourceScale,
    fit.sw * sourceScale,
    fit.sh * sourceScale,
    fit.dx * bucketScale + offsetX,
    fit.dy * bucketScale + offsetY,
    fit.dw * bucketScale,
    fit.dh * bucketScale,
  );
}

/**
 * Render the fitted artwork into a temporary slot-sized raster, then apply
 * the destination-driven cylinder remap once. The temporary canvas is
 * released with the function scope, so drag updates never resample a prior
 * warped result.
 */
function drawCylindricalInSlot(
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
  outW: number,
  outH: number,
  offsetX: number,
  offsetY: number,
  bucketScale: number,
  centerX: number,
  centerY: number,
  placement: MockupSurfacePlacement,
  sourceScale: number,
  cylindrical: MockupSurfaceDefinition['cylindrical'],
): boolean {
  if (!cylindrical) return false;
  const fittedCanvas = document.createElement('canvas');
  fittedCanvas.width = outW;
  fittedCanvas.height = outH;
  const fittedCtx = fittedCanvas.getContext('2d');
  if (!fittedCtx) return false;
  drawFittedInSlot(
    fittedCtx,
    image,
    fit,
    offsetX,
    offsetY,
    bucketScale,
    centerX,
    centerY,
    placement,
    sourceScale,
  );
  let source: ImageData;
  try {
    source = fittedCtx.getImageData(0, 0, outW, outH);
  } catch {
    return false;
  }
  const warped = warpImageToCylinder(source.data, outW, outH, outW, outH, cylindrical);
  if (!warped) return false;
  ctx.putImageData(warped, 0, 0);
  return true;
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
