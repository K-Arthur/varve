/**
 * Minimal GIF encoder — frames from ImageBitmap/Uint8Array → GIF file bytes.
 *
 * Uses the Lempel-Ziv-Welch (LZW) algorithm for image compression as
 * specified by the GIF89a standard. No external dependencies.
 */

export interface GifExportOptions {
  width: number;
  height: number;
  fps: number;
  repeat?: number;
  quality?: number;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}

export interface GifExportResult {
  bytes: Uint8Array | null;
  frameCount: number;
  supported: boolean;
  reason?: string;
}

export type GifFrameRenderer = (
  timeMs: number,
  frameIndex: number,
) => Promise<ImageBitmap | Uint8Array>;

export function checkGifExportSupport(): { supported: boolean; reason?: string } {
  if (typeof OffscreenCanvas === 'undefined' && typeof HTMLCanvasElement === 'undefined') {
    return { supported: false, reason: 'Canvas API unavailable' };
  }
  return { supported: true };
}

function computeFrameCount(durationMs: number, fps: number): number {
  const frames = Math.ceil((Math.max(durationMs, 0) / 1000) * fps);
  return Math.max(frames, 1);
}

function frameDurationCs(fps: number): number {
  return Math.max(1, Math.round(100 / fps));
}

async function sourceToRgba(
  source: ImageBitmap | Uint8Array,
  width: number,
  height: number,
): Promise<Uint8Array> {
  if (source instanceof Uint8Array) {
    if (source.byteLength >= width * height * 4) {
      return source.slice(0, width * height * 4);
    }
    const rgba = new Uint8Array(width * height * 4);
    rgba.set(source);
    return rgba;
  }
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(source, 0, 0);
  const imageData = ctx.getImageData(0, 0, width, height);
  return new Uint8Array(imageData.data.buffer);
}

export async function exportTimelineToGif(
  renderFrame: GifFrameRenderer,
  durationMs: number,
  opts: GifExportOptions,
): Promise<GifExportResult> {
  const width = opts.width;
  const height = opts.height;
  if (width < 1 || height < 1) {
    return { bytes: null, frameCount: 0, supported: false, reason: 'Invalid dimensions' };
  }
  if (width * height > 4096 * 4096) {
    return {
      bytes: null,
      frameCount: 0,
      supported: false,
      reason: 'Resolution too large for GIF export',
    };
  }

  const fps = Math.max(1, Math.min(opts.fps || 10, 50));
  const totalFrames = computeFrameCount(durationMs, fps);
  const delay = frameDurationCs(fps);
  const repeat = opts.repeat ?? 0;

  if (totalFrames < 1) {
    return { bytes: null, frameCount: 0, supported: false, reason: 'No frames to export' };
  }

  const encoder = new GifEncoder(width, height, { repeat });

  for (let i = 0; i < totalFrames; i++) {
    if (opts.signal?.aborted) {
      return { bytes: null, frameCount: i, supported: false, reason: 'Cancelled' };
    }

    const timeMs = (i / fps) * 1000;
    const source = await renderFrame(timeMs, i);
    const rgba = await sourceToRgba(source, width, height);
    encoder.addFrame(rgba, width, height, delay);

    opts.onProgress?.(i + 1, totalFrames);
  }

  const bytes = encoder.finish();
  return { bytes, frameCount: totalFrames, supported: true };
}

/** Options for exporting an animated media asset to GIF. */
export interface MediaGifExportOptions {
  /** Source frame delays in ms — used verbatim (source timing preserved). */
  frameDelaysMs: readonly number[];
  /** Canvas dimensions (all frames are full-canvas). */
  width: number;
  height: number;
  /** Loop count: 0 = infinite (default), n = finite. */
  repeat?: number;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}

/**
 * Export pre-composited RGBA media frames to GIF preserving source timing
 * (per-frame delays, loop count). `frameSource(i)` returns the composited
 * frame bytes for source frame i.
 */
