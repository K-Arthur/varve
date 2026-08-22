import { describe, expect, it } from 'vitest';
import { detectFontFormat, fontIdentityKey } from './fontIdentity';
import { parseFontCollection, parseFontData } from './fontParser';

// ── Helper: build minimal OpenType font bytes ──────────────────────────

function buildMinimalSFNT(
  headTable: ArrayBuffer,
  nameTable: ArrayBuffer,
  os2Table?: ArrayBuffer,
  hheaTable?: ArrayBuffer,
  maxpTable?: ArrayBuffer,
  fvarTable?: ArrayBuffer,
  cmapTable?: ArrayBuffer,
  gsubTable?: ArrayBuffer,
  colrTable?: ArrayBuffer,
  cpalTable?: ArrayBuffer,
): ArrayBuffer {
  const tables: Array<{ tag: string; data: ArrayBuffer }> = [
    { tag: 'head', data: headTable },
    { tag: 'name', data: nameTable },
  ];
  if (os2Table) tables.push({ tag: 'OS/2', data: os2Table });
  if (hheaTable) tables.push({ tag: 'hhea', data: hheaTable });
  if (maxpTable) tables.push({ tag: 'maxp', data: maxpTable });
  if (fvarTable) tables.push({ tag: 'fvar', data: fvarTable });
  if (cmapTable) tables.push({ tag: 'cmap', data: cmapTable });
  if (gsubTable) tables.push({ tag: 'GSUB', data: gsubTable });
  if (colrTable) tables.push({ tag: 'COLR', data: colrTable });
  if (cpalTable) tables.push({ tag: 'CPAL', data: cpalTable });

  const numTables = tables.length;
  const headerSize = 12;
  const dirSize = numTables * 16;
  const totalDirAndHeader = headerSize + dirSize;

  let currentOffset = totalDirAndHeader;
  const entries: Array<{ tag: string; offset: number; length: number; checksum: number }> = [];
  for (const { tag, data } of tables) {
    const paddedLength = (data.byteLength + 3) & ~3;
    entries.push({
      tag,
      offset: currentOffset,
      length: data.byteLength,
      checksum: computeChecksum(data),
    });
    currentOffset += paddedLength;
  }

  const buffer = new ArrayBuffer(currentOffset);
  const out = new Uint8Array(buffer);
  const view = new DataView(buffer);

  // sfVersion = 0x00010000 for TrueType, 0x4F54544F for OTF
  view.setUint32(0, 0x00010000);
  view.setUint16(4, numTables);
  const maxPow2 = 2 ** Math.floor(Math.log2(numTables));
  view.setUint16(6, maxPow2 * 16);
  view.setUint16(8, Math.log2(maxPow2));
  view.setUint16(10, numTables - maxPow2);

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]!;
    const off = headerSize + i * 16;
    const tagBytes = e.tag;
    out[off] = tagBytes.charCodeAt(0);
    out[off + 1] = tagBytes.charCodeAt(1);
    out[off + 2] = tagBytes.charCodeAt(2);
    out[off + 3] = tagBytes.charCodeAt(3);
    view.setUint32(off + 4, e.checksum);
    view.setUint32(off + 8, e.offset);
    view.setUint32(off + 12, e.length);
  }

  for (const e of entries) {
    const t = tables.find((t) => t.tag === e.tag)!;
    out.set(new Uint8Array(t.data), e.offset);
  }

  return buffer;
}

function computeChecksum(data: ArrayBuffer): number {
  const words = new Uint16Array(data);
  let sum = 0;
  for (let i = 0; i < words.length; i++) {
    sum = (sum + (words[i] ?? 0)) | 0;
  }
  return sum >>> 0;
}

