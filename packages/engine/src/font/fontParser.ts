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
  type FontEmbeddingPolicy,
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
export interface FontParseOptions {
  /** Abort an in-flight validation operation between bounded parser steps. */
  signal?: AbortSignal;
  /** Whole-operation deadline in milliseconds (default: 2 seconds). */
  deadlineMs?: number;
}

const DEFAULT_PARSE_DEADLINE_MS = 2_000;

class ParseBudget {
  readonly deadline: number;
  readonly signal?: AbortSignal;

  constructor(options: FontParseOptions = {}) {
    const deadlineMs =
      options.deadlineMs === undefined || !Number.isFinite(options.deadlineMs)
        ? DEFAULT_PARSE_DEADLINE_MS
        : Math.max(0, options.deadlineMs);
    this.deadline = Date.now() + deadlineMs;
    this.signal = options.signal;
  }

  check(): void {
    if (this.signal?.aborted) throw new Error('Font parsing cancelled');
    if (Date.now() >= this.deadline) throw new Error('Font parsing timed out');
  }
}

export async function parseFontData(
  data: ArrayBuffer,
  options: FontParseOptions = {},
): Promise<ParsedFontMetadata> {
  const budget = new ParseBudget(options);
  budget.check();
  if (data.byteLength < 12) {
    throw new Error('Font data is truncated');
  }
  const format = detectFontFormat(data);

  // WOFF2 needs brotli decompression — defer to the WOFF2 parser
  if (format === 'woff2') {
    return parseWOFF2(data, budget);
  }

  // WOFF1 uses zlib compression within tables — decompress tables
  if (format === 'woff') {
    return parseWOFF1(data, budget);
  }

  const members = await parseRawCollectionMembers(data, format, budget);
  return members[0] ?? (await parseRawFontAtOffset(data, format, 0, 0, budget));
}

/**
 * Parse a TrueType/OpenType Collection (TTC/OTC) into its individual faces.
 * Non-collection files return a single-element array.
 * Accepts raw TTF/OTF/TTC/OTC bytes and WOFF2 files that decompress to a collection.
 */