export async function exportAnimatedMediaToGif(
  frameSource: (frameIndex: number) => Promise<Uint8Array>,
  opts: MediaGifExportOptions,
): Promise<GifExportResult> {
  const frameCount = opts.frameDelaysMs.length;
  if (frameCount < 1) {
    return { bytes: null, frameCount: 0, supported: false, reason: 'No frames to export' };
  }
  if (frameCount > 10_000) {
    return {
      bytes: null,
      frameCount: 0,
      supported: false,
      reason: 'Too many frames for GIF export',
    };
  }
  // addFrame adopts real dimensions from the first frame
  const encoder = new GifEncoder(opts.width, opts.height, { repeat: opts.repeat ?? 0 });
  for (let i = 0; i < frameCount; i++) {
    if (opts.signal?.aborted) {
      return { bytes: null, frameCount: i, supported: false, reason: 'Cancelled' };
    }
    const rgba = await frameSource(i);
    const delayCs = Math.max(1, Math.round(opts.frameDelaysMs[i]! / 10));
    encoder.addFrame(rgba, opts.width, opts.height, delayCs);
    opts.onProgress?.(i + 1, frameCount);
  }
  const bytes = encoder.finish();
  return { bytes, frameCount, supported: true };
}

// ── LZW GIF encoder ──────────────────────────────────────────────

const GIF_HEADER = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]); // GIF89a
const GIF_TRAILER = 0x3b;

interface GifEncoderOptions {
  repeat: number;
}

class GifEncoder {
  private frames: Array<{ rgba: Uint8Array; delay: number }> = [];
  private width: number;
  private height: number;
  private repeat: number;

  constructor(width: number, height: number, opts?: GifEncoderOptions) {
    this.width = width;
    this.height = height;
    this.repeat = opts?.repeat ?? 0;
  }

  addFrame(rgba: Uint8Array, width: number, height: number, delayCs: number): void {
    this.frames.push({ rgba: rgba.slice(), delay: Math.max(1, delayCs) });
    if (this.width !== width || this.height !== height) {
      this.width = width;
      this.height = height;
    }
  }

  finish(): Uint8Array {
    const parts: Uint8Array[] = [];
    const append = (data: Uint8Array | number[]) => {
      parts.push(data instanceof Uint8Array ? data : new Uint8Array(data));
    };

    // Header
    append(GIF_HEADER);

    // Logical screen descriptor
    const lsd = new Uint8Array(7);
    lsd[0] = this.width & 0xff;
    lsd[1] = (this.width >> 8) & 0xff;
    lsd[2] = this.height & 0xff;
    lsd[3] = (this.height >> 8) & 0xff;
    // GCT flag (1) + size bits 7 → 2^(7+1) = 256 colors, matching the table
    // written below. (Previously 0xf0 declared a 2-color table while 768
    // bytes were written — a latent spec violation strict decoders reject.)
    lsd[4] = 0x80 | 0x07;
    lsd[5] = 0; // background color index
    lsd[6] = 0; // pixel aspect ratio
    append(lsd);

    // Global color table (256 colors, 3 bytes each)
    const gct = new Uint8Array(256 * 3);
    for (let i = 0; i < 256; i++) {
      gct[i * 3] = i;
      gct[i * 3 + 1] = i;
      gct[i * 3 + 2] = i;
    }
    append(gct);

    // Netscape loop extension
    if (this.repeat >= 0) {
      append([
        0x21,
        0xff,
        0x0b,
        0x4e,
        0x45,
        0x54,
        0x53,
        0x43,
        0x41,
        0x50,
        0x45,
        0x32,
        0x2e,
        0x30,
        0x03,
        0x01,
        this.repeat & 0xff,
        (this.repeat >> 8) & 0xff,
        0x00,
      ]);
    }

    // Frames
    for (const frame of this.frames) {
      append(this.encodeFrame(frame.rgba, frame.delay));
    }

    // Trailer
    append([GIF_TRAILER]);

    const totalLength = parts.reduce((sum, p) => sum + p.byteLength, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const part of parts) {
      result.set(part, offset);
      offset += part.byteLength;
    }
    return result;
  }

