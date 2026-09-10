/**
 * AVIF colour metadata parsing (colr box: nclx CICP / embedded ICC; pixi
 * bit depth) for raster ingestion.
 *
 * AVIF stores colour information as ISOBMFF item properties:
 *
 *   colr 'nclx'  — CICP primaries/transfer/matrix/range (H.273 values)
 *   colr 'prof' / 'rICC' — embedded ICC profile bytes
 *   pixi         — per-channel pixel depths
 *
 * Browser decoders apply CICP/ICC internally and expose only display-ready
 * pixels; this module reads the box structure so Varve can record what the
 * file actually claims. Metadata precedence: an embedded ICC profile in
 * colr wins over nclx CICP (the container specification treats them as
 * alternatives; ICC is the more specific interpretation) — a disagreement
 * is recorded as a diagnostic, never averaged.
 *
 * Walking is bounded: box counts, recursion depth and sizes are capped, so
 * hostile files cannot drive unbounded scanning.
 */

import type {
  RasterColorEncoding,
  RasterPrecision,
  TransferFunctionName,
  VideoMatrixCoefficients,
  VideoRange,
} from '@varve/shared';
import { type IccExtractionResult, isValidIccProfile, profileFromBytes } from './icc';

/** Cap on boxes scanned per level and on recursion depth. */
const MAX_BOXES = 4096;
const MAX_DEPTH = 6;

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

function readUint16BE(bytes: Uint8Array, offset: number): number {
  if (offset + 1 >= bytes.length) return 0;
  return (((bytes[offset] as number) << 8) | (bytes[offset + 1] as number)) >>> 0;
}

/** H.273 CICP primaries → our primaries family. */
export function mapCicpPrimaries(value: number): RasterColorEncoding['primaries'] {
  switch (value) {
    case 1: // BT.709 (same primaries as sRGB gamut)
      return 'srgb';
    case 9: // BT.2020
      return 'rec2020';
    case 22: // SMPTE 431 (Display P3)
      return 'display-p3';
    default:
      return 'unknown';
  }
}

/** H.273 CICP transfer characteristics → our transfer name. */
export function mapCicpTransfer(value: number): TransferFunctionName {
  switch (value) {
    case 1: // BT.709 (piecewise sRGB-like)
    case 13: // sRGB piecewise
      return 'srgb';
    case 8: // linear
      return 'linear';
    case 14: // BT.2020 10-bit
    case 15: // BT.2020 12-bit
      return 'rec2020';
    case 16: // SMPTE 2084 (PQ)
      return 'pq';
    case 18: // HLG
      return 'hlg';
    default:
      return 'unknown';
  }
}

/** H.273 CICP matrix coefficients → our name. */
export function mapCicpMatrix(value: number): VideoMatrixCoefficients {
  switch (value) {
    case 0: // identity (RGB)
    case 4: // FCC (also full-range identity variant)
      return 'rgb';
    case 1:
      return 'bt709';
    case 5:
    case 6:
      return 'bt601';
    case 9:
      return 'bt2020-ncl';
    case 10:
      return 'bt2020-cl';
    default:
      return 'unknown';
  }
}

/** nclx range byte: 0 = full, 1 = limited (ISO 23001-8). */
export function mapCicpRange(value: number): VideoRange {
  if (value === 0) return 'full';
  if (value === 1) return 'limited';
  return 'unknown';
}

/** nclx data from a colr box payload (after the 4-byte type). */
function parseNclx(payload: Uint8Array): {
  primaries?: RasterColorEncoding['primaries'];
  transfer?: TransferFunctionName;
  matrix?: VideoMatrixCoefficients;
  range?: VideoRange;
} | null {
  // payload starts at the type field ('nclx'); CICP fields follow.
  if (payload.length < 13) return null;
  const primaries = mapCicpPrimaries(readUint32BE(payload, 4));
  const transfer = mapCicpTransfer(readUint16BE(payload, 8));
  const matrix = mapCicpMatrix(readUint16BE(payload, 10));
  const range = mapCicpRange(payload[12] ?? 0);
  return { primaries, transfer, matrix, range };
}

interface ScannedAvif {
  nclx?: NonNullable<ReturnType<typeof parseNclx>>;
  icc?: Uint8Array;
  iccInvalid?: string;
  bitDepth?: RasterPrecision;
  diagnostics: string[];
}

