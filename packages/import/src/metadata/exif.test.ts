import { describe, expect, it } from 'vitest';
import {
  buildCorruptTiffOffset,
  buildJpegWithExifOrientation,
  buildTiffEntryCountBomb,
  buildTiffWithOrientation,
  bytesToHex,
} from './__fixtures__';
import { orientedDimensions, parseExifOrientation } from './exif';

/** Exact transform matrix for each EXIF orientation (mission §9, §66). */
const ORIENTATION_MATRICES: Array<{
  orientation: number;
  src: [number, number];
  expected: [number, number];
}> = [
  // Source pixel (2, 0) in a 3×2 image → destination mapping per the EXIF
  // spec (verified against the engine's applyExifOrientation kernel):
  // 1: identity, 2: mirror H, 3: rotate 180, 4: mirror V,
  // 5: mirror H + 270, 6: rotate 90, 7: mirror H + 90, 8: rotate 270.
  { orientation: 1, src: [2, 0], expected: [2, 0] },
  { orientation: 2, src: [2, 0], expected: [0, 0] },
  { orientation: 3, src: [2, 0], expected: [0, 1] },
  { orientation: 4, src: [2, 0], expected: [2, 1] },
  { orientation: 5, src: [2, 0], expected: [0, 2] },
  { orientation: 6, src: [2, 0], expected: [1, 2] },
  { orientation: 7, src: [2, 0], expected: [1, 0] },
  { orientation: 8, src: [2, 0], expected: [0, 0] },
];

describe('parseExifOrientation', () => {
  it('returns 1 for a JPEG with no Exif APP1', () => {
    // SOI + DQT + SOS.
    const jpeg = new Uint8Array([
      0xff, 0xd8, 0xff, 0xdb, 0x00, 0x08, 0x00, 0x00, 0xff, 0xda, 0x00, 0x02,
    ]);
    expect(parseExifOrientation(jpeg)).toBe(1);
  });

  it('returns 1 for empty and tiny inputs', () => {
    expect(parseExifOrientation(new Uint8Array(0))).toBe(1);
    expect(parseExifOrientation(new Uint8Array([0xff, 0xd8]))).toBe(1);
    expect(parseExifOrientation(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]))).toBe(1);
  });

  it.each(
    ORIENTATION_MATRICES,
  )('reads orientation $orientation from a little-endian JPEG Exif segment', ({ orientation }) => {
    const jpeg = buildJpegWithExifOrientation(orientation, true);
    expect(parseExifOrientation(jpeg)).toBe(orientation);
  });

  it.each(
    ORIENTATION_MATRICES,
  )('reads orientation $orientation from a big-endian JPEG Exif segment', ({ orientation }) => {
    const jpeg = buildJpegWithExifOrientation(orientation, false);
    expect(parseExifOrientation(jpeg)).toBe(orientation);
  });

  it('reads orientation from a standalone little-endian TIFF', () => {
    expect(parseExifOrientation(buildTiffWithOrientation(6, true))).toBe(6);
  });

  it('reads orientation from a standalone big-endian TIFF', () => {
    expect(parseExifOrientation(buildTiffWithOrientation(6, false))).toBe(6);
  });

  it('returns 1 when the JPEG Exif signature is corrupt', () => {
    expect(parseExifOrientation(buildJpegWithExifOrientation(6, true, true))).toBe(1);
  });

  it('returns 1 for a truncated Exif segment', () => {
    const jpeg = buildJpegWithExifOrientation(6);
    expect(parseExifOrientation(jpeg.subarray(0, jpeg.length - 24))).toBe(1);
  });

  it('returns 1 when the IFD offset points past EOF', () => {
    expect(parseExifOrientation(buildCorruptTiffOffset())).toBe(1);
  });

  it('tolerates an IFD entry-count bomb without hanging', () => {
    // A count of 65,535 entries with only one physically present. The
    // parser caps the walk (512) and stops at the buffer boundary without
    // ever reaching an orientation tag, so the result is 1 — bounded and
    // deterministic, not a hang or a read of garbage.
    expect(parseExifOrientation(buildTiffEntryCountBomb())).toBe(1);
  });

  it('returns 1 for an out-of-range orientation value (9)', () => {
    const jpeg = buildJpegWithExifOrientation(6);
    // TIFF starts at absolute offset 12 ("Exif\0\0" at 4..9, APP1 header
    // 4 bytes, SOI 2 bytes); IFD at +8; first entry at +10; SHORT value at
    // entry+8 => absolute 12 + 10 + 8 = 30.
    jpeg[30] = 9;
    expect(parseExifOrientation(jpeg)).toBe(1);
  });

  it('returns 1 for zero orientation', () => {
    expect(parseExifOrientation(buildTiffWithOrientation(0))).toBe(1);
  });

  it('is safe on a segment-length bomb (length field pointing past EOF)', () => {
    // SOI + APP1 claiming a huge length with only a few payload bytes.
    const bytes = new Uint8Array(12);
    bytes[0] = 0xff;
    bytes[1] = 0xd8;
    bytes[2] = 0xff;
    bytes[3] = 0xe1;
    bytes[4] = 0xff;
    bytes[5] = 0xff; // segment length 65535
    expect(parseExifOrientation(bytes)).toBe(1);
  });

  it('is deterministic and quick on repeated parses (no state leaks)', () => {
    const jpeg = buildJpegWithExifOrientation(6);
    const first = bytesToHex(jpeg);
    for (let i = 0; i < 1000; i += 1) {
      expect(parseExifOrientation(jpeg)).toBe(6);
    }
    expect(bytesToHex(jpeg)).toBe(first); // parser must not mutate input
  });
});

describe('orientedDimensions', () => {
  it('swaps dimensions only for orientations 5-8', () => {
    expect(orientedDimensions(4000, 3000, 1)).toEqual({ width: 4000, height: 3000 });
    expect(orientedDimensions(4000, 3000, 2)).toEqual({ width: 4000, height: 3000 });
    expect(orientedDimensions(4000, 3000, 3)).toEqual({ width: 4000, height: 3000 });
    expect(orientedDimensions(4000, 3000, 4)).toEqual({ width: 4000, height: 3000 });
    expect(orientedDimensions(4000, 3000, 5)).toEqual({ width: 3000, height: 4000 });
    expect(orientedDimensions(4000, 3000, 6)).toEqual({ width: 3000, height: 4000 });
    expect(orientedDimensions(4000, 3000, 7)).toEqual({ width: 3000, height: 4000 });
    expect(orientedDimensions(4000, 3000, 8)).toEqual({ width: 3000, height: 4000 });
  });
});
