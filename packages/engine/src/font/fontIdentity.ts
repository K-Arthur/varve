/**
 * Font identity — stable, deduplicated font identity based on metadata and
 * file fingerprints rather than family names alone.
 *
 * A font is identified by:
 *   1. A deterministic SHA-256 content hash of the entire file.
 *   2. PostScript name (unique per face within a family).
 *   3. Family name + subfamily (e.g. "Inter" + "Bold Italic").
 *
 * The identity model prevents silent replacement: two files with different
 * hashes are treated as distinct fonts even if they share a family name.
 *
 * Research basis: OpenType name table (nameID 4 = full name, nameID 6 =
 * PostScript name), fontconfig FcPattern, FontBase/FontBook identity models.
 */

/** Canonical font source classification. */
export type FontSourceKind =
  | 'system' // OS-installed font
  | 'bundled' // Ships with the app (@fontsource, etc.)
  | 'project' // Embedded in a project file
  | 'user' // Downloaded/installed by the user
  | 'remote' // From a provider (Google Fonts, Fontsource CDN)
  | 'missing'; // Referenced but not available

/** Font file format. */
export type FontFormat = 'ttf' | 'otf' | 'ttc' | 'otc' | 'woff' | 'woff2' | 'unknown';

/** Font classification category. */
export type FontCategory =
  | 'sans-serif'
  | 'serif'
  | 'monospace'
  | 'display'
  | 'handwriting'
  | 'unknown';

/** Embedding permission from OS/2 fsType field. */
export type EmbeddingRights =
  | 'installable' // fsType=0: unrestricted
  | 'preview-and-print' // fsType=4
  | 'editable' // fsType=8
  | 'restricted' // fsType=2: no embedding
  | 'no-subsetting' // fsType bit 8: embedding ok, subsetting prohibited
  | 'unknown';

/** Normalized font identity — the stable key for deduplication. */
export interface FontIdentity {
  /** Full SHA-256 hash of the font file bytes (64 hex chars). */
  contentHash: string;
  /** Short 8-character fingerprint derived from the content hash for compact UI labels. */
  fingerprint?: string;
  /** Hash algorithm used to produce contentHash. */
  hashAlgorithm?: 'sha256' | 'fnv1a' | 'unknown';
  /** PostScript name from the name table (nameID 6). */
  postScriptName: string;
  /** Family name (nameID 1 or platform-specific). */
  familyName: string;
  /** Subfamily name (nameID 2, e.g. "Regular", "Bold Italic"). */
  subfamilyName: string;
  /** Full font name (nameID 4). */
  fullName: string;
  /** Preferred typographic family name (nameID 16), if present. */
  typographicFamilyName?: string;
  /** Preferred typographic subfamily name (nameID 17), if present. */
  typographicSubfamilyName?: string;
  /** Font vendor/manufacturer (nameID 8), if present. */
  vendor?: string;
  /** Version string (nameID 5), if present. */
  version?: string;
  /** Index within a TrueType/OpenType Collection (TTC/OTC). */
  collectionIndex?: number;
}

/** Complete metadata parsed from a font file. */
export interface ParsedFontMetadata {
  identity: FontIdentity;
  /** Font format (derived from file header magic bytes). */
  format: FontFormat;
  /** Raw file size in bytes. */
  fileSize: number;
  /** Font vendor/manufacturer string (nameID 8). */
  vendor?: string;
  /** Version string (nameID 5). */
  version?: string;
  /** Copyright notice (nameID 0). */
  copyright?: string;
  /** License text (nameID 13 or nameID 14). */
  license?: string;
  /** License URL (nameID 14). */
  licenseUrl?: string;
  /** Description (nameID 10). */
  description?: string;
  /** Designer (nameID 9). */
  designer?: string;
  /** Units per em (head table). */
  unitsPerEm: number;
  /** Ascender (OS/2 or hhea table). */
  ascender: number;
  /** Descender (OS/2 or hhea table). */
  descender: number;
  /** Line gap (hhea table). */
  lineGap: number;
  /** x-height (OS/2 table). */
  xHeight?: number;
  /** Cap height (OS/2 table). */
  capHeight?: number;
  /** Number of glyphs in the font. */
  glyphCount: number;
  /** Whether the font is a variable font. */
  isVariable: boolean;
  /** Variable font axes (fvar table). */
  axes: ParsedAxis[];
  /** Named instances (fvar table). */
  namedInstances: ParsedNamedInstance[];
  /** OpenType feature tags present (GSUB/GPOS tables). */
  openTypeFeatures: string[];
  /** Supported Unicode ranges (as [start, end] pairs). */
  unicodeRanges: Array<[number, number]>;
  /** Supported scripts (from OS/2). */
  scripts: string[];
  /** Supported languages (from name table). */
  languages?: string[];
  /** Embedding permission from OS/2 fsType. */
  embeddingRights: EmbeddingRights;
  /** Whether the font contains color glyphs (COLR/CPAL or sbix or SVG). */
  hasColorGlyphs: boolean;
  /** Font category (heuristic from metadata + metrics). */
  category: FontCategory;
  /** Source where this font was loaded from. */
  source: FontSourceKind;
  /** Original file path or URL, if known. */
  sourceLocation?: string;
}