export async function parseFontCollection(
  data: ArrayBuffer,
  options: FontParseOptions = {},
): Promise<ParsedFontMetadata[]> {
  const budget = new ParseBudget(options);
  budget.check();
  const format = detectFontFormat(data);

  if (format === 'woff2') {
    const decompressed = await decompressWOFF2(data, budget);
    if (decompressed) {
      const collectionMembers = await parseRawCollectionMembers(decompressed, 'woff2', budget);
      const members =
        collectionMembers.length > 0
          ? collectionMembers
          : [await parseRawFontAtOffset(decompressed, 'woff2', 0, 0, budget)];
      // A collection-capable importer must resolve the same artifact as the
      // single-face path. Hash the original container once for every member.
      const artifactIdentity = await computeFontHash(data);
      budget.check();
      return members.map((metadata) => ({
        ...metadata,
        format: 'woff2',
        fileSize: data.byteLength,
        identity: { ...metadata.identity, ...artifactIdentity },
      }));
    }
    // Decompression failed — fall back to header-only metadata
    return [await parseFontData(data, options)];
  }

  if (format === 'woff') {
    // WOFF1 is not a collection container in practice; parse as a single font.
    return [await parseWOFF1(data, budget)];
  }

  const view = new DataView(data);
  if (data.byteLength >= 4 && view.getUint32(0) !== TTC_SIGNATURE) {
    return [await parseRawFontAtOffset(data, format, 0, 0, budget)];
  }

  return await parseRawCollectionMembers(data, format, budget);
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

function fallbackMetadata(format: FontFormat, fileSize: number): ParsedFontMetadata {
  return {
    identity: { ...DEFAULT_IDENTITY },
    format,
    fileSize,
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
    embeddingPolicy: {
      baseRights: 'unknown',
      noSubsetting: false,
      bitmapOnly: false,
      source: 'unknown',
    },
    licenseProvenance: 'unknown',
    hasColorGlyphs: false,
    colorFormats: [],
    category: 'unknown',
    source: 'system',
  };
}

// ── WOFF2 Parsing ───────────────────────────────────────────────────────────

async function parseWOFF2(data: ArrayBuffer, budget: ParseBudget): Promise<ParsedFontMetadata> {
  budget.check();
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
  const decompressed = await decompressWOFF2(data, budget);
  if (decompressed) {
    const members = await parseRawCollectionMembers(decompressed, 'woff2', budget);
    return withOriginalArtifactIdentity(
      members[0] ?? (await parseRawFontAtOffset(decompressed, 'woff2', 0, 0, budget)),
      data,
    );
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
    embeddingPolicy: {
      baseRights: 'unknown',
      noSubsetting: false,
      bitmapOnly: false,
      source: 'unknown',
    },
    licenseProvenance: 'unknown',
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
async function decompressWOFF2(
  data: ArrayBuffer,
  budget: ParseBudget,
): Promise<ArrayBuffer | null> {
  budget.check();
  const timeoutMs = 2_000;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      import('wawoff2').then(({ decompress: decompressBrotli }) =>
        decompressBrotli(new Uint8Array(data)),
      ),
      new Promise<null>((resolve) => {
        timeoutId = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    // wawoff2 returns a Uint8Array/Buffer of the decompressed SFNT data.
    if (result && result.byteLength > 0) {
      budget.check();
      return result.buffer.slice(
        result.byteOffset,
        result.byteOffset + result.byteLength,
      ) as ArrayBuffer;
    }
  } catch {
    // Fall back to header-only parsing if decompression fails.
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
  return null;
}

// ── WOFF1 Parsing ───────────────────────────────────────────────────────────

async function parseWOFF1(data: ArrayBuffer, budget: ParseBudget): Promise<ParsedFontMetadata> {
  budget.check();
  const view = new DataView(data);
  const entries = readWoffDirectory(data, budget);
  const tables = new Map<string, ArrayBuffer>();
  // Preserve physical table order when reconstructing the original SFNT.
  for (const entry of entries.sort((a, b) => a.offset - b.offset)) {
    budget.check();
    const compressed = data.slice(entry.offset, entry.offset + entry.compressedLength);
    const decoded =
      entry.compressedLength === entry.length
        ? compressed
        : await decompressZlib(compressed, entry.length, budget);
    if (computeTableChecksum(decoded, entry.tag === 'head') !== entry.checksum) {
      throw new Error(`Invalid WOFF1 checksum for ${entry.tag}`);
    }
    tables.set(entry.tag, decoded);
  }
  const sfnt = reconstructSFNT(tables, view.getUint32(4));
  if (!sfnt) throw new Error('Invalid WOFF1: no font tables');
  return withOriginalArtifactIdentity(await parseRawFontAtOffset(sfnt, 'woff', 0, 0), data);
}

const MAX_WOFF_BYTES = 128 * 1024 * 1024;
const alignFontBytes = (length: number) => Math.ceil(length / 4) * 4;

interface WoffTable extends TableDirectory {
  compressedLength: number;
}

function readWoffDirectory(data: ArrayBuffer, budget?: ParseBudget): WoffTable[] {
  if (data.byteLength < 44 || data.byteLength > MAX_WOFF_BYTES) {
    throw new Error('Invalid WOFF1 header or file size');
  }
  const view = new DataView(data);
  const count = view.getUint16(12);
  const directoryEnd = 44 + count * 20;
  if (
    view.getUint32(8) !== data.byteLength ||
    view.getUint16(14) !== 0 ||
    count === 0 ||
    count > 4095 ||
    directoryEnd > data.byteLength
  ) {
    throw new Error('Invalid WOFF1 header or directory');
  }
  const entries: WoffTable[] = [];
  let decodedSize = 12 + count * 16;
  let previousTag = -1;
  for (let i = 0; i < count; i++) {
    budget?.check();
    const record = 44 + i * 20;
    const tag = view.getUint32(record);
    const length = view.getUint32(record + 12);
    const compressedLength = view.getUint32(record + 8);
    decodedSize += alignFontBytes(length);
    if (tag <= previousTag || compressedLength > length || decodedSize > MAX_WOFF_BYTES) {
      throw new Error('Invalid WOFF1 table directory or decoded size');
    }
    previousTag = tag;
    entries.push({
      tag: String.fromCharCode(...new Uint8Array(data, record, 4)),
      offset: view.getUint32(record + 4),
      length,
      compressedLength,
      checksum: view.getUint32(record + 16),
    });
  }
  if (decodedSize !== view.getUint32(16)) throw new Error('Invalid WOFF1 decoded size');
  validateWoffBlocks(data, entries, directoryEnd, budget);
  return entries;
}

function validateWoffBlocks(
  data: ArrayBuffer,
  entries: WoffTable[],
  directoryEnd: number,
  budget?: ParseBudget,
): void {
  const view = new DataView(data);
  const blocks = entries.map((entry) => ({ offset: entry.offset, length: entry.compressedLength }));
  blocks.sort((a, b) => a.offset - b.offset);
  const metadataOffset = view.getUint32(24);
  const metadataLength = view.getUint32(28);
  const metadataOriginalLength = view.getUint32(32);
  const privateOffset = view.getUint32(36);
  const privateLength = view.getUint32(40);
  if (
    (metadataOffset === 0) !== (metadataLength === 0) ||
    (metadataOffset === 0) !== (metadataOriginalLength === 0) ||
    (privateOffset === 0) !== (privateLength === 0)
  ) {
    throw new Error('Invalid WOFF1 optional block header');
  }
  if (metadataOffset) blocks.push({ offset: metadataOffset, length: metadataLength });
  if (privateOffset) blocks.push({ offset: privateOffset, length: privateLength });
  let end = directoryEnd;
  for (const block of blocks) {
    budget?.check();
    if (block.offset !== alignFontBytes(end) || block.length > data.byteLength - block.offset) {
      throw new Error('Invalid WOFF1 block alignment, overlap or bounds');
    }
    for (let i = end; i < block.offset; i++) {
      budget?.check();
      if (view.getUint8(i) !== 0) throw new Error('Invalid WOFF1 padding');
    }
    end = block.offset + block.length;
  }
  if (end > data.byteLength || data.byteLength > alignFontBytes(end)) {
    throw new Error('Invalid WOFF1 trailing data');
  }
  for (let i = end; i < data.byteLength; i++) {
    budget?.check();
    if (view.getUint8(i) !== 0) throw new Error('Invalid WOFF1 trailing padding');
  }
}

/**
 * WOFF1 uses the zlib wrapper, including its checksum, rather than raw deflate.
 * Bound retained output to the declared length and settle stream errors once.
 */
async function decompressZlib(
  data: ArrayBuffer,
  expectedLength: number,
  budget?: ParseBudget,
): Promise<ArrayBuffer> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('DecompressionStream is not available for WOFF1 decompression');
  }
  const reader = new Blob([data])
    .stream()
    .pipeThrough(new DecompressionStream('deflate'))
    .getReader();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error('WOFF1 decompression timed out')), 2_000);
  });
  try {
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      budget?.check();
      const { done, value } = await Promise.race([reader.read(), deadline]);
      if (done) break;
      total += value.byteLength;
      if (total > expectedLength) {
        throw new Error('WOFF1 decompressed table exceeds declared length');
      }
      chunks.push(value);
    }
    if (total !== expectedLength) throw new Error('WOFF1 decompressed table length mismatch');
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return out.buffer;
  } catch (cause) {
    throw new Error('Invalid WOFF1 compressed table', { cause });
  } finally {
    clearTimeout(timeout);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function reconstructSFNT(
  tables: Map<string, ArrayBuffer>,
  flavor = 0x00010000,
): ArrayBuffer | null {
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
      checksum: computeTableChecksum(tableData, tag === 'head'),
    });
    currentOffset += paddedLength;
  }

  // Build the buffer
  const totalSize = currentOffset;
  const buffer = new ArrayBuffer(totalSize);
  const out = new Uint8Array(buffer);
  const outView = new DataView(buffer);

  // Offset table header
  outView.setUint32(0, flavor);
  const entrySelector = Math.floor(Math.log2(numTables));
  const searchRange = 2 ** entrySelector * 16;
  outView.setUint16(4, numTables);
  outView.setUint16(6, searchRange);
  outView.setUint16(8, entrySelector);
  outView.setUint16(10, numTables * 16 - searchRange);

  // Table directory
  tableEntries.sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
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

  const head = tableEntries.find((entry) => entry.tag === 'head');
  if (head && head.length >= 12) {
    outView.setUint32(head.offset + 8, 0);
    outView.setUint32(head.offset + 8, (0xb1b0afba - computeTableChecksum(buffer)) >>> 0);
  }

  return buffer;
}

