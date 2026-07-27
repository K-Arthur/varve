import type { DocumentGrid, GridViewportLines } from './gridTypes';

const MIN_SCREEN_PX_BETWEEN_LINES = 6;

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
    ctx.strokeStyle = minorColor;
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
    ctx.strokeStyle = majorColor;
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
