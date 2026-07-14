/**
 * Enhanced mask compositing: alpha, luminance, inversion, feather, density.
 *
 * Builds on the existing renderAlphaMask() in replay.ts, adding support for:
 *   - Luminance masks (SVG-spec luminance → alpha conversion)
 *   - Inversion (swap transparent/opaque)
 *   - Feather (Gaussian blur on mask alpha)
 *   - Density (overall mask strength scaling)
 *   - Unlinked transforms (mask transforms independently of content)
 *
 * Research basis: SVG 1.1 mask spec (§14.4), Adobe Photoshop layer masks,
 * Figma alpha masks, W3C Compositing and Blending spec.
 */

// ── Luminance calculation ────────────────────────────────────────────────────

/**
 * Linearize a single sRGB channel value (0-255) to linear RGB (0-1).
 * Per the IEC 61966-2-1 standard:
 *   c_srgb <= 0.04045 → c_linear = c_srgb / 12.92
 *   c_srgb >  0.04045 → c_linear = ((c_srgb + 0.055) / 1.055) ^ 2.4
 */
function srgbToLinear(c: number): number {
  const cNorm = c / 255;
  if (cNorm <= 0.04045) return cNorm / 12.92;
  return ((cNorm + 0.055) / 1.055) ** 2.4;
}

/**
 * sRGB luminance coefficients (ITU-R BT.709 / SVG 1.1).
 * Applied to linear RGB values.
 * L = 0.2126 * R_lin + 0.7152 * G_lin + 0.0722 * B_lin
 */
const LUM_R = 0.2126;
const LUM_G = 0.7152;
const LUM_B = 0.0722;

/**
 * Convert an sRGB pixel to luminance value using proper linear-RGB math.
 *
 * The SVG 1.1 mask spec (§14.4) defines the luminance channel as the
 * standard ITU-R BT.709 luma formula applied to sRGB values. However,
 * applying the coefficients to gamma-encoded sRGB produces perceptually
 * inaccurate results. This implementation linearizes sRGB first, then
 * applies the BT.709 coefficients, producing perceptually uniform luminance.
 *
 * Input: [r, g, b] in 0-255 range (non-premultiplied)
 * Returns: luminance value in 0-1 range
 */
export function srgbToLuminance(r: number, g: number, b: number): number {
  return LUM_R * srgbToLinear(r) + LUM_G * srgbToLinear(g) + LUM_B * srgbToLinear(b);
}

/**
 * Convert a pixel to its mask alpha value.
 * For luminance masks: L * A where L is sRGB luminance and A is pixel alpha.
 * For alpha masks: just A (the pixel alpha).
 * Both are in 0-1 range.
 */
export function pixelToMaskAlpha(
  r: number,
  g: number,
  b: number,
  a: number,
  luminance: boolean,
): number {
  if (luminance) {
    // SVG mask spec: mask value = luminance * alpha
    return srgbToLuminance(r, g, b) * (a / 255);
  }
  return a / 255;
}

// ── Apply mask post-processing ──────────────────────────────────────────────

/**
 * Apply mask post-processing to an ImageData buffer.
 *
 * Operations applied in order:
 *   1. Feather (Gaussian blur on alpha channel)
 *   2. Inversion (1 - alpha)
 *   3. Density (alpha * density)
 *
 * @param data - ImageData buffer to modify in place
 * @param opts - Post-processing options
 */
export interface MaskPostProcessOptions {
  luminance?: boolean;
  inverted?: boolean;
  feather?: number;
  density?: number;
}

export function applyMaskPostProcess(data: ImageData, opts: MaskPostProcessOptions): void {
  const pixels = data.data;
  const w = data.width;
  const h = data.height;

  // Step 1: Convert to mask alpha (luminance if needed)
  if (opts.luminance) {
    for (let i = 0; i < pixels.length; i += 4) {
      const r = pixels[i]!;
      const g = pixels[i + 1]!;
      const b = pixels[i + 2]!;
      const a = pixels[i + 3]!;
      const alpha = pixelToMaskAlpha(r, g, b, a, true);
      // Store the calculated mask value in all channels + alpha for blur to work on visible channels
      const v = Math.round(alpha * 255);
      pixels[i] = v;
      pixels[i + 1] = v;
      pixels[i + 2] = v;
      pixels[i + 3] = v;
    }
  }

  // Step 2: Feather (Gaussian blur on the mask)
  if (opts.feather && opts.feather > 0) {
    applyBoxBlur(pixels, w, h, opts.feather);
  }

  // Step 3: Inversion
  if (opts.inverted) {
    for (let i = 0; i < pixels.length; i += 4) {
      const r = pixels[i]!;
      const g = pixels[i + 1]!;
      const b = pixels[i + 2]!;
      const a = pixels[i + 3]!;
      pixels[i] = 255 - r;
      pixels[i + 1] = 255 - g;
      pixels[i + 2] = 255 - b;
      pixels[i + 3] = 255 - a;
    }
  }

  // Step 4: Density
  if (opts.density !== undefined && opts.density < 1) {
    for (let i = 0; i < pixels.length; i += 4) {
      const d = opts.density;
      const r = pixels[i]!;
      const g = pixels[i + 1]!;
      const b = pixels[i + 2]!;
      const a = pixels[i + 3]!;
      pixels[i] = Math.round(r * d);
      pixels[i + 1] = Math.round(g * d);
      pixels[i + 2] = Math.round(b * d);
      pixels[i + 3] = Math.round(a * d);
    }
  }
}

