/**
 * The image/container capability vocabulary shared by import, conversion UI,
 * and documentation. A format is not simply "supported": the level records
 * what Varve can actually preserve at the boundary where it is used.
 */

export type ImageFormatId =
  | 'png'
  | 'jpeg'
  | 'webp'
  | 'avif'
  | 'gif'
  | 'bmp'
  | 'tiff'
  | 'svg'
  | 'svgz'
  | 'pdf'
  | 'psd'
  | 'psb'
  | 'eps'
  | 'ai'
  | 'fig'
  | 'sketch'
  | 'heif'
  | 'jxl'
  | 'qoi'
  | 'ico'
  | 'icns';

export type FormatKind = 'raster' | 'vector' | 'container' | 'document';

export type ImportCapability =
  | 'unsupported'
  | 'metadata-only'
  | 'preview-only'
  | 'flattened-raster'
  | 'editable-raster'
  | 'vector-preserving'
  | 'first-frame'
  | 'partial-document';

export interface FormatCapability {
  id: ImageFormatId;
  label: string;
  kind: FormatKind;
  extensions: readonly string[];
  mimeTypes: readonly string[];
  import: {
    level: ImportCapability;
    browser: 'native' | 'normalized' | 'parser' | 'unsupported';
    desktop: 'native' | 'normalized' | 'parser' | 'unsupported';
    notes: readonly string[];
  };
  export: {
    available: boolean;
    lossy: boolean;
    notes: readonly string[];
  };
  alpha: 'none' | 'binary-or-palette' | 'full' | 'unknown';
  animation: 'none' | 'possible' | 'first-frame-only' | 'full' | 'unknown';
  pages: 'none' | 'possible' | 'first-page-only' | 'full' | 'unknown';
  color: readonly string[];
  metadata: readonly string[];
}