function makeNameTable(fields: Record<number, string>): ArrayBuffer {
  const entries: Array<{ platformID: number; nameID: number; text: string }> = [];
  for (const [nameID, text] of Object.entries(fields)) {
    entries.push({ platformID: 3, nameID: parseInt(nameID, 10), text });
  }

  const stringsSize = entries.reduce((sum, e) => sum + e.text.length * 2, 0);
  const entriesSize = entries.length * 12;
  const headerSize = 6;
  const totalSize = headerSize + entriesSize + stringsSize;
  const buffer = new ArrayBuffer(totalSize);
  const view = new DataView(buffer);

  view.setUint16(0, 0); // format
  view.setUint16(2, entries.length);
  const stringOffset = headerSize + entriesSize;
  view.setUint16(4, stringOffset);

  let strPos = stringOffset;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]!;
    const recOff = headerSize + i * 12;
    view.setUint16(recOff, e.platformID);
    view.setUint16(recOff + 2, 3); // encodingID = Unicode BMP
    view.setUint16(recOff + 4, e.nameID);
    view.setUint16(recOff + 6, e.text.length * 2);
    view.setUint16(recOff + 8, strPos - stringOffset);

    for (let j = 0; j < e.text.length; j++) {
      view.setUint16(strPos + j * 2, e.text.charCodeAt(j));
    }
    strPos += e.text.length * 2;
  }

  return buffer;
}

function makeHeadTable(unitsPerEm: number = 1000, macStyle: number = 0): ArrayBuffer {
  const buffer = new ArrayBuffer(54);
  const view = new DataView(buffer);
  view.setUint16(18, unitsPerEm);
  view.setUint16(44, macStyle);
  return buffer;
}

function makeOS2Table(
  ascender: number = 800,
  descender: number = -200,
  fsType: number = 0,
  xHeight?: number,
  capHeight?: number,
): ArrayBuffer {
  const length = capHeight !== undefined ? 90 : xHeight !== undefined ? 88 : 86;
  const buffer = new ArrayBuffer(length);
  const view = new DataView(buffer);
  view.setUint16(8, fsType);
  view.setInt16(68, ascender);
  view.setInt16(70, descender);
  if (xHeight !== undefined) view.setUint16(86, xHeight);
  if (capHeight !== undefined) view.setUint16(88, capHeight);
  return buffer;
}

function makeHheaTable(
  ascender: number = 800,
  descender: number = -200,
  lineGap: number = 0,
): ArrayBuffer {
  const buffer = new ArrayBuffer(36);
  const view = new DataView(buffer);
  view.setInt16(4, ascender);
  view.setInt16(6, descender);
  view.setInt16(8, lineGap);
  return buffer;
}

function makeMaxpTable(glyphCount: number = 500): ArrayBuffer {
  const buffer = new ArrayBuffer(6);
  new DataView(buffer).setUint16(4, glyphCount);
  return buffer;
}

/** Writes an OpenType `Fixed` (signed 16.16 fixed-point), as `fvar` requires. */
function setFixed(view: DataView, offset: number, value: number): void {
  view.setInt32(offset, Math.round(value * 65536), false);
}

/**
 * Builds a spec-shaped `fvar` table.
 *
 * This fixture previously wrote axis bounds as IEEE floats at header offsets
 * that did not match the OpenType layout — the same two mistakes the parser
 * made — so the round-trip agreed with itself and no test could see that real
 * fonts parsed to garbage. It now follows the spec, which is what makes the
 * assertions below meaningful.
 */