function computeTableChecksum(data: ArrayBuffer, isHead = false): number {
  const paddedLength = (data.byteLength + 3) & ~3;
  const bytes = new Uint8Array(paddedLength);
  bytes.set(new Uint8Array(data));
  const view = new DataView(bytes.buffer);
  let sum = 0;
  for (let i = 0; i < paddedLength; i += 4) {
    if (isHead && i === 8) continue;
    sum = (sum + view.getUint32(i)) >>> 0;
  }
  return sum;
}

async function withOriginalArtifactIdentity(
  metadata: ParsedFontMetadata,
  original: ArrayBuffer,
): Promise<ParsedFontMetadata> {
  const { contentHash, fingerprint, hashAlgorithm } = await computeFontHash(original);
  return {
    ...metadata,
    fileSize: original.byteLength,
    identity: { ...metadata.identity, contentHash, fingerprint, hashAlgorithm },
  };
}

// ── Raw TTF/OTF Parsing ────────────────────────────────────────────────────

const TTC_SIGNATURE = 0x74746366; // "ttcf"
const MAX_COLLECTION_MEMBERS = 64;

async function parseRawCollectionMembers(
  data: ArrayBuffer,
  format: FontFormat,
  budget?: ParseBudget,
): Promise<ParsedFontMetadata[]> {
  budget?.check();
  const view = new DataView(data);
  if (data.byteLength < 8 || view.getUint32(0) !== TTC_SIGNATURE) {
    return [];
  }

  // TTC header: version (uint32) at 4, numFonts at 8, offsets at 12.
  if (data.byteLength < 12) return [];
  const numFonts = view.getUint32(8);
  if (numFonts === 0 || numFonts > MAX_COLLECTION_MEMBERS) {
    return [];
  }

  const offsetStart = 12;
  const members: ParsedFontMetadata[] = [];
  for (let i = 0; i < numFonts; i++) {
    budget?.check();
    const offsetOff = offsetStart + i * 4;
    if (offsetOff + 4 > data.byteLength) break;
    const sfntOffset = view.getUint32(offsetOff);
    if (sfntOffset + 12 > data.byteLength) continue;
    const meta = await parseRawFontAtOffset(data, format, i, sfntOffset, budget);
    members.push(meta);
  }

  return members;
}