const raster = {
  png: {
    id: 'png',
    label: 'PNG',
    kind: 'raster',
    extensions: ['png'],
    mimeTypes: ['image/png'],
    import: {
      level: 'editable-raster',
      browser: 'native',
      desktop: 'native',
      notes: [
        'Static and animated PNG containers are detected from bytes; animation is not a timeline.',
      ],
    },
    export: { available: true, lossy: false, notes: ['Canvas export is RGBA8.'] },
    alpha: 'full',
    animation: 'possible',
    pages: 'none',
    color: ['RGB/RGBA', '8-bit browser surface', 'ICC metadata retained when valid'],
    metadata: ['PNG color chunks', 'ICC profile', 'DPI where available'],
  },
  jpeg: {
    id: 'jpeg',
    label: 'JPEG',
    kind: 'raster',
    extensions: ['jpg', 'jpeg', 'jpe'],
    mimeTypes: ['image/jpeg'],
    import: {
      level: 'editable-raster',
      browser: 'native',
      desktop: 'native',
      notes: ['CMYK/YCCK pixels are not treated as ordinary RGB without a proven decoder.'],
    },
    export: {
      available: true,
      lossy: true,
      notes: ['Alpha is flattened against an explicit background.'],
    },
    alpha: 'none',
    animation: 'none',
    pages: 'none',
    color: ['RGB browser decode', 'EXIF/ICC metadata inspected'],
    metadata: ['EXIF orientation', 'ICC profile', 'DPI where available'],
  },
  webp: {
    id: 'webp',
    label: 'WebP',
    kind: 'raster',
    extensions: ['webp'],
    mimeTypes: ['image/webp'],
    import: {
      level: 'editable-raster',
      browser: 'native',
      desktop: 'native',
      notes: [
        'Animated WebP is identified and retained as media metadata; editor placement is first-frame.',
      ],
    },
    export: {
      available: true,
      lossy: true,
      notes: ['Encoder mode is selected by the conversion workflow.'],
    },
    alpha: 'full',
    animation: 'possible',
    pages: 'none',
    color: ['RGB/RGBA browser surface', 'ICC metadata inspected'],
    metadata: ['ICC profile where present'],
  },
  avif: {
    id: 'avif',
    label: 'AVIF',
    kind: 'raster',
    extensions: ['avif'],
    mimeTypes: ['image/avif'],
    import: {
      level: 'editable-raster',
      browser: 'native',
      desktop: 'native',
      notes: [
        'Decode availability is runtime-dependent; failed decode is reported instead of silently substituting.',
      ],
    },
    export: {
      available: true,
      lossy: true,
      notes: ['Availability is checked against the active Canvas encoder.'],
    },
    alpha: 'full',
    animation: 'possible',
    pages: 'none',
    color: ['CICP and ICC metadata inspected', 'Browser working surface may be sRGB8'],
    metadata: ['CICP', 'ICC profile where present'],
  },
  gif: {
    id: 'gif',
    label: 'GIF',
    kind: 'raster',
    extensions: ['gif'],
    mimeTypes: ['image/gif'],
    import: {
      level: 'first-frame',
      browser: 'native',
      desktop: 'native',
      notes: [
        'Frame count, timing, loop, disposal, and transparency are inspected; editable placement uses the first frame.',
      ],
    },
    export: {
      available: true,
      lossy: true,
      notes: ['Animation export is not implied by static raster export.'],
    },
    alpha: 'binary-or-palette',
    animation: 'first-frame-only',
    pages: 'none',
    color: ['Indexed palette', '8-bit browser surface'],
    metadata: ['Frame timing and disposal', 'Loop count'],
  },
  bmp: {
    id: 'bmp',
    label: 'BMP',
    kind: 'raster',
    extensions: ['bmp', 'dib'],
    mimeTypes: ['image/bmp', 'image/x-ms-bmp'],
    import: {
      level: 'editable-raster',
      browser: 'native',
      desktop: 'native',
      notes: ['The browser decoder is authoritative for uncommon BMP channel layouts.'],
    },
    export: { available: false, lossy: false, notes: ['No Varve BMP encoder.'] },
    alpha: 'unknown',
    animation: 'none',
    pages: 'none',
    color: ['Browser working surface'],
    metadata: ['Header dimensions'],
  },
  tiff: {
    id: 'tiff',
    label: 'TIFF',
    kind: 'raster',
    extensions: ['tif', 'tiff'],
    mimeTypes: ['image/tiff'],
    import: {
      level: 'flattened-raster',
      browser: 'normalized',
      desktop: 'normalized',
      notes: [
        'The first decoded IFD is normalized to PNG for browser rendering; layered and multi-page fidelity is not claimed.',
      ],
    },
    export: { available: false, lossy: false, notes: ['No Varve TIFF encoder.'] },
    alpha: 'full',
    animation: 'none',
    pages: 'first-page-only',
    color: ['TIFF photometric metadata inspected', 'Browser working surface may be sRGB8'],
    metadata: ['EXIF orientation', 'ICC profile', 'First IFD dimensions'],
  },
} satisfies Record<string, Omit<FormatCapability, 'id'> & { id: ImageFormatId }>;