function makeFvarTable(
  axes: Array<{ tag: string; min: number; default: number; max: number }>,
  namedInstances: Array<Record<string, number>> = [],
): ArrayBuffer {
  if (axes.length === 0) return new ArrayBuffer(0);

  const axesArrayOffset = 16;
  const axisSize = 20;
  const instanceSize = 4 + axes.length * 4;
  const totalSize = axesArrayOffset + axes.length * axisSize + namedInstances.length * instanceSize;
  const buffer = new ArrayBuffer(totalSize);
  const view = new DataView(buffer);

  view.setUint16(0, 1); // majorVersion
  view.setUint16(2, 0); // minorVersion
  view.setUint16(4, axesArrayOffset);
  view.setUint16(6, 2); // reserved
  view.setUint16(8, axes.length);
  view.setUint16(10, axisSize);
  view.setUint16(12, namedInstances.length);
  view.setUint16(14, instanceSize);

  for (let i = 0; i < axes.length; i++) {
    const ax = axes[i]!;
    const off = axesArrayOffset + i * axisSize;
    const tagBytes = ax.tag;
    view.setUint8(off, tagBytes.charCodeAt(0));
    view.setUint8(off + 1, tagBytes.charCodeAt(1));
    view.setUint8(off + 2, tagBytes.charCodeAt(2));
    view.setUint8(off + 3, tagBytes.charCodeAt(3));
    setFixed(view, off + 4, ax.min);
    setFixed(view, off + 8, ax.default);
    setFixed(view, off + 12, ax.max);
    view.setUint16(off + 16, 0); // flags
    view.setUint16(off + 18, 0); // axisNameID
  }

  const instanceBase = axesArrayOffset + axes.length * axisSize;
  for (let i = 0; i < namedInstances.length; i++) {
    const off = instanceBase + i * instanceSize;
    view.setUint16(off, 0); // subfamilyNameID
    view.setUint16(off + 2, 0); // flags
    for (let a = 0; a < axes.length; a++) {
      const tag = axes[a]!.tag;
      setFixed(view, off + 4 + a * 4, namedInstances[i]![tag] ?? axes[a]!.default);
    }
  }

  return buffer;
}

function makeFormat4Cmap(ranges: Array<[number, number]>): ArrayBuffer {
  const segCount = ranges.length;
  const bufSize = 14 + 8 * segCount + 4;
  const buffer = new ArrayBuffer(bufSize);
  const view = new DataView(buffer);

  view.setUint16(0, 4); // format
  view.setUint16(2, bufSize); // length
  view.setUint16(6, segCount * 2); // segCountX2
  view.setUint16(8, 0); // searchRange
  view.setUint16(10, 0); // entrySelector
  view.setUint16(12, 0); // rangeShift

  for (let i = 0; i < segCount; i++) {
    const [start, end] = ranges[i]!;
    // endCode
    view.setUint16(14 + i * 2, end);
    // startCode
    view.setUint16(14 + segCount * 2 + i * 2, start);
  }

  return buffer;
}

function makeCmapTable(subtables: ArrayBuffer[]): ArrayBuffer {
  const version = 4;
  const numTables = subtables.length;
  let totalSize = 4;
  const offsets: number[] = [];
  for (const sub of subtables) {
    offsets.push(totalSize);
    totalSize += sub.byteLength;
  }

  const buffer = new ArrayBuffer(totalSize);
  const view = new DataView(buffer);
  view.setUint16(0, version);
  view.setUint16(2, numTables);

  for (let i = 0; i < numTables; i++) {
    const off = 4 + i * 8;
    view.setUint16(off, 3); // platformID = Windows
    view.setUint16(off + 2, 1); // encodingID = Unicode BMP
    view.setUint32(off + 4, offsets[i]!);
  }

  for (let i = 0; i < numTables; i++) {
    new Uint8Array(buffer).set(new Uint8Array(subtables[i]!), offsets[i]!);
  }

  return buffer;
}

