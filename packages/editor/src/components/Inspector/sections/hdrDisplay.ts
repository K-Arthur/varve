import type { RangeRaster } from '@varve/shared';

export type HdrDisplayAvailability = 'unsupported' | 'unknown' | 'candidate';

export interface HdrDisplayCapabilities {
  availability: HdrDisplayAvailability;
  float16Canvas: boolean;
  highDynamicRangeMedia: boolean;
  wideGamutMedia: boolean;
  webGpuAvailable: boolean;
  explanation: string;
}

/**
 * Runtime probe only. Browser API acceptance is not a physical HDR-display
 * certification; the UI must retain that distinction in its status label.
 */
export function probeHdrDisplayCapabilities(): HdrDisplayCapabilities {
  if (typeof document === 'undefined') {
    return unavailable('No browser display runtime is present');
  }
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', {
    colorSpace: 'display-p3',
    colorType: 'float16',
  } as CanvasRenderingContext2DSettings);
  const float16Canvas = Boolean(context);
  const highDynamicRangeMedia = mediaQueryMatches('(dynamic-range: high)');
  const wideGamutMedia = mediaQueryMatches('(color-gamut: p3)');
  const webGpuAvailable =
    typeof navigator !== 'undefined' &&
    'gpu' in navigator &&
    Boolean((navigator as Navigator & { gpu?: unknown }).gpu);
  if (float16Canvas && highDynamicRangeMedia) {
    return {
      availability: 'candidate',
      float16Canvas,
      highDynamicRangeMedia,
      wideGamutMedia,
      webGpuAvailable,
      explanation:
        'The runtime accepted a float16 wide-gamut canvas and reports high dynamic range; physical luminance remains unverified.',
    };
  }
  if (float16Canvas || webGpuAvailable || highDynamicRangeMedia) {
    return {
      availability: 'unknown',
      float16Canvas,
      highDynamicRangeMedia,
      wideGamutMedia,
      webGpuAvailable,
      explanation:
        'Some HDR-capable APIs are present, but the runtime/display combination is not sufficient for a verified HDR presentation claim.',
    };
  }
  return unavailable('This runtime reports no usable HDR presentation capability');
}

/** Draw extended display-referred values when the browser accepts float16 Canvas2D. */
export function renderExtendedCanvasPreview(
  canvas: HTMLCanvasElement,
  source: RangeRaster,
): HdrDisplayCapabilities {
  const capabilities = probeHdrDisplayCapabilities();
  if (!capabilities.float16Canvas) return capabilities;
  const { width, height, stride, referenceWhite } = source.contract;
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', {
    colorSpace: 'display-p3',
    colorType: 'float16',
  } as CanvasRenderingContext2DSettings);
  if (!context) return { ...capabilities, availability: 'unknown' };
  const Float16ArrayConstructor = (
    globalThis as typeof globalThis & {
      Float16Array?: new (length: number) => { [index: number]: number; length: number };
    }
  ).Float16Array;
  if (!Float16ArrayConstructor) {
    return {
      ...capabilities,
      availability: 'unknown',
      explanation:
        'Canvas accepted float16 configuration, but this runtime cannot construct float16 pixels.',
    };
  }
  const pixels = new Float16ArrayConstructor(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const input = y * stride + x * 4;
      const output = (y * width + x) * 4;
      pixels[output] = Math.max(0, source.pixels[input]! / referenceWhite);
      pixels[output + 1] = Math.max(0, source.pixels[input + 1]! / referenceWhite);
      pixels[output + 2] = Math.max(0, source.pixels[input + 2]! / referenceWhite);
      pixels[output + 3] = Math.max(0, Math.min(1, source.pixels[input + 3]!));
    }
  }
  const imageData = new ImageData(
    pixels as unknown as ConstructorParameters<typeof ImageData>[0],
    width,
    height,
    { colorSpace: 'display-p3', colorType: 'float16' } as ImageDataSettings,
  );
  context.putImageData(imageData, 0, 0);
  return capabilities;
}

function mediaQueryMatches(query: string): boolean {
  return typeof matchMedia === 'function' && matchMedia(query).matches;
}

function unavailable(explanation: string): HdrDisplayCapabilities {
  return {
    availability: 'unsupported',
    float16Canvas: false,
    highDynamicRangeMedia: false,
    wideGamutMedia: false,
    webGpuAvailable: false,
    explanation,
  };
}
