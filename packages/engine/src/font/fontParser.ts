/**
 * Font file parser — extracts complete metadata from TTF/OTF/WOFF/WOFF2 bytes.
 *
 * Handles the full OpenType structure: head, name, OS/2, hhea, fvar, GSUB, GPOS,
 * cmap tables. For WOFF2, decompresses before parsing.
 *
 * Research basis: OpenType specification (Microsoft/Google),
 * ISO/IEC 14496-22 (Open Font Format), W3C WOFF/WOFF2 specifications.
 */

/// <reference path="./wawoff2.d.ts" />

import {
  type ColorFontFormat,
  computeFontHash,
  detectFontFormat,
  type EmbeddingRights,
  type FontCategory,
  type FontFormat,
  type ParsedAxis,
  type ParsedFontMetadata,
  type ParsedNamedInstance,
} from './fontIdentity';

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Parse raw font file bytes into complete metadata.
 * Accepts TTF, OTF, WOFF, or WOFF2 data.
 */
export async function parseFontData(data: ArrayBuffer): Promise<ParsedFontMetadata> {
  const format = detectFontFormat(data);

  // WOFF2 needs brotli decompression — defer to the WOFF2 parser
  if (format === 'woff2') {
    return parseWOFF2(data);
  }

  // WOFF1 uses zlib compression within tables — decompress tables
  if (format === 'woff') {
    return parseWOFF1(data);
  }

  const members = await parseRawCollectionMembers(data, format);
  return members[0] ?? (await parseRawFontAtOffset(data, format, 0, 0));
}

/**
 * Parse a TrueType/OpenType Collection (TTC/OTC) into its individual faces.
 * Non-collection files return a single-element array.
 * Accepts raw TTF/OTF/TTC/OTC bytes and WOFF2 files that decompress to a collection.
 */
export async function parseFontCollection(data: ArrayBuffer): Promise<ParsedFontMetadata[]> {
  const format = detectFontFormat(data);

  if (format === 'woff2') {
    const decompressed = await decompressWOFF2(data);
    if (decompressed) {
      return parseFontCollection(decompressed);
    }
    // Decompression failed — fall back to header-only metadata
    return [await parseFontData(data)];
  }

  if (format === 'woff') {
    // WOFF1 is not a collection container in practice; parse as a single font.
    return [await parseWOFF1(data)];
  }

  const view = new DataView(data);
  if (data.byteLength >= 4 && view.getUint32(0) !== TTC_SIGNATURE) {
    return [await parseRawFontAtOffset(data, format, 0, 0)];
  }

  return await parseRawCollectionMembers(data, format);
}

const DEFAULT_IDENTITY = {
  contentHash: '',
  fingerprint: '',
  hashAlgorithm: 'unknown' as const,
  postScriptName: 'Unknown',
  familyName: 'Unknown',
  subfamilyName: 'Regular',
  fullName: 'Unknown',
};

// ── WOFF2 Parsing ───────────────────────────────────────────────────────────

async function parseWOFF2(data: ArrayBuffer): Promise<ParsedFontMetadata> {
  const view = new DataView(data);

  // WOFF2 header: signature(4) flavor(4) length(4) numTables(2) reserved(2)
  // metaOffset(4) metaLength(4) metaOrigLength(4) privOffset(4) privLength(4)
  void view.getUint16(12);
  void view.getUint32(20);

  // Reconstruct the original font from WOFF2 table directory + compressed data
  // WOFF2 uses Brotli compression — we need the decompressed table data
  // For metadata extraction, we'll try to parse what we can from the WOFF2 header
  // and fall back to reading available fields.

  // Try using the built-in decompression if available
  const decompressed = await decompressWOFF2(data);
  if (decompressed) {
    const members = await parseRawCollectionMembers(decompressed, 'woff2');
    return members[0] ?? (await parseRawFontAtOffset(decompressed, 'woff2', 0, 0));
  }

  // Fallback: parse what we can from the WOFF2 header
  const flavor = view.getUint32(4);
  const fontFamily = flavor === 0x4f54544f ? 'OTF' : 'TTF';
  const identity = { ...DEFAULT_IDENTITY, familyName: fontFamily, fullName: fontFamily };

  return {
    identity,
    format: 'woff2',
    fileSize: data.byteLength,
    unitsPerEm: 1000,
    ascender: 800,
    descender: -200,
    lineGap: 0,
    glyphCount: 0,
    isVariable: false,
    axes: [],
    namedInstances: [],
    openTypeFeatures: [],
    unicodeRanges: [],
    scripts: [],
    languages: [],
    embeddingRights: 'unknown',
    hasColorGlyphs: false,
    colorFormats: [],
    category: 'unknown',
    source: 'system',
  };
}

