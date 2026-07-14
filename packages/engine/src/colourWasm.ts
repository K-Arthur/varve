/**
 * WASM colour conversion module using strata-colour via wasm-bindgen.
 * Provides ICC-based colour transforms for preview and export.
 */

import type { ColourWasmModule } from './colour/colourLoader';
import { loadColourWasmModule as loadWasmModule, prewarmColourWasm } from './colour/colourLoader';

export { prewarmColourWasm };

let cachedModule: ColourWasmModule | null = null;
let loadPromise: Promise<ColourWasmModule | null> | null = null;

async function ensureColourWasm(): Promise<ColourWasmModule | null> {
  if (cachedModule) return cachedModule;
  if (loadPromise) return loadPromise;
  loadPromise = loadWasmModule().then((mod) => {
    cachedModule = mod;
    return mod;
  });
  return loadPromise;
}

export async function getColourWasm(): Promise<ColourWasmModule | null> {
  return ensureColourWasm();
}

export function isColourWasmAvailable(): boolean {
  return cachedModule !== null;
}

export async function convertSrgbBufferToCmykWasm(
  data: Uint8Array,
  profile?: string,
  renderingIntent?: string,
  blackPointCompensation?: boolean,
): Promise<Uint8Array | null> {
  const mod = await ensureColourWasm();
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

export async function validateColourProfile(data: Uint8Array): Promise<boolean> {
  const mod = await ensureColourWasm();
  if (!mod) return false;
  try {
    return mod.wasm_validate_colour_profile(data);
  } catch {
    return false;
  }
}

export async function getColourProfileInfo(
  data: Uint8Array,
): Promise<{ name: string; colorSpace: string; pcs: string; class_: string } | null> {
  const mod = await ensureColourWasm();
  if (!mod) return null;
  try {
    const json = mod.wasm_colour_profile_info(data);
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export async function srgbToCmykWasm(
  r: number,
  g: number,
  b: number,
  profile?: string,
  renderingIntent?: string,
  blackPointCompensation?: boolean,
): Promise<[number, number, number, number] | null> {
  const mod = await ensureColourWasm();
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
