import type { DocumentGrid, GridViewportLines } from './gridTypes';

const MIN_SCREEN_PX_BETWEEN_LINES = 6;

/**
 * Resolve a CSS color string for use with Canvas2D.
 *
 * Canvas2D's strokeStyle/fillStyle parse `<color>` values but do NOT resolve
 * CSS custom properties — a raw `var(--color-border-subtle)` string is a parse
 * failure that is silently ignored (the context keeps its previous state),
 * which is why grid lines rendered in a stale/wrong color and never updated on
 * theme change. `var(--token)` references are resolved against `:root`'s
 * computed value; fallbacks (`var(--a, --b)`, `var(--a, red)`) are followed
 * recursively. Already-resolved colors are returned untouched.
 *
 * Resolved colors are cached per CSS property name. The cache is invalidated
 * when `clearResolvedColorCache()` is called (on theme switch).
 */
const resolvedColorCache = new Map<string, string>();

/** Clear the resolved-color cache. Call on theme switch. */
export function clearResolvedColorCache(): void {
  resolvedColorCache.clear();
}

// Register globally so context.tsx can call without importing (hub-file budget).
if (typeof window !== 'undefined') {
  (window as any).__clearResolvedColorCache = clearResolvedColorCache;
}

export function resolveCanvasColor(color: string): string {
  if (typeof color !== 'string' || !color.startsWith('var(')) return color;
  if (typeof document === 'undefined' || typeof getComputedStyle === 'undefined') {
    return color;
  }
  const root = document.documentElement;
  if (!root) return color;
  const match = color.match(/var\((--[^,)]+)(?:,\s*([^)]+))?\)/);
  if (!match?.[1]) return color;
  const prop = match[1].trim();
  const fallback = match[2]?.trim();

  // Check cache first (theme colors change only on theme switch)
  const cached = resolvedColorCache.get(prop);
  if (cached !== undefined) return cached;

  const value = getComputedStyle(root).getPropertyValue(prop).trim();
  if (value) {
    resolvedColorCache.set(prop, value);
    return value;
  }
  if (fallback) {
    // Fallback may be a color string, a bare --token, or another var().
    if (fallback.startsWith('--')) {
      const resolved = resolveCanvasColor(`var(${fallback})`);
      resolvedColorCache.set(prop, resolved);
      return resolved;
    }
    const resolved = resolveCanvasColor(fallback);
    resolvedColorCache.set(prop, resolved);
    return resolved;
  }
  resolvedColorCache.set(prop, color);
  return color;
}

/**
 * Compute a zoom-adaptive step multiplier so the effective screen-space
 * density stays bounded. At very low zoom the step increases, keeping the
 * number of drawn lines reasonable.
 */
function lodStep(zoom: number, spacing: number): number {
  const screenStep = spacing * zoom;
  if (screenStep >= MIN_SCREEN_PX_BETWEEN_LINES) return 1;
  return Math.max(1, Math.ceil(MIN_SCREEN_PX_BETWEEN_LINES / screenStep));
}

export type GridGeometry = Pick<
  DocumentGrid,
  'visible' | 'spacingX' | 'spacingY' | 'subdivisions' | 'offsetX' | 'offsetY'
>;

