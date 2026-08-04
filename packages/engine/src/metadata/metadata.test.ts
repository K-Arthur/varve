import { createMetadataPolicy } from '@varve/shared';
import { describe, expect, it } from 'vitest';
import { applyExifOrientation, orientationAfterApply, parseExifOrientation } from './exif';
import {
  buildPngChunk,
  insertPngIccp,
  insertPngTextChunks,
  isPng,
  readPngChunks,
  stripPngMetadata,
} from './png';
import { metadataToPngEntries, policyKeepsSensitiveData, resolveMetadataContent } from './policy';

/** Minimal valid PNG: signature + IHDR + IDAT + IEND. */
function minimalPng(): Uint8Array {
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, 1);
  ihdrView.setUint32(4, 1);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const idat = new Uint8Array([0x78, 0x9c, 0x63, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01]);
  const parts: Uint8Array[] = [
    signature,
    buildPngChunk('IHDR', ihdr),
    buildPngChunk('IDAT', idat),
    buildPngChunk('IEND', new Uint8Array(0)),
  ];
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

describe('png chunk helpers', () => {
  it('recognises a valid PNG and enumerates its chunks', () => {
    const png = minimalPng();
    expect(isPng(png)).toBe(true);
    expect(readPngChunks(png).map((c) => c.type)).toEqual(['IHDR', 'IDAT', 'IEND']);
  });

  it('inserts text chunks before IEND, preserving pixel chunks', () => {
    const png = minimalPng();
    const withText = insertPngTextChunks(png, [
      { keyword: 'Title', text: 'Hello Strata', utf8: true },
      { keyword: 'Copyright', text: '\u00a9 2026', utf8: true },
    ]);
    const types = readPngChunks(withText).map((c) => c.type);
    expect(types).toEqual(['IHDR', 'IDAT', 'iTXt', 'iTXt', 'IEND']);
    // Pixel data untouched.
    expect(withText[0]).toBe(137);
    expect(withText.length).toBeGreaterThan(png.length);
  });

  it('inserts an iCCP chunk', async () => {
    const png = minimalPng();
    const profile = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const withProfile = await insertPngIccp(png, 'sRGB', profile);
    const types = readPngChunks(withProfile).map((c) => c.type);
    expect(types).toEqual(['IHDR', 'IDAT', 'iCCP', 'IEND']);
  });

  it('strips ancillary metadata but keeps the colour profile on request', () => {
    let png = minimalPng();
    png = insertPngTextChunks(png, [
      { keyword: 'Title', text: 'T' },
      { keyword: 'Author', text: 'A' },
    ]);
    const stripped = stripPngMetadata(png);
    expect(readPngChunks(stripped).map((c) => c.type)).toEqual(['IHDR', 'IDAT', 'IEND']);
  });

  it('strip with keep preserves iCCP', async () => {
    let png = minimalPng();
    png = await insertPngIccp(png, 'sRGB', new Uint8Array(4));
    png = insertPngTextChunks(png, [{ keyword: 'Title', text: 'T' }]);
    const kept = stripPngMetadata(png, ['iCCP']);
    const types = readPngChunks(kept).map((c) => c.type);
    expect(types).toEqual(['IHDR', 'IDAT', 'iCCP', 'IEND']);
  });

  it('rejects non-PNG input', () => {
    expect(isPng(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toBe(false);
  });
});

describe('exif orientation', () => {
  it('returns 1 for JPEGs with no Exif APP1', () => {
    // SOI + two markers (SOF + SOS placeholder) — no APP1.
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x08, 0x00, 0x00]);
    expect(parseExifOrientation(jpeg)).toBe(1);
  });

  it('reads orientation 6 from an Exif APP1 segment', () => {
    const bytes = new Uint8Array(64);
    let o = 0;
    bytes[o++] = 0xff;
    bytes[o++] = 0xd8; // SOI
    bytes[o++] = 0xff;
    bytes[o++] = 0xe1; // APP1
    // Segment length placeholder (fill later).
    const segLenPos = o;
    o += 2;
    bytes[o++] = 0x45;
    bytes[o++] = 0x78;
    bytes[o++] = 0x69;
    bytes[o++] = 0x66;
    bytes[o++] = 0x00;
    bytes[o++] = 0x00; // "Exif\0\0"
    const tiffPos = o;
    const little = true;
    const view = new DataView(bytes.buffer);
    view.setUint8(tiffPos, little ? 0x49 : 0x4d);
    view.setUint8(tiffPos + 1, little ? 0x49 : 0x4d);
    view.setUint16(tiffPos + 2, 0x2a, little);
    view.setUint32(tiffPos + 4, 8, little); // IFD at tiffPos+8
    const ifd = tiffPos + 8;
    view.setUint16(ifd, 1, little); // 1 entry
    const entry = ifd + 2;
    view.setUint16(entry, 0x0112, little); // tag Orientation
    view.setUint16(entry + 2, 3, little); // type SHORT
    view.setUint32(entry + 4, 1, little); // count
    view.setUint16(entry + 8, 6, little); // value = 6
    view.setUint16(entry + 10, 0, little);
    const segLen = o - segLenPos;
    view.setUint16(segLenPos, segLen, false);
    expect(parseExifOrientation(bytes)).toBe(6);
  });

  it('applies a 90-degree rotation (6) and reports orientation 1 afterwards', () => {
    const src = new ImageData(new Uint8ClampedArray(2 * 3 * 4), 2, 3);
    // Fill a distinct pixel at (1, 0).
    const o = 4;
    src.data[o] = 200;
    src.data[o + 1] = 100;
    src.data[o + 2] = 50;
    src.data[o + 3] = 255;
    const rotated = applyExifOrientation(src, 6);
    expect(rotated.width).toBe(3);
    expect(rotated.height).toBe(2);
    // Rotation 6: (x=1,y=0) -> (dx=h-1-y, dy=x) = (2, 1).
    const ro = (1 * rotated.width + 2) * 4;
    expect(rotated.data[ro]).toBe(200);
    expect(rotated.data[ro + 1]).toBe(100);
    expect(orientationAfterApply()).toBe(1);
  });

  it('identity orientation returns a copy unchanged', () => {
    const src = new ImageData(new Uint8ClampedArray([1, 2, 3, 255]), 1, 1);
    const out = applyExifOrientation(src, 1);
    expect(Array.from(out.data)).toEqual([1, 2, 3, 255]);
  });
});