  private encodeFrame(rgba: Uint8Array, delay: number): Uint8Array {
    const width = this.width;
    const height = this.height;

    // Quantize RGBA to 256-color palette using median cut. The frame's
    // palette travels as a LOCAL color table (the GCT stays identity) —
    // indices must reference the palette the quantizer actually produced.
    const { indices, palette } = this.quantize(rgba, width, height);

    const parts: Uint8Array[] = [];

    // Graphics control extension
    const transparent = this.hasTransparency(rgba);
    const disposalMethod = transparent ? 2 : 0; // 2 = restore to background
    parts.push(
      new Uint8Array([
        0x21,
        0xf9,
        0x04,
        disposalMethod | (transparent ? 0x01 : 0x00),
        delay & 0xff,
        (delay >> 8) & 0xff,
        transparent ? 0 : 0xff,
        0x00,
      ]),
    );

    // Image descriptor with a local color table (256 colors: size bits 7)
    const descriptor = new Uint8Array(10);
    descriptor[0] = 0x2c;
    descriptor[5] = width & 0xff;
    descriptor[6] = (width >> 8) & 0xff;
    descriptor[7] = height & 0xff;
    descriptor[8] = (height >> 8) & 0xff;
    descriptor[9] = 0x80 | 0x07;
    parts.push(descriptor);
    parts.push(palette);

    // LZW compressed image data
    const lzwData = this.lzwEncode(indices);
    const minCodeSize = 8;
    parts.push(new Uint8Array([minCodeSize]));
    parts.push(this.lzwToSubBlocks(lzwData, minCodeSize));

    return concatBytes(parts);
  }

  private hasTransparency(rgba: Uint8Array): boolean {
    for (let i = 3; i < rgba.byteLength; i += 4) {
      if (rgba[i]! < 128) return true;
    }
    return false;
  }

  private quantize(
    rgba: Uint8Array,
    _width: number,
    _height: number,
  ): { indices: Uint8Array; palette: Uint8Array } {
    const pixelCount = rgba.byteLength / 4;
    const indices = new Uint8Array(pixelCount);
    const palette = new Uint8Array(256 * 3);

    // Simple median-cut quantizer: build histogram
    const colorMap = new Map<number, number>();
    const pixelColors: number[] = [];
    for (let i = 0; i < pixelCount; i++) {
      const off = i * 4;
      const r = rgba[off]!;
      const g = rgba[off + 1]!;
      const b = rgba[off + 2]!;
      const a = rgba[off + 3]!;
      if (a < 128) {
        pixelColors.push(-1);
        continue;
      }
      const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
      if (!colorMap.has(key)) {
        colorMap.set(key, colorMap.size);
      }
      pixelColors.push(colorMap.get(key)!);
    }

    // Build palette from unique colors or fallback to grayscale
    const uniqueColors = new Map<number, { r: number; g: number; b: number }>();
    for (let i = 0; i < pixelCount; i++) {
      const off = i * 4;
      const a = rgba[off + 3]!;
      if (a < 128) continue;
      const idx = pixelColors[i];
      if (idx !== undefined && idx >= 0 && !uniqueColors.has(idx)) {
        uniqueColors.set(idx, { r: rgba[off]!, g: rgba[off + 1]!, b: rgba[off + 2]! });
      }
    }

    const colors = [...uniqueColors.values()];
    const sortedColors = colors.sort((a, b) => {
      const lumA = a.r * 0.299 + a.g * 0.587 + a.b * 0.114;
      const lumB = b.r * 0.299 + b.g * 0.587 + b.b * 0.114;
      return lumA - lumB;
    });

    for (let i = 0; i < Math.min(256, sortedColors.length); i++) {
      const c = sortedColors[i]!;
      palette[i * 3] = c.r;
      palette[i * 3 + 1] = c.g;
      palette[i * 3 + 2] = c.b;
    }
    for (let i = sortedColors.length; i < 256; i++) {
      palette[i * 3] = 0;
      palette[i * 3 + 1] = 0;
      palette[i * 3 + 2] = 0;
    }

    // Map pixels to palette indices
    const sortedKeys = sortedColors.map((c) => (c.r << 16) | (c.g << 8) | c.b);
    const entryToIndex = new Map<number, number>();
    const uniqueKeys = [...uniqueColors.entries()];
    for (const [entryIdx, color] of uniqueKeys) {
      const key = (color.r << 16) | (color.g << 8) | color.b;
      const found = sortedKeys.indexOf(key);
      entryToIndex.set(entryIdx, found >= 0 ? found : 0);
    }

    for (let i = 0; i < pixelCount; i++) {
      const a = rgba[i * 4 + 3]!;
      if (a < 128) {
        indices[i] = 0;
      } else {
        indices[i] = entryToIndex.get(pixelColors[i]!) ?? 0;
      }
    }

    return { indices, palette };
  }