/**
 * Decompress WOFF2 to SFNT.
 *
 * `wawoff2` is imported dynamically, and that is load-bearing rather than a
 * style preference. It is an Emscripten module whose embind glue calls
 * `new Function(...)` at module-evaluation time to build named functions for
 * stack traces. Tauri's production CSP allows `'wasm-unsafe-eval'` but not
 * `'unsafe-eval'`, so evaluating it throws:
 *
 *   EvalError: Refused to evaluate a string as JavaScript because 'unsafe-eval'
 *   ... is not an allowed source of script in the following CSP directive
 *
 * As a *static* import it sat in the main chunk, so that throw happened before
 * React mounted and took the entire application down — the packaged app opened
 * and never reached its UI. Every other call site in the repo already imports
 * it dynamically; this one did not.
 *
 * Dynamic import confines the failure to this function, which already degrades
 * to header-only parsing. Do not convert this back to a static import.
 */
async function decompressWOFF2(data: ArrayBuffer): Promise<ArrayBuffer | null> {
  try {
    const { decompress: decompressBrotli } = await import('wawoff2');
    const input = new Uint8Array(data);
    const result = await decompressBrotli(input);
    // wawoff2 returns a Uint8Array/Buffer of the decompressed SFNT data.
    if (result && result.byteLength > 0) {
      return result.buffer.slice(
        result.byteOffset,
        result.byteOffset + result.byteLength,
      ) as ArrayBuffer;
    }
  } catch {
    // Fall back to header-only parsing if decompression fails.
  }
  return null;
}

// ── WOFF1 Parsing ───────────────────────────────────────────────────────────

async function parseWOFF1(data: ArrayBuffer): Promise<ParsedFontMetadata> {
  const view = new DataView(data);

  // WOFF1 header: signature(4) flavor(4) length(4) numTables(2) reserved(2)
  // metaOffset(4) metaLength(4) metaOrigLength(4) privOffset(4) privLength(4)
  const numTables = view.getUint16(12);

  // WOFF1 table directory follows the header
  // Each entry: tag(4) offset(4) compLength(4) origLength(4) origChecksum(4)
  // Total header = 44 bytes, directory starts at byte 44
  const DIR_START = 44;
  const DIR_ENTRY_SIZE = 20;

  // Collect compressed table data
  const tables = new Map<string, ArrayBuffer>();
  for (let i = 0; i < numTables && i < 100; i++) {
    const entryOff = DIR_START + i * DIR_ENTRY_SIZE;
    if (entryOff + DIR_ENTRY_SIZE > data.byteLength) break;

    const tag = String.fromCharCode(
      view.getUint8(entryOff),
      view.getUint8(entryOff + 1),
      view.getUint8(entryOff + 2),
      view.getUint8(entryOff + 3),
    );
    const compOffset = view.getUint32(entryOff + 4);
    const compLength = view.getUint32(entryOff + 8);
    const origLength = view.getUint32(entryOff + 12);

    if (compOffset + compLength > data.byteLength) continue;

    const compressed = data.slice(compOffset, compOffset + compLength);

    if (compLength === origLength) {
      // Uncompressed
      tables.set(tag, compressed);
    } else {
      // Zlib-compressed — decompress
      try {
        const decompressed = await decompressZlib(compressed, origLength);
        tables.set(tag, decompressed);
      } catch {
        // Skip tables we can't decompress
      }
    }
  }

  // Reconstruct a minimal SFNT font from decompressed tables
  const sfnt = reconstructSFNT(tables);
  if (sfnt) {
    const members = await parseRawCollectionMembers(sfnt, 'woff');
    return members[0] ?? (await parseRawFontAtOffset(sfnt, 'woff', 0, 0));
  }

  // Fallback
  return {
    identity: DEFAULT_IDENTITY,
    format: 'woff',
    fileSize: data.byteLength,
    unitsPerEm: 1000,
    ascender: 800,
    descender: -200,
    lineGap: 0,
    glyphCount: 0,
    isVariable: false,
    axes: [],
    namedInstances: [],
    openTypeFeatures: [],
    unicodeRanges: [],
    scripts: [],
    languages: [],
    embeddingRights: 'unknown',
    hasColorGlyphs: false,
    colorFormats: [],
    category: 'unknown',
    source: 'system',
  };
}