/** Recursively scan ISOBMFF boxes for colr/pixi properties (bounded). */
function scanAvifBoxes(
  bytes: Uint8Array,
  start: number,
  end: number,
  depth: number,
  out: ScannedAvif,
): void {
  if (depth > MAX_DEPTH) return;
  let offset = start;
  for (let boxes = 0; boxes < MAX_BOXES; boxes += 1) {
    if (offset + 8 > end || offset + 8 > bytes.length) break;
    const boxSize = readUint32BE(bytes, offset);
    const boxType = String.fromCharCode(
      bytes[offset + 4] ?? 0,
      bytes[offset + 5] ?? 0,
      bytes[offset + 6] ?? 0,
      bytes[offset + 7] ?? 0,
    );
    // 64-bit extended size.
    let size = boxSize;
    if (boxSize === 1) {
      if (offset + 16 > bytes.length) break;
      size = 0;
      for (let i = 8; i < 16; i += 1) {
        size = size * 0x100 + (bytes[offset + i] ?? 0);
      }
    }
    if (size < 8) break;
    const boxEnd = Math.min(offset + size, end);
    const payloadStart = offset + (boxSize === 1 ? 16 : 8);

    if (boxType === 'colr' && payloadStart + 4 <= boxEnd) {
      const typeStr = String.fromCharCode(
        bytes[payloadStart] ?? 0,
        bytes[payloadStart + 1] ?? 0,
        bytes[payloadStart + 2] ?? 0,
        bytes[payloadStart + 3] ?? 0,
      );
      const payload = bytes.subarray(payloadStart, boxEnd);
      if (typeStr === 'nclx' && !out.nclx) {
        const parsed = parseNclx(payload);
        if (parsed) {
          if (out.icc && out.icc.length > 0) {
            out.diagnostics.push('colr box contains both ICC and nclx CICP metadata');
          }
          out.nclx = parsed;
        }
      } else if ((typeStr === 'prof' || typeStr === 'rICC') && !out.icc && !out.iccInvalid) {
        const profile = payload.subarray(4);
        if (isValidIccProfile(profile)) {
          out.icc = profile;
          if (out.nclx) {
            out.diagnostics.push('colr box contains both ICC and nclx CICP metadata');
          }
        } else {
          out.iccInvalid = 'invalid ICC profile in colr box';
        }
      }
    } else if (boxType === 'pixi' && !out.bitDepth) {
      // pixi: version+flags (4) + channel count + depths.
      const count = bytes[payloadStart + 4] ?? 0;
      const depth = bytes[payloadStart + 5];
      if (count >= 1 && (depth === 8 || depth === 10 || depth === 12 || depth === 16)) {
        out.bitDepth = depth;
      }
    } else if (boxType === 'meta' || boxType === 'iinf') {
      // Full boxes: 4 bytes version+flags follow the type. 'iprp'/'ipco'
      // are plain boxes whose children start immediately.
      scanAvifBoxes(bytes, payloadStart + 4, boxEnd, depth + 1, out);
    } else if (boxType === 'iprp' || boxType === 'ipco') {
      scanAvifBoxes(bytes, payloadStart, boxEnd, depth + 1, out);
    }

    offset = offset + size;
    if (offset >= end) break;
  }
}

/**
 * Extract AVIF colour metadata (colr nclx / ICC + pixi). ICC wins over
 * CICP when both are present; conflicts are recorded as diagnostics.
 */
export function extractAvifColorMetadata(bytes: Uint8Array): {
  encoding: RasterColorEncoding;
  icc: IccExtractionResult;
} {
  const scanned: ScannedAvif = { diagnostics: [] };
  if (bytes.length >= 12 && readUint32BE(bytes, 4) === 0x66747970 /* 'ftyp' */) {
    scanAvifBoxes(bytes, 0, bytes.length, 0, scanned);
  }

  if (scanned.icc) {
    const profile = profileFromBytes(scanned.icc);
    return {
      encoding: {
        model: 'rgb',
        primaries: 'unknown',
        transfer: 'unknown',
        bitDepth: scanned.bitDepth,
        alphaMode: 'straight',
        provenance: 'embedded-icc',
        ...(scanned.diagnostics.length > 0 ? { diagnostics: scanned.diagnostics } : {}),
      },
      icc: { kind: 'valid', profile },
    };
  }

  const icc: IccExtractionResult = scanned.iccInvalid
    ? { kind: 'invalid', reason: scanned.iccInvalid }
    : { kind: 'none' };
  if (scanned.iccInvalid) scanned.diagnostics.push(scanned.iccInvalid);

  if (scanned.nclx) {
    const { primaries, transfer, matrix, range } = scanned.nclx;
    return {
      encoding: {
        model: 'rgb',
        primaries,
        transfer,
        ...(matrix !== undefined && matrix !== 'unknown' ? { matrixCoefficients: matrix } : {}),
        ...(range !== undefined && range !== 'unknown' ? { videoRange: range } : {}),
        bitDepth: scanned.bitDepth,
        alphaMode: 'straight',
        provenance: 'cicp',
        ...(scanned.diagnostics.length > 0 ? { diagnostics: scanned.diagnostics } : {}),
      },
      icc,
    };
  }

  return {
    encoding: {
      model: 'rgb',
      primaries: 'unknown',
      transfer: 'unknown',
      bitDepth: scanned.bitDepth,
      alphaMode: 'straight',
      provenance: 'format-default',
      ...(scanned.diagnostics.length > 0 ? { diagnostics: scanned.diagnostics } : {}),
    },
    icc,
  };
}