function makeGSUBTable(featureTags: string[]): ArrayBuffer {
  // Layout matches what parseFeatureList expects:
  // offset+4: featureCount (uint16)
  // offset+8: feature record offsets (2 bytes each)
  // Each feature record: 4-byte tag + 2-byte padding
  const recordOffsetsSize = featureTags.length * 2;
  const recordDataSize = featureTags.length * 6;
  const headerSize = 8;
  const totalSize = headerSize + recordOffsetsSize + recordDataSize;
  const buffer = new ArrayBuffer(totalSize);
  const view = new DataView(buffer);

  view.setUint16(0, 0); // padding
  view.setUint16(2, 0); // padding
  view.setUint16(4, featureTags.length); // featureCount
  view.setUint16(6, 0); // padding

  // Feature record offsets at offset+8
  const recordDataStart = headerSize + recordOffsetsSize;

  for (let i = 0; i < featureTags.length; i++) {
    const tag = featureTags[i]!;
    const recOffset = recordDataStart + i * 6;
    // Offset relative to offset+0 (since absOff = offset + featureOffset in parser)
    view.setUint16(headerSize + i * 2, recOffset);

    // Feature tag at recOffset
    view.setUint8(recOffset, tag.charCodeAt(0));
    view.setUint8(recOffset + 1, tag.charCodeAt(1));
    view.setUint8(recOffset + 2, tag.charCodeAt(2));
    view.setUint8(recOffset + 3, tag.charCodeAt(3));
    view.setUint16(recOffset + 4, 0); // padding
  }

  return buffer;
}

function buildTestFont(
  nameFields: Record<number, string> = {
    1: 'TestSans',
    2: 'Regular',
    4: 'TestSans Regular',
    6: 'TestSans-Regular',
  },
  extras?: {
    os2?: {
      ascender: number;
      descender: number;
      fsType: number;
      xHeight?: number;
      capHeight?: number;
    };
    hhea?: { ascender: number; descender: number; lineGap: number };
    maxp?: number;
    fvar?: Array<{ tag: string; min: number; default: number; max: number }>;
    cmap?: Array<[number, number]>;
    gsub?: string[];
    colr?: boolean;
  },
): ArrayBuffer {
  const nameTable = makeNameTable(nameFields);
  const headTable = makeHeadTable(1000);

  const os2Data = extras?.os2 ?? { ascender: 800, descender: -200, fsType: 0 };
  const os2Table = makeOS2Table(
    os2Data.ascender,
    os2Data.descender,
    os2Data.fsType,
    os2Data.xHeight,
    os2Data.capHeight,
  );

  const hheaData = extras?.hhea ?? { ascender: 800, descender: -200, lineGap: 0 };
  const hheaTable = makeHheaTable(hheaData.ascender, hheaData.descender, hheaData.lineGap);

  const maxpTable = makeMaxpTable(extras?.maxp ?? 500);

  const cmapSubtable = makeFormat4Cmap(extras?.cmap ?? [[0x0020, 0x007e]]);
  const cmapTable = makeCmapTable([cmapSubtable]);

  let fvarTable: ArrayBuffer | undefined;
  if (extras?.fvar) {
    fvarTable = makeFvarTable(extras.fvar);
  }

  let gsubTable: ArrayBuffer | undefined;
  if (extras?.gsub) {
    gsubTable = makeGSUBTable(extras.gsub);
  }

  let colrTable: ArrayBuffer | undefined;
  if (extras?.colr) {
    colrTable = new ArrayBuffer(4);
  }

  return buildMinimalSFNT(
    headTable,
    nameTable,
    os2Table,
    hheaTable,
    maxpTable,
    fvarTable,
    cmapTable,
    gsubTable,
    colrTable,
  );
}

describe('detectFontFormat', () => {
  it('detects TrueType (ttf) from 0x00010000 sfVersion', () => {
    const buf = new ArrayBuffer(4);
    const view = new DataView(buf);
    view.setUint32(0, 0x00010000);
    expect(detectFontFormat(buf)).toBe('ttf');
  });

  it('detects OTF from 0x4F54544F sfVersion', () => {
    const buf = new ArrayBuffer(4);
    const view = new DataView(buf);
    view.setUint32(0, 0x4f54544f);
    expect(detectFontFormat(buf)).toBe('otf');
  });

  it('detects WOFF from wOFF magic', () => {
    const buf = new ArrayBuffer(4);
    const view = new DataView(buf);
    view.setUint32(0, 0x774f4646);
    expect(detectFontFormat(buf)).toBe('woff');
  });

  it('detects WOFF2 from wOF2 magic', () => {
    const buf = new ArrayBuffer(4);
    const view = new DataView(buf);
    view.setUint32(0, 0x774f4632);
    expect(detectFontFormat(buf)).toBe('woff2');
  });

  it('returns unknown for unrecognised format', () => {
    const buf = new ArrayBuffer(4);
    const view = new DataView(buf);
    view.setUint32(0, 0xdeadbeef);
    expect(detectFontFormat(buf)).toBe('unknown');
  });

  it('returns unknown for empty buffer', () => {
    expect(detectFontFormat(new ArrayBuffer(0))).toBe('unknown');
  });
});