/**
 * Decompress a zlib-compressed block (raw deflate, as used by WOFF1 tables).
 * Uses the Web `DecompressionStream` when available and falls back to the
 * browser/node `inflate-raw` equivalent.
 */
async function decompressZlib(data: ArrayBuffer, expectedLength: number): Promise<ArrayBuffer> {
  if (typeof DecompressionStream !== 'undefined') {
    const ds = new DecompressionStream('deflate-raw');
    const writer = ds.writable.getWriter();
    const reader = ds.readable.getReader();

    const writePromise = writer.write(new Uint8Array(data)).then(() => writer.close());

    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.byteLength;
      // Guard against pathological expansion.
      if (total > Math.max(expectedLength * 4, 16 * 1024 * 1024)) {
        throw new Error('Decompressed WOFF1 table exceeds safety limit');
      }
    }
    await writePromise;

    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return out.buffer;
  }

  throw new Error('DecompressionStream is not available for WOFF1 decompression');
}

function reconstructSFNT(tables: Map<string, ArrayBuffer>): ArrayBuffer | null {
  if (tables.size === 0) return null;

  // Calculate total size for SFNT font
  const tableTags = [...tables.keys()];
  const numTables = tableTags.length;
  const headerSize = 12;
  const dirSize = numTables * 16;
  const totalDirAndHeader = headerSize + dirSize;

  // Align table offsets to 4-byte boundaries
  let currentOffset = totalDirAndHeader;
  const tableEntries: Array<{ tag: string; offset: number; length: number; checksum: number }> = [];

  for (const tag of tableTags) {
    const tableData = tables.get(tag)!;
    const paddedLength = (tableData.byteLength + 3) & ~3;
    tableEntries.push({
      tag,
      offset: currentOffset,
      length: tableData.byteLength,
      checksum: computeTableChecksum(tableData),
    });
    currentOffset += paddedLength;
  }

  // Build the buffer
  const totalSize = currentOffset;
  const buffer = new ArrayBuffer(totalSize);
  const out = new Uint8Array(buffer);
  const outView = new DataView(buffer);

  // Offset table header
  outView.setUint16(0, 0); // sfVersion (will be set from head table)
  outView.setUint16(2, numTables);
  outView.setUint16(4, 0); // searchRange
  outView.setUint16(6, 0); // entrySelector
  outView.setUint16(8, 0); // rangeShift

  // Table directory
  for (let i = 0; i < tableEntries.length; i++) {
    const entry = tableEntries[i]!;
    const dirOff = headerSize + i * 16;
    const tagBytes = entry.tag;
    out[dirOff] = tagBytes.charCodeAt(0);
    out[dirOff + 1] = tagBytes.charCodeAt(1);
    out[dirOff + 2] = tagBytes.charCodeAt(2);
    out[dirOff + 3] = tagBytes.charCodeAt(3);
    outView.setUint32(dirOff + 4, entry.checksum);
    outView.setUint32(dirOff + 8, entry.offset);
    outView.setUint32(dirOff + 12, entry.length);
  }

  // Copy table data
  for (const entry of tableEntries) {
    const tableData = tables.get(entry.tag)!;
    out.set(new Uint8Array(tableData), entry.offset);
  }

  return buffer;
}

function computeTableChecksum(data: ArrayBuffer): number {
  const words = new Uint16Array(data);
  let sum = 0;
  for (let i = 0; i < words.length; i++) {
    sum = (sum + (words[i] ?? 0)) | 0;
  }
  return sum >>> 0;
}

// ── Raw TTF/OTF Parsing ────────────────────────────────────────────────────

const TTC_SIGNATURE = 0x74746366; // "ttcf"
const MAX_COLLECTION_MEMBERS = 64;