/** A variable font axis parsed from the fvar table. */
export interface ParsedAxis {
  /** 4-character axis tag (e.g. "wght", "wdth", "slnt"). */
  tag: string;
  /** Human-readable name (e.g. "Weight", "Width"). */
  name: string;
  /** Minimum axis value. */
  min: number;
  /** Default axis value. */
  default: number;
  /** Maximum axis value. */
  max: number;
}

/** A named instance in a variable font. */
export interface ParsedNamedInstance {
  /** Instance name (e.g. "Regular", "Bold"). */
  name: string;
  /** Axis coordinates for this instance. */
  coordinates: Record<string, number>;
}

/**
 * Detect font format from raw file bytes using magic bytes.
 */
export function detectFontFormat(data: ArrayBuffer): FontFormat {
  if (data.byteLength < 4) return 'unknown';
  const view = new Uint8Array(data, 0, 4);

  if (view[0] === 0x77 && view[1] === 0x4f && view[2] === 0x46 && view[3] === 0x46) return 'woff';
  if (view[0] === 0x77 && view[1] === 0x4f && view[2] === 0x46 && view[3] === 0x32) return 'woff2';
  if (view[0] === 0x00 && view[1] === 0x01 && view[2] === 0x00 && view[3] === 0x00) return 'ttf';
  if (view[0] === 0x4f && view[1] === 0x54 && view[2] === 0x54 && view[3] === 0x4f) return 'otf';
  if (view[0] === 0x74 && view[1] === 0x72 && view[2] === 0x75 && view[3] === 0x65) return 'ttf';
  if (view[0] === 0x74 && view[1] === 0x74 && view[2] === 0x63 && view[3] === 0x66) return 'ttc';

  return 'unknown';
}

/**
 * Compute a stable font identity key string from a FontIdentity.
 * Use this as a Map/Set key for deduplication.
 */
export function fontIdentityKey(id: FontIdentity): string {
  return `${id.contentHash}:${id.postScriptName}`;
}

/**
 * Check if two font identities refer to the same face.
 *
 * Primary match: SHA-256 content hashes are identical. This is the only
 * reliable way to distinguish files that share a family name but differ in
 * version, subset, or source.
 *
 * Fallback: when a hash is unavailable or non-canonical, compare the
 * PostScript name plus family/subfamily pair to avoid treating a single
 * missing-font reference as different from its resolved replacement.
 */
export function sameFontFace(a: FontIdentity, b: FontIdentity): boolean {
  // Prefer exact SHA-256 match when both identities are canonical.
  if (
    a.contentHash &&
    b.contentHash &&
    a.hashAlgorithm === 'sha256' &&
    b.hashAlgorithm === 'sha256'
  ) {
    return a.contentHash === b.contentHash;
  }

  // Legacy/non-canonical hash match.
  if (a.contentHash && b.contentHash && a.contentHash === b.contentHash) {
    return true;
  }

  // Metadata fallback: same PostScript name and same family/subfamily.
  if (
    a.postScriptName &&
    a.postScriptName === b.postScriptName &&
    a.postScriptName !== 'Unknown' &&
    a.familyName === b.familyName &&
    a.subfamilyName === b.subfamilyName
  ) {
    return true;
  }

  return false;
}

/**
 * Compute a short 8-hex-character fingerprint from a full content hash.
 */
export function shortFingerprint(contentHash: string): string {
  return contentHash.slice(0, 8).toLowerCase();
}

/**
 * Compute the canonical SHA-256 content hash for a font file.
 *
 * Returns the full 64-character hex digest and a short fingerprint. If the
 * runtime does not expose `crypto.subtle`, a fallback FNV-1a hash is produced
 * and marked with algorithm `fnv1a` so callers can decide whether to trust it
 * for canonical identity.
 */
export async function computeFontHash(data: ArrayBuffer): Promise<{
  contentHash: string;
  fingerprint: string;
  hashAlgorithm: 'sha256' | 'fnv1a';
}> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const digest = await crypto.subtle.digest('SHA-256', data);
    const bytes = new Uint8Array(digest);
    const contentHash = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    return { contentHash, fingerprint: shortFingerprint(contentHash), hashAlgorithm: 'sha256' };
  }

  const contentHash = simpleHash(data);
  return { contentHash, fingerprint: shortFingerprint(contentHash), hashAlgorithm: 'fnv1a' };
}

// ── Simple hash (for legacy/fallback environments) ─────────────────────────

function simpleHash(data: ArrayBuffer): string {
  const bytes = new Uint8Array(data);
  // FNV-1a hash
  let hash = 0x811c9dc5;
  for (let i = 0; i < Math.min(bytes.length, 10000); i++) {
    hash ^= bytes[i] ?? 0;
    hash = (hash * 0x01000193) | 0;
  }
  // Also hash the last 1000 bytes if file is large
  if (bytes.length > 10000) {
    for (let i = bytes.length - 1000; i < bytes.length; i++) {
      hash ^= bytes[i] ?? 0;
      hash = (hash * 0x01000193) | 0;
    }
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