describe('parseFontData', () => {
  it('parses a minimal TTF font and extracts identity fields', async () => {
    const data = buildTestFont();
    const meta = await parseFontData(data);

    expect(meta.identity.familyName).toBe('TestSans');
    expect(meta.identity.subfamilyName).toBe('Regular');
    expect(meta.identity.fullName).toBe('TestSans Regular');
    expect(meta.identity.postScriptName).toBe('TestSans-Regular');
    expect(meta.format).toBe('ttf');
    expect(meta.fileSize).toBeGreaterThan(0);
  });

  it('generates a deterministic content hash', async () => {
    const data = buildTestFont();
    const meta1 = await parseFontData(data);
    const meta2 = await parseFontData(data);
    expect(meta1.identity.contentHash).toBeTruthy();
    expect(meta1.identity.contentHash).toBe(meta2.identity.contentHash);
  });

  it('extracts metrics from OS/2 and hhea tables', async () => {
    const data = buildTestFont(undefined, {
      os2: { ascender: 900, descender: -300, fsType: 0 },
      hhea: { ascender: 920, descender: -280, lineGap: 200 },
    });
    const meta = await parseFontData(data);
    expect(meta.ascender).toBe(900);
    expect(meta.descender).toBe(-300);
    expect(meta.lineGap).toBe(200);
  });

  it('extracts x-height and cap-height from OS/2 table', async () => {
    const data = buildTestFont(undefined, {
      os2: { ascender: 800, descender: -200, fsType: 0, xHeight: 500, capHeight: 700 },
    });
    const meta = await parseFontData(data);
    expect(meta.xHeight).toBe(500);
    expect(meta.capHeight).toBe(700);
  });

  it('extracts glyph count from maxp table', async () => {
    const data = buildTestFont(undefined, { maxp: 1234 });
    const meta = await parseFontData(data);
    expect(meta.glyphCount).toBe(1234);
  });

  it('classifies embedding rights from fsType', async () => {
    const installable = buildTestFont(undefined, {
      os2: { ascender: 800, descender: -200, fsType: 0 },
    });
    expect((await parseFontData(installable)).embeddingRights).toBe('installable');

    const restricted = buildTestFont(undefined, {
      os2: { ascender: 800, descender: -200, fsType: 0x0002 },
    });
    expect((await parseFontData(restricted)).embeddingRights).toBe('restricted');

    const previewAndPrint = buildTestFont(undefined, {
      os2: { ascender: 800, descender: -200, fsType: 0x0004 },
    });
    expect((await parseFontData(previewAndPrint)).embeddingRights).toBe('preview-and-print');

    const editable = buildTestFont(undefined, {
      os2: { ascender: 800, descender: -200, fsType: 0x0008 },
    });
    expect((await parseFontData(editable)).embeddingRights).toBe('editable');

    const noSubsetting = buildTestFont(undefined, {
      os2: { ascender: 800, descender: -200, fsType: 0x0100 },
    });
    expect((await parseFontData(noSubsetting)).embeddingRights).toBe('no-subsetting');
  });

  it('detects variable fonts from fvar table', async () => {
    const data = buildTestFont(undefined, {
      fvar: [{ tag: 'wght', min: 100, default: 400, max: 900 }],
    });
    const meta = await parseFontData(data);
    expect(meta.isVariable).toBe(true);
    expect(meta.axes).toHaveLength(1);
    expect(meta.axes[0]!.tag).toBe('wght');
    expect(meta.axes[0]!.min).toBe(100);
    expect(meta.axes[0]!.default).toBe(400);
    expect(meta.axes[0]!.max).toBe(900);
  });

  it('handles variable fonts with multiple axes', async () => {
    const data = buildTestFont(undefined, {
      fvar: [
        { tag: 'wght', min: 100, default: 400, max: 900 },
        { tag: 'wdth', min: 75, default: 100, max: 125 },
        { tag: 'slnt', min: -10, default: 0, max: 10 },
      ],
    });
    const meta = await parseFontData(data);
    expect(meta.isVariable).toBe(true);
    expect(meta.axes).toHaveLength(3);
  });

  it('extracts Unicode ranges from cmap table', async () => {
    const data = buildTestFont(undefined, {
      cmap: [
        [0x0020, 0x007e],
        [0x00a0, 0x00ff],
      ],
    });
    const meta = await parseFontData(data);
    expect(meta.unicodeRanges.length).toBeGreaterThanOrEqual(2);
  });

  it('extracts OpenType feature tags from GSUB table', async () => {
    const data = buildTestFont(undefined, {
      gsub: ['liga', 'dlig', 'kern', 'salt'],
    });
    const meta = await parseFontData(data);
    expect(meta.openTypeFeatures).toContain('liga');
    expect(meta.openTypeFeatures).toContain('kern');
  });

  it('detects colour fonts from COLR table', async () => {
    const data = buildTestFont(undefined, { colr: true });
    const meta = await parseFontData(data);
    expect(meta.hasColorGlyphs).toBe(true);
  });

  it('classifies font category from family name', async () => {
    const monoFont = buildTestFont({
      1: 'Fira Code',
      2: 'Regular',
      4: 'Fira Code Regular',
      6: 'FiraCode-Regular',
    });
    expect((await parseFontData(monoFont)).category).toBe('monospace');

    const serifFont = buildTestFont({
      1: 'Times New Roman',
      2: 'Regular',
      4: 'Times New Roman Regular',
      6: 'TimesNewRoman-Regular',
    });
    expect((await parseFontData(serifFont)).category).toBe('serif');

    const displayFont = buildTestFont({
      1: 'Oswald',
      2: 'Regular',
      4: 'Oswald Regular',
      6: 'Oswald-Regular',
    });
    expect((await parseFontData(displayFont)).category).toBe('display');

    const scriptFont = buildTestFont({
      1: 'Pacifico',
      2: 'Regular',
      4: 'Pacifico Regular',
      6: 'Pacifico-Regular',
    });
    expect((await parseFontData(scriptFont)).category).toBe('handwriting');
  });

  it('defaults to sans-serif for unclassified fonts', async () => {
    const data = buildTestFont();
    const meta = await parseFontData(data);
    expect(meta.category).toBe('sans-serif');
  });

  it('extracts vendor info from name table', async () => {
    // nameID 8 = vendor/manufacturer per OpenType spec
    const data = buildTestFont({
      1: 'Test',
      2: 'Regular',
      4: 'Test Regular',
      6: 'Test-Regular',
      8: 'TestFoundry',
    });
    const meta = await parseFontData(data);
    expect(meta.vendor).toBeDefined();
    expect(meta.vendor).toBe('TestFoundry');
  });

  it('extracts version from name table', async () => {
    // nameID 5 = version string per OpenType spec
    const data = buildTestFont({
      1: 'Test',
      2: 'Regular',
      4: 'Test Regular',
      6: 'Test-Regular',
      5: 'Version 1.0',
    });
    const meta = await parseFontData(data);
    expect(meta.version).toBeDefined();
    expect(meta.version).toBe('Version 1.0');
  });
});

