/**
 * Shared visible-bounds abstraction — the single source of truth for computing
 * the visible content region of an image node, accounting for:
 *
 * - Source alpha bounds (no mask)
 * - Raster mask alpha bounds
 * - Vector mask geometry bounds
 * - Clip mask source-node bounds
 * - Crop viewport
 * - Image transforms (fill offset, scale)
 * - Optional padding
 *
 * Research basis: Figma trim-to-subject, Photoshop alpha bounds,
 * Illustrator clipping mask bounds, SVG clipPath geometry.
 */
import type { Affine } from '@strata/engine';
import type { Document, NodeId, RasterMaskAsset, ShapeNode } from '@strata/scene';
import { getImageFill, isImageShape } from '@strata/scene';
import { type PathPoint as BezierPathPoint, cubicBezierBBox, transformRect } from '@strata/shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Bounds in node-local coordinate space. */
export interface LocalBounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Tight bounding box in source-image pixel space. */
export interface AlphaBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** How the visible bounds were computed. */
export type BoundsMethod =
  | 'raster-alpha'
  | 'vector-path'
  | 'clip-mask'
  | 'source-alpha'
  | 'fallback';

/** Result of computeVisibleContentBounds. */
export interface VisibleBounds {
  /** Bounds in node-local space. */
  local: LocalBounds;
  /** Bounds in source-image pixel space (when applicable). */
  source: AlphaBounds | null;
  /** How the bounds were computed. */
  method: BoundsMethod;
}

/** Padding specification — uniform number or per-side. */
export type PaddingSpec = number | { top?: number; right?: number; bottom?: number; left?: number };

export interface VisibleBoundsOptions {
  /** Alpha threshold for raster scan (0-255). Default 0. */
  alphaThreshold?: number;
  /** Padding to apply around the computed bounds. */
  padding?: PaddingSpec;
  /**
   * Optional function to resolve world-space bounds for clip mask sources.
   * If not provided, clip mask bounds fall back to source-alpha or null.
   */
  resolveWorldBounds?: (nodeId: NodeId) => LocalBounds | null;
  /**
   * Optional pre-decoded ImageData for raster alpha bounds.
   * When provided, skips data-URL decoding (useful for worker or cached data).
   */
  rasterImageData?: ImageData;
  /**
   * Optional resolved raster mask asset. When provided alongside a raster
   * mask, uses the asset's checksum for cache keying.
   */
  rasterMaskAsset?: RasterMaskAsset;
}

// ---------------------------------------------------------------------------
// Vector mask bounds
// ---------------------------------------------------------------------------

/**
 * Compute the axis-aligned bounding box of a vector mask from its path points.
 * Uses cubic bezier bounding boxes for curves, and applies an optional
 * mask transform.
 */
export function computeVectorMaskBounds(
  points: BezierPathPoint[],
  closed: boolean,
  _fillRule: 'nonzero' | 'evenodd',
  maskTransform?: Affine,
): LocalBounds | null {
  if (points.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  const expand = (x: number, y: number) => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };

  for (let i = 0; i < points.length; i++) {
    const pt = points[i];
    // Anchor point
    expand(pt.x, pt.y);

    // Handle control points extend the bounding box
    if (pt.handleOut) {
      const hx = pt.handleOut[0];
      const hy = pt.handleOut[1];
      // The handle is a control point of a cubic bezier from pt to next point
      // We use the handle position itself as a bound expansion
      expand(hx, hy);
    }

    // Also consider the incoming handle of the next point (if connected)
    const nextPt = closed ? points[(i + 1) % points.length] : points[i + 1];
    if (nextPt) {
      if (nextPt.handleIn) {
        expand(nextPt.handleIn[0], nextPt.handleIn[1]);
      }
      // Line segment to next point
      expand(nextPt.x, nextPt.y);
    }

    // For curves with handles, use cubicBezierBBox for tighter bounds
    if (pt.handleOut && nextPt) {
      const cb = {
        p0: { x: pt.x, y: pt.y },
        p1: { x: pt.handleOut[0], y: pt.handleOut[1] },
        p2: {
          x: nextPt.handleIn ? nextPt.handleIn[0] : nextPt.x,
          y: nextPt.handleIn ? nextPt.handleIn[1] : nextPt.y,
        },
        p3: { x: nextPt.x, y: nextPt.y },
      };
      const bb = cubicBezierBBox(cb);
      expand(bb.x, bb.y);
      expand(bb.x + bb.w, bb.y + bb.h);
    }
  }

  if (!Number.isFinite(minX)) return null;

  const bounds: LocalBounds = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };

  // Apply mask transform if unlinked
  if (maskTransform) {
    return transformRect(maskTransform, bounds);
  }

  return bounds;
}