const nonRaster = {
  svg: {
    id: 'svg',
    label: 'SVG',
    kind: 'vector',
    extensions: ['svg'],
    mimeTypes: ['image/svg+xml'],
    import: {
      level: 'vector-preserving',
      browser: 'parser',
      desktop: 'parser',
      notes: ['External resources and scripts are rejected.'],
    },
    export: {
      available: true,
      lossy: false,
      notes: ['Vector export is available when the scene feature is representable.'],
    },
    alpha: 'full',
    animation: 'possible',
    pages: 'none',
    color: ['Document color model'],
    metadata: ['SVG attributes and embedded resources'],
  },
  svgz: {
    id: 'svgz',
    label: 'SVGZ',
    kind: 'vector',
    extensions: ['svgz'],
    mimeTypes: ['image/svg+xml'],
    import: {
      level: 'vector-preserving',
      browser: 'parser',
      desktop: 'parser',
      notes: ['Gzip is decoded before the same SVG security policy is applied.'],
    },
    export: { available: false, lossy: false, notes: ['No SVGZ encoder.'] },
    alpha: 'full',
    animation: 'possible',
    pages: 'none',
    color: ['Document color model'],
    metadata: ['SVG attributes and embedded resources'],
  },
  pdf: {
    id: 'pdf',
    label: 'PDF',
    kind: 'document',
    extensions: ['pdf'],
    mimeTypes: ['application/pdf'],
    import: {
      level: 'partial-document',
      browser: 'parser',
      desktop: 'parser',
      notes: [
        'Page and vector preservation varies by source feature; unsupported constructs are reported.',
      ],
    },
    export: {
      available: true,
      lossy: false,
      notes: ['Print PDF has explicit color and rasterization policies.'],
    },
    alpha: 'full',
    animation: 'none',
    pages: 'possible',
    color: ['RGB/CMYK document policies'],
    metadata: ['Page boxes and print metadata'],
  },
  psd: {
    id: 'psd',
    label: 'PSD',
    kind: 'container',
    extensions: ['psd'],
    mimeTypes: ['image/vnd.adobe.photoshop'],
    import: {
      level: 'partial-document',
      browser: 'parser',
      desktop: 'parser',
      notes: [
        'Supported layers are imported; effects, smart objects, and unsupported adjustment layers are disclosed.',
      ],
    },
    export: { available: false, lossy: false, notes: ['No PSD encoder.'] },
    alpha: 'full',
    animation: 'none',
    pages: 'none',
    color: ['Source metadata inspected where available'],
    metadata: ['Layer names and dimensions where parsed'],
  },
  psb: {
    id: 'psb',
    label: 'PSB',
    kind: 'container',
    extensions: ['psb'],
    mimeTypes: ['image/vnd.adobe.photoshop'],
    import: {
      level: 'unsupported',
      browser: 'unsupported',
      desktop: 'unsupported',
      notes: ['Large-document Photoshop decoding is not bundled.'],
    },
    export: { available: false, lossy: false, notes: ['No PSB encoder.'] },
    alpha: 'unknown',
    animation: 'none',
    pages: 'none',
    color: [],
    metadata: [],
  },
  eps: {
    id: 'eps',
    label: 'EPS',
    kind: 'document',
    extensions: ['eps'],
    mimeTypes: ['application/postscript'],
    import: {
      level: 'partial-document',
      browser: 'parser',
      desktop: 'parser',
      notes: [
        'Only the maintained safe subset is parsed; PostScript execution is never performed.',
      ],
    },
    export: { available: false, lossy: false, notes: ['No EPS encoder.'] },
    alpha: 'unknown',
    animation: 'none',
    pages: 'none',
    color: ['Source color declarations where parsed'],
    metadata: ['Bounding box'],
  },
  ai: {
    id: 'ai',
    label: 'Illustrator',
    kind: 'document',
    extensions: ['ai'],
    mimeTypes: ['application/illustrator'],
    import: {
      level: 'partial-document',
      browser: 'parser',
      desktop: 'parser',
      notes: ['Illustrator-compatible PostScript subset only.'],
    },
    export: { available: false, lossy: false, notes: ['No Illustrator encoder.'] },
    alpha: 'unknown',
    animation: 'none',
    pages: 'none',
    color: [],
    metadata: ['Bounding box'],
  },
  fig: {
    id: 'fig',
    label: 'Figma',
    kind: 'document',
    extensions: ['fig', 'fig.json'],
    mimeTypes: ['application/json'],
    import: {
      level: 'partial-document',
      browser: 'parser',
      desktop: 'parser',
      notes: ['Official/native binary .fig support is disclosed separately from JSON exports.'],
    },
    export: { available: false, lossy: false, notes: ['No Figma encoder.'] },
    alpha: 'unknown',
    animation: 'none',
    pages: 'possible',
    color: ['Source color declarations where parsed'],
    metadata: ['Node and page metadata where parsed'],
  },
  sketch: {
    id: 'sketch',
    label: 'Sketch',
    kind: 'container',
    extensions: ['sketch'],
    mimeTypes: ['application/zip'],
    import: {
      level: 'partial-document',
      browser: 'parser',
      desktop: 'parser',
      notes: [
        'Supported JSON layer content is converted; symbols and advanced effects may be omitted.',
      ],
    },
    export: { available: false, lossy: false, notes: ['No Sketch encoder.'] },
    alpha: 'full',
    animation: 'none',
    pages: 'possible',
    color: ['Source color declarations where parsed'],
    metadata: ['Layer metadata where parsed'],
  },
  heif: {
    id: 'heif',
    label: 'HEIF/HEIC',
    kind: 'container',
    extensions: ['heif', 'heic'],
    mimeTypes: ['image/heif', 'image/heic'],
    import: {
      level: 'unsupported',
      browser: 'unsupported',
      desktop: 'unsupported',
      notes: ['No bundled local decoder; this is intentionally not advertised as importable.'],
    },
    export: { available: false, lossy: false, notes: ['No HEIF encoder.'] },
    alpha: 'unknown',
    animation: 'possible',
    pages: 'possible',
    color: [],
    metadata: [],
  },
  jxl: {
    id: 'jxl',
    label: 'JPEG XL',
    kind: 'raster',
    extensions: ['jxl'],
    mimeTypes: ['image/jxl'],
    import: {
      level: 'unsupported',
      browser: 'unsupported',
      desktop: 'unsupported',
      notes: ['No bundled local decoder.'],
    },
    export: { available: false, lossy: false, notes: ['No JPEG XL encoder.'] },
    alpha: 'full',
    animation: 'possible',
    pages: 'none',
    color: [],
    metadata: [],
  },
  qoi: {
    id: 'qoi',
    label: 'QOI',
    kind: 'raster',
    extensions: ['qoi'],
    mimeTypes: ['image/qoi'],
    import: {
      level: 'unsupported',
      browser: 'unsupported',
      desktop: 'unsupported',
      notes: ['No browser/native provider is bundled.'],
    },
    export: { available: false, lossy: false, notes: ['No QOI encoder.'] },
    alpha: 'full',
    animation: 'none',
    pages: 'none',
    color: [],
    metadata: [],
  },
  ico: {
    id: 'ico',
    label: 'ICO',
    kind: 'container',
    extensions: ['ico'],
    mimeTypes: ['image/x-icon', 'image/vnd.microsoft.icon'],
    import: {
      level: 'unsupported',
      browser: 'unsupported',
      desktop: 'unsupported',
      notes: ['Multi-resolution icon extraction is not yet part of the image lifecycle.'],
    },
    export: {
      available: true,
      lossy: false,
      notes: [
        'Icon export is handled by the dedicated export encoder, not generic image conversion.',
      ],
    },
    alpha: 'full',
    animation: 'none',
    pages: 'possible',
    color: ['RGBA icon frames'],
    metadata: ['Icon frame dimensions'],
  },
  icns: {
    id: 'icns',
    label: 'ICNS',
    kind: 'container',
    extensions: ['icns'],
    mimeTypes: ['image/icns'],
    import: {
      level: 'unsupported',
      browser: 'unsupported',
      desktop: 'unsupported',
      notes: ['Import is not bundled; desktop icon export remains a separate path.'],
    },
    export: {
      available: true,
      lossy: false,
      notes: ['Icon export is handled by the dedicated export encoder.'],
    },
    alpha: 'full',
    animation: 'none',
    pages: 'possible',
    color: ['RGBA icon frames'],
    metadata: ['Icon frame dimensions'],
  },
} satisfies Record<string, Omit<FormatCapability, 'id'> & { id: ImageFormatId }>;

