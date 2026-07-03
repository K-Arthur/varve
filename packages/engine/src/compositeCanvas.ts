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

export type BlendMode =
  | 'passThrough' | 'normal' | 'multiply' | 'screen' | 'overlay'
  | 'darken' | 'lighten' | 'colorDodge' | 'colorBurn'
  | 'hardLight' | 'softLight' | 'difference' | 'exclusion'
  | 'hue' | 'saturation' | 'color' | 'luminosity'
  | 'plusDarker' | 'plusLighter';

export interface CompositeCanvasOptions {
  width: number;
  height: number;
  devicePixelRatio?: number;
  testCanvas?: HTMLCanvasElement | OffscreenCanvas;
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
    } else {
      this.canvas = document.createElement('canvas');
      this.canvas.width = w;
      this.canvas.height = h;
    }

    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('CompositeCanvas: failed to get 2D context');
    this.ctx = ctx;

    this.ctx.scale(this._dpr, this._dpr);
  }

  get width(): number {
    return this.canvas.width / this._dpr;
  }

  get height(): number {
    return this.canvas.height / this._dpr;
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
    sx: number, sy: number, sw: number, sh: number,
    dx = 0, dy = 0,
  ): void {
    this.ctx.drawImage(
      source as CanvasImageSource,
      sx * this._dpr, sy * this._dpr,
      sw * this._dpr, sh * this._dpr,
      dx, dy,
      sw, sh,
    );
  }

  compositeBlend(
    source: CompositeCanvas,
    blendMode: string,
    opacity: number,
    dx = 0, dy = 0,
  ): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = mapBlendMode(blendMode);
    ctx.globalAlpha = opacity;
    ctx.drawImage(source.canvas as CanvasImageSource, dx, dy);
    ctx.restore();
  }

  compositePorterDuff(
    source: CompositeCanvas,
    operator: string,
    dx = 0, dy = 0,
  ): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = operator;
    ctx.drawImage(source.canvas as CanvasImageSource, dx, dy);
    ctx.restore();
  }

  getImageData(x: number, y: number, w: number, h: number): ImageData {
    return this.ctx.getImageData(
      x * this._dpr, y * this._dpr,
      w * this._dpr, h * this._dpr,
    );
  }

  putImageData(data: ImageData, x: number, y: number): void {
    this.ctx.putImageData(data, x * this._dpr, y * this._dpr);
  }

  async toImageBitmap(): Promise<ImageBitmap> {
    if (typeof ImageBitmap !== 'undefined' && 'transferToImageBitmap' in this.canvas) {
      return (this.canvas as OffscreenCanvas).transferToImageBitmap();
    }
    const blob = await (this.canvas as HTMLCanvasElement).toBlob();
    if (!blob) throw new Error('CompositeCanvas: failed to create blob');
    return createImageBitmap(blob);
  }

  applyBlur(radius: number): void {
    if (radius <= 0) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.filter = `blur(${radius}px)`;
    ctx.drawImage(this.canvas as CanvasImageSource, 0, 0);
    ctx.restore();
  }
}

export function mapBlendMode(mode: string): string {
  switch (mode) {
    case 'multiply': return 'multiply';
    case 'screen': return 'screen';
    case 'overlay': return 'overlay';
    case 'darken': return 'darken';
    case 'lighten': return 'lighten';
    case 'colorDodge': return 'color-dodge';
    case 'colorBurn': return 'color-burn';
    case 'hardLight': return 'hard-light';
    case 'softLight': return 'soft-light';
    case 'difference': return 'difference';
    case 'exclusion': return 'exclusion';
    case 'hue': return 'hue';
    case 'saturation': return 'saturation';
    case 'color': return 'color';
    case 'luminosity': return 'luminosity';
    case 'plusDarker': return 'plus-darker';
    case 'plusLighter': return 'plus-lighter';
    case 'passThrough': return 'source-over';
    default: return 'source-over';
  }
}