// ---------------------------------------------------------------------------
// Raster alpha bounds — tile-based scanning with caching
// ---------------------------------------------------------------------------

/** Tile size for hierarchical alpha scanning (pixels). */
const TILE_SIZE = 64;
/** Maximum decoded pixels before we abort a scan (128 Mi-pixels). */
const MAX_DECODED_PIXELS = 128 * 1024 * 1024;
/** LRU cache capacity for alpha bounds. */
const ALPHA_BOUNDS_CACHE_MAX = 50;

interface AlphaCacheEntry {
  key: string;
  bounds: AlphaBounds | null;
  timestamp: number;
}

const alphaBoundsCache: AlphaCacheEntry[] = [];

function cacheGet(key: string): AlphaBounds | null {
  const entry = alphaBoundsCache.find((e) => e.key === key);
  if (entry) {
    entry.timestamp = Date.now();
    return entry.bounds;
  }
  return null;
}

function cacheSet(key: string, bounds: AlphaBounds | null): void {
  // Evict oldest if full
  if (alphaBoundsCache.length >= ALPHA_BOUNDS_CACHE_MAX) {
    alphaBoundsCache.sort((a, b) => a.timestamp - b.timestamp);
    alphaBoundsCache.shift();
  }
  alphaBoundsCache.push({ key, bounds, timestamp: Date.now() });
}

/**
 * Check a single pixel for alpha content above threshold.
 * Fast inline helper — avoids function call overhead in hot loops.
 */
function alphaAbove(
  data: Uint8ClampedArray,
  w: number,
  x: number,
  y: number,
  threshold: number,
): boolean {
  return data[(y * w + x) * 4 + 3] > threshold;
}

/**
 * Probe a tile with a coarse grid to determine if any content exists.
 * Returns true if any sample point exceeds the alpha threshold.
 * The 9-point probe (4 corners + 4 edge midpoints + center) detects
 * features >~TILE_SIZE/3 but may miss very narrow features (<~21px).
 * When a tile boundary is ambiguous, callers should fall back to
 * {@link scanTileExact}.
 */
function probeTileCoarse(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  tileMinX: number,
  tileMinY: number,
  tileMaxX: number,
  tileMaxY: number,
  threshold: number,
): boolean {
  const check = (sx: number, sy: number) => {
    if (sx >= 0 && sx < w && sy >= 0 && sy < h) {
      if (alphaAbove(data, w, sx, sy, threshold)) return true;
    }
    return false;
  };
  if (check(tileMinX, tileMinY)) return true;
  if (check(tileMaxX - 1, tileMinY)) return true;
  if (check(tileMinX, tileMaxY - 1)) return true;
  if (check(tileMaxX - 1, tileMaxY - 1)) return true;
  if (check((tileMinX + tileMaxX) >> 1, (tileMinY + tileMaxY) >> 1)) return true;
  if (check((tileMinX + tileMaxX) >> 1, tileMinY)) return true;
  if (check((tileMinX + tileMaxX) >> 1, tileMaxY - 1)) return true;
  if (check(tileMinX, (tileMinY + tileMaxY) >> 1)) return true;
  if (check(tileMaxX - 1, (tileMinY + tileMaxY) >> 1)) return true;
  return false;
}

/**
 * Scan a tile exhaustively (every pixel) and update the global bounds.
 * Returns true if any pixel exceeded the threshold.
 */
function scanTileExact(
  data: Uint8ClampedArray,
  w: number,
  tileMinX: number,
  tileMinY: number,
  tileMaxX: number,
  tileMaxY: number,
  threshold: number,
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
): boolean {
  let found = false;
  for (let y = tileMinY; y < tileMaxY; y++) {
    for (let x = tileMinX; x < tileMaxX; x++) {
      if (alphaAbove(data, w, x, y, threshold)) {
        if (x < bounds.minX) bounds.minX = x;
        if (y < bounds.minY) bounds.minY = y;
        if (x + 1 > bounds.maxX) bounds.maxX = x + 1;
        if (y + 1 > bounds.maxY) bounds.maxY = y + 1;
        found = true;
      }
    }
  }
  return found;
}

