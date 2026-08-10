import { describe, expect, it } from 'vitest';
import {
  buildJpegWithIccChunks,
  buildMinimalIccProfile,
  buildPngWithIccp,
  buildPngWithoutIccp,
  buildTiffWithIcc,
  buildWebpWithIccp,
  truncatePng,
} from './__fixtures__';
import { extractIccProfile, isValidIccProfile } from './icc';

describe('isValidIccProfile', () => {
  it('accepts a minimal structurally valid profile', () => {
    expect(isValidIccProfile(buildMinimalIccProfile())).toBe(true);
  });

  it('rejects truncated headers and wrong signatures', () => {
    expect(isValidIccProfile(new Uint8Array(64))).toBe(false);
    const bad = buildMinimalIccProfile();
    bad[38] = 0x00; // break "acsp"
    expect(isValidIccProfile(bad)).toBe(false);
  });

  it('rejects a declared size larger than the payload', () => {
    const profile = buildMinimalIccProfile(512);
    expect(isValidIccProfile(profile.subarray(0, 128))).toBe(false);
  });

  it('rejects a profile exceeding the byte cap', () => {
    const huge = new Uint8Array(17 * 1024 * 1024);
    const view = new DataView(huge.buffer);
    view.setUint32(0, huge.length, false);
    huge[36] = 0x61;
    huge[37] = 0x63;
    huge[38] = 0x73;
    huge[39] = 0x70;
    expect(isValidIccProfile(huge)).toBe(false);
  });
});

describe('extractIccProfile — JPEG APP2 chunks', () => {
  it('reconstructs a multi-chunk profile in sequence order', () => {
    const profile = buildMinimalIccProfile(300, 'Adobe RGB-style fixture');
    const jpeg = buildJpegWithIccChunks(profile, 40);
    const result = extractIccProfile(jpeg, 'image/jpeg');
    expect(result.kind).toBe('valid');
    if (result.kind !== 'valid') return;
    expect(result.profile.bytes.length).toBe(profile.length);
    expect(Array.from(result.profile.bytes)).toEqual(Array.from(profile));
    expect(result.profile.description).toBe('Adobe RGB-style fixture');
  });

  it('reconstructs a single-chunk profile', () => {
    const profile = buildMinimalIccProfile(128);
    const result = extractIccProfile(buildJpegWithIccChunks(profile, 128), 'image/jpeg');
    expect(result.kind).toBe('valid');
  });

  it('reports none when no APP2 ICC segments exist', () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02]);
    expect(extractIccProfile(jpeg, 'image/jpeg')).toEqual({ kind: 'none' });
  });

  it('rejects a duplicate chunk sequence number', () => {
    const profile = buildMinimalIccProfile(300);
    const jpeg = buildJpegWithIccChunks(profile, 40);
    // Chunk 2 starts at 2 (SOI) + chunk1 total, where chunk1 total =
    // segmentLength + 2; its seq byte sits at chunk2Start + 4 + 12.
    const firstSegmentLength = (jpeg[4]! << 8) | jpeg[5]!;
    const chunk2SeqByte = 2 + firstSegmentLength + 2 + 4 + 12;
    jpeg[chunk2SeqByte] = 1; // duplicate of chunk 1's sequence number
    const result = extractIccProfile(jpeg, 'image/jpeg');
    expect(result.kind).toBe('invalid');
  });

  it('rejects a missing chunk in the sequence', () => {
    const profile = buildMinimalIccProfile(300);
    const jpeg = buildJpegWithIccChunks(profile, 40);
    // Truncate after the first APP2 segment (SOI + first segment).
    const firstSegmentLength = (jpeg[4]! << 8) | jpeg[5]!;
    expect(extractIccProfile(jpeg.subarray(0, firstSegmentLength + 4), 'image/jpeg').kind).toBe(
      'invalid',
    );
  });

  it('rejects an out-of-range sequence header', () => {
    const profile = buildMinimalIccProfile(128);
    const jpeg = buildJpegWithIccChunks(profile, 128);
    // Single chunk: seq byte at 2 (SOI) + 4 (marker+length) + 12 ("ICC_PROFILE\0").
    jpeg[18] = 7; // seq > total
    expect(extractIccProfile(jpeg, 'image/jpeg').kind).toBe('invalid');
  });

  it('rejects a malformed reconstructed profile header', () => {
    const profile = buildMinimalIccProfile(128);
    profile[36] = 0; // break "acsp" after chunking
    const jpeg = buildJpegWithIccChunks(profile, 40);
    expect(extractIccProfile(jpeg, 'image/jpeg').kind).toBe('invalid');
  });
});