export const FORMAT_CAPABILITIES: readonly FormatCapability[] = [
  ...Object.values(raster),
  ...Object.values(nonRaster),
];

const byId = new Map(FORMAT_CAPABILITIES.map((format) => [format.id, format]));
const extensionToId = new Map(
  FORMAT_CAPABILITIES.flatMap((format) =>
    format.extensions.map((extension) => [extension, format.id] as const),
  ),
);
const mimeToId = new Map(
  FORMAT_CAPABILITIES.flatMap((format) =>
    format.mimeTypes.map((mime) => [mime, format.id] as const),
  ),
);

export function listFormatCapabilities(): readonly FormatCapability[] {
  return FORMAT_CAPABILITIES;
}

export function getFormatCapability(id: ImageFormatId): FormatCapability | undefined {
  return byId.get(id);
}

export function formatForExtension(extension: string): ImageFormatId | undefined {
  return extensionToId.get(extension.replace(/^\./, '').toLowerCase());
}

export function formatForMime(mime: string): ImageFormatId | undefined {
  return mimeToId.get(mime.split(';', 1)[0]!.trim().toLowerCase());
}

export function mimeForFormat(id: ImageFormatId): string | undefined {
  return byId.get(id)?.mimeTypes[0];
}

export function listImportableRasterExtensions(): readonly string[] {
  return FORMAT_CAPABILITIES.filter(
    (format) => format.kind === 'raster' && format.import.level !== 'unsupported',
  ).flatMap((format) => format.extensions);
}

