import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import * as opentype from 'opentype.js';
import { beforeAll, describe, expect, it } from 'vitest';
import { parseFontCollection, parseFontData } from './fontParser';

const align4 = (size: number) => Math.ceil(size / 4) * 4;

/** Repackage real licensed SFNT tables; never invent family or face metadata. */
function wrapWoff(sfnt: ArrayBuffer, compress: boolean): ArrayBuffer {
  const source = new DataView(sfnt);
  const count = source.getUint16(4);
  const entries = Array.from({ length: count }, (_, i) => {
    const record = 12 + i * 16;
    const offset = source.getUint32(record + 8);
    const size = source.getUint32(record + 12);
    const raw = new Uint8Array(sfnt.slice(offset, offset + size));
    const zipped = compress ? deflateSync(raw) : raw;
    return {
      tag: source.getUint32(record),
      checksum: source.getUint32(record + 4),
      size,
      data: zipped.byteLength < raw.byteLength ? zipped : raw,
    };
  });
  const length =
    44 + count * 20 + entries.reduce((sum, entry) => sum + align4(entry.data.length), 0);
  const buffer = new ArrayBuffer(length);
  const view = new DataView(buffer);
  view.setUint32(0, 0x774f4646);
  view.setUint32(4, source.getUint32(0));
  view.setUint32(8, length);
  view.setUint16(12, count);
  view.setUint32(16, 12 + count * 16 + entries.reduce((sum, entry) => sum + align4(entry.size), 0));
  let offset = 44 + count * 20;
  entries.forEach((entry, i) => {
    const record = 44 + i * 20;
    view.setUint32(record, entry.tag);
    view.setUint32(record + 4, offset);
    view.setUint32(record + 8, entry.data.length);
    view.setUint32(record + 12, entry.size);
    view.setUint32(record + 16, entry.checksum);
    new Uint8Array(buffer, offset, entry.data.length).set(entry.data);
    offset += align4(entry.data.length);
  });
  return buffer;
}

let sfnt: ArrayBuffer;
let woff: ArrayBuffer;
beforeAll(async () => {
  const bytes = readFileSync(
    new URL('./__fixtures__/geist/geist-latin-wght-normal.woff2', import.meta.url),
  );
  const { decompress } = await import('wawoff2');
  const decoded = await decompress(bytes);
  sfnt = new Uint8Array(decoded).buffer;
  woff = wrapWoff(sfnt, true);
});