export function blendPixels(
  backdrop: ImageData,
  source: ImageData,
  blendMode: string,
  opacity: number,
): ImageData {
  const w = Math.min(backdrop.width, source.width);
  const h = Math.min(backdrop.height, source.height);
  const result = new ImageData(w, h);
  const bd = backdrop.data;
  const sd = source.data;
  const rd = result.data;

  for (let i = 0; i < w * h; i++) {
    const offset = i * 4;
    const ba = bd[offset + 3] / 255;
    const sa = sd[offset + 3] / 255 * opacity;

    if (sa === 0) {
      rd[offset] = bd[offset];
      rd[offset + 1] = bd[offset + 1];
      rd[offset + 2] = bd[offset + 2];
      rd[offset + 3] = bd[offset + 3];
      continue;
    }

    if (ba === 0) {
      rd[offset] = sd[offset];
      rd[offset + 1] = sd[offset + 1];
      rd[offset + 2] = sd[offset + 2];
      rd[offset + 3] = Math.round(sa * 255);
      continue;
    }

    const br = bd[offset] / 255;
    const bg = bd[offset + 1] / 255;
    const bb = bd[offset + 2] / 255;
    const sr = sd[offset] / 255;
    const sg = sd[offset + 1] / 255;
    const sb = sd[offset + 2] / 255;

    let mr: number;
    let mg: number;
    let mb: number;

    switch (blendMode) {
      case 'multiply':
        mr = br * sr;
        mg = bg * sg;
        mb = bb * sb;
        break;
      case 'screen':
        mr = 1 - (1 - br) * (1 - sr);
        mg = 1 - (1 - bg) * (1 - sg);
        mb = 1 - (1 - bb) * (1 - sb);
        break;
      case 'overlay':
        mr = br < 0.5 ? 2 * br * sr : 1 - 2 * (1 - br) * (1 - sr);
        mg = bg < 0.5 ? 2 * bg * sg : 1 - 2 * (1 - bg) * (1 - sg);
        mb = bb < 0.5 ? 2 * bb * sb : 1 - 2 * (1 - bb) * (1 - sb);
        break;
      case 'darken':
        mr = Math.min(br, sr);
        mg = Math.min(bg, sg);
        mb = Math.min(bb, sb);
        break;
      case 'lighten':
        mr = Math.max(br, sr);
        mg = Math.max(bg, sg);
        mb = Math.max(bb, sb);
        break;
      case 'colorDodge':
        mr = br === 0 ? 0 : sr >= 1 ? 1 : Math.min(1, br / (1 - sr));
        mg = bg === 0 ? 0 : sg >= 1 ? 1 : Math.min(1, bg / (1 - sg));
        mb = bb === 0 ? 0 : sb >= 1 ? 1 : Math.min(1, bb / (1 - sb));
        break;
      case 'colorBurn':
        mr = br >= 1 ? 1 : sr <= 0 ? 0 : 1 - Math.min(1, (1 - br) / sr);
        mg = bg >= 1 ? 1 : sg <= 0 ? 0 : 1 - Math.min(1, (1 - bg) / sg);
        mb = bb >= 1 ? 1 : sb <= 0 ? 0 : 1 - Math.min(1, (1 - bb) / sb);
        break;
      case 'hardLight':
        mr = sr < 0.5 ? 2 * br * sr : 1 - 2 * (1 - br) * (1 - sr);
        mg = sg < 0.5 ? 2 * bg * sg : 1 - 2 * (1 - bg) * (1 - sg);
        mb = sb < 0.5 ? 2 * bb * sb : 1 - 2 * (1 - bb) * (1 - sb);
        break;
      case 'softLight': {
        const softDodge = (a: number, b: number): number => {
          if (b <= 0.5) return a - (1 - 2 * b) * a * (1 - a);
          const g = a <= 0.25 ? ((16 * a - 12) * a + 4) * a : Math.sqrt(a);
          return a + (2 * b - 1) * (g - a);
        };
        mr = softDodge(br, sr);
        mg = softDodge(bg, sg);
        mb = softDodge(bb, sb);
        break;
      }
      case 'difference':
        mr = Math.abs(br - sr);
        mg = Math.abs(bg - sg);
        mb = Math.abs(bb - sb);
        break;
      case 'exclusion':
        mr = br + sr - 2 * br * sr;
        mg = bg + sg - 2 * bg * sg;
        mb = bb + sb - 2 * bb * sb;
        break;
      case 'plusDarker':
        mr = Math.max(0, br + sr - 1);
        mg = Math.max(0, bg + sg - 1);
        mb = Math.max(0, bb + sb - 1);
        break;
      case 'plusLighter':
        mr = Math.min(1, br + sr);
        mg = Math.min(1, bg + sg);
        mb = Math.min(1, bb + sb);
        break;
      case 'hue':
      case 'saturation':
      case 'color':
      case 'luminosity': {
        const { r: hr, g: hg, b: hb } = blendNonSeparable(br, bg, bb, sr, sg, sb, blendMode);
        mr = hr;
        mg = hg;
        mb = hb;
        break;
      }
      default:
        mr = sr;
        mg = sg;
        mb = sb;
        break;
    }

    const ao = sa + ba * (1 - sa);
    if (ao === 0) {
      rd[offset] = rd[offset + 1] = rd[offset + 2] = rd[offset + 3] = 0;
      continue;
    }

    rd[offset] = Math.round(clamp(((sa * mr + ba * (1 - sa) * br) / ao)) * 255);
    rd[offset + 1] = Math.round(clamp(((sa * mg + ba * (1 - sa) * bg) / ao)) * 255);
    rd[offset + 2] = Math.round(clamp(((sa * mb + ba * (1 - sa) * bb) / ao)) * 255);
    rd[offset + 3] = Math.round(clamp(ao) * 255);
  }

  return result;
}