export type FormatDetectionSource = 'signature' | 'mime' | 'extension' | 'none';

export interface FormatDetection {
  format: ImageFormatId | null;
  source: FormatDetectionSource;
  extension?: string;
  suppliedMimeType?: string;
  warnings: readonly FormatDetectionWarning[];
}

export interface FormatDetectionWarning {
  code: 'extension-mismatch' | 'mime-mismatch' | 'signature-unverified';
  message: string;
}

function hasBytes(data: unknown): data is Uint8Array {
  return data instanceof Uint8Array;
}

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  return signature.every((value, index) => bytes[offset + index] === value);
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(start, Math.min(bytes.length, start + length)));
}

function signatureFormat(bytes: Uint8Array): ImageFormatId | undefined {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return 'gif';
  if (startsWith(bytes, [0x42, 0x4d])) return 'bmp';
  if (startsWith(bytes, [0x49, 0x49, 0x2a, 0x00]) || startsWith(bytes, [0x4d, 0x4d, 0x00, 0x2a]))
    return 'tiff';
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && ascii(bytes, 8, 4) === 'WEBP') return 'webp';
  if (ascii(bytes, 0, 5) === '%PDF-') return 'pdf';
  if (ascii(bytes, 0, 4) === '8BPS') return 'psd';

  // HEIF/AVIF are ISO Base Media containers. The compatible-brand list can
  // appear after a variable number of bytes, so scan bounded top-level boxes.
  let offset = 0;
  for (let boxes = 0; boxes < 32 && offset + 8 <= bytes.length; boxes += 1) {
    const size = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset);
    const type = ascii(bytes, offset + 4, 4);
    if (type === 'ftyp' && offset + 12 <= bytes.length) {
      const brands = ascii(bytes, offset + 8, Math.min(size || bytes.length - offset, 128));
      if (brands.includes('avif') || brands.includes('avis')) return 'avif';
      if (
        ['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1'].some((brand) => brands.includes(brand))
      ) {
        return 'heif';
      }
    }
    if (size < 8) break;
    offset += size;
  }

  return undefined;
}

function textSignature(data: string | Uint8Array): ImageFormatId | undefined {
  const text =
    typeof data === 'string'
      ? data.trimStart()
      : new TextDecoder().decode(data.subarray(0, 4096)).trimStart();
  return /^<\?xml\b[\s\S]*<svg\b/i.test(text) || /^<svg\b/i.test(text) ? 'svg' : undefined;
}

/** Detect content first, retaining mismatch diagnostics for the UI/report. */
export function detectFileFormat(input: {
  filename?: string;
  mimeType?: string;
  data?: string | Uint8Array;
}): FormatDetection {
  const extension = input.filename
    ?.split(/[./\\]/)
    .pop()
    ?.toLowerCase();
  const extensionFormat = extension ? formatForExtension(extension) : undefined;
  const mimeFormat = input.mimeType ? formatForMime(input.mimeType) : undefined;
  const signature = input.data
    ? hasBytes(input.data)
      ? (signatureFormat(input.data) ?? textSignature(input.data))
      : textSignature(input.data)
    : undefined;
  const format = signature ?? mimeFormat ?? extensionFormat ?? null;
  const warnings: FormatDetectionWarning[] = [];

  if (signature && extensionFormat && signature !== extensionFormat) {
    warnings.push({
      code: 'extension-mismatch',
      message: `The filename extension .${extension} does not match the detected ${signature.toUpperCase()} content; content detection was used.`,
    });
  }
  if (signature && mimeFormat && signature !== mimeFormat) {
    warnings.push({
      code: 'mime-mismatch',
      message: `The supplied MIME type ${input.mimeType} does not match the detected ${signature.toUpperCase()} content; content detection was used.`,
    });
  }
  if (!signature && input.data && (extensionFormat || mimeFormat)) {
    warnings.push({
      code: 'signature-unverified',
      message: 'The file signature could not be verified before the format provider was selected.',
    });
  }

  return {
    format,
    source: signature ? 'signature' : mimeFormat ? 'mime' : extensionFormat ? 'extension' : 'none',
    ...(extension ? { extension } : {}),
    ...(input.mimeType ? { suppliedMimeType: input.mimeType } : {}),
    warnings,
  };
}