describe('WOFF1 decoding of the licensed Geist fixture', () => {
  it.each([false, true])('retains real metadata with compression=%s', async (compress) => {
    const container = wrapWoff(sfnt, compress);
    // A second implementation checks our WOFF encoder before testing Varve.
    const oracle = opentype.parse(container);
    expect(oracle.getEnglishName('fontFamily')).toBe('Geist');
    const parsed = await parseFontData(container);
    const original = await parseFontData(sfnt);
    expect(parsed.identity.familyName).toBe('Geist');
    expect(parsed.glyphCount).toBe(oracle.numGlyphs);
    expect(parsed.axes).toEqual(original.axes);
    expect(parsed.openTypeFeatures).toEqual(original.openTypeFeatures);
    expect(parsed.unicodeRanges).toEqual(original.unicodeRanges);
    expect(parsed.xHeight).toBe(530);
    expect(parsed.format).toBe('woff');
    expect(parsed.fileSize).toBe(container.byteLength);
    expect(parsed.identity.contentHash).toBe(
      createHash('sha256').update(new Uint8Array(container)).digest('hex'),
    );
    expect(await parseFontCollection(container)).toEqual([parsed]);
  });

  it.each([
    ['file length', (v: DataView) => v.setUint32(8, v.byteLength - 1)],
    ['reserved header bits', (v: DataView) => v.setUint16(14, 1)],
    ['decoded size', (v: DataView) => v.setUint32(16, 64)],
    ['empty directory', (v: DataView) => v.setUint16(12, 0)],
    ['truncated directory', (v: DataView) => v.setUint16(12, 4096)],
    ['table before data', (v: DataView) => v.setUint32(48, 0)],
    ['table after file', (v: DataView) => v.setUint32(48, v.byteLength)],
    ['unaligned table', (v: DataView) => v.setUint32(48, v.getUint32(48) + 1)],
    ['expanded compressed size', (v: DataView) => v.setUint32(52, v.getUint32(56) + 1)],
    ['table checksum', (v: DataView) => v.setUint32(60, v.getUint32(60) ^ 1)],
    ['duplicate table', (v: DataView) => v.setUint32(64, v.getUint32(44))],
    ['overlapping tables', (v: DataView) => v.setUint32(68, v.getUint32(48))],
    ['oversized decoded table', (v: DataView) => v.setUint32(56, 0xffffffff)],
    [
      'metadata outside file',
      (v: DataView) => {
        v.setUint32(24, v.byteLength);
        v.setUint32(28, 4);
        v.setUint32(32, 4);
      },
    ],
    [
      'private data outside file',
      (v: DataView) => {
        v.setUint32(36, v.byteLength);
        v.setUint32(40, 4);
      },
    ],
  ] as const)(
    'rejects invalid %s instead of returning partial metadata',
    async (_label, mutate) => {
      const corrupt = woff.slice(0);
      mutate(new DataView(corrupt));
      await expect(parseFontData(corrupt)).rejects.toThrow(/WOFF/);
    },
  );

  it('rejects a truncated header', async () => {
    await expect(parseFontData(woff.slice(0, 20))).rejects.toThrow(/WOFF/);
  });

  it('rejects corrupted zlib data without an unhandled writer rejection', async () => {
    const corrupt = woff.slice(0);
    const view = new DataView(corrupt);
    const count = view.getUint16(12);
    const record = Array.from({ length: count }, (_, i) => 44 + i * 20).find(
      (offset) => view.getUint32(offset + 8) < view.getUint32(offset + 12),
    )!;
    view.setUint8(view.getUint32(record + 4), 0);
    await expect(parseFontData(corrupt)).rejects.toThrow(/WOFF/);
  });

  it.each([-4, 4])('requires the exact declared decoded length (%s bytes)', async (difference) => {
    const corrupt = woff.slice(0);
    const view = new DataView(corrupt);
    const record = Array.from({ length: view.getUint16(12) }, (_, i) => 44 + i * 20).find(
      (offset) => view.getUint32(offset + 8) + 4 < view.getUint32(offset + 12),
    )!;
    view.setUint32(record + 12, view.getUint32(record + 12) + difference);
    view.setUint32(16, view.getUint32(16) + difference);
    await expect(parseFontData(corrupt)).rejects.toThrow(/WOFF1 compressed table/);
  });

  it('accepts bounded optional metadata and private blocks without changing face metadata', async () => {
    const metadata = deflateSync('<metadata version="1.0"/>');
    const bytes = new Uint8Array(woff.byteLength + align4(metadata.length) + 3);
    bytes.set(new Uint8Array(woff));
    bytes.set(metadata, woff.byteLength);
    bytes.set([1, 2, 3], woff.byteLength + align4(metadata.length));
    const view = new DataView(bytes.buffer);
    view.setUint32(8, bytes.byteLength);
    view.setUint32(24, woff.byteLength);
    view.setUint32(28, metadata.length);
    view.setUint32(32, 25);
    view.setUint32(36, woff.byteLength + align4(metadata.length));
    view.setUint32(40, 3);
    const parsed = await parseFontData(bytes.buffer);
    expect(parsed.identity.familyName).toBe('Geist');
    expect(parsed.glyphCount).toBe(opentype.parse(sfnt).numGlyphs);
  });

  it('rejects nonzero table padding', async () => {
    const corrupt = woff.slice(0);
    const view = new DataView(corrupt);
    const record = Array.from({ length: view.getUint16(12) }, (_, i) => 44 + i * 20).find(
      (offset) => view.getUint32(offset + 8) % 4 !== 0,
    )!;
    view.setUint8(view.getUint32(record + 4) + view.getUint32(record + 8), 1);
    await expect(parseFontData(corrupt)).rejects.toThrow(/WOFF1.*padding/);
  });
});