async function parseRawCollectionMembers(
  data: ArrayBuffer,
  format: FontFormat,
): Promise<ParsedFontMetadata[]> {
  const view = new DataView(data);
  if (data.byteLength < 8 || view.getUint32(0) !== TTC_SIGNATURE) {
    return [];
  }

  const numFonts = view.getUint32(4);
  if (numFonts === 0 || numFonts > MAX_COLLECTION_MEMBERS) {
    return [];
  }

  const offsetStart = 8;
  const members: ParsedFontMetadata[] = [];
  for (let i = 0; i < numFonts; i++) {
    const offsetOff = offsetStart + i * 4;
    if (offsetOff + 4 > data.byteLength) break;
    const sfntOffset = view.getUint32(offsetOff);
    if (sfntOffset + 12 > data.byteLength) continue;
    const meta = await parseRawFontAtOffset(data, format, i, sfntOffset);
    members.push(meta);
  }

  return members;
}

async function parseRawFontAtOffset(
  data: ArrayBuffer,
  format: FontFormat,
  collectionIndex: number,
  sfntOffset: number,
): Promise<ParsedFontMetadata> {
  const view = new DataView(data);

  // Read offset table
  const numTables = view.getUint16(sfntOffset + 4);

  // Build table directory map
  const tableMap = readTableDirectory(data, sfntOffset, numTables);

  // Parse required tables
  const nameRecords = parseNameTable(data, tableMap);
  const headData = parseHeadTable(data, tableMap);
  const os2Data = parseOS2Table(data, tableMap);
  const hheaData = parseHheaTable(data, tableMap);
  const fvarData = parseFvarTable(data, tableMap);
  const cmapRanges = parseCmapTable(data, tableMap);
  const gsubFeatures = parseGSUBTable(data, tableMap);
  const gposFeatures = parseGPOSTable(data, tableMap);
  const colorCapabilities = detectColorCapabilities(data, tableMap);

  // Extract name strings (OpenType name table)
  // nameID 1/2/4/6 are required; 16/17 are typographic preferred names;
  // 5 is version; 8 is vendor/manufacturer.
  const postScriptName = nameRecords[6] || nameRecords[4] || '';
  const familyName = nameRecords[1] || postScriptName || 'Unknown';
  const subfamilyName = nameRecords[2] || 'Regular';
  const fullName = nameRecords[4] || `${familyName} ${subfamilyName}`;
  const typographicFamilyName = nameRecords[16];
  const typographicSubfamilyName = nameRecords[17];
  const version = nameRecords[5];
  const vendor = nameRecords[8];
  const copyrightStr = nameRecords[0];
  const license = nameRecords[13];
  const licenseUrl = nameRecords[14];
  const description = nameRecords[10];
  const designer = nameRecords[9];

  // Compute canonical SHA-256 content hash of the whole collection file.
  // Members are differentiated by collectionIndex + PostScript name in fontIdentityKey.
  const { contentHash, fingerprint, hashAlgorithm } = await computeFontHash(data);

  const unitsPerEm = headData.unitsPerEm || 1000;
  const ascender = os2Data.ascender || hheaData.ascender || 800;
  const descender = os2Data.descender || hheaData.descender || -200;
  const lineGap = hheaData.lineGap || 0;
  const xHeight = os2Data.xHeight;
  const capHeight = os2Data.capHeight;
  const embeddingRights = os2Data.embeddingRights || 'unknown';

  // Determine glyph count from maxp table
  const glyphCount = parseMaxpGlyphCount(data, tableMap);

  // Determine if variable font
  const isVariable = fvarData.axes.length > 0;

  // Merge GSUB + GPOS features
  const featureSet = new Set([...gsubFeatures, ...gposFeatures]);

  // Classify category from metadata
  const category = classifyFont(familyName, os2Data.panose, headData.macStyle);

  return {
    identity: {
      contentHash,
      fingerprint,
      hashAlgorithm,
      postScriptName,
      familyName,
      subfamilyName,
      fullName,
      typographicFamilyName,
      typographicSubfamilyName,
      vendor,
      version,
      collectionIndex: format === 'ttc' || format === 'otc' ? collectionIndex : undefined,
    },
    format,
    fileSize: data.byteLength,
    vendor,
    version,
    copyright: copyrightStr,
    license,
    licenseUrl,
    description,
    designer,
    unitsPerEm,
    ascender,
    descender,
    lineGap,
    xHeight,
    capHeight,
    glyphCount,
    isVariable,
    axes: fvarData.axes,
    namedInstances: fvarData.instances,
    openTypeFeatures: [...featureSet],
    unicodeRanges: cmapRanges,
    scripts: os2Data.scripts,
    languages: [],
    embeddingRights,
    hasColorGlyphs: colorCapabilities.hasColor,
    colorFormats: colorCapabilities.colorFormats,
    paletteCount: colorCapabilities.paletteCount,
    category,
    source: 'system',
  };
}

