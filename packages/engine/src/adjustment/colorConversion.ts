/**
 * Color conversion utilities with WASM-first ICC pipeline and analytical fallback.
 */

/**
 * Convert an RGBA pixel buffer from sRGB to CMYK using ICC if available.
 * Falls back to analytical conversion when WASM is not loaded.
 */
export async function convertToCmykIcc(
  rgba: Uint8Array,
  width: number,
  height: number,
  profile?: string,
  renderingIntent?: string,
  blackPointCompensation?: boolean,
): Promise<Uint8Array> {
  const totalPixels = width * height;

  // Build an RGB-only view (discard alpha for the WASM path)
  const rgb = new Uint8Array(totalPixels * 3);
  for (let i = 0; i < totalPixels; i++) {
    const src = i * 4;
    const dst = i * 3;
    rgb[dst] = rgba[src]!;
    rgb[dst + 1] = rgba[src + 1]!;
    rgb[dst + 2] = rgba[src + 2]!;
  }

  // Try WASM path first
  let wasmProviderLoaded = false;
  try {
    const { convertSrgbBufferToCmykWasm, isColourWasmAvailable } = await import('../colourWasm');
    const result = await convertSrgbBufferToCmykWasm(
      rgb,
      profile,
      renderingIntent,
      blackPointCompensation,
    );
    if (result) {
      // Re-interleave alpha
      const cmyk = new Uint8Array(totalPixels * 4);
      for (let i = 0; i < totalPixels; i++) {
        const src = i * 4;
        const dst = i * 4;
        cmyk[dst] = result[src]!;
        cmyk[dst + 1] = result[src + 1]!;
        cmyk[dst + 2] = result[src + 2]!;
        cmyk[dst + 3] = rgba[i * 4 + 3]!;
      }
      return cmyk;
    }
    wasmProviderLoaded = isColourWasmAvailable();
    // A loaded WASM module failing a requested profile is a real conversion
    // error, not permission to reinterpret the output with the approximate
    // browser formula. Preserve the old analytical fallback only when no
    // ICC provider could be loaded at all.
    if (wasmProviderLoaded) {
      throw new Error(`ICC conversion failed for destination profile ${profile ?? 'Fogra39'}`);
    }
  } catch (error) {
    // Loading failures fall through to the explicitly documented analytical
    // path. Provider failures after a module was loaded are rethrown below.
    if (wasmProviderLoaded) throw error;
  }

  // Fallback: analytical conversion
  const cmyk = new Uint8Array(totalPixels * 4);
  for (let i = 0; i < totalPixels; i++) {
    const offset = i * 4;
    const r = rgba[offset]!;
    const g = rgba[offset + 1]!;
    const b = rgba[offset + 2]!;
    const a = rgba[offset + 3]!;
    const k = 1 - Math.max(r / 255, g / 255, b / 255);
    const c = (1 - r / 255 - k) / (1 - k || 1);
    const m = (1 - g / 255 - k) / (1 - k || 1);
    const y = (1 - b / 255 - k) / (1 - k || 1);
    const cmykOffset = i * 4;
    // `c`, `m`, and `y` are already the normalized subtractive channels.
    // Writing their complements silently swapped every primary (red became
    // cyan) whenever the ICC/WASM provider was unavailable.
    cmyk[cmykOffset] = Math.round(c * 255);
    cmyk[cmykOffset + 1] = Math.round(m * 255);
    cmyk[cmykOffset + 2] = Math.round(y * 255);
    cmyk[cmykOffset + 3] = a;
  }
  return cmyk;
}

/**
 * Analytical-only sRGB to CMYK (no WASM dependency).
 */
export function analyticalRgbToCmyk(
  r: number,
  g: number,
  b: number,
): [number, number, number, number] {
  const rr = r / 255;
  const gg = g / 255;
  const bb = b / 255;
  const k = 1 - Math.max(rr, gg, bb);
  if (k === 1) return [0, 0, 0, 255];
  const c = (1 - rr - k) / (1 - k);
  const m = (1 - gg - k) / (1 - k);
  const y = (1 - bb - k) / (1 - k);
  return [Math.round(c * 255), Math.round(m * 255), Math.round(y * 255), Math.round(k * 255)];
}

/**
 * Analytical-only CMYK to sRGB (no WASM dependency).
 */
export function analyticalCmykToRgb(
  c: number,
  m: number,
  y: number,
  k: number,
): [number, number, number] {
  const r = Math.round(255 * (1 - c / 255) * (1 - k / 255));
  const g = Math.round(255 * (1 - m / 255) * (1 - k / 255));
  const b_ = Math.round(255 * (1 - y / 255) * (1 - k / 255));
  return [r, g, b_];
}
