/**
 * Canonical raster color encoding — the shared vocabulary that describes
 * what a raster pixel buffer MEANS, independent of where it lives.
 *
 * A color-managed raster is never just "RGBA bytes": the same byte
 * quadruple can be sRGB, Display P3, Adobe RGB, or ProPhoto, and the
 * difference is the encoding. Every boundary that produces or consumes
 * raster pixels (decode, cache, compositor, effects, export, print,
 * thumbnails) can name its encoding with this model instead of silently
 * assuming sRGB.
 *
 * The model deliberately separates the four independent dimensions that
 * gamut-vs-HDR discussions conflate:
 *
 *   model       — RGB / gray / CMYK / unknown          (channel semantics)
 *   primaries   — reachable chromaticities (gamut)
 *   transfer    — encoding transfer function
 *   precision   — bit depth (8/10/12/16/int, float16/float32)
 *
 * plus alpha semantics and provenance, so future HDR (PQ/HLG) support does
 * not require restructuring: it only adds transfer names.
 *
 * Provenance distinguishes "the file told us" from "we assumed it":
 * an untagged JPEG must never be silently relabelled sRGB as though the
 * bytes carried that meaning.
 */

// ── Channel model ────────────────────────────────────────────────────────────

/** What the raster channels represent. */
export type RasterColorModel = 'rgb' | 'gray' | 'cmyk' | 'unknown';

// ── Primaries (gamut) ────────────────────────────────────────────────────────

/**
 * RGB primaries families with defined chromaticities. 'unknown' means the
 * gamut is not determined; never convert through it.
 */
export type RgbPrimariesName =
  | 'srgb'
  | 'display-p3'
  | 'adobe-rgb'
  | 'pro-photo'
  | 'rec2020'
  | 'unknown';

// ── Transfer function ────────────────────────────────────────────────────────

/**
 * Transfer functions. 'pq' and 'hlg' are HDR transfer functions: the
 * conversion engine does not support them today and must fail explicitly
 * rather than mis-convert. 'rec2020' is the BT.2100 OETF (sRGB-like
 * piecewise curve with different constants).
 */
export type TransferFunctionName =
  | 'srgb'
  | 'gamma22'
  | 'gamma18'
  | 'prophoto'
  | 'rec2020'
  | 'linear'
  | 'pq'
  | 'hlg'
  | 'unknown';

// ── Video matrix / range (CICP nclx) ────────────────────────────────────────

/** CICP matrix coefficients (values 0-14 per H.273). */
export type VideoMatrixCoefficients =
  | 'rgb'
  | 'bt709'
  | 'bt601'
  | 'bt2020-ncl'
  | 'bt2020-cl'
  | 'identity'
  | 'unknown';

/** CICP video full/limited range (nclx `range` flag). */
export type VideoRange = 'full' | 'limited' | 'unknown';

// ── Precision ────────────────────────────────────────────────────────────────

/**
 * Integer channel precision. 8 = byte channels (0-255), 10/12/16 = higher
 * integer depth (stored appropriately at the boundary that owns the pixels).
 */
export type RasterBitDepth = 8 | 10 | 12 | 16;

/**
 * Float channel precision. float16 = half-float (internal/surface intent),
 * float32 = single precision. Float channels are 0.0-1.0 for SDR; extended
 * ranges are a future HDR concern.
 */
export type RasterFloatDepth = 'float16' | 'float32';

export type RasterPrecision = RasterBitDepth | RasterFloatDepth;

// ── Alpha ────────────────────────────────────────────────────────────────────

export type RasterAlphaMode = 'straight' | 'premultiplied' | 'unknown';

// ── Provenance ───────────────────────────────────────────────────────────────

/**
 * Where the color interpretation came from. Read this before trusting an
 * encoding: 'embedded-icc' is authoritative, 'assumed'/'format-default'
 * is a policy decision, 'legacy-assumed-srgb' marks pixels whose original
 * interpretation is unknowable.
 */
export type RasterEncodingProvenance =
  | 'embedded-icc'
  | 'cicp'
  | 'named'
  | 'format-default'
  | 'user-assigned'
  | 'assumed'
  | 'legacy-assumed-srgb'
  | 'unknown';

// ── Canonical encoding record ────────────────────────────────────────────────

/**
 * Complete color interpretation of one raster source or surface. Optional
 * members are omitted when unknown — never fabricated. `diagnostics` carries
 * non-fatal warnings (e.g. conflicting PNG iCCP + sRGB chunks) so callers
 * can surface them without blocking ingestion.
 */