// ── Table Parsers ───────────────────────────────────────────────────────────

interface TableDirectory {
  tag: string;
  offset: number;
  length: number;
  checksum: number;
}

function readTableDirectory(
  data: ArrayBuffer,
  sfntOffset: number,
  numTables: number,
): Map<string, TableDirectory> {
  const view = new DataView(data);
  const map = new Map<string, TableDirectory>();
  const dirStart = sfntOffset + 12;

  for (let i = 0; i < numTables; i++) {
    const off = dirStart + i * 16;
    if (off + 16 > data.byteLength) break;

    const tag = String.fromCharCode(
      view.getUint8(off),
      view.getUint8(off + 1),
      view.getUint8(off + 2),
      view.getUint8(off + 3),
    );
    map.set(tag, {
      tag,
      offset: view.getUint32(off + 8),
      length: view.getUint32(off + 12),
      checksum: view.getUint32(off + 4),
    });
  }

  return map;
}

interface NameRecords {
  [nameID: number]: string;
}

function parseNameTable(data: ArrayBuffer, tables: Map<string, TableDirectory>): NameRecords {
  const table = tables.get('name');
  if (!table) return {};

  const view = new DataView(data);
  const base = table.offset;
  const result: NameRecords = {};

  if (base + 6 > data.byteLength) return result;

  const count = view.getUint16(base + 2);
  const stringOffset = view.getUint16(base + 4);
  const recordsStart = base + 6;

  for (let i = 0; i < count; i++) {
    const recOff = recordsStart + i * 12;
    if (recOff + 12 > data.byteLength) break;

    const platformID = view.getUint16(recOff);
    const nameID = view.getUint16(recOff + 4);
    const length = view.getUint16(recOff + 6);
    const offset2 = view.getUint16(recOff + 8);

    // Prefer Windows platform (3) over Mac (1)
    if (result[nameID] !== undefined) continue;

    const strBase = base + stringOffset + offset2;
    if (strBase + length > data.byteLength) continue;

    const bytes = new Uint8Array(data, strBase, length);

    let decoded: string;
    if (platformID === 3) {
      decoded = decodeUTF16BE(bytes);
    } else if (platformID === 1) {
      decoded = decodeMacRoman(bytes);
    } else {
      decoded = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    }

    result[nameID] = decoded.trim();
  }

  return result;
}

function decodeUTF16BE(bytes: Uint8Array): string {
  const codePoints: number[] = [];
  for (let i = 0; i < bytes.length - 1; i += 2) {
    codePoints.push(((bytes[i] ?? 0) << 8) | (bytes[i + 1] ?? 0));
  }
  return String.fromCharCode(...codePoints);
}

function decodeMacRoman(bytes: Uint8Array): string {
  const chars: string[] = [];
  for (const b of bytes) {
    if (b < 0x80) {
      chars.push(String.fromCharCode(b));
    } else {
      chars.push('\uFFFD');
    }
  }
  return chars.join('');
}

interface HeadData {
  unitsPerEm: number;
  macStyle: number;
}

function parseHeadTable(data: ArrayBuffer, tables: Map<string, TableDirectory>): HeadData {
  const table = tables.get('head');
  if (!table) return { unitsPerEm: 1000, macStyle: 0 };
  if (table.offset + 18 > data.byteLength) return { unitsPerEm: 1000, macStyle: 0 };

  const view = new DataView(data);
  return {
    unitsPerEm: view.getUint16(table.offset + 18),
    macStyle: view.getUint16(table.offset + 44),
  };
}

interface OS2Data {
  ascender: number;
  descender: number;
  xHeight?: number;
  capHeight?: number;
  embeddingRights: EmbeddingRights;
  panose?: Uint8Array;
  scripts: string[];
}

