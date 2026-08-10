/**
 * PNG colour metadata parsing (sRGB / cHRM / gAMA / bit depth) for raster
 * ingestion.
 *
 * PNG carries colour information in four places, in descending authority:
 *
 *   iCCP   — embedded ICC profile (authoritative when valid)
 *   sRGB   — standard sRGB chunk with a rendering intent byte
 *   cHRM   — chromaticities (white point + RGB primaries)
 *   gAMA   — gamma value only
 *
 * This module reads the latter three (iCCP is handled by ./icc.ts) so the
 * ingestion pipeline can record what the file actually said. Precedence
 * follows the PNG specification: when iCCP and sRGB both appear they must
 * describe the same profile; we never average conflicting metadata — the
 * higher-authority chunk wins and the conflict is recorded as a diagnostic.
 *
 * cHRM chromaticities are matched against the standard gamuts (sRGB,
 * Display P3, Adobe RGB) within a small tolerance; a match yields a `named`
 * encoding, anything else is recorded as explicit unknown gamut rather than
 * guessed.
 */

import type { RasterColorEncoding, RgbPrimariesName, TransferFunctionName } from '@varve/shared';
import type { IccExtractionResult } from './icc';

/** Max chunk count walked defensively (well above any real PNG). */
const MAX_CHUNKS = 4096;

/** Chromaticity tolerance for cHRM → named gamut matching (in xy units). */
const CHROMATICITY_TOLERANCE = 0.002;

/** Reference chromaticities: white + RGB primaries, xy coordinates. */
interface Chromaticities {
  white: readonly [number, number];
  red: readonly [number, number];
  green: readonly [number, number];
  blue: readonly [number, number];
}

const SRGB_CHROMATICITIES: Chromaticities = {
  white: [0.3127, 0.329],
  red: [0.64, 0.33],
  green: [0.3, 0.6],
  blue: [0.15, 0.06],
};

const DISPLAY_P3_CHROMATICITIES: Chromaticities = {
  white: [0.3127, 0.329],
  red: [0.68, 0.32],
  green: [0.265, 0.69],
  blue: [0.15, 0.06],
};

const ADOBE_RGB_CHROMATICITIES: Chromaticities = {
  white: [0.3127, 0.329],
  red: [0.64, 0.33],
  green: [0.21, 0.71],
  blue: [0.15, 0.06],
};

const PROPHOTO_CHROMATICITIES: Chromaticities = {
  white: [0.3457, 0.3585],
  red: [0.7347, 0.2653],
  green: [0.1596, 0.8404],
  blue: [0.0366, 0.0001],
};

/** PNG chunk scan result — only colour-relevant chunks are retained. */
export interface PngColorChunks {
  /** sRGB chunk rendering intent byte (0-3), when present. */
  srgbIntent?: number;
  /** cHRM chromaticities (values /100000), when present. */
  chroma?: Chromaticities;
  /** gAMA gamma value (encoded /100000), when present. */
  gamma?: number;
  /** IHDR bit depth (1/2/4/8/16), when parseable. */
  bitDepth?: number;
  /** IHDR colour type (0-6), when parseable. */
  colorType?: number;
  /** Non-fatal diagnostics (conflicts), when detected. */
  diagnostics: string[];
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
  if (offset + 3 >= bytes.length) return 0;
  return (
    (((bytes[offset] as number) << 24) |
      ((bytes[offset + 1] as number) << 16) |
      ((bytes[offset + 2] as number) << 8) |
      (bytes[offset + 3] as number)) >>>
    0
  );
}

function chromaticityPair(bytes: Uint8Array, offset: number): readonly [number, number] {
  return [readUint32BE(bytes, offset) / 100000, readUint32BE(bytes, offset + 4) / 100000];
}

function closeEnough(a: readonly [number, number], b: readonly [number, number]): boolean {
  return (
    Math.abs(a[0] - b[0]) <= CHROMATICITY_TOLERANCE &&
    Math.abs(a[1] - b[1]) <= CHROMATICITY_TOLERANCE
  );
}

function chromaMatches(chroma: Chromaticities, reference: Chromaticities): boolean {
  return (
    closeEnough(chroma.white, reference.white) &&
    closeEnough(chroma.red, reference.red) &&
    closeEnough(chroma.green, reference.green) &&
    closeEnough(chroma.blue, reference.blue)
  );
}

/** Match cHRM chromaticities to a named primaries family, or 'unknown'. */
export function matchNamedPrimaries(chroma: Chromaticities): RgbPrimariesName {
  if (chromaMatches(chroma, SRGB_CHROMATICITIES)) return 'srgb';
  if (chromaMatches(chroma, DISPLAY_P3_CHROMATICITIES)) return 'display-p3';
  if (chromaMatches(chroma, ADOBE_RGB_CHROMATICITIES)) return 'adobe-rgb';
  if (chromaMatches(chroma, PROPHOTO_CHROMATICITIES)) return 'pro-photo';
  return 'unknown';
}

