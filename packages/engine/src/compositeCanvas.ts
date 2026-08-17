/**
 * CompositeCanvas — OffscreenCanvas wrapper for backdrop capture, group flatten
 * compositing, and pixel-level image operations.
 *
 * Research basis: W3C Compositing and Blending Level 1 §8 (Compositing Groups),
 * §9 (Porter Duff operators), §10 (Blending). Canvas2D globalCompositeOperation
 * for hardware-accelerated compositing; pixel fallback via ImageData for
 * non-separable blend modes and custom operations.
 *
 * Architecture: wraps OffscreenCanvas (with HTMLCanvasElement fallback for
 * test environments). All operations are in world-space coordinates; DPR is
 * handled internally via context scaling.
 */

import type { BlendEvaluationSpace } from '@varve/shared';
import { blendModeDefinition, type CanvasBlendOperation } from './blendModeCatalog';
import { blendPixels as blendPixelsCanonical } from './blendModes';
import { gaussianBlurLinearLight } from './blur';

export type { BlendMode } from './types';

export interface CompositeCanvasOptions {
  width: number;
  height: number;
  devicePixelRatio?: number;
  testCanvas?: HTMLCanvasElement | OffscreenCanvas;
}

function promisifyToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('CompositeCanvas: failed to create blob'));
    });
  });
}

export class CompositeCanvas {
  readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  readonly ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  private _dpr: number;

  constructor(opts: CompositeCanvasOptions) {
    this._dpr = opts.devicePixelRatio ?? 1;
    const w = Math.ceil(opts.width * this._dpr);
    const h = Math.ceil(opts.height * this._dpr);

    if (opts.testCanvas) {
      this.canvas = opts.testCanvas;
      this.canvas.width = w;
      this.canvas.height = h;
    } else if (typeof OffscreenCanvas !== 'undefined') {
      this.canvas = new OffscreenCanvas(w, h);
      const offCtx = this.canvas.getContext('2d');
      if (!offCtx && typeof document !== 'undefined') {
        this.canvas = document.createElement('canvas');
        this.canvas.width = w;
        this.canvas.height = h;
      }
    } else if (typeof document !== 'undefined') {
      this.canvas = document.createElement('canvas');
      this.canvas.width = w;
      this.canvas.height = h;
    } else {
      throw new Error('CompositeCanvas: no canvas backend available');
    }

    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('CompositeCanvas: failed to get 2D context');
    this.ctx = ctx as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

    this.ctx.scale(this._dpr, this._dpr);
  }

  get width(): number {
    return this.canvas.width / this._dpr;
  }

  get height(): number {
    return this.canvas.height / this._dpr;
  }

  get devicePixelRatio(): number {
    return this._dpr;
  }

  clear(): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.restore();
  }

  fill(color: readonly [number, number, number, number]): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = `rgba(${color[0]},${color[1]},${color[2]},${color[3] / 255})`;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.restore();
  }

  resize(w: number, h: number): void {
    const pw = Math.ceil(w * this._dpr);
    const ph = Math.ceil(h * this._dpr);
    if (pw <= this.canvas.width && ph <= this.canvas.height) return;
    this.canvas.width = Math.max(pw, this.canvas.width);
    this.canvas.height = Math.max(ph, this.canvas.height);
    this.ctx.scale(this._dpr, this._dpr);
  }

  captureSource(
    source: HTMLCanvasElement | OffscreenCanvas,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx = 0,
    dy = 0,
  ): void {
    this.ctx.drawImage(
      source as CanvasImageSource,
      sx * this._dpr,
      sy * this._dpr,
      sw * this._dpr,
      sh * this._dpr,
      dx,
      dy,
      sw,
      sh,
    );
  }

  compositeBlend(
    source: CompositeCanvas,
    blendMode: string,
    opacity: number,
    dx = 0,
    dy = 0,
    evaluationSpace: BlendEvaluationSpace = 'legacy-srgb',
  ): void {
    const ctx = this.ctx;
    if (evaluationSpace === 'linear-srgb') {
      const width = Math.min(source.width, this.width - dx);
      const height = Math.min(source.height, this.height - dy);
      if (width > 0 && height > 0) {
        const backdrop = this.getImageData(dx, dy, width, height);
        const pixels = source.getImageData(0, 0, width, height);
        const result = blendPixelsCanonical(backdrop, pixels, blendMode, opacity, evaluationSpace);
        this.putImageData(result, dx, dy);
        return;
      }
    }
    const operation = mapBlendMode(blendMode);
    ctx.save();
    try {
      ctx.globalCompositeOperation = operation;
      ctx.globalAlpha = opacity;
      ctx.drawImage(source.canvas as CanvasImageSource, dx, dy);
    } finally {
      ctx.restore();
    }
  }

  compositePorterDuff(source: CompositeCanvas, operator: string, dx = 0, dy = 0): void {
    const ctx = this.ctx;
    ctx.save();
    try {
      ctx.globalCompositeOperation = operator as GlobalCompositeOperation;
      ctx.drawImage(source.canvas as CanvasImageSource, dx, dy);
    } finally {
      ctx.restore();
    }
  }

  getImageData(x: number, y: number, w: number, h: number): ImageData {
    return this.ctx.getImageData(x * this._dpr, y * this._dpr, w * this._dpr, h * this._dpr);
  }

  putImageData(data: ImageData, x: number, y: number): void {
    this.ctx.putImageData(data, x * this._dpr, y * this._dpr);
  }

  async toImageBitmap(): Promise<ImageBitmap> {
    if (typeof ImageBitmap !== 'undefined' && 'transferToImageBitmap' in this.canvas) {
      return (this.canvas as OffscreenCanvas).transferToImageBitmap();
    }
    const blob = await promisifyToBlob(this.canvas as HTMLCanvasElement);
    return createImageBitmap(blob);
  }

  applyBlur(radius: number): void {
    if (radius <= 0) return;
    const ctx = this.ctx;
    if (radius <= 32) {
      // CSS filter path (GPU-accelerated, fast for small radii)
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.filter = `blur(${radius}px)`;
      ctx.drawImage(this.canvas as CanvasImageSource, 0, 0);
      ctx.restore();
    } else {
      // Software separable blur for large radii (>32px):
      // CSS filter does full 2D convolution and becomes slower than
      // separable blur beyond ~32px radius.
      const imageData = this.getImageData(0, 0, this.width, this.height);
      const result = gaussianBlurLinearLight(imageData, radius);
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      this.putImageData(result, 0, 0);
      ctx.restore();
    }
  }
}

export function mapBlendMode(mode: string): CanvasBlendOperation {
  const definition = blendModeDefinition(mode);
  if (!definition?.css) {
    throw new Error(`Blend mode is not available in Canvas2D: ${mode}`);
  }
  return definition.css;
}

export function blendPixels(
  backdrop: ImageData,
  source: ImageData,
  blendMode: string,
  opacity: number,
  evaluationSpace: BlendEvaluationSpace = 'legacy-srgb',
): ImageData {
  return blendPixelsCanonical(backdrop, source, blendMode, opacity, evaluationSpace);
}