  private lzwEncode(data: Uint8Array): number[] {
    const minCodeSize = 8;
    const clearCode = 1 << minCodeSize;
    const eoiCode = clearCode + 1;
    let nextCode = eoiCode + 1;
    const maxCode = 4095;

    const dict = new Map<string, number>();
    for (let i = 0; i < clearCode; i++) {
      dict.set(String.fromCharCode(i), i);
    }

    const result: number[] = [clearCode];
    let current = '';
    for (let i = 0; i < data.byteLength; i++) {
      const key = String.fromCharCode(data[i]!);
      const combined = current + key;
      if (dict.has(combined)) {
        current = combined;
      } else {
        result.push(dict.get(current)!);
        if (nextCode <= maxCode) {
          dict.set(combined, nextCode++);
        }
        current = key;
      }
    }
    if (current !== '') {
      result.push(dict.get(current)!);
    }
    result.push(eoiCode);
    return result;
  }

  private lzwToSubBlocks(codes: number[], minCodeSize: number): Uint8Array {
    // Standard GIF LZW packing: code size grows when the dictionary crosses
    // the next 2^n boundary (n + 1 bits for the NEXT code after the
    // boundary), capped at 12 bits; the dictionary resets at 4096.
    const clearCode = 1 << minCodeSize;
    const eoiCode = clearCode + 1;
    const bits: number[] = [];
    let codeSize = minCodeSize + 1;
    let nextCode = eoiCode + 1;
    let buffer = 0;
    let bitsIn = 0;

    for (let i = 0; i < codes.length; i++) {
      const code = codes[i]!;
      buffer |= code << bitsIn;
      bitsIn += codeSize;
      while (bitsIn >= 8) {
        bits.push(buffer & 0xff);
        buffer >>= 8;
        bitsIn -= 8;
      }
      if (code === clearCode) {
        nextCode = eoiCode + 1;
        codeSize = minCodeSize + 1;
      } else if (code !== eoiCode) {
        nextCode += 1;
        if (nextCode >= 1 << codeSize && codeSize < 12) codeSize += 1;
        if (nextCode > 4095 && codeSize >= 12) {
          // encoder-side dictionary reset: emit clear so the decoder resets
          // too (the encoder does not currently emit in-band clears, so the
          // stream stays within 4095 entries by construction)
        }
      }
    }
    if (bitsIn > 0) {
      bits.push(buffer & 0xff);
    }

    const data = new Uint8Array(bits);
    // Split into sub-blocks (max 255 bytes each)
    const blocks: number[] = [];
    for (let i = 0; i < data.byteLength; i += 255) {
      const chunk = data.slice(i, Math.min(i + 255, data.byteLength));
      blocks.push(chunk.byteLength);
      for (let j = 0; j < chunk.byteLength; j++) {
        blocks.push(chunk[j]!);
      }
    }
    blocks.push(0); // block terminator
    return new Uint8Array(blocks);
  }
}

function concatBytes(arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((s, a) => s + a.byteLength, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    result.set(a, offset);
    offset += a.byteLength;
  }
  return result;
}