async function parseRawFontAtOffset(
  data: ArrayBuffer,
  format: FontFormat,
  collectionIndex: number,
  sfntOffset: number,
  budget?: ParseBudget,
): Promise<ParsedFontMetadata> {
  budget?.check();
  const view = new DataView(data);

  // Read offset table
  if (sfntOffset < 0 || sfntOffset + 12 > data.byteLength) {
    return fallbackMetadata(format, data.byteLength);
  }
  const numTables = view.getUint16(sfntOffset + 4);
  if (numTables === 0 || numTables > 4096 || sfntOffset + 12 + numTables * 16 > data.byteLength) {
    return fallbackMetadata(format, data.byteLength);
  }

  // Build table directory map
  const tableMap = readTableDirectory(data, sfntOffset, numTables, budget);

  // Parse required tables
  const nameRecords = parseNameTable(data, tableMap, budget);
  budget?.check();
  const headData = parseHeadTable(data, tableMap);
  const os2Data = parseOS2Table(data, tableMap);
  const hheaData = parseHheaTable(data, tableMap);
  const fvarData = parseFvarTable(data, tableMap, nameRecords, budget);
  const cmapRanges = parseCmapTable(data, tableMap, budget);
  const gsubFeatures = parseGSUBTable(data, tableMap, budget);
  const gposFeatures = parseGPOSTable(data, tableMap, budget);
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
  budget?.check();
  const { contentHash, fingerprint, hashAlgorithm } = await computeFontHash(data);
  budget?.check();

  const unitsPerEm = headData.unitsPerEm || 1000;
  const ascender = os2Data.ascender ?? hheaData.ascender ?? 800;
  const descender = os2Data.descender ?? hheaData.descender ?? -200;
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
    // Script coverage is derived from the validated cmap ranges rather than
    // guessed from the family name. This keeps source filters useful for
    // multilingual fonts whose OS/2 code-page bits are incomplete.
    scripts: scriptsFromUnicodeRanges(cmapRanges, budget),
    languages: [],
    embeddingRights,
    embeddingPolicy: os2Data.embeddingPolicy,
    licenseProvenance: license || licenseUrl ? 'declared' : 'unknown',
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
  budget?: ParseBudget,
): Map<string, TableDirectory> {
  const view = new DataView(data);
  const map = new Map<string, TableDirectory>();
  const dirStart = sfntOffset + 12;

  for (let i = 0; i < numTables; i++) {
    budget?.check();
    const off = dirStart + i * 16;
    if (off + 16 > data.byteLength) break;

    const tag = String.fromCharCode(
      view.getUint8(off),
      view.getUint8(off + 1),
      view.getUint8(off + 2),
      view.getUint8(off + 3),
    );
    const offset = view.getUint32(off + 8);
    const length = view.getUint32(off + 12);
    // Table spans are untrusted input. Reject entries that point outside the
    // file instead of allowing a later parser to read unrelated bytes.
    if (offset > data.byteLength || length > data.byteLength - offset) continue;
    map.set(tag, {
      tag,
      offset,
      length,
      checksum: view.getUint32(off + 4),
    });
  }

  return map;
}

interface NameRecords {
  [nameID: number]: string;
}