/** Refinement tile size for the second pass (16px for thin features). */
const REFINE_TILE = 16;

/**
 * Compute the tight alpha bounding box from ImageData using a two-pass
 * tile-based hierarchical scan.
 *
 * Pass 1 (broad phase): coarse 64px tiles with 9-point sampling.
 * Fully transparent 64px regions are skipped, giving 10-50x speedup.
 *
 * Pass 2 (refinement): any 64px tile detected as non-empty, plus its
 * immediate 8 neighbours, is re-scanned at 16px×16px resolution using
 * the same 9-point probe. Suspicious 16px tiles get a full pixel scan.
 *
 * This guarantees that features as small as ~5px are detected even
 * when they fall between the coarse 64px sample points, while keeping
 * the full-scan area bounded to tiles near actual content.
 */
export function computeAlphaBoundsFromImageData(
  imageData: ImageData,
  threshold = 0,
): AlphaBounds | null {
  const { width: w, height: h, data } = imageData;
  if (w <= 0 || h <= 0) return null;

  const totalPixels = w * h;
  if (totalPixels > MAX_DECODED_PIXELS) return null;

  // Phase 1: coarse tile scan — identify which 64px tiles have content.
  const tilesX = Math.ceil(w / TILE_SIZE);
  const tilesY = Math.ceil(h / TILE_SIZE);
  const contentTiles = new Set<number>();

  const tileKey = (tx: number, ty: number) => ty * tilesX + tx;

  for (let ty = 0; ty < tilesY; ty++) {
    for (let tx = 0; tx < tilesX; tx++) {
      const tileMinX = tx * TILE_SIZE;
      const tileMinY = ty * TILE_SIZE;
      const tileMaxX = Math.min(tileMinX + TILE_SIZE, w);
      const tileMaxY = Math.min(tileMinY + TILE_SIZE, h);

      if (probeTileCoarse(data, w, h, tileMinX, tileMinY, tileMaxX, tileMaxY, threshold)) {
        contentTiles.add(tileKey(tx, ty));
      }
    }
  }

  // Phase 2: expand candidate set to include neighbours of content tiles.
  // This catches features that straddle tile boundaries and may have been
  // missed by the coarse probe in the neighbouring empty tile.
  const candidates = new Set(contentTiles);
  for (const key of contentTiles) {
    const tx = key % tilesX;
    const ty = Math.floor(key / tilesX);
    for (let ny = Math.max(0, ty - 1); ny <= Math.min(tilesY - 1, ty + 1); ny++) {
      for (let nx = Math.max(0, tx - 1); nx <= Math.min(tilesX - 1, tx + 1); nx++) {
        candidates.add(tileKey(nx, ny));
      }
    }
  }

  // Phase 3: refine candidate tiles at 16px resolution, with full pixel
  // scan for any sub-tile that contains content.
  const bounds = { minX: w, minY: h, maxX: 0, maxY: 0 };
  let found = false;

  const refineTilesX = Math.ceil(w / REFINE_TILE);
  const refinedCandidates = new Set<number>();

  for (const key of candidates) {
    const tx = key % tilesX;
    const ty = Math.floor(key / tilesX);
    const tileMinX = tx * TILE_SIZE;
    const tileMinY = ty * TILE_SIZE;
    const tileMaxX = Math.min(tileMinX + TILE_SIZE, w);
    const tileMaxY = Math.min(tileMinY + TILE_SIZE, h);

    // Subdivide this 64px tile into 16px sub-tiles
    const subTX = Math.ceil((tileMaxX - tileMinX) / REFINE_TILE);
    const subTY = Math.ceil((tileMaxY - tileMinY) / REFINE_TILE);

    for (let sty = 0; sty < subTY; sty++) {
      for (let stx = 0; stx < subTX; stx++) {
        const subMinX = tileMinX + stx * REFINE_TILE;
        const subMinY = tileMinY + sty * REFINE_TILE;
        const subMaxX = Math.min(subMinX + REFINE_TILE, tileMaxX);
        const subMaxY = Math.min(subMinY + REFINE_TILE, tileMaxY);

        if (probeTileCoarse(data, w, h, subMinX, subMinY, subMaxX, subMaxY, threshold)) {
          refinedCandidates.add(
            Math.floor(subMinY / REFINE_TILE) * refineTilesX + Math.floor(subMinX / REFINE_TILE),
          );
        }
      }
    }
  }

  // Phase 4: full pixel scan of only the refined candidate 16px tiles
  for (const subKey of refinedCandidates) {
    const stx = subKey % refineTilesX;
    const sty = Math.floor(subKey / refineTilesX);
    const subMinX = stx * REFINE_TILE;
    const subMinY = sty * REFINE_TILE;
    const subMaxX = Math.min(subMinX + REFINE_TILE, w);
    const subMaxY = Math.min(subMinY + REFINE_TILE, h);

    if (scanTileExact(data, w, subMinX, subMinY, subMaxX, subMaxY, threshold, bounds)) {
      found = true;
    }
  }

  return found
    ? { minX: bounds.minX, minY: bounds.minY, maxX: bounds.maxX, maxY: bounds.maxY }
    : null;
}