export function computeGridLines(
  grid: GridGeometry,
  zoom: number,
  panX: number,
  panY: number,
  viewportW: number,
  viewportH: number,
): GridViewportLines {
  const major: GridViewportLines['major'] = [];
  const minor: GridViewportLines['minor'] = [];
  const spacingX = grid.spacingX;
  const spacingY = grid.spacingY;
  const subdivisions = grid.subdivisions;
  const majorStepX = spacingX * subdivisions;
  const majorStepY = spacingY * subdivisions;
  const originWorldX = grid.offsetX;
  const originWorldY = grid.offsetY;

  const leftWorld = -panX / zoom;
  const rightWorld = (-panX + viewportW) / zoom;
  const topWorld = -panY / zoom;
  const bottomWorld = (-panY + viewportH) / zoom;
  const padding = Math.max(majorStepX, majorStepY) * 2;

  if (!grid.visible) return { major, minor };

  // Level-of-detail step scaling
  const minorLod = lodStep(zoom, spacingX);
  const majorLod = lodStep(zoom, majorStepX);
  const minorStep = spacingX * minorLod;
  const effectiveMajorStepX = majorStepX * majorLod;
  const effectiveMajorStepY = majorStepY * majorLod;

  // Minor horizontal lines
  if (minorLod <= subdivisions && subdivisions > 1 && minorStep > 0.5) {
    const minY =
      Math.floor((topWorld - originWorldY - padding) / minorStep) * minorStep + originWorldY;
    const maxY =
      Math.ceil((bottomWorld - originWorldY + padding) / minorStep) * minorStep + originWorldY;
    for (let wy = minY; wy <= maxY; wy += minorStep) {
      const isMajor = Math.abs((wy - originWorldY) % effectiveMajorStepY) < 0.001;
      if (!isMajor) {
        const sx = (leftWorld - padding) * zoom + panX;
        const sy = wy * zoom + panY;
        const ex = (rightWorld + padding) * zoom + panX;
        const ey = wy * zoom + panY;
        minor.push({ x1: sx, y1: sy, x2: ex, y2: ey });
      }
    }
  }

  // Minor vertical lines
  if (minorLod <= subdivisions && subdivisions > 1 && minorStep > 0.5) {
    const minX =
      Math.floor((leftWorld - originWorldX - padding) / minorStep) * minorStep + originWorldX;
    const maxX =
      Math.ceil((rightWorld - originWorldX + padding) / minorStep) * minorStep + originWorldX;
    for (let wx = minX; wx <= maxX; wx += minorStep) {
      const isMajor = Math.abs((wx - originWorldX) % effectiveMajorStepX) < 0.001;
      if (!isMajor) {
        const sx = wx * zoom + panX;
        const sy = (topWorld - padding) * zoom + panY;
        const ex = wx * zoom + panX;
        const ey = (bottomWorld + padding) * zoom + panY;
        minor.push({ x1: sx, y1: sy, x2: ex, y2: ey });
      }
    }
  }

  // Major horizontal lines
  if (effectiveMajorStepY > 0.5) {
    const minY =
      Math.floor((topWorld - originWorldY - padding) / effectiveMajorStepY) * effectiveMajorStepY +
      originWorldY;
    const maxY =
      Math.ceil((bottomWorld - originWorldY + padding) / effectiveMajorStepY) *
        effectiveMajorStepY +
      originWorldY;
    for (let wy = minY; wy <= maxY; wy += effectiveMajorStepY) {
      const sx = (leftWorld - padding) * zoom + panX;
      const sy = wy * zoom + panY;
      const ex = (rightWorld + padding) * zoom + panX;
      const ey = wy * zoom + panY;
      major.push({ x1: sx, y1: sy, x2: ex, y2: ey });
    }
  }

  // Major vertical lines
  if (effectiveMajorStepX > 0.5) {
    const minX =
      Math.floor((leftWorld - originWorldX - padding) / effectiveMajorStepX) * effectiveMajorStepX +
      originWorldX;
    const maxX =
      Math.ceil((rightWorld - originWorldX + padding) / effectiveMajorStepX) * effectiveMajorStepX +
      originWorldX;
    for (let wx = minX; wx <= maxX; wx += effectiveMajorStepX) {
      const sx = wx * zoom + panX;
      const sy = (topWorld - padding) * zoom + panY;
      const ex = wx * zoom + panX;
      const ey = (bottomWorld + padding) * zoom + panY;
      major.push({ x1: sx, y1: sy, x2: ex, y2: ey });
    }
  }

  return { major, minor };
}

export function renderGridOnCtx(
  ctx: CanvasRenderingContext2D,
  lines: GridViewportLines,
  dpr: number,
  majorColor: string,
  minorColor: string,
  majorOpacity: number,
  minorOpacity: number,
  rotation: number = 0,
  originX: number = 0,
  originY: number = 0,
): void {
  const mw = 1;
  const mw2 = 0.5;

  ctx.save();
  ctx.scale(dpr, dpr);

  // Apply rotation around origin point
  if (rotation !== 0) {
    ctx.translate(originX, originY);
    ctx.rotate(rotation);
    ctx.translate(-originX, -originY);
  }

  if (lines.minor.length > 0) {
    ctx.strokeStyle = resolveCanvasColor(minorColor);
    ctx.globalAlpha = minorOpacity;
    ctx.lineWidth = mw2;
    ctx.beginPath();
    for (const l of lines.minor) {
      ctx.moveTo(l.x1, l.y1);
      ctx.lineTo(l.x2, l.y2);
    }
    ctx.stroke();
  }

  if (lines.major.length > 0) {
    ctx.strokeStyle = resolveCanvasColor(majorColor);
    ctx.globalAlpha = majorOpacity;
    ctx.lineWidth = mw;
    ctx.beginPath();
    for (const l of lines.major) {
      ctx.moveTo(l.x1, l.y1);
      ctx.lineTo(l.x2, l.y2);
    }
    ctx.stroke();
  }

  ctx.restore();
}