function parseNameTable(
  data: ArrayBuffer,
  tables: Map<string, TableDirectory>,
  budget?: ParseBudget,
): NameRecords {
  const table = tables.get('name');
  if (!table || table.length < 6) return {};

  const view = new DataView(data, table.offset, table.length);
  const result: NameRecords = {};
  const priority: Record<number, number> = {};

  const count = view.getUint16(2);
  const stringOffset = view.getUint16(4);
  const recordsStart = 6;
  const recordsEnd = recordsStart + count * 12;
  if (recordsEnd > table.length || stringOffset < recordsEnd || stringOffset > table.length) {
    return result;
  }

  for (let i = 0; i < count; i++) {
    budget?.check();
    const recOff = recordsStart + i * 12;

    const platformID = view.getUint16(recOff);
    const encodingID = view.getUint16(recOff + 2);
    const languageID = view.getUint16(recOff + 4);
    const nameID = view.getUint16(recOff + 6);
    const length = view.getUint16(recOff + 8);
    const offset2 = view.getUint16(recOff + 10);

    // Prefer Windows records, then Unicode-platform records. Within a
    // platform favor the default/Windows English language IDs and Unicode
    // encodings over legacy encodings.
    const recordPriority =
      (platformID === 3 ? 20 : platformID === 0 ? 18 : platformID === 1 ? 10 : 0) +
      (encodingID === 10 || encodingID === 1 ? 2 : 0) +
      (languageID === 0 || languageID === 0x0409 ? 1 : 0);
    if (result[nameID] !== undefined && (priority[nameID] ?? -1) >= recordPriority) continue;

    const strBase = stringOffset + offset2;
    if (strBase + length > table.length) continue;

    const bytes = new Uint8Array(data, table.offset + strBase, length);

    let decoded: string;
    if (platformID === 0 || platformID === 3) {
      if (length % 2 !== 0) continue;
      decoded = decodeUTF16BE(bytes);
    } else if (platformID === 1) {
      decoded = decodeMacRoman(bytes);
    } else {
      decoded = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    }

    result[nameID] = decoded.trim();
    priority[nameID] = recordPriority;
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
  // The OpenType name table permits platform 1 (Macintosh) records. These
  // records use Apple's MacRoman encoding, not ISO-8859-1; replacing all
  // high bytes with U+FFFD loses real family names when a font omits its
  // Windows/Unicode duplicate. Keep the mapping local and deterministic so
  // parsing never depends on a platform codec being available.
  const highBytes =
    '\u00c4\u00c5\u00c7\u00c9\u00d1\u00d6\u00dc\u00e1\u00e0\u00e2\u00e4\u00e3\u00e5\u00e7\u00e9\u00e8\u00ea\u00eb\u00ed\u00ec\u00ee\u00ef\u00f1\u00f3\u00f2\u00f4\u00f6\u00f5\u00fa\u00f9\u00fb\u00fc\u2020\u00b0\u00a2\u00a3\u00a7\u2022\u00b6\u00df\u00ae\u00a9\u2122\u00b4\u00a8\u2260\u00c6\u00d8\u221e\u00b1\u2264\u2265\u00a5\u00b5\u2202\u2211\u220f\u03c0\u222b\u00aa\u00ba\u03a9\u00e6\u00f8\u00bf\u00a1\u00ac\u221a\u0192\u2248\u2206\u00ab\u00bb\u2026\u00a0\u00c0\u00c3\u00d5\u0152\u0153\u2013\u2014\u201c\u201d\u2018\u2019\u00f7\u25ca\u00ff\u0178\u2044\u20ac\u2039\u203a\ufb01\ufb02\u2021\u00b7\u201a\u201e\u2030\u00c2\u00ca\u00c1\u00cb\u00c8\u00cd\u00ce\u00cf\u00cc\u00d3\u00d4\uf8ff\u00d2\u00da\u00db\u00d9\u0131\u02c6\u02dc\u00af\u02d8\u02d9\u02da\u00b8\u02dd\u02db\u02c7';
  const chars: string[] = [];
  for (const b of bytes) {
    if (b < 0x80) {
      chars.push(String.fromCharCode(b));
    } else {
      chars.push(highBytes[b - 0x80] ?? '\uFFFD');
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
  ascender?: number;
  descender?: number;
  xHeight?: number;
  capHeight?: number;
  embeddingRights: EmbeddingRights;
  embeddingPolicy: FontEmbeddingPolicy;
  panose?: Uint8Array;
  scripts: string[];
}

function parseOS2Table(data: ArrayBuffer, tables: Map<string, TableDirectory>): OS2Data {
  const table = tables.get('OS/2');
  // Legacy version-0 tables may end at usLastCharIndex (68 bytes). Bounds
  // belong to this table, not the whole file: the next table is unrelated data.
  if (!table || table.length < 68) {
    return {
      embeddingRights: 'unknown',
      embeddingPolicy: {
        baseRights: 'unknown',
        noSubsetting: false,
        bitmapOnly: false,
        source: 'unknown',
      },
      scripts: [],
    };
  }

  const view = new DataView(data, table.offset, table.length);
  const version = view.getUint16(0);

  const ascender = table.length >= 78 ? view.getInt16(68) : undefined;
  const descender = table.length >= 78 ? view.getInt16(70) : undefined;

  let xHeight: number | undefined;
  let capHeight: number | undefined;
  if (version >= 2 && table.length >= 96) {
    xHeight = view.getInt16(86);
    capHeight = view.getInt16(88);
  }

  // fsType at offset 8 — embedding permissions
  const fsType = view.getUint16(8);
  const embeddingPolicy = classifyEmbeddingFSType(fsType);
  const embeddingRights = embeddingPolicy.noSubsetting
    ? 'no-subsetting'
    : embeddingPolicy.baseRights;

  // Panose classification
  const panose = new Uint8Array(data, table.offset + 32, 10);

  // Unicode range (bytes 42-58)
  const scripts: string[] = [];
  // Simplified: just track if the font has CJK ranges

  return {
    ascender,
    descender,
    xHeight,
    capHeight,
    embeddingRights,
    embeddingPolicy,
    panose,
    scripts,
  };
}

/** Decode OS/2 fsType while keeping technical flags separate from base rights. */
export function classifyEmbeddingFSType(fsType: number): FontEmbeddingPolicy {
  const noSubsetting = (fsType & 0x0100) !== 0;
  const bitmapOnly = (fsType & 0x0200) !== 0;

  let baseRights: FontEmbeddingPolicy['baseRights'] = 'installable';

  // Bit 1 (0x0002) = Restricted License Embedding
  if (fsType & 0x0002) baseRights = 'restricted';
  // Bit 2 (0x0004) = Preview & Print Embedding
  else if (fsType & 0x0004) baseRights = 'preview-and-print';
  // Bit 3 (0x0008) = Editable Embedding
  else if (fsType & 0x0008) baseRights = 'editable';

  return { baseRights, noSubsetting, bitmapOnly, source: 'os2' };
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

function parseFvarTable(
  data: ArrayBuffer,
  tables: Map<string, TableDirectory>,
  names: NameRecords = {},
  budget?: ParseBudget,
): FvarData {
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
    budget?.check();
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
    const axisNameId = view.getUint16(axisOffset + 18);

    // Resolve axis name from name table
    const axisName = names[axisNameId] || AXIS_NAMES[tag] || tag;

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
    budget?.check();
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

    const subfamilyNameId = view.getUint16(instOffset);
    instances.push({
      name: names[subfamilyNameId] || `Instance ${i + 1}`,
      coordinates: coords,
    });
    instOffset += instanceSize;
  }

  return { axes, instances };
}

function parseCmapTable(
  data: ArrayBuffer,
  tables: Map<string, TableDirectory>,
  budget?: ParseBudget,
): Array<[number, number]> {
  const table = tables.get('cmap');
  if (!table || table.length < 4) return [];

  const view = new DataView(data);
  const base = table.offset;
  const tableEnd = Math.min(data.byteLength, base + table.length);
  const numSubtables = view.getUint16(base + 2);
  const recordsEnd = base + 4 + numSubtables * 8;
  if (recordsEnd > tableEnd) return [];

  const ranges: Array<[number, number]> = [];
  for (let i = 0; i < Math.min(numSubtables, 32); i++) {
    budget?.check();
    const record = base + 4 + i * 8;
    const offset = view.getUint32(record + 4);
    if (offset > table.length - 2) continue;
    const subtable = base + offset;
    const format = view.getUint16(subtable);
    ranges.push(...parseCmapSubtable(view, subtable, tableEnd, format, budget));
  }

  return mergeUnicodeRanges(ranges, budget);
}

function parseCmapSubtable(
  view: DataView,
  offset: number,
  tableEnd: number,
  format: number,
  budget?: ParseBudget,
): Array<[number, number]> {
  switch (format) {
    case 0:
      return parseCmapFormat0(view, offset, tableEnd, budget);
    case 4:
      return parseCmapFormat4(view, offset, tableEnd, budget);
    case 6:
      return parseCmapFormat6(view, offset, tableEnd, budget);
    case 10:
      return parseCmapFormat10(view, offset, tableEnd, budget);
    case 12:
      return parseCmapFormat12Or13(view, offset, tableEnd, false, budget);
    case 13:
      return parseCmapFormat12Or13(view, offset, tableEnd, true, budget);
    default:
      return [];
  }
}

function subtableEnd(
  view: DataView,
  offset: number,
  tableEnd: number,
  lengthBytes: 2 | 4,
  minimumLength: number,
): number | null {
  if (offset + 2 + lengthBytes > tableEnd) return null;
  const length = lengthBytes === 2 ? view.getUint16(offset + 2) : view.getUint32(offset + 4);
  if (length < minimumLength || length > tableEnd - offset) return null;
  return offset + length;
}

function parseCmapFormat0(
  view: DataView,
  offset: number,
  tableEnd: number,
  budget?: ParseBudget,
): Array<[number, number]> {
  const end = subtableEnd(view, offset, tableEnd, 2, 262);
  if (end === null) return [];
  const ranges: Array<[number, number]> = [];
  for (let code = 0; code < 256; code++) {
    budget?.check();
    if (view.getUint8(offset + 6 + code) !== 0) ranges.push([code, code]);
  }
  return ranges;
}

function parseCmapFormat4(
  view: DataView,
  offset: number,
  tableEnd: number,
  budget?: ParseBudget,
): Array<[number, number]> {
  const end = subtableEnd(view, offset, tableEnd, 2, 16);
  if (end === null || offset + 8 > end) return [];
  const segCountX2 = view.getUint16(offset + 6);
  if (segCountX2 === 0 || (segCountX2 & 1) !== 0) return [];
  const segCount = segCountX2 / 2;
  const endCodes = offset + 14;
  const startCodes = endCodes + segCount * 2 + 2;
  const idDeltas = startCodes + segCount * 2;
  const idRangeOffsets = idDeltas + segCount * 2;
  if (idRangeOffsets + segCount * 2 > end) return [];

  const ranges: Array<[number, number]> = [];
  for (let segment = 0; segment < segCount; segment++) {
    budget?.check();
    const endCode = view.getUint16(endCodes + segment * 2);
    const startCode = view.getUint16(startCodes + segment * 2);
    if (startCode > endCode || startCode === 0xffff) continue;
    const delta = view.getInt16(idDeltas + segment * 2);
    const rangeOffset = view.getUint16(idRangeOffsets + segment * 2);
    let runStart: number | null = null;
    let previous = -2;
    for (let code = startCode; code <= endCode; code++) {
      budget?.check();
      let glyph = 0;
      if (rangeOffset === 0) {
        glyph = (code + delta) & 0xffff;
      } else {
        const glyphOffset = idRangeOffsets + segment * 2 + rangeOffset + (code - startCode) * 2;
        if (glyphOffset + 2 > end) break;
        glyph = view.getUint16(glyphOffset);
        if (glyph !== 0) glyph = (glyph + delta) & 0xffff;
      }
      if (glyph !== 0) {
        if (runStart === null || code !== previous + 1) {
          if (runStart !== null) ranges.push([runStart, previous]);
          runStart = code;
        }
        previous = code;
      }
    }
    if (runStart !== null) ranges.push([runStart, previous]);
  }
  return ranges;
}

function parseCmapFormat6(
  view: DataView,
  offset: number,
  tableEnd: number,
  budget?: ParseBudget,
): Array<[number, number]> {
  const end = subtableEnd(view, offset, tableEnd, 2, 10);
  if (end === null) return [];
  const firstCode = view.getUint16(offset + 6);
  const entryCount = view.getUint16(offset + 8);
  if (offset + 10 + entryCount * 2 > end) return [];
  const ranges: Array<[number, number]> = [];
  for (let index = 0; index < entryCount; index++) {
    budget?.check();
    if (view.getUint16(offset + 10 + index * 2) !== 0) {
      ranges.push([firstCode + index, firstCode + index]);
    }
  }
  return ranges;
}

function parseCmapFormat10(
  view: DataView,
  offset: number,
  tableEnd: number,
  budget?: ParseBudget,
): Array<[number, number]> {
  const end = subtableEnd(view, offset, tableEnd, 4, 20);
  if (end === null) return [];
  const firstCode = view.getUint32(offset + 12);
  const entryCount = view.getUint32(offset + 16);
  if (entryCount > (end - (offset + 20)) / 2) return [];
  const ranges: Array<[number, number]> = [];
  for (let index = 0; index < entryCount; index++) {
    budget?.check();
    if (view.getUint16(offset + 20 + index * 2) !== 0) {
      ranges.push([firstCode + index, firstCode + index]);
    }
  }
  return ranges;
}

function parseCmapFormat12Or13(
  view: DataView,
  offset: number,
  tableEnd: number,
  constantGlyph: boolean,
  budget?: ParseBudget,
): Array<[number, number]> {
  const end = subtableEnd(view, offset, tableEnd, 4, 16);
  if (end === null) return [];
  const groups = view.getUint32(offset + 12);
  if (groups > (end - (offset + 16)) / 12 || groups > 100_000) return [];
  const ranges: Array<[number, number]> = [];
  for (let index = 0; index < groups; index++) {
    budget?.check();
    const group = offset + 16 + index * 12;
    const start = view.getUint32(group);
    const finish = view.getUint32(group + 4);
    const glyph = view.getUint32(group + 8);
    if (start <= finish && finish <= 0x10ffff && (constantGlyph ? glyph !== 0 : true)) {
      ranges.push([start, finish]);
    }
  }
  return ranges;
}

function mergeUnicodeRanges(
  ranges: Array<[number, number]>,
  budget?: ParseBudget,
): Array<[number, number]> {
  if (ranges.length < 2) return ranges;
  const sorted = [...ranges].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: Array<[number, number]> = [];
  for (const [start, end] of sorted) {
    budget?.check();
    const previous = merged.at(-1);
    if (previous && start <= previous[1] + 1) previous[1] = Math.max(previous[1], end);
    else merged.push([start, end]);
  }
  return merged;
}

/** Return OpenType script tags represented by validated cmap coverage. */
function scriptsFromUnicodeRanges(ranges: Array<[number, number]>, budget?: ParseBudget): string[] {
  const scripts = new Set<string>();
  for (const [start, end] of ranges) {
    budget?.check();
    for (const [tag, scriptStart, scriptEnd] of UNICODE_SCRIPT_RANGES) {
      if (start <= scriptEnd && end >= scriptStart) scripts.add(tag);
    }
  }
  return [...scripts];
}

const UNICODE_SCRIPT_RANGES: readonly [string, number, number][] = [
  ['latn', 0x0000, 0x024f],
  ['grek', 0x0370, 0x03ff],
  ['cyrl', 0x0400, 0x052f],
  ['hebr', 0x0590, 0x05ff],
  ['arab', 0x0600, 0x06ff],
  ['syrc', 0x0700, 0x074f],
  ['armn', 0x0530, 0x058f],
  ['deva', 0x0900, 0x097f],
  ['beng', 0x0980, 0x09ff],
  ['guru', 0x0a00, 0x0a7f],
  ['gujr', 0x0a80, 0x0aff],
  ['orya', 0x0b00, 0x0b7f],
  ['taml', 0x0b80, 0x0bff],
  ['telu', 0x0c00, 0x0c7f],
  ['knda', 0x0c80, 0x0cff],
  ['mlym', 0x0d00, 0x0d7f],
  ['sinh', 0x0d80, 0x0dff],
  ['thai', 0x0e00, 0x0e7f],
  ['lao ', 0x0e80, 0x0eff],
  ['tibt', 0x0f00, 0x0fff],
  ['mymr', 0x1000, 0x109f],
  ['geor', 0x10a0, 0x10ff],
  ['ethi', 0x1200, 0x137f],
  ['khmr', 0x1780, 0x17ff],
  ['hani', 0x3400, 0x9fff],
  ['hang', 0xac00, 0xd7af],
  ['kana', 0x3040, 0x30ff],
];

function parseGSUBTable(
  data: ArrayBuffer,
  tables: Map<string, TableDirectory>,
  budget?: ParseBudget,
): string[] {
  const table = tables.get('GSUB');
  if (!table) return [];
  return parseFeatureList(data, table.offset, table.length, budget);
}

function parseGPOSTable(
  data: ArrayBuffer,
  tables: Map<string, TableDirectory>,
  budget?: ParseBudget,
): string[] {
  const table = tables.get('GPOS');
  if (!table) return [];
  return parseFeatureList(data, table.offset, table.length, budget);
}

function parseFeatureList(
  data: ArrayBuffer,
  offset: number,
  length: number,
  budget?: ParseBudget,
): string[] {
  const tableEnd = Math.min(data.byteLength, offset + length);
  if (length < 10 || offset < 0 || offset + 10 > tableEnd) return [];

  const view = new DataView(data);
  const featureListOffset = view.getUint16(offset + 6);
  if (featureListOffset > length - 2) return [];
  const featureList = offset + featureListOffset;
  if (featureList + 2 > tableEnd) return [];
  const featureCount = view.getUint16(featureList);
  const recordsEnd = featureList + 2 + featureCount * 6;
  if (recordsEnd > tableEnd) return [];
  const features: string[] = [];

  for (let i = 0; i < featureCount && i < 100; i++) {
    budget?.check();
    const recOff = featureList + 2 + i * 6;

    const tag = String.fromCharCode(
      view.getUint8(recOff),
      view.getUint8(recOff + 1),
      view.getUint8(recOff + 2),
      view.getUint8(recOff + 3),
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