function buildTestCollection(
  members: Array<Record<number, string>>,
  colorTables?: { colr?: number; cpal?: { numPalettes: number }; svg?: boolean; sbix?: boolean },
): ArrayBuffer {
  const memberBuffers = members.map((fields) =>
    buildTestFont(fields, colorTables ? { colr: !!colorTables.colr } : undefined),
  );

  // Compute total size: TTC header (8 + 4*numFonts) + member offsets aligned to 4
  let offset = 8 + members.length * 4;
  const memberOffsets: number[] = [];
  for (const buf of memberBuffers) {
    memberOffsets.push(offset);
    offset += (buf.byteLength + 3) & ~3;
  }

  const buffer = new ArrayBuffer(offset);
  const out = new Uint8Array(buffer);
  const view = new DataView(buffer);

  // TTC header
  view.setUint32(0, 0x74746366); // "ttcf"
  view.setUint32(4, members.length);
  for (let i = 0; i < members.length; i++) {
    view.setUint32(8 + i * 4, memberOffsets[i]!);
  }

  for (let i = 0; i < memberBuffers.length; i++) {
    out.set(new Uint8Array(memberBuffers[i]!), memberOffsets[i]!);
    // OpenType collections store absolute offsets in each member's table directory.
    const memberOffset = memberOffsets[i]!;
    const numTables = view.getUint16(memberOffset + 4);
    const dirStart = memberOffset + 12;
    for (let j = 0; j < numTables; j++) {
      const entryOff = dirStart + j * 16;
      const tableOffset = view.getUint32(entryOff + 8);
      view.setUint32(entryOff + 8, tableOffset + memberOffset);
    }
  }

  return buffer;
}

