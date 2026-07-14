/**
 * WASM colour conversion module using strata-colour via wasm-bindgen.
 * Provides ICC-based colour transforms for preview and export.
 */

import type { ColourWasmModule } from '@strata/print';

let cachedModule: ColourWasmModule | null = null;
let loadPromise: Promise<ColourWasmModule | null> | null = null;

/**
 * Pre-warm the colour WASM module during idle time.
 */
export function prewarmColourWasm(): void {
  if (cachedModule || loadPromise) return;
  loadPromise = loadColourWasm();
}

async function loadColourWasm(): Promise<ColourWasmModule | null> {
  try {
    const { loadColourWasmModule } = await import('@strata/print');
    const mod = await loadColourWasmModule();
    cachedModule = mod;
    return mod;
  } catch (e) {
    console.warn('[colourWasm] Failed to load colour WASM module:', e);
    return null;
  }
}

/**
 * Get the loaded colour WASM module, loading it if necessary.
 */
export async function getColourWasm(): Promise<ColourWasmModule | null> {
  if (cachedModule) return cachedModule;
  if (loadPromise) return loadPromise;
  loadPromise = loadColourWasm();
  return loadPromise;
}

/**
 * Convert an sRGB pixel buffer to CMYK using the ICC profile pipeline.
 * Uses wasm_batch_rgb_to_cmyk_icc which accepts a profile name string.
 * Returns null if WASM is unavailable.
 */
export async function convertSrgbBufferToCmykWasm(
  data: Uint8Array,
  profile?: string,
  renderingIntent?: string,
  blackPointCompensation?: boolean,
): Promise<Uint8Array | null> {
  const mod = await getColourWasm();
  if (!mod) return null;

  try {
    return mod.wasm_batch_rgb_to_cmyk_icc(
      data,
      profile ?? 'Fogra39',
      renderingIntent ?? 'relativeColorimetric',
      blackPointCompensation ?? true,
    );
  } catch (e) {
    console.warn('[colourWasm] Buffer conversion failed:', e);
    return null;
  }
}

/**
 * Validate an ICC profile by its raw bytes.
 */
export async function validateColourProfile(data: Uint8Array): Promise<boolean> {
  const mod = await getColourWasm();
  if (!mod) return false;
  try {
    return mod.wasm_validate_colour_profile(data);
  } catch {
    return false;
  }
}

/**
 * Parse ICC profile information from raw bytes.
 * Returns null if WASM unavailable or parsing fails.
 */
export async function getColourProfileInfo(
  data: Uint8Array,
): Promise<{ name: string; colorSpace: string; pcs: string; class_: string } | null> {
  const mod = await getColourWasm();
  if (!mod) return null;
  try {
    const json = mod.wasm_colour_profile_info(data);
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/**
 * Convert a single sRGB colour to CMYK using ICC profile.
 * Returns null if WASM unavailable.
 */
export async function srgbToCmykWasm(
  r: number,
  g: number,
  b: number,
  profile?: string,
  renderingIntent?: string,
  blackPointCompensation?: boolean,
): Promise<[number, number, number, number] | null> {
  const mod = await getColourWasm();
  if (!mod) return null;
  try {
    const result = mod.wasm_rgb_to_cmyk_icc(
      r,
      g,
      b,
      profile ?? 'Fogra39',
      renderingIntent ?? 'relativeColorimetric',
      blackPointCompensation ?? true,
    );
    return [result[0]!, result[1]!, result[2]!, result[3]!];
  } catch {
    return null;
  }
}

/**
 * Check whether the colour WASM module is available.
 */
export function isColourWasmAvailable(): boolean {
  return cachedModule !== null;
}