export interface RasterColorEncoding {
  model: RasterColorModel;
  /** RGB primaries when model is rgb and gamut is determinable. */
  primaries?: RgbPrimariesName;
  /** Transfer function when determinable. */
  transfer?: TransferFunctionName;
  /** CICP matrix coefficients (from AVIF nclx), when present. */
  matrixCoefficients?: VideoMatrixCoefficients;
  /** CICP video range (from AVIF nclx), when present. */
  videoRange?: VideoRange;
  /** Source precision, when the container reports it. */
  bitDepth?: RasterPrecision;
  alphaMode?: RasterAlphaMode;
  /**
   * Reference into `Document.iccProfiles` when an embedded ICC profile is
   * the authoritative interpretation (provenance 'embedded-icc').
   */
  profileId?: string;
  /**
   * SHA-256 fingerprint of the exact profile payload referenced by
   * `profileId`. It lets a document detect profile-id reuse or replacement
   * instead of silently reinterpreting existing raster channel values.
   */
  profileFingerprint?: string;
  /** Provenance of this interpretation. Required. */
  provenance: RasterEncodingProvenance;
  /** Human-readable diagnostics, e.g. conflicting metadata outcomes. */
  diagnostics?: string[];
}

// ── Defaults and helpers ─────────────────────────────────────────────────────

/** The encoding Varve applies to untagged legacy raster data. */
export const LEGACY_ASSUMED_ENCODING: RasterColorEncoding = {
  model: 'rgb',
  primaries: 'srgb',
  transfer: 'srgb',
  bitDepth: 8,
  alphaMode: 'straight',
  provenance: 'legacy-assumed-srgb',
};

/** The encoding of a freshly rendered sRGB display surface (not source data). */
export const DISPLAY_SRGB_ENCODING: RasterColorEncoding = {
  model: 'rgb',
  primaries: 'srgb',
  transfer: 'srgb',
  bitDepth: 8,
  alphaMode: 'premultiplied',
  provenance: 'format-default',
};

/** True when the encoding carries enough information to convert from. */
export function isConvertibleRgbEncoding(
  encoding: RasterColorEncoding,
): encoding is RasterColorEncoding & {
  primaries: RgbPrimariesName;
  transfer: TransferFunctionName;
} {
  return (
    encoding.model === 'rgb' &&
    encoding.primaries !== undefined &&
    encoding.primaries !== 'unknown' &&
    encoding.transfer !== undefined &&
    encoding.transfer !== 'unknown' &&
    encoding.transfer !== 'pq' &&
    encoding.transfer !== 'hlg'
  );
}

/**
 * A stable display label for an encoding (e.g. "Display P3 / sRGB transfer
 * / 16-bit"). `unknown` members render as "unknown" so UI never lies by
 * omission.
 */
export function rasterEncodingLabel(encoding: RasterColorEncoding): string {
  const parts: string[] = [];
  switch (encoding.primaries ?? 'unknown') {
    case 'srgb':
      parts.push('sRGB');
      break;
    case 'display-p3':
      parts.push('Display P3');
      break;
    case 'adobe-rgb':
      parts.push('Adobe RGB');
      break;
    case 'pro-photo':
      parts.push('ProPhoto RGB');
      break;
    case 'rec2020':
      parts.push('Rec.2020');
      break;
    default:
      parts.push('unknown primaries');
  }
  switch (encoding.transfer ?? 'unknown') {
    case 'srgb':
      parts.push('sRGB');
      break;
    case 'gamma22':
      parts.push('gamma 2.2');
      break;
    case 'gamma18':
      parts.push('gamma 1.8');
      break;
    case 'prophoto':
      parts.push('ProPhoto');
      break;
    case 'rec2020':
      parts.push('Rec.2020');
      break;
    case 'linear':
      parts.push('linear');
      break;
    case 'pq':
      parts.push('PQ');
      break;
    case 'hlg':
      parts.push('HLG');
      break;
    default:
      parts.push('unknown transfer');
  }
  if (encoding.bitDepth !== undefined) parts.push(`${encoding.bitDepth}-bit`);
  return parts.join(' / ');
}

/**
 * Deterministic cache identity for the semantic parts of a raster encoding.
 * Diagnostics are intentionally excluded: they explain an interpretation but
 * do not change the channel meaning. The field order is fixed so this key is
 * stable across runtimes and document save/reopen cycles.
 */
export function rasterEncodingKey(encoding: RasterColorEncoding): string {
  return JSON.stringify({
    model: encoding.model,
    primaries: encoding.primaries ?? null,
    transfer: encoding.transfer ?? null,
    matrixCoefficients: encoding.matrixCoefficients ?? null,
    videoRange: encoding.videoRange ?? null,
    bitDepth: encoding.bitDepth ?? null,
    alphaMode: encoding.alphaMode ?? null,
    profileId: encoding.profileId ?? null,
    profileFingerprint: encoding.profileFingerprint ?? null,
    provenance: encoding.provenance,
  });
}

/** Human-readable provenance label for UI/preflight. */
export function rasterProvenanceLabel(provenance: RasterEncodingProvenance): string {
  switch (provenance) {
    case 'embedded-icc':
      return 'embedded ICC profile';
    case 'cicp':
      return 'CICP/nclx metadata';
    case 'named':
      return 'standard named color space';
    case 'format-default':
      return 'format default';
    case 'user-assigned':
      return 'user-assigned';
    case 'assumed':
      return 'assumed (no source metadata)';
    case 'legacy-assumed-srgb':
      return 'legacy: assumed sRGB';
    case 'unknown':
      return 'unknown';
  }
}