describe('parseFontCollection', () => {
  it('parses a TTC with multiple members', async () => {
    const data = buildTestCollection([
      {
        1: 'TestSans',
        2: 'Regular',
        4: 'TestSans Regular',
        6: 'TestSans-Regular',
      },
      {
        1: 'TestSans',
        2: 'Bold',
        4: 'TestSans Bold',
        6: 'TestSans-Bold',
      },
    ]);
    const members = await parseFontCollection(data);
    expect(members).toHaveLength(2);
    expect(members[0]!.identity.subfamilyName).toBe('Regular');
    expect(members[0]!.identity.collectionIndex).toBe(0);
    expect(members[1]!.identity.subfamilyName).toBe('Bold');
    expect(members[1]!.identity.collectionIndex).toBe(1);
    expect(members[0]!.identity.contentHash).toBe(members[1]!.identity.contentHash);
    expect(fontIdentityKey(members[0]!.identity)).not.toBe(fontIdentityKey(members[1]!.identity));
  });

  it('returns a single member for non-collection fonts', async () => {
    const data = buildTestFont();
    const members = await parseFontCollection(data);
    expect(members).toHaveLength(1);
    expect(members[0]!.identity.familyName).toBe('TestSans');
  });

  it('rejects over-long collection counts', async () => {
    const buf = new ArrayBuffer(12);
    const view = new DataView(buf);
    view.setUint32(0, 0x74746366);
    view.setUint32(4, 100); // exceeds MAX_COLLECTION_MEMBERS
    const members = await parseFontCollection(buf);
    expect(members).toHaveLength(0);
  });
});