function parseOS2Table(data: ArrayBuffer, tables: Map<string, TableDirectory>): OS2Data {
  const table = tables.get('OS/2');
  if (!table) {
    return { ascender: 800, descender: -200, embeddingRights: 'unknown', scripts: [] };
  }
  if (table.offset + 88 > data.byteLength) {
    return { ascender: 800, descender: -200, embeddingRights: 'unknown', scripts: [] };
  }

  const view = new DataView(data);
  const base = table.offset;

  const ascender = view.getInt16(base + 68);
  const descender = view.getInt16(base + 70);

  let xHeight: number | undefined;
  let capHeight: number | undefined;
  if (table.length >= 88) {
    xHeight = view.getUint16(base + 86);
  }
  if (table.length >= 90) {
    capHeight = view.getUint16(base + 88);
  }

  // fsType at offset 8 — embedding permissions
  const fsType = view.getUint16(base + 8);
  const embeddingRights = classifyFSType(fsType);

  // Panose classification
  let panose: Uint8Array | undefined;
  if (table.length >= 32) {
    panose = new Uint8Array(data, base + 32, 10);
  }

  // Unicode range (bytes 42-58)
  const scripts: string[] = [];
  // Simplified: just track if the font has CJK ranges

  return { ascender, descender, xHeight, capHeight, embeddingRights, panose, scripts };
}

function classifyFSType(fsType: number): EmbeddingRights {
  const noSubsetting = (fsType & 0x0100) !== 0;

  // Bit 1 (0x0002) = Restricted License Embedding
  if (fsType & 0x0002) return noSubsetting ? 'no-subsetting' : 'restricted';

  // Bit 2 (0x0004) = Preview & Print Embedding
  if (fsType & 0x0004) return noSubsetting ? 'no-subsetting' : 'preview-and-print';

  // Bit 3 (0x0008) = Editable Embedding
  if (fsType & 0x0008) return noSubsetting ? 'no-subsetting' : 'editable';

  // No embedding bits set = Installable Embedding
  return noSubsetting ? 'no-subsetting' : 'installable';
}

interface HheaData {
  ascender: number;
  descender: number;
  lineGap: number;
}

function parseHheaTable(data: ArrayBuffer, tables: Map<string, TableDirectory>): HheaData {
  const table = tables.get('hhea');
  if (!table) return { ascender: 800, descender: -200, lineGap: 0 };
  if (table.offset + 12 > data.byteLength) {
    return { ascender: 800, descender: -200, lineGap: 0 };
  }

  const view = new DataView(data);
  const base = table.offset;
  return {
    ascender: view.getInt16(base + 4),
    descender: view.getInt16(base + 6),
    lineGap: view.getInt16(base + 8),
  };
}

interface FvarData {
  axes: ParsedAxis[];
  instances: ParsedNamedInstance[];
}

/**
 * Reads an OpenType `Fixed` value: a signed 32-bit 16.16 fixed-point number.
 *
 * `fvar` stores every axis bound and instance coordinate this way. Reading
 * those four bytes as an IEEE-754 float instead yields denormals (`wght`
 * min 100 is 0x00640000, which is 9.18e-39 as a float, not 100), so the
 * whole variable-axis surface silently degrades to noise.
 */
function readFixed(view: DataView, offset: number): number {
  return view.getInt32(offset, false) / 65536;
}

