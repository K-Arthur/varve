export interface ColourWasmModule {
  wasm_rgb_to_cmyk(r: number, g: number, b: number): Uint8Array;
  wasm_cmyk_to_rgb(c: number, m: number, y: number, k: number): Uint8Array;
  wasm_rgb_to_cmyk_icc(
    r: number,
    g: number,
    b: number,
    profileName: string,
    renderingIntent: string,
    bpc: boolean,
  ): Uint8Array;
  wasm_convert_srgb_buffer_to_cmyk(
    data: Uint8Array,
    profileData: Uint8Array,
    renderingIntent: string,
    bpc: boolean,
  ): Uint8Array;
  wasm_validate_colour_profile(data: Uint8Array): boolean;
  wasm_colour_profile_info(data: Uint8Array): string;
  wasm_batch_rgb_to_cmyk_icc(
    data: Uint8Array,
    profileName: string,
    renderingIntent: string,
    bpc: boolean,
  ): Uint8Array;
}

let cachedModule: ColourWasmModule | null = null;
let initPromise: Promise<void> | null = null;

const WASM_CANDIDATES = ['/wasm/varve_colour_bg.wasm'];

function wasmUrlToJsUrl(wasmUrl: string): string {
  return wasmUrl.replace('_bg.wasm', '.js');
}

async function tryLoadCandidate(wasmUrl: string): Promise<ColourWasmModule | null> {
  try {
    const headResp = await fetch(wasmUrl, { method: 'HEAD' });
    if (!headResp.ok) return null;
    const jsUrl = wasmUrlToJsUrl(wasmUrl);
    const jsResp = await fetch(jsUrl);
    if (!jsResp.ok) return null;
    const jsCode = await jsResp.text();
    const blob = new Blob([jsCode], { type: 'text/javascript' });
    const blobUrl = URL.createObjectURL(blob);
    try {
      const mod = (await import(/* @vite-ignore */ blobUrl)) as {
        default: (init: { module_or_path: Promise<ArrayBuffer> }) => Promise<ColourWasmModule>;
      };
      const module = await mod.default({
        module_or_path: fetch(wasmUrl).then((r) => r.arrayBuffer()),
      });
      return module as unknown as ColourWasmModule;
    } finally {
      URL.revokeObjectURL(blobUrl);
    }
  } catch {
    return null;
  }
}

export async function loadColourWasmModule(): Promise<ColourWasmModule | null> {
  if (cachedModule) return cachedModule;
  if (!initPromise) {
    initPromise = (async () => {
      for (const candidate of WASM_CANDIDATES) {
        const mod = await tryLoadCandidate(candidate);
        if (mod) {
          cachedModule = mod;
          return;
        }
      }
    })();
  }
  await initPromise;
  return cachedModule;
}

export function prewarmColourWasm(): void {
  if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
    (window as Window & typeof globalThis).requestIdleCallback(
      () => {
        void loadColourWasmModule();
      },
      { timeout: 2000 },
    );
  } else {
    setTimeout(() => void loadColourWasmModule(), 500);
  }
}

export interface ColourEngine {
  readonly backend: 'wasm';
  rgbToCmyk(r: number, g: number, b: number): Uint8Array;
  cmykToRgb(c: number, m: number, y: number, k: number): Uint8Array;
  rgbToCmykIcc(
    r: number,
    g: number,
    b: number,
    profileName: string,
    renderingIntent: string,
    bpc: boolean,
  ): Uint8Array;
  convertSrgbBufferToCmyk(
    data: Uint8Array,
    profileData: Uint8Array,
    renderingIntent: string,
    bpc: boolean,
  ): Uint8Array;
  validateColourProfile(data: Uint8Array): boolean;
  colourProfileInfo(data: Uint8Array): Record<string, unknown>;
  batchRgbToCmykIcc(
    data: Uint8Array,
    profileName: string,
    renderingIntent: string,
    bpc: boolean,
  ): Uint8Array;
}

export function createColourEngineFromModule(mod: ColourWasmModule): ColourEngine {
  return {
    backend: 'wasm',
    rgbToCmyk(r: number, g: number, b: number): Uint8Array {
      return mod.wasm_rgb_to_cmyk(r, g, b);
    },
    cmykToRgb(c: number, m: number, y: number, k: number): Uint8Array {
      return mod.wasm_cmyk_to_rgb(c, m, y, k);
    },
    rgbToCmykIcc(
      r: number,
      g: number,
      b: number,
      profileName: string,
      renderingIntent: string,
      bpc: boolean,
    ): Uint8Array {
      return mod.wasm_rgb_to_cmyk_icc(r, g, b, profileName, renderingIntent, bpc);
    },
    convertSrgbBufferToCmyk(
      data: Uint8Array,
      profileData: Uint8Array,
      renderingIntent: string,
      bpc: boolean,
    ): Uint8Array {
      return mod.wasm_convert_srgb_buffer_to_cmyk(data, profileData, renderingIntent, bpc);
    },
    validateColourProfile(data: Uint8Array): boolean {
      return mod.wasm_validate_colour_profile(data);
    },
    colourProfileInfo(data: Uint8Array): Record<string, unknown> {
      return JSON.parse(mod.wasm_colour_profile_info(data)) as Record<string, unknown>;
    },
    batchRgbToCmykIcc(
      data: Uint8Array,
      profileName: string,
      renderingIntent: string,
      bpc: boolean,
    ): Uint8Array {
      return mod.wasm_batch_rgb_to_cmyk_icc(data, profileName, renderingIntent, bpc);
    },
  };
}