// ── Fast box blur approximation (3-pass = Gaussian) ─────────────────────────

/**
 * Apply a separable box blur to the alpha channel (index 3) of pixel data.
 * Uses 3-pass box blur to approximate a Gaussian blur.
 * Pixel format: RGBA (4 bytes per pixel), w and h are pixel dimensions.
 */
function applyBoxBlur(pixels: Uint8ClampedArray, w: number, h: number, radius: number): void {
  if (radius < 0.5) return;
  const r = Math.max(1, Math.round(radius));
  // 3-pass box blur approximates Gaussian with sigma ≈ radius * 0.47
  // We apply passes on the alpha channel only
  const temp = new Float32Array(w * h);

  for (let pass = 0; pass < 3; pass++) {
    // Horizontal pass
    for (let y = 0; y < h; y++) {
      let sum = 0;
      const rowStart = y * w;
      for (let x = -r; x <= r; x++) {
        const cx = Math.min(w - 1, Math.max(0, x));
        sum += pixels[(rowStart + cx) * 4 + 3]!;
      }
      temp[rowStart] = sum / (2 * r + 1);
      for (let x = 1; x < w; x++) {
        const addIdx = Math.min(w - 1, x + r);
        const subIdx = Math.max(0, x - r - 1);
        sum += pixels[(rowStart + addIdx) * 4 + 3]! - pixels[(rowStart + subIdx) * 4 + 3]!;
        temp[rowStart + x] = sum / (2 * r + 1);
      }
    }

    // Vertical pass
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let y = -r; y <= r; y++) {
        const cy = Math.min(h - 1, Math.max(0, y));
        sum += temp[cy * w + x]!;
      }
      pixels[x * 4 + 3] = Math.round(sum / (2 * r + 1))!;
      for (let y = 1; y < h; y++) {
        const addIdx = Math.min(h - 1, y + r);
        const subIdx = Math.max(0, y - r - 1);
        sum += temp[addIdx * w + x]! - temp[subIdx * w + x]!;
        pixels[y * w * 4 + x * 4 + 3] = Math.round(sum / (2 * r + 1))!;
      }
    }
  }
}

// ── Enhanced mask rendering ─────────────────────────────────────────────────

export interface EnhancedMaskOptions {
  /** Whether to use luminance instead of alpha */
  luminance?: boolean;
  /** Whether to invert the mask */
  inverted?: boolean;
  /** Feather radius in pixels */
  feather?: number;
  /** Density (0-1) */
  density?: number;
  /** If true, the mask transform is applied independently */
  unlinked?: boolean;
  /** Independent mask transform when unlinked */
  maskTransform?: readonly [number, number, number, number, number, number];
}

/**
 * Render a mask with full post-processing support.
 *
 * Like the existing renderAlphaMask, but applies luminance conversion,
 * inversion, feather, and density post-processing to the mask before
 * compositing.
 */
export function renderEnhancedMask(
  ctx: CanvasRenderingContext2D,
  maskSource: { draw: (ctx: CanvasRenderingContext2D) => void },
  content: { draw: (ctx: CanvasRenderingContext2D) => void },
  options?: EnhancedMaskOptions,
): void {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  if (w === 0 || h === 0) return;

  const opts = options || {};
  const needPostProcess =
    opts.luminance ||
    opts.inverted ||
    (opts.feather ?? 0) > 0 ||
    (opts.density !== undefined && opts.density < 1);

  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = w;
  maskCanvas.height = h;
  const maskCtx = maskCanvas.getContext('2d');
  if (!maskCtx) return;

  const contentCanvas = document.createElement('canvas');
  contentCanvas.width = w;
  contentCanvas.height = h;
  const contentCtx = contentCanvas.getContext('2d');
  if (!contentCtx) return;

  // Render mask source content
  // Apply unlinked mask transform if specified
  if (opts.unlinked && opts.maskTransform) {
    maskCtx.save();
    maskCtx.setTransform(
      opts.maskTransform[0],
      opts.maskTransform[1],
      opts.maskTransform[2],
      opts.maskTransform[3],
      opts.maskTransform[4],
      opts.maskTransform[5],
    );
  }
  maskSource.draw(maskCtx);
  if (opts.unlinked && opts.maskTransform) {
    maskCtx.restore();
  }

  // Post-process the mask pixels if needed
  if (needPostProcess) {
    try {
      const imageData = maskCtx.getImageData(0, 0, w, h);
      applyMaskPostProcess(imageData, opts);
      maskCtx.putImageData(imageData, 0, 0);
    } catch {
      // getImageData may fail for tainted canvases (cross-origin images)
      // Fall through with unprocessed mask in that case
    }
  }

  // Render content
  content.draw(contentCtx);

  // Composite: destination-in keeps content only where mask has non-zero alpha
  contentCtx.globalCompositeOperation = 'destination-in';
  contentCtx.drawImage(maskCanvas, 0, 0);

  // Draw the composited result onto the main canvas
  ctx.drawImage(contentCanvas, 0, 0);
}