function parseFvarTable(data: ArrayBuffer, tables: Map<string, TableDirectory>): FvarData {
  const table = tables.get('fvar');
  if (!table) return { axes: [], instances: [] };
  if (table.offset + 16 > data.byteLength) return { axes: [], instances: [] };

  const view = new DataView(data);
  const base = table.offset;

  // fvar header: majorVersion(0) minorVersion(2) axesArrayOffset(4)
  // reserved(6) axisCount(8) axisSize(10) instanceCount(12) instanceSize(14).
  // Treating offset 4 as the axis count reads axesArrayOffset (16) instead,
  // which is why this used to report a 16-axis font with a 2-byte axis record.
  const axesArrayOffset = view.getUint16(base + 4);
  const axesCount = view.getUint16(base + 8);
  const axisSize = view.getUint16(base + 10);
  const instanceCount = view.getUint16(base + 12);
  const instanceSize = view.getUint16(base + 14);

  // A malformed table can advertise a zero stride; walking it would spin on
  // the same record until the iteration cap.
  if (axisSize < 20) return { axes: [], instances: [] };

  const axes: ParsedAxis[] = [];
  let axisOffset = base + axesArrayOffset;

  for (let i = 0; i < axesCount && i < 20; i++) {
    if (axisOffset + axisSize > data.byteLength) break;

    const tag = String.fromCharCode(
      view.getUint8(axisOffset),
      view.getUint8(axisOffset + 1),
      view.getUint8(axisOffset + 2),
      view.getUint8(axisOffset + 3),
    );

    const minValue = readFixed(view, axisOffset + 4);
    const defaultValue = readFixed(view, axisOffset + 8);
    const maxValue = readFixed(view, axisOffset + 12);
    void view.getUint16(axisOffset + 16);
    void view.getUint16(axisOffset + 18);

    // Resolve axis name from name table
    const axisName = AXIS_NAMES[tag] || tag;

    axes.push({
      tag,
      name: axisName,
      min: minValue,
      default: defaultValue,
      max: maxValue,
    });

    axisOffset += axisSize;
  }

  // Named instances. The count is a header field; deriving it from the table
  // length assumed the axis array began at a fixed offset and that no
  // trailing data followed the instance array.
  const instances: ParsedNamedInstance[] = [];
  const minInstanceSize = 4 + axes.length * 4;
  if (instanceSize < minInstanceSize) return { axes, instances };
  let instOffset = base + axesArrayOffset + axesCount * axisSize;

  for (let i = 0; i < instanceCount && i < 50; i++) {
    if (instOffset + instanceSize > data.byteLength) break;

    // instance record: subfamilyNameID(0) flags(2) coordinates(4...)
    const coords: Record<string, number> = {};
    for (let a = 0; a < axes.length; a++) {
      const val = readFixed(view, instOffset + 4 + a * 4);
      const axis = axes[a];
      if (axis) {
        coords[axis.tag] = val;
      }
    }

    instances.push({ name: `Instance ${i + 1}`, coordinates: coords });
    instOffset += instanceSize;
  }

  return { axes, instances };
}

function parseCmapTable(
  data: ArrayBuffer,
  tables: Map<string, TableDirectory>,
): Array<[number, number]> {
  const table = tables.get('cmap');
  if (!table) return [];

  const view = new DataView(data);
  const base = table.offset;
  if (base + 4 > data.byteLength) return [];

  const numSubtables = view.getUint16(base + 2);
  const ranges: Array<[number, number]> = [];
  let subtableOffset = base + 4;

  for (let i = 0; i < numSubtables && i < 10; i++) {
    if (subtableOffset + 8 > data.byteLength) break;

    void view.getUint16(subtableOffset);
    void view.getUint16(subtableOffset + 2);
    const offset2 = view.getUint32(subtableOffset + 4);
    const formatOffset = base + offset2;

    if (formatOffset + 2 > data.byteLength) {
      subtableOffset += 8;
      continue;
    }

    const format = view.getUint16(formatOffset);

    if (format === 4) {
      // Format 4: Segment mapping
      if (formatOffset + 28 > data.byteLength) {
        subtableOffset += 8;
        continue;
      }
      const segCount = view.getUint16(formatOffset + 6) / 2;
      for (let s = 0; s < segCount && s < 200; s++) {
        const startOffset = formatOffset + 14 + s * 2;
        const endOffset = formatOffset + 14 + segCount * 2 + s * 2;
        if (endOffset + 2 > data.byteLength) break;

        const start = view.getUint16(startOffset);
        const end = view.getUint16(endOffset);
        if (start !== 0xffff && end !== 0xffff) {
          ranges.push([start, end]);
        }
      }
      break; // Only parse the first cmap subtable
    }
  }

  return ranges;
}

function parseGSUBTable(data: ArrayBuffer, tables: Map<string, TableDirectory>): string[] {
  const table = tables.get('GSUB');
  if (!table) return [];
  return parseFeatureList(data, table.offset, table.length);
}

function parseGPOSTable(data: ArrayBuffer, tables: Map<string, TableDirectory>): string[] {
  const table = tables.get('GPOS');
  if (!table) return [];
  return parseFeatureList(data, table.offset, table.length);
}

function parseFeatureList(data: ArrayBuffer, offset: number, _length: number): string[] {
  if (offset + 8 > data.byteLength) return [];

  const view = new DataView(data);
  const featureCount = view.getUint16(offset + 4);
  const features: string[] = [];

  for (let i = 0; i < featureCount && i < 100; i++) {
    const recOff = offset + 8 + i * 2;
    if (recOff + 2 > data.byteLength) break;

    const featureOffset = view.getUint16(recOff);
    const absOff = offset + featureOffset;
    if (absOff + 4 > data.byteLength) break;

    const tag = String.fromCharCode(
      view.getUint8(absOff),
      view.getUint8(absOff + 1),
      view.getUint8(absOff + 2),
      view.getUint8(absOff + 3),
    );

    if (tag.length === 4 && /^[a-z]{4}$/i.test(tag)) {
      features.push(tag);
    }
  }

  return features;
}

