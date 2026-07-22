/**
 * Procedural pattern generators — deterministic, worker-safe.
 * Each generator produces a data URL for use as a pattern tile.
 */

export type PatternType = 'checkerboard' | 'stripes' | 'polka-dots' | 'crosshatch' | 'hex-grid';

export interface PatternOptions {
  tileSize: number;
  color1: string;
  color2: string;
  /** Deterministic seed for pseudo-random patterns */
  seed?: number;
  /** For stripes: angle in degrees */
  angle?: number;
  /** For dots/crosshatch: density 0-1 */
  density?: number;
  /** For hex-grid: gap size */
  gap?: number;
}

/**
 * Generate a procedural pattern tile as a data URL.
 * Deterministic when seed is provided.
 */
export function generatePattern(
  type: PatternType,
  options: PatternOptions,
  canvasFactory?: () => HTMLCanvasElement,
): string {
  const canvas =
    canvasFactory?.() ??
    (typeof document !== 'undefined' ? document.createElement('canvas') : null);

  if (!canvas) return '';

  const tileSize = Math.max(8, Math.min(256, options.tileSize));
  canvas.width = tileSize;
  canvas.height = tileSize;
  const ctx = canvas.getContext('2d')!;

  switch (type) {
    case 'checkerboard':
      drawCheckerboard(ctx, tileSize, options.color1, options.color2);
      break;
    case 'stripes':
      drawStripes(
        ctx,
        tileSize,
        options.color1,
        options.color2,
        options.angle ?? 45,
        options.density ?? 0.5,
      );
      break;
    case 'polka-dots':
      drawPolkaDots(
        ctx,
        tileSize,
        options.color1,
        options.color2,
        options.density ?? 0.3,
        options.seed,
      );
      break;
    case 'crosshatch':
      drawCrosshatch(ctx, tileSize, options.color1, options.color2, options.density ?? 0.5);
      break;
    case 'hex-grid':
      drawHexGrid(ctx, tileSize, options.color1, options.color2, options.gap ?? 2);
      break;
  }

  return canvas.toDataURL();
}

function drawCheckerboard(
  ctx: CanvasRenderingContext2D,
  size: number,
  color1: string,
  color2: string,
): void {
  const half = size / 2;
  ctx.fillStyle = color1;
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = color2;
  ctx.fillRect(0, 0, half, half);
  ctx.fillRect(half, half, half, half);
}

function drawStripes(
  ctx: CanvasRenderingContext2D,
  size: number,
  color1: string,
  color2: string,
  angle: number,
  density: number,
): void {
  ctx.fillStyle = color1;
  ctx.fillRect(0, 0, size, size);

  ctx.save();
  ctx.translate(size / 2, size / 2);
  ctx.rotate((angle * Math.PI) / 180);

  const stripeW = Math.max(2, size * density * 0.5);
  ctx.fillStyle = color2;
  for (let x = -size; x < size * 2; x += stripeW * 2) {
    ctx.fillRect(x, -size, stripeW, size * 2);
  }

  ctx.restore();
}

function drawPolkaDots(
  ctx: CanvasRenderingContext2D,
  size: number,
  color1: string,
  color2: string,
  density: number,
  seed?: number,
): void {
  ctx.fillStyle = color1;
  ctx.fillRect(0, 0, size, size);

  const rng = seed ? seededRandom(seed) : Math.random;
  const dotCount = Math.max(1, Math.floor(density * 20));
  const dotR = Math.max(2, size * 0.08 * density);

  ctx.fillStyle = color2;
  for (let i = 0; i < dotCount; i++) {
    const x = rng() * size;
    const y = rng() * size;
    ctx.beginPath();
    ctx.arc(x, y, dotR, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawCrosshatch(
  ctx: CanvasRenderingContext2D,
  size: number,
  color1: string,
  color2: string,
  density: number,
): void {
  ctx.fillStyle = color1;
  ctx.fillRect(0, 0, size, size);

  const spacing = Math.max(4, Math.floor((1 - density) * 20 + 4));
  ctx.strokeStyle = color2;
  ctx.lineWidth = 1;

  for (let i = 0; i < size; i += spacing) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + size, size - i);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i);
    ctx.lineTo(size - i, size);
    ctx.stroke();
  }
}

function drawHexGrid(
  ctx: CanvasRenderingContext2D,
  size: number,
  color1: string,
  color2: string,
  gap: number,
): void {
  ctx.fillStyle = color1;
  ctx.fillRect(0, 0, size, size);

  const r = size / 4;
  const h = r * Math.sqrt(3);
  ctx.fillStyle = color2;

  for (let row = -1; row < 3; row++) {
    for (let col = -1; col < 3; col++) {
      const cx = col * (r * 1.5) + (row % 2 === 0 ? r * 0.75 : 0);
      const cy = row * h * 0.5 + r;
      drawHexagon(ctx, cx, cy, r - gap / 2);
    }
  }
}

function drawHexagon(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i - Math.PI / 6;
    const x = cx + r * Math.cos(angle);
    const y = cy + r * Math.sin(angle);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
}

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}