describe('metadata policy resolution', () => {
  const source = {
    title: 'Poster',
    author: 'Jane Doe',
    copyright: '\u00a9 2026 Jane Doe',
    software: 'Strata 0.11',
    gps: { latitude: 51.5, longitude: -0.12 },
    device: 'Camera Model X',
    timestamp: '2026-08-02T00:00:00Z',
    history: ['edit-1', 'edit-2'],
    keywords: ['poster', 'teal'],
  };

  it('privacy-strip keeps authorship but drops GPS/device/timestamps/history', () => {
    const resolved = resolveMetadataContent(source, {
      policy: createMetadataPolicy({ kind: 'privacy-strip' }),
    });
    expect(resolved.author).toBe('Jane Doe');
    expect(resolved.copyright).toBe('\u00a9 2026 Jane Doe');
    expect(resolved.gps).toBeUndefined();
    expect(resolved.device).toBeUndefined();
    expect(resolved.timestamp).toBeUndefined();
    expect(resolved.history).toBeUndefined();
  });

  it('strip-all removes authorship too', () => {
    const resolved = resolveMetadataContent(source, {
      policy: createMetadataPolicy({ kind: 'strip-all' }),
    });
    expect(resolved.author).toBeUndefined();
    expect(resolved.copyright).toBeUndefined();
    expect(resolved.keywords).toEqual([]);
  });

  it('preserve keeps everything including GPS', () => {
    const resolved = resolveMetadataContent(source, {
      policy: createMetadataPolicy({ kind: 'preserve' }),
    });
    expect(resolved.gps).toEqual(source.gps);
    expect(resolved.history).toEqual(source.history);
  });

  it('custom overrides can keep GPS under a privacy base', () => {
    const resolved = resolveMetadataContent(source, {
      policy: createMetadataPolicy({ kind: 'custom', overrides: { gps: 'keep' } }),
    });
    expect(resolved.gps).toEqual(source.gps);
    expect(resolved.device).toBeUndefined();
  });

  it('deterministic mode strips volatile fields even under preserve', () => {
    const resolved = resolveMetadataContent(source, {
      policy: createMetadataPolicy({ kind: 'preserve', deterministic: true }),
    });
    expect(resolved.timestamp).toBeUndefined();
    expect(resolved.gps).toBeUndefined();
    expect(resolved.copyright).toBe('\u00a9 2026 Jane Doe');
  });

  it('policyKeepsSensitiveData flags GPS/device retention', () => {
    expect(policyKeepsSensitiveData(createMetadataPolicy({ kind: 'privacy-strip' }))).toBe(false);
    expect(policyKeepsSensitiveData(createMetadataPolicy({ kind: 'preserve' }))).toBe(true);
  });

  it('maps resolved metadata to PNG entries', () => {
    const entries = metadataToPngEntries({
      title: 'Poster',
      copyright: '\u00a9 2026',
      keywords: ['a', 'b'],
    });
    expect(entries.map((e) => e.keyword)).toEqual(['Title', 'Copyright', 'Keywords']);
  });
});