/** Map a gAMA value to a transfer function name (approximate, documented). */
export function gammaToTransfer(gamma: number): TransferFunctionName {
  if (gamma === 0) return 'unknown';
  if (Math.abs(gamma - 0.45455) < 0.02) return 'srgb';
  if (Math.abs(gamma - 1 / 2.2) < 0.02) return 'gamma22';
  if (Math.abs(gamma - 1 / 1.8) < 0.02) return 'gamma18';
  if (Math.abs(gamma - 1) < 0.02) return 'linear';
  return 'unknown';
}

/** Scan a PNG byte stream for colour metadata chunks. Never throws. */
export function readPngColorChunks(bytes: Uint8Array): PngColorChunks {
  const result: PngColorChunks = { diagnostics: [] };
  if (bytes.length < 8 || bytes[0] !== 0x89 || bytes[1] !== 0x50) return result;

  let offset = 8;
  for (let chunks = 0; chunks < MAX_CHUNKS; chunks += 1) {
    if (offset + 8 > bytes.length) break;
    const length = readUint32BE(bytes, offset);
    const type = String.fromCharCode(
      bytes[offset + 4] ?? 0,
      bytes[offset + 5] ?? 0,
      bytes[offset + 6] ?? 0,
      bytes[offset + 7] ?? 0,
    );
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd > bytes.length) break;

    if (type === 'IHDR' && length >= 8) {
      result.bitDepth = bytes[dataStart + 8];
      result.colorType = bytes[dataStart + 9];
    } else if (type === 'sRGB' && length >= 1) {
      const intent = bytes[dataStart];
      if (intent !== undefined && intent <= 3) result.srgbIntent = intent;
      else result.diagnostics.push('sRGB chunk with invalid rendering intent');
    } else if (type === 'cHRM' && length >= 32) {
      result.chroma = {
        white: chromaticityPair(bytes, dataStart),
        red: chromaticityPair(bytes, dataStart + 8),
        green: chromaticityPair(bytes, dataStart + 16),
        blue: chromaticityPair(bytes, dataStart + 24),
      };
    } else if (type === 'gAMA' && length >= 4) {
      const gamma = readUint32BE(bytes, dataStart) / 100000;
      if (gamma > 0 && gamma < 10) result.gamma = gamma;
    }
    if (type === 'IEND') break;
    offset = dataEnd + 4; // skip CRC
  }

  if (result.srgbIntent !== undefined && result.chroma !== undefined) {
    const matched = matchNamedPrimaries(result.chroma);
    if (matched !== 'srgb') {
      result.diagnostics.push('sRGB chunk present but cHRM chromaticities do not match sRGB');
    }
  }
  return result;
}

/**
 * Resolve the PNG colour encoding: embedded ICC wins, then the sRGB chunk,
 * then cHRM/gAMA, then nothing (explicitly unknown — never silently sRGB).
 */
export function resolvePngEncoding(
  bytes: Uint8Array,
  icc: IccExtractionResult,
): RasterColorEncoding {
  const chunks = readPngColorChunks(bytes);

  if (icc.kind === 'valid') {
    return {
      model: 'rgb',
      primaries: 'srgb',
      transfer: 'srgb',
      bitDepth: bitDepthOf(chunks.bitDepth),
      alphaMode: 'straight',
      provenance: 'embedded-icc',
      ...(chunks.diagnostics.length > 0 ? { diagnostics: chunks.diagnostics } : {}),
    };
  }

  if (icc.kind === 'invalid') {
    chunks.diagnostics.push(`embedded ICC profile invalid: ${icc.reason}`);
  }

  if (chunks.srgbIntent !== undefined) {
    return {
      model: 'rgb',
      primaries: 'srgb',
      transfer: 'srgb',
      bitDepth: bitDepthOf(chunks.bitDepth),
      alphaMode: 'straight',
      provenance: 'named',
      ...(chunks.diagnostics.length > 0 ? { diagnostics: chunks.diagnostics } : {}),
    };
  }

  if (chunks.chroma) {
    const primaries = matchNamedPrimaries(chunks.chroma);
    const transfer = chunks.gamma !== undefined ? gammaToTransfer(chunks.gamma) : 'unknown';
    return {
      model: 'rgb',
      primaries,
      transfer,
      bitDepth: bitDepthOf(chunks.bitDepth),
      alphaMode: 'straight',
      provenance: primaries === 'unknown' ? 'format-default' : 'named',
      ...(chunks.diagnostics.length > 0 ? { diagnostics: chunks.diagnostics } : {}),
    };
  }

  if (chunks.gamma !== undefined) {
    return {
      model: 'rgb',
      primaries: 'unknown',
      transfer: gammaToTransfer(chunks.gamma),
      bitDepth: bitDepthOf(chunks.bitDepth),
      alphaMode: 'straight',
      provenance: 'format-default',
    };
  }

  return {
    model: 'rgb',
    primaries: 'unknown',
    transfer: 'unknown',
    bitDepth: bitDepthOf(chunks.bitDepth),
    alphaMode: 'straight',
    provenance: 'format-default',
  };
}

function bitDepthOf(value: number | undefined): 8 | 16 | undefined {
  if (value === 16) return 16;
  if (value !== undefined) return 8;
  return undefined;
}