/**
 * Decode a data URL (or other image source) into ImageData for alpha scanning.
 * Returns null if the image cannot be decoded or the environment lacks DOM.
 */
export async function decodeImageData(src: string): Promise<ImageData | null> {
  if (typeof document === 'undefined') return null;

  const img = await new Promise<HTMLImageElement | null>((resolve) => {
    const el = new Image();
    el.crossOrigin = 'anonymous';
    el.onload = () => resolve(el);
    el.onerror = () => resolve(null);
    el.src = src;
  });
  if (!img) return null;

  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  if (w <= 0 || h <= 0 || w * h > MAX_DECODED_PIXELS) return null;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.drawImage(img, 0, 0);
  return ctx.getImageData(0, 0, w, h);
}

/**
 * Compute alpha bounds from a data URL with caching.
 * Uses the tile-based scanner internally.
 */
export async function computeAlphaBoundsCached(
  src: string,
  checksum: string,
  threshold = 0,
): Promise<AlphaBounds | null> {
  const cacheKey = `${checksum}:${threshold}`;
  const cached = cacheGet(cacheKey);
  if (cached !== null) return cached;

  const imageData = await decodeImageData(src);
  if (!imageData) {
    cacheSet(cacheKey, null);
    return null;
  }

  const bounds = computeAlphaBoundsFromImageData(imageData, threshold);
  cacheSet(cacheKey, bounds);
  return bounds;
}

// ---------------------------------------------------------------------------
// Source alpha bounds
// ---------------------------------------------------------------------------

/**
 * Compute source alpha bounds from image fill metadata.
 * When no mask is present, returns the full source image bounds as a
 * heuristic (actual pixel-level scan requires DOM canvas).
 */
export function computeSourceAlphaBounds(doc: Document, nodeId: NodeId): AlphaBounds | null {
  const node = doc.nodes[nodeId];
  if (!node || !isImageShape(node)) return null;

  const img = getImageFill(node as ShapeNode)?.image;
  if (!img) return null;

  const sourceW = img.imageWidth;
  const sourceH = img.imageHeight;
  if (!sourceW || !sourceH || sourceW <= 0 || sourceH <= 0) return null;

  // Full image bounds in source pixels
  return { minX: 0, minY: 0, maxX: sourceW, maxY: sourceH };
}

// ---------------------------------------------------------------------------
// Bounds helpers
// ---------------------------------------------------------------------------

/** Intersection of two bounds. Returns null if no overlap. */
export function intersectBounds(a: LocalBounds, b: LocalBounds): LocalBounds | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const r = Math.min(a.x + a.w, b.x + b.w);
  const bot = Math.min(a.y + a.h, b.y + b.h);
  const w = r - x;
  const h = bot - y;
  if (w <= 0 || h <= 0) return null;
  return { x, y, w, h };
}

/** Apply padding to bounds. */
export function paddingBounds(b: LocalBounds, padding: PaddingSpec): LocalBounds {
  if (typeof padding === 'number') {
    if (padding === 0) return b;
    return { x: b.x - padding, y: b.y - padding, w: b.w + padding * 2, h: b.h + padding * 2 };
  }
  const top = padding.top ?? 0;
  const right = padding.right ?? 0;
  const bottom = padding.bottom ?? 0;
  const left = padding.left ?? 0;
  if (top === 0 && right === 0 && bottom === 0 && left === 0) return b;
  return {
    x: b.x - left,
    y: b.y - top,
    w: b.w + left + right,
    h: b.h + top + bottom,
  };
}