function blendNonSeparable(
  br: number, bg: number, bb: number,
  sr: number, sg: number, sb: number,
  mode: string,
): { r: number; g: number; b: number } {
  const lum = (r: number, g: number, b: number) => 0.3 * r + 0.59 * g + 0.11 * b;

  const clipColor = (r: number, g: number, b: number): { r: number; g: number; b: number } => {
    const l = lum(r, g, b);
    let cr = r, cg = g, cb = b;
    const n = Math.min(r, g, b);
    const x = Math.max(r, g, b);
    if (n < 0) {
      const scale = l / (l - n);
      cr = l + ((cr - l) * (l - n) !== 0 ? (cr - l) * l / (l - n) : 0);
      cg = l + ((cg - l) * (l - n) !== 0 ? (cg - l) * l / (l - n) : 0);
      cb = l + ((cb - l) * (l - n) !== 0 ? (cb - l) * l / (l - n) : 0);
    }
    if (x > 1) {
      const scale = (1 - l) / (x - l);
      cr = l + (cr - l) * scale;
      cg = l + (cg - l) * scale;
      cb = l + (cb - l) * scale;
    }
    return { r: cr, g: cg, b: cb };
  };

  const setLum = (r: number, g: number, b: number, l: number): { r: number; g: number; b: number } => {
    const d = l - lum(r, g, b);
    return clipColor(r + d, g + d, b + d);
  };

  const sat = (r: number, g: number, b: number) => Math.max(r, g, b) - Math.min(r, g, b);

  const setSat = (r: number, g: number, b: number, s: number): { r: number; g: number; b: number } => {
    const values = [r, g, b];
    const sorted = [...values].sort((a, c) => a - c);
    const min = sorted[0]!;
    const mid = sorted[1]!;
    const max = sorted[2]!;
    if (max > min) {
      const midIdx = values.indexOf(mid);
      const mid2 = ((mid - min) * s) / (max - min);
      const max2 = s;
      const result = values.map((v, i) => {
        if (v === max) return max2;
        if (v === min) return 0;
        return mid2;
      });
      return { r: result[0]!, g: result[1]!, b: result[2]! };
    }
    return { r: 0, g: 0, b: 0 };
  };

  const bLum = lum(br, bg, bb);

  switch (mode) {
    case 'hue':
      return setLum(setSat(sr, sg, sb, sat(br, bg, bb)).r, setSat(sr, sg, sb, sat(br, bg, bb)).g, setSat(sr, sg, sb, sat(br, bg, bb)).b, bLum);
    case 'saturation':
      return setLum(setSat(br, bg, bb, sat(sr, sg, sb)).r, setSat(br, bg, bb, sat(sr, sg, sb)).g, setSat(br, bg, bb, sat(sr, sg, sb)).b, bLum);
    case 'color':
      return setLum(sr, sg, sb, bLum);
    case 'luminosity':
      return setLum(br, bg, bb, lum(sr, sg, sb));
    default:
      return { r: sr, g: sg, b: sb };
  }
}

function clamp(v: number): number {
  return Math.max(0, Math.min(1, v));
}