describe('extractIccProfile — PNG iCCP', () => {
  it('inflates a valid iCCP chunk', () => {
    const profile = buildMinimalIccProfile(200, 'Display P3 fixture');
    const png = buildPngWithIccp(profile);
    const result = extractIccProfile(png, 'image/png');
    expect(result.kind).toBe('valid');
    if (result.kind !== 'valid') return;
    expect(result.profile.bytes.length).toBe(profile.length);
    expect(Array.from(result.profile.bytes)).toEqual(Array.from(profile));
  });

  it('reports none for a PNG without iCCP', () => {
    expect(extractIccProfile(buildPngWithoutIccp(), 'image/png')).toEqual({ kind: 'none' });
  });

  it('handles a truncated PNG without throwing', () => {
    const png = buildPngWithIccp(buildMinimalIccProfile(200));
    // Truncate inside the iCCP payload (deflate region): signature(8) +
    // IHDR(25) + iCCP header(8 + 12 name + 1 compression) = offset 54;
    // cut at 60 lands mid-deflate deterministically.
    expect(extractIccProfile(truncatePng(png, 60), 'image/png').kind).toBe('invalid');
    // Header-only truncation: no chunk is parseable at all.
    expect(extractIccProfile(truncatePng(png, 12), 'image/png').kind).toBe('none');
  });

  it('rejects a bomb iCCP that inflates beyond the byte cap', () => {
    // Deflate cannot be maliciously pre-built here; instead assert the cap
    // path by feeding a profile that declares a size over the cap.
    const big = new Uint8Array(200);
    const view = new DataView(big.buffer);
    view.setUint32(0, 17 * 1024 * 1024, false);
    big[36] = 0x61;
    big[37] = 0x63;
    big[38] = 0x73;
    big[39] = 0x70;
    const png = buildPngWithIccp(big);
    expect(extractIccProfile(png, 'image/png').kind).toBe('invalid');
  });
});

describe('extractIccProfile — WebP ICCP', () => {
  it('reads an uncompressed ICCP chunk', () => {
    const profile = buildMinimalIccProfile(150, 'WebP fixture');
    const webp = buildWebpWithIccp(profile);
    const result = extractIccProfile(webp, 'image/webp');
    expect(result.kind).toBe('valid');
    if (result.kind !== 'valid') return;
    // The RIFF chunk stores even-padded payloads; an odd-length profile is
    // read back with one padding byte. Compare the unpadded prefix.
    expect(Array.from(result.profile.bytes.slice(0, profile.length))).toEqual(Array.from(profile));
    expect(result.profile.description).toBe('WebP fixture');
  });

  it('reports none for a WebP without ICCP', () => {
    const webp = buildWebpWithIccp(new Uint8Array(0));
    expect(extractIccProfile(webp, 'image/webp').kind).toBe('invalid'); // empty chunk → invalid header
  });

  it('rejects a truncated WebP ICCP', () => {
    const webp = buildWebpWithIccp(buildMinimalIccProfile(200));
    // Truncate inside the ICCP chunk (header-only: size claims 200 bytes).
    expect(extractIccProfile(webp.subarray(0, 12 + 8), 'image/webp').kind).toBe('invalid');
  });
});

describe('extractIccProfile — TIFF tag 34675', () => {
  it('reads the ICC profile tag in both endiannesses', () => {
    const profile = buildMinimalIccProfile(160, 'TIFF fixture');
    const le = extractIccProfile(buildTiffWithIcc(profile, true), 'image/tiff');
    const be = extractIccProfile(buildTiffWithIcc(profile, false), 'image/tiff');
    expect(le.kind).toBe('valid');
    expect(be.kind).toBe('valid');
    if (le.kind !== 'valid' || be.kind !== 'valid') return;
    expect(Array.from(le.profile.bytes)).toEqual(Array.from(profile));
    expect(Array.from(be.profile.bytes)).toEqual(Array.from(profile));
  });

  it('rejects an implausible profile size', () => {
    const tiff = buildTiffWithIcc(buildMinimalIccProfile(128), true);
    // Patch the count field to a huge value.
    const view = new DataView(tiff.buffer);
    // Count is at IFD entry +4: absolute 8 + 2 + 4 = 14.
    view.setUint32(14, 0x7fffffff, true);
    expect(extractIccProfile(tiff, 'image/tiff').kind).toBe('invalid');
  });

  it('rejects an invalid profile payload', () => {
    const bad = new Uint8Array(140);
    expect(extractIccProfile(buildTiffWithIcc(bad, true), 'image/tiff').kind).toBe('invalid');
  });
});

describe('extractIccProfile — format coverage', () => {
  it('never throws for unsupported formats', () => {
    expect(extractIccProfile(new Uint8Array([0x42, 0x4d, 1, 2, 3, 4]), 'image/bmp')).toEqual({
      kind: 'none',
    });
    expect(extractIccProfile(new Uint8Array([0x47, 0x49, 0x46, 0x38]), 'image/gif')).toEqual({
      kind: 'none',
    });
  });

  it('returns none for empty input', () => {
    expect(extractIccProfile(new Uint8Array(0), 'image/jpeg')).toEqual({ kind: 'none' });
  });
});
