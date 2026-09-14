/**
 * Real-font corpus coverage for the parser boundary.
 *
 * The files under __fixtures__ are licensed, checked-in artifacts. These
 * tests deliberately exercise the original bytes instead of synthetic table
 * encoders so a malformed name table, collection header, cmap, or colour
 * table cannot agree with a mistake in the test fixture generator.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { extractFontCollectionMember } from './fontCollectionMember';
import { parseFontCollection, parseFontData } from './fontParser';

function bytes(path: string): ArrayBuffer {
  const value = readFileSync(new URL(`./__fixtures__/${path}`, import.meta.url));
  return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
}

function covers(meta: Awaited<ReturnType<typeof parseFontData>>, codePoint: number): boolean {
  return meta.unicodeRanges.some(([start, end]) => codePoint >= start && codePoint <= end);
}

describe('licensed real-font corpus', () => {
  it('parses a static TrueType face with original-byte identity', async () => {
    const data = bytes('liberation-sans/LiberationSans-Regular.ttf');
    const meta = await parseFontData(data);

    expect(meta.format).toBe('ttf');
    expect(meta.identity.familyName).toBe('Liberation Sans');
    expect(meta.identity.subfamilyName).toBe('Regular');
    expect(meta.identity.contentHash).toBe(
      'baccc64becc3eb7d104b7c84d99f5314a0a1f896e2b3ea6c2f22fc08d2003bee',
    );
    expect(meta.identity.hashAlgorithm).toBe('sha256');
    expect(meta.glyphCount).toBeGreaterThan(1_000);
    expect(covers(meta, 0x0041)).toBe(true);
  });

  it('keeps distinct members and one artifact hash in a real TTC', async () => {
    const data = bytes('liberation-collection/liberation-sans-serif.ttc');
    const members = await parseFontCollection(data);
    const first = await parseFontData(data);

    expect(members).toHaveLength(2);
    expect(members.map((member) => member.identity.collectionIndex)).toEqual([0, 1]);
    expect(members.map((member) => member.identity.familyName)).toEqual([
      'Liberation Sans',
      'Liberation Serif',
    ]);
    expect(new Set(members.map((member) => member.identity.contentHash))).toEqual(
      new Set(['0ea773b2354098ccac1972147993c4d52c6b3cd1338e8bd56ebd0f5cbcd3eefd']),
    );
    expect(first.identity).toEqual(members[0]?.identity);
  });

  it('extracts a selected TTC member as a standalone face', async () => {
    const collection = bytes('liberation-collection/liberation-sans-serif.ttc');
    const member = await extractFontCollectionMember(collection, 1);
    const metadata = await parseFontData(member);

    expect(metadata.format).toBe('ttf');
    expect(metadata.identity.familyName).toBe('Liberation Serif');
    expect(metadata.identity.collectionIndex).toBeUndefined();
    expect(member.byteLength).toBeLessThan(collection.byteLength);
  });

  it('rejects a collection member whose table span is outside the artifact', async () => {
    const collection = bytes('liberation-collection/liberation-sans-serif.ttc');
    const corrupted = collection.slice(0);
    const view = new DataView(corrupted);
    const memberOffset = view.getUint32(12);
    // The first table directory entry's offset is at sfnt + 12 + 8.
    view.setUint32(memberOffset + 12 + 8, corrupted.byteLength - 2);

    await expect(extractFontCollectionMember(corrupted, 0)).rejects.toThrow(/outside the artifact/);
  });

  it.each([
    ['noto-arabic/NotoSansArabic-Regular.ttf', 'arab', 0x0627],
    ['noto-devanagari/NotoSansDevanagari-Regular.ttf', 'deva', 0x0915],
  ] as const)('reports %s script coverage from cmap', async (path, script, codePoint) => {
    const meta = await parseFontData(bytes(path));
    expect(meta.scripts).toContain(script);
    expect(covers(meta, codePoint)).toBe(true);
  });

  it('parses an unmodified CJK WOFF2 subset without losing original identity', async () => {
    const data = bytes('noto-cjk/noto-sans-jp-japanese-400-normal.woff2');
    const meta = await parseFontData(data);

    expect(meta.format).toBe('woff2');
    // Fontsource's Japanese subset carries the typographic family plus its
    // embedded static style in nameID 1; keep the assertion tolerant of that
    // legitimate name-table choice while still rejecting an unrelated face.
    expect(meta.identity.familyName).toContain('Noto Sans JP');
    expect(meta.identity.contentHash).toBe(
      '4a7b928d4d75e7fc0bace614030664a7ea7eb7d2f754fd2b2da9c3c0ed350570',
    );
    expect(meta.identity.hashAlgorithm).toBe('sha256');
    expect(covers(meta, 0x65e5)).toBe(true);
  });

  it('reports colour glyph technologies instead of treating the face as monochrome', async () => {
    const meta = await parseFontData(bytes('noto-color/NotoZnamennyMusicalNotation-Regular.ttf'));

    expect(meta.hasColorGlyphs).toBe(true);
    expect(meta.colorFormats).toEqual(expect.arrayContaining(['colr0', 'cpal']));
    expect(meta.paletteCount).toBeGreaterThan(0);
  });
});