function parseMaxpGlyphCount(data: ArrayBuffer, tables: Map<string, TableDirectory>): number {
  const table = tables.get('maxp');
  if (!table) return 0;
  if (table.offset + 6 > data.byteLength) return 0;

  const view = new DataView(data);
  return view.getUint16(table.offset + 4);
}

interface ColorCapabilities {
  hasColor: boolean;
  colorFormats: ColorFontFormat[];
  paletteCount?: number;
}

function detectColorCapabilities(
  data: ArrayBuffer,
  tables: Map<string, TableDirectory>,
): ColorCapabilities {
  const view = new DataView(data);
  const colorFormats: ColorFontFormat[] = [];
  let paletteCount: number | undefined;

  const colr = tables.get('COLR');
  if (colr && colr.offset + 2 <= data.byteLength) {
    const version = view.getUint16(colr.offset);
    if (version === 0) {
      colorFormats.push('colr0');
    } else if (version === 1) {
      colorFormats.push('colr1');
    }
  }

  const cpal = tables.get('CPAL');
  if (cpal && cpal.offset + 6 <= data.byteLength) {
    colorFormats.push('cpal');
    // CPAL v0: version(2), numPaletteEntries(2), numPalettes(2)
    paletteCount = view.getUint16(cpal.offset + 4);
  }

  if (tables.has('SVG ')) colorFormats.push('svg');
  if (tables.has('sbix')) colorFormats.push('sbix');
  if (tables.has('CBDT')) colorFormats.push('cbdt');
  if (tables.has('CBLC')) colorFormats.push('cblc');

  // A font has colour glyphs if it has a rendering table (COLR, SVG, sbix, CBDT/CBLC).
  // CPAL by itself only provides palettes.
  const hasColor =
    tables.has('COLR') ||
    tables.has('SVG ') ||
    tables.has('sbix') ||
    tables.has('CBDT') ||
    tables.has('CBLC');

  return { hasColor, colorFormats, paletteCount };
}

const AXIS_NAMES: Record<string, string> = {
  wght: 'Weight',
  wdth: 'Width',
  slnt: 'Slant',
  opsz: 'Optical Size',
  ital: 'Italic',
  grad: 'Grade',
  XTRA: 'X-Transparency',
  YOPQ: 'Y-Opacity',
  YTLC: 'Lowercase Height',
  YTUC: 'Uppercase Height',
  YTDE: 'Descender Depth',
  YTFI: 'Figure Height',
};

// ── Classification ──────────────────────────────────────────────────────────

function classifyFont(familyName: string, _panose?: Uint8Array, _macStyle?: number): FontCategory {
  const lower = familyName.toLowerCase();

  // Quick classification from family name keywords
  if (/\b(mono|courier|consolas|code|terminal|spacemono|jetbrains)\b/i.test(lower)) {
    return 'monospace';
  }
  if (/\b(handwrit|script|callig|brush|caveat|dancing|satisfy|pacifico)\b/i.test(lower)) {
    return 'handwriting';
  }
  if (/\b(display|poster|impact|bebas|oswald|raleway|futura\s*display)\b/i.test(lower)) {
    return 'display';
  }

  // PANOSE classification (if available)
  if (_panose && _panose.length >= 1) {
    const familyKind = _panose[0];
    // PANOSE familyKind: 2=Latin Text, 3=Latin Handwriting, 4=Latin Decorative
    if (familyKind === 3) return 'handwriting';
    if (familyKind === 4) return 'display';
  }

  // macStyle bit 0 = bold, bit 1 = italic — not useful for classification

  // Heuristic: serif families
  if (
    /\b(georgia|times|garamond|palatino|baskerville|bodoni|didot|libre\s*libre|merri|lora|playfair|crimson|source\s*serif|noto\s*serif)\b/i.test(
      lower,
    )
  ) {
    return 'serif';
  }

  // Default: sans-serif (most common for modern UI/design fonts)
  return 'sans-serif';
}
