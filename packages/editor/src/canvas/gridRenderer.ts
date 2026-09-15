import { screenToWorld, worldToScreen } from '@varve/shared';
import type { DocumentGrid, GridViewportLines } from './gridTypes';

const MIN_SCREEN_PX_BETWEEN_LINES = 6;
const MAX_LINES_PER_AXIS = 4096;

type ColorCacheWindow = Window & { __clearResolvedColorCache?: () => void };

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
  (window as ColorCacheWindow).__clearResolvedColorCache = clearResolvedColorCache;
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
  'visible' | 'spacingX' | 'spacingY' | 'subdivisions' | 'offsetX' | 'offsetY' | 'rotation'
>;

export function computeGridLines(
  grid: GridGeometry,
  zoom: number,
  panX: number,
  panY: number,
  viewportW: number,
  viewportH: number,
  cameraRotation = 0,
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

  if (
    !grid.visible ||
    !Number.isFinite(zoom) ||
    zoom <= 0 ||
    !Number.isFinite(spacingX) ||
    !Number.isFinite(spacingY) ||
    spacingX <= 0 ||
    spacingY <= 0 ||
    !Number.isFinite(originWorldX) ||
    !Number.isFinite(originWorldY) ||
    !Number.isFinite(cameraRotation) ||
    !Number.isInteger(subdivisions) ||
    subdivisions < 1 ||
    !Number.isFinite(viewportW) ||
    !Number.isFinite(viewportH) ||
    viewportW <= 0 ||
    viewportH <= 0
  ) {
    return { major, minor };
  }

  const camera = { zoom, pan: { x: panX, y: panY }, rotation: cameraRotation };
  const viewport = { width: viewportW, height: viewportH };
  const worldCorners = [
    screenToWorld(camera, 0, 0, viewport),
    screenToWorld(camera, viewportW, 0, viewport),
    screenToWorld(camera, 0, viewportH, viewport),
    screenToWorld(camera, viewportW, viewportH, viewport),
  ];
  const leftWorld = Math.min(...worldCorners.map(([x]) => x));
  const rightWorld = Math.max(...worldCorners.map(([x]) => x));
  const topWorld = Math.min(...worldCorners.map(([, y]) => y));
  const bottomWorld = Math.max(...worldCorners.map(([, y]) => y));
  const padding = Math.max(majorStepX, majorStepY) * 2;

  const minorLodX = lodStep(zoom, spacingX);
  const minorLodY = lodStep(zoom, spacingY);
  const majorLodX = lodStep(zoom, majorStepX);
  const majorLodY = lodStep(zoom, majorStepY);
  const minorStepX = spacingX * minorLodX;
  const minorStepY = spacingY * minorLodY;
  const effectiveMajorStepX = majorStepX * majorLodX;
  const effectiveMajorStepY = majorStepY * majorLodY;
  const gridRotation = Number.isFinite(grid.rotation) ? (grid.rotation ?? 0) : 0;
  const cos = Math.cos(gridRotation);
  const sin = Math.sin(gridRotation);
  const project = (x: number, y: number): [number, number] => {
    const dx = x - originWorldX;
    const dy = y - originWorldY;
    const rotatedX = originWorldX + dx * cos - dy * sin;
    const rotatedY = originWorldY + dx * sin + dy * cos;
    const [sx, sy] = worldToScreen(camera, rotatedX, rotatedY, viewport);
    return [sx, sy];
  };
  const isMajor = (value: number, origin: number, step: number): boolean => {
    const quotient = (value - origin) / step;
    return Math.abs(quotient - Math.round(quotient)) < 1e-6;
  };
  const appendHorizontal = (
    value: number,
    end: number,
    step: number,
    majorStep: number,
    target: GridViewportLines['minor'] | GridViewportLines['major'],
    includeOnlyMajor: boolean,
  ): void => {
    let count = 0;
    for (let y = value; y <= end && count < MAX_LINES_PER_AXIS; y += step, count += 1) {
      if (includeOnlyMajor !== isMajor(y, originWorldY, majorStep)) continue;
      const [x1, y1] = project(leftWorld - padding, y);
      const [x2, y2] = project(rightWorld + padding, y);
      target.push({ x1, y1, x2, y2 });
    }
  };
  const appendVertical = (
    value: number,
    end: number,
    step: number,
    majorStep: number,
    target: GridViewportLines['minor'] | GridViewportLines['major'],
    includeOnlyMajor: boolean,
  ): void => {
    let count = 0;
    for (let x = value; x <= end && count < MAX_LINES_PER_AXIS; x += step, count += 1) {
      if (includeOnlyMajor !== isMajor(x, originWorldX, majorStep)) continue;
      const [x1, y1] = project(x, topWorld - padding);
      const [x2, y2] = project(x, bottomWorld + padding);
      target.push({ x1, y1, x2, y2 });
    }
  };

  // Minor lines use the corresponding axis spacing. LOD is independent too:
  // a dense horizontal lattice must not change when only X is configured.
  if (minorLodY <= subdivisions && subdivisions > 1 && minorStepY > 0.5) {
    const minY =
      Math.floor((topWorld - originWorldY - padding) / minorStepY) * minorStepY + originWorldY;
    const maxY =
      Math.ceil((bottomWorld - originWorldY + padding) / minorStepY) * minorStepY + originWorldY;
    appendHorizontal(minY, maxY, minorStepY, majorStepY, minor, false);
  }
  if (minorLodX <= subdivisions && subdivisions > 1 && minorStepX > 0.5) {
    const minX =
      Math.floor((leftWorld - originWorldX - padding) / minorStepX) * minorStepX + originWorldX;
    const maxX =
      Math.ceil((rightWorld - originWorldX + padding) / minorStepX) * minorStepX + originWorldX;
    appendVertical(minX, maxX, minorStepX, majorStepX, minor, false);
  }

  // Major lines use independent X/Y LOD and remain attached to the authored
  // origin after camera rotation and grid rotation.
  if (effectiveMajorStepY > 0.5) {
    const minY =
      Math.floor((topWorld - originWorldY - padding) / effectiveMajorStepY) * effectiveMajorStepY +
      originWorldY;
    const maxY =
      Math.ceil((bottomWorld - originWorldY + padding) / effectiveMajorStepY) *
        effectiveMajorStepY +
      originWorldY;
    appendHorizontal(minY, maxY, effectiveMajorStepY, effectiveMajorStepY, major, true);
  }

  // Major vertical lines
  if (effectiveMajorStepX > 0.5) {
    const minX =
      Math.floor((leftWorld - originWorldX - padding) / effectiveMajorStepX) * effectiveMajorStepX +
      originWorldX;
    const maxX =
      Math.ceil((rightWorld - originWorldX + padding) / effectiveMajorStepX) * effectiveMajorStepX +
      originWorldX;
    appendVertical(minX, maxX, effectiveMajorStepX, effectiveMajorStepX, major, true);
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
): void {
  const mw = 1;
  const mw2 = 0.5;

  ctx.save();
  ctx.scale(dpr, dpr);

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