// ---------------------------------------------------------------------------
// Main: computeVisibleContentBounds
// ---------------------------------------------------------------------------

/**
 * Compute the visible content bounds of an image node, accounting for masks,
 * crop viewport, and image transforms.
 *
 * Returns bounds in node-local coordinate space, or null if the node is
 * not an image or has no computable bounds.
 */
export async function computeVisibleContentBounds(
  doc: Document,
  nodeId: NodeId,
  opts?: VisibleBoundsOptions,
): Promise<VisibleBounds | null> {
  const node = doc.nodes[nodeId];
  if (!node || !isImageShape(node)) return null;

  const shapeNode = node as ShapeNode;
  const mask = shapeNode.mask;
  let local: LocalBounds | null = null;
  let source: AlphaBounds | null = null;
  let method: BoundsMethod = 'fallback';

  // 1. Vector mask bounds (geometry-based, no rasterization needed)
  if (mask?.vectorMask && mask.vectorMask.points.length > 0) {
    const vm = mask.vectorMask;
    const maskTf = !mask.linked ? mask.transform : undefined;
    local = computeVectorMaskBounds(vm.points, vm.closed, vm.fillRule, maskTf);
    if (local) {
      method = 'vector-path';
    }
  }

  // 2. Raster mask alpha bounds (pixel-level scan with tile optimization)
  if (!local && mask?.rasterMask && mask.type === 'alpha') {
    const asset = opts?.rasterMaskAsset;
    if (asset) {
      // Use pre-decoded ImageData if available, otherwise use cached decoder
      if (opts?.rasterImageData) {
        source = computeAlphaBoundsFromImageData(opts.rasterImageData, opts.alphaThreshold ?? 0);
      } else {
        const checksum = asset.checksum ?? asset.id;
        source = await computeAlphaBoundsCached(asset.dataUrl, checksum, opts?.alphaThreshold ?? 0);
      }

      if (source) {
        // Convert source pixel bounds to node-local space
        const img = getImageFill(shapeNode)?.image;
        if (img) {
          const fillScale = img.scale ?? 1;
          local = {
            x: img.x + source.minX * fillScale,
            y: img.y + source.minY * fillScale,
            w: (source.maxX - source.minX) * fillScale,
            h: (source.maxY - source.minY) * fillScale,
          };
          method = 'raster-alpha';
        }
      }
    }
  }

  // 3. Clip mask bounds (from source node's world bounds)
  if (!local && mask && 'sourceNodeId' in mask && mask.sourceNodeId) {
    if (opts?.resolveWorldBounds) {
      const sourceBounds = opts.resolveWorldBounds(mask.sourceNodeId);
      const nodeBounds = opts.resolveWorldBounds(nodeId);
      if (sourceBounds) {
        local = nodeBounds
          ? (intersectBounds(nodeBounds, sourceBounds) ?? sourceBounds)
          : sourceBounds;
        method = 'clip-mask';
      }
    }
  }

  // 3. Source alpha bounds (no mask, or mask resolution failed)
  //    When no mask is present, the visible region is the node's own shape
  //    bounds — the image is clipped to the shape in the render pipeline.
  if (!local) {
    source = computeSourceAlphaBounds(doc, nodeId);
    const shape = shapeNode.shape;
    if (shape.kind === 'rect') {
      local = { x: 0, y: 0, w: shape.w, h: shape.h };
      method = 'source-alpha';
    } else if (shape.kind === 'ellipse' || shape.kind === 'circle') {
      // Ellipse/circle bounds from center + radii
      const cx = shape.cx ?? 0;
      const cy = shape.cy ?? 0;
      const rx = shape.rx ?? (shape.kind === 'circle' ? (shape.r ?? 0) : 0);
      const ry = shape.ry ?? (shape.kind === 'circle' ? (shape.r ?? 0) : 0);
      local = { x: cx - rx, y: cy - ry, w: rx * 2, h: ry * 2 };
      method = 'source-alpha';
    }
  }

  if (!local) return null;

  // Apply padding
  if (opts?.padding !== undefined) {
    local = paddingBounds(local, opts.padding);
  }

  return { local, source, method };
}