describe('color font detection', () => {
  it('detects COLR v0', async () => {
    const colrTable = new ArrayBuffer(4);
    new DataView(colrTable).setUint16(0, 0);
    const data = buildMinimalSFNT(
      makeHeadTable(),
      makeNameTable({ 1: 'C', 2: 'Regular', 4: 'C Regular', 6: 'C-Regular' }),
      makeOS2Table(),
      makeHheaTable(),
      makeMaxpTable(),
      undefined,
      undefined,
      undefined,
      colrTable,
    );
    const meta = await parseFontData(data);
    expect(meta.hasColorGlyphs).toBe(true);
    expect(meta.colorFormats).toContain('colr0');
  });

  it('detects COLR v1 and CPAL palette count', async () => {
    const colrTable = new ArrayBuffer(4);
    new DataView(colrTable).setUint16(0, 1);
    const cpalTable = new ArrayBuffer(8);
    const cpalView = new DataView(cpalTable);
    cpalView.setUint16(0, 0); // version
    cpalView.setUint16(2, 3); // numPaletteEntries
    cpalView.setUint16(4, 2); // numPalettes
    const data = buildMinimalSFNT(
      makeHeadTable(),
      makeNameTable({ 1: 'C', 2: 'Regular', 4: 'C Regular', 6: 'C-Regular' }),
      makeOS2Table(),
      makeHheaTable(),
      makeMaxpTable(),
      undefined,
      undefined,
      undefined,
      colrTable,
      cpalTable,
    );
    const meta = await parseFontData(data);
    expect(meta.hasColorGlyphs).toBe(true);
    expect(meta.colorFormats).toContain('colr1');
    expect(meta.colorFormats).toContain('cpal');
    expect(meta.paletteCount).toBe(2);
  });
});

describe('fontIdentityKey', () => {
  it('produces stable keys for identical fonts', async () => {
    const data = buildTestFont();
    const meta = await parseFontData(data);
    const key1 = fontIdentityKey(meta.identity);
    const key2 = fontIdentityKey(meta.identity);
    expect(key1).toBe(key2);
  });

  it('produces different keys for fonts with different hashes', () => {
    const id1 = {
      contentHash: 'abc12345',
      postScriptName: 'Test-Regular',
      familyName: 'Test',
      subfamilyName: 'Regular',
      fullName: 'Test Regular',
    };
    const id2 = {
      contentHash: 'def67890',
      postScriptName: 'Test-Bold',
      familyName: 'Test',
      subfamilyName: 'Bold',
      fullName: 'Test Bold',
    };
    expect(fontIdentityKey(id1)).not.toBe(fontIdentityKey(id2));
  });

  it('includes both hash and PostScript name in the key', () => {
    const id = {
      contentHash: 'abc12345',
      postScriptName: 'Test-Regular',
      familyName: 'Test',
      subfamilyName: 'Regular',
      fullName: 'Test Regular',
    };
    const key = fontIdentityKey(id);
    expect(key).toContain('abc12345');
    expect(key).toContain('Test-Regular');
  });
});

describe('error handling', () => {
  it('handles empty font data gracefully', async () => {
    await expect(parseFontData(new ArrayBuffer(0))).rejects.toThrow();
  });

  it('handles font data too small for table directory gracefully', async () => {
    const meta = await parseFontData(new ArrayBuffer(10));
    expect(meta.identity.familyName).toBe('Unknown');
    expect(meta.fileSize).toBe(10);
  });

  it('handles font with missing name table gracefully', async () => {
    const headTable = makeHeadTable();
    const nameTable = makeNameTable({});
    const os2Table = makeOS2Table();
    const hheaTable = makeHheaTable();
    const maxpTable = makeMaxpTable();
    const cmapSub = makeFormat4Cmap([[0x0020, 0x007e]]);
    const cmapTable = makeCmapTable([cmapSub]);
    const data = buildMinimalSFNT(
      headTable,
      nameTable,
      os2Table,
      hheaTable,
      maxpTable,
      undefined,
      cmapTable,
    );

    const meta = await parseFontData(data);
    expect(meta.identity.familyName).toBe('Unknown');
    expect(meta.identity.postScriptName).toBe('');
  });

  it('handles fonts with malformed tables by continuing', async () => {
    const view = new DataView(new ArrayBuffer(4));
    view.setUint32(0, 0x00010000);
    const buf = view.buffer;
    await expect(parseFontData(buf)).rejects.toThrow();
  });
});
