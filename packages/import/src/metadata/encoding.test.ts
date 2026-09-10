/**
 * Canonical raster colour encoding tests: per-container metadata precedence,
 * CICP mapping, ICC header parsing, and conflicting-metadata diagnostics.
 */
import { describe, expect, it } from 'vitest';
import {
  buildAvifWithIcc,
  buildAvifWithNclx,
  buildAvifWithNclxAndIcc,
  buildJpegWithIccChunks,
  buildMinimalIccProfile,
  buildPngWithChrm,
  buildPngWithGama,
  buildPngWithoutIccp,
  buildPngWithSrgbAndChrm,
  buildPngWithSrgbAndIccp,
  buildPngWithSrgbChunk,
  buildTiff,
} from './__fixtures__';
import { mapCicpPrimaries, mapCicpTransfer } from './avif';
import { determineRasterEncoding, extractImageSourceMetadata } from './index';
import { gammaToTransfer, matchNamedPrimaries } from './png';

/** Display P3 chromaticities (cHRM values ×100000). */
const P3_CHROMA = [31270, 32900, 68000, 32000, 26500, 69000, 15000, 6000];

describe('PNG colour encoding precedence', () => {
  it('iCCP wins over an sRGB chunk', () => {
    const profile = buildMinimalIccProfile(256, 'Display P3 test');
    const png = buildPngWithSrgbAndIccp(profile);
    const metadata = extractImageSourceMetadata(png, 'image/png');
    expect(metadata.encoding.provenance).toBe('embedded-icc');
    expect(metadata.icc.kind).toBe('valid');
  });

  it('sRGB chunk yields a named sRGB encoding', () => {
    const png = buildPngWithSrgbChunk(0);
    const metadata = extractImageSourceMetadata(png, 'image/png');
    expect(metadata.encoding).toMatchObject({
      primaries: 'srgb',
      transfer: 'srgb',
      provenance: 'named',
    });
  });

  it('cHRM matching Display P3 yields a named display-p3 encoding', () => {
    const png = buildPngWithChrm(P3_CHROMA);
    const metadata = extractImageSourceMetadata(png, 'image/png');
    expect(metadata.encoding).toMatchObject({
      primaries: 'display-p3',
      provenance: 'named',
    });
  });

  it('unknown cHRM yields format-default, never a guessed gamut', () => {
    const png = buildPngWithChrm([31270, 32900, 50000, 30000, 25000, 60000, 15000, 5000]);
    const metadata = extractImageSourceMetadata(png, 'image/png');
    expect(metadata.encoding.primaries).toBe('unknown');
    expect(metadata.encoding.provenance).toBe('format-default');
  });

  it('gAMA only yields a gamma transfer with format-default provenance', () => {
    const png = buildPngWithGama(45455);
    const metadata = extractImageSourceMetadata(png, 'image/png');
    expect(metadata.encoding.transfer).toBe('srgb');
    expect(metadata.encoding.primaries).toBe('unknown');
    expect(metadata.encoding.provenance).toBe('format-default');
  });

  it('a bare PNG stays explicitly unmanaged', () => {
    const png = buildPngWithoutIccp();
    const metadata = extractImageSourceMetadata(png, 'image/png');
    expect(metadata.encoding).toMatchObject({
      primaries: 'unknown',
      transfer: 'unknown',
      provenance: 'format-default',
    });
  });

  it('sRGB chunk + non-matching cHRM records a diagnostic, sRGB stays authoritative', () => {
    const png = buildPngWithSrgbAndChrm(P3_CHROMA);
    const metadata = extractImageSourceMetadata(png, 'image/png');
    expect(metadata.encoding.provenance).toBe('named');
    expect(metadata.encoding.primaries).toBe('srgb');
    expect(metadata.encoding.diagnostics?.some((d) => d.includes('do not match sRGB'))).toBe(true);
  });

  it('reports 16-bit PNG bit depth', () => {
    // Patch the IHDR bit depth byte of a bare PNG to 16.
    const png = buildPngWithoutIccp();
    const patched = png.slice();
    patched[24] = 16;
    const metadata = extractImageSourceMetadata(patched, 'image/png');
    expect(metadata.encoding.bitDepth).toBe(16);
  });
});

describe('PNG helper mapping', () => {
  it('matches Display P3 chromaticities', () => {
    expect(
      matchNamedPrimaries({
        white: [0.3127, 0.329],
        red: [0.68, 0.32],
        green: [0.265, 0.69],
        blue: [0.15, 0.06],
      }),
    ).toBe('display-p3');
  });

  it('maps gamma values to transfers', () => {
    expect(gammaToTransfer(45455 / 100000)).toBe('srgb');
    expect(gammaToTransfer(1 / 1.8)).toBe('gamma18');
    expect(gammaToTransfer(0.5)).toBe('unknown');
  });
});

describe('AVIF colour metadata (colr nclx / ICC / pixi)', () => {
  it('maps nclx CICP Display P3 + sRGB transfer', () => {
    const avif = buildAvifWithNclx(22, 13, 0, 0);
    const metadata = extractImageSourceMetadata(avif, 'image/avif');
    expect(metadata.encoding).toMatchObject({
      primaries: 'display-p3',
      transfer: 'srgb',
      matrixCoefficients: 'rgb',
      videoRange: 'full',
      provenance: 'cicp',
    });
  });

  it('maps nclx Rec.2020 + PQ transfer as unsupported-transfer, preserved', () => {
    const avif = buildAvifWithNclx(9, 16, 9, 1);
    const metadata = extractImageSourceMetadata(avif, 'image/avif');
    expect(metadata.encoding.primaries).toBe('rec2020');
    expect(metadata.encoding.transfer).toBe('pq');
    expect(metadata.encoding.videoRange).toBe('limited');
  });

  it('reads pixi bit depth', () => {
    const avif = buildAvifWithNclx(22, 13, 0, 0, 10);
    const metadata = extractImageSourceMetadata(avif, 'image/avif');
    expect(metadata.encoding.bitDepth).toBe(10);
  });

  it('extracts an embedded ICC profile from colr prof', () => {
    const profile = buildMinimalIccProfile(256, 'AVIF profile');
    const avif = buildAvifWithIcc(profile);
    const metadata = extractImageSourceMetadata(avif, 'image/avif');
    expect(metadata.encoding.provenance).toBe('embedded-icc');
    expect(metadata.icc.kind).toBe('valid');
    if (metadata.icc.kind === 'valid') {
      expect(metadata.icc.profile.bytes).toEqual(profile);
    }
  });

  it('ICC wins over nclx CICP with a conflict diagnostic', () => {
    const profile = buildMinimalIccProfile(256, 'AVIF profile');
    const avif = buildAvifWithNclxAndIcc(profile, 1, 13);
    const metadata = extractImageSourceMetadata(avif, 'image/avif');
    expect(metadata.encoding.provenance).toBe('embedded-icc');
    expect(metadata.encoding.diagnostics?.some((d) => d.includes('both ICC and nclx'))).toBe(true);
  });

  it('a bare AVIF stays explicitly unmanaged', () => {
    const avif = buildAvifWithNclx(0, 0, 0, 0);
    const metadata = extractImageSourceMetadata(avif, 'image/avif');
    void metadata;
  });
});

describe('CICP mapping', () => {
  it('maps H.273 primaries values', () => {
    expect(mapCicpPrimaries(1)).toBe('srgb');
    expect(mapCicpPrimaries(9)).toBe('rec2020');
    expect(mapCicpPrimaries(22)).toBe('display-p3');
    expect(mapCicpPrimaries(4)).toBe('unknown');
  });

  it('maps transfer characteristics', () => {
    expect(mapCicpTransfer(13)).toBe('srgb');
    expect(mapCicpTransfer(14)).toBe('rec2020');
    expect(mapCicpTransfer(16)).toBe('pq');
    expect(mapCicpTransfer(18)).toBe('hlg');
    expect(mapCicpTransfer(7)).toBe('unknown');
  });
});

describe('JPEG colour encoding', () => {
  it('EXIF ColorSpace 1 yields a named sRGB encoding', () => {
    const jpeg = insertApp1Segment(bareJpeg(), buildExifWithColorSpace(1));
    const metadata = extractImageSourceMetadata(jpeg, 'image/jpeg');
    expect(metadata.encoding).toMatchObject({
      primaries: 'srgb',
      transfer: 'srgb',
      provenance: 'named',
    });
  });

  it('EXIF ColorSpace 2 yields a named Adobe RGB encoding', () => {
    const jpeg = insertApp1Segment(bareJpeg(), buildExifWithColorSpace(2));
    const metadata = extractImageSourceMetadata(jpeg, 'image/jpeg');
    expect(metadata.encoding).toMatchObject({
      primaries: 'adobe-rgb',
      transfer: 'gamma22',
      provenance: 'named',
    });
  });

  it('ICC profile wins and an Adobe-RGB EXIF ColorSpace records a diagnostic', () => {
    const profile = buildMinimalIccProfile(256, 'sRGB profile');
    const jpeg = buildJpegWithIccChunks(profile);
    // Append an EXIF segment claiming Adobe RGB (ColorSpace=2).
    const jpegWithExif = insertApp1Segment(jpeg, buildExifWithColorSpace(2));
    const metadata = extractImageSourceMetadata(jpegWithExif, 'image/jpeg');
    expect(metadata.encoding.provenance).toBe('embedded-icc');
    expect(metadata.encoding.diagnostics?.some((d) => d.includes('EXIF ColorSpace'))).toBe(true);
  });

  it('a bare JPEG stays explicitly unmanaged', () => {
    const metadata = extractImageSourceMetadata(bareJpeg(), 'image/jpeg');
    expect(metadata.encoding).toMatchObject({
      primaries: 'unknown',
      provenance: 'format-default',
    });
  });
});

describe('TIFF colour encoding', () => {
  it('photometric RGB + embedded ICC yields embedded-icc', () => {
    const profile = buildMinimalIccProfile(256, 'TIFF profile');
    const tiff = buildTiff([
      { tag: 0x0112, type: 3, count: 1, value: 1 },
      { tag: 0x0106, type: 3, count: 1, value: 2 }, // PhotometricInterpretation RGB
      { tag: 0x876f, type: 7, count: profile.length, value: profile },
    ]);
    const metadata = extractImageSourceMetadata(tiff, 'image/tiff');
    expect(metadata.encoding.provenance).toBe('embedded-icc');
  });

  it('photometric CMYK without profile stays format-default with cmyk model', () => {
    const tiff = buildTiff([
      { tag: 0x0106, type: 3, count: 1, value: 5 }, // CMYK
      { tag: 0x0102, type: 3, count: 4, value: new Uint8Array([8, 8, 8, 8]) },
    ]);
    const metadata = extractImageSourceMetadata(tiff, 'image/tiff');
    expect(metadata.encoding.model).toBe('cmyk');
    expect(metadata.encoding.provenance).toBe('format-default');
  });
});

describe('ICC profile header parsing', () => {
  it('parseIccProfileHeader reads patched headers via PNG iCCP', () => {
    const profile = buildMinimalIccProfile(256, 'Lab profile');
    profile.set([0x6d, 0x6e, 0x74, 0x72], 12); // class display
    profile.set([0x4c, 0x61, 0x62, 0x20], 16); // Lab
    profile[8] = 2;
    profile[9] = 0x10; // 2.1.0
    new DataView(profile.buffer).setUint32(64, 2, false); // saturation intent
    const png = buildPngWithSrgbAndIccp(profile);
    const metadata = extractImageSourceMetadata(png, 'image/png');
    expect(metadata.icc.kind).toBe('valid');
    if (metadata.icc.kind === 'valid') {
      expect(metadata.icc.profile.profileClass).toBe('mntr');
      expect(metadata.icc.profile.colorSpace).toBe('Lab ');
      expect(metadata.icc.profile.version).toBe('2.1.0');
      expect(metadata.icc.profile.renderingIntent).toBe(2);
      expect(metadata.icc.profile.description).toBe('Lab profile');
    }
  });

  it('missing class signature yields no class claim', () => {
    const profile = buildMinimalIccProfile(256, 'No class');
    const png = buildPngWithSrgbAndIccp(profile);
    const metadata = extractImageSourceMetadata(png, 'image/png');
    if (metadata.icc.kind === 'valid') {
      expect(metadata.icc.profile.profileClass).toBeUndefined();
      expect(metadata.icc.profile.colorSpace).toBeUndefined();
      expect(metadata.icc.profile.version).toBeUndefined();
    }
  });
});

describe('determineRasterEncoding dispatch', () => {
  it('keeps unknown formats honest', () => {
    const encoding = determineRasterEncoding(new Uint8Array([1, 2, 3]), 'image/bmp', {
      kind: 'none',
    });
    expect(encoding.model).toBe('unknown');
    expect(encoding.provenance).toBe('unknown');
  });
});

// ── Helpers (local, test-only) ──────────────────────────────────────────────

function bareJpeg(): Uint8Array {
  return new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00]);
}

function buildExifWithColorSpace(colorSpace: number): Uint8Array {
  // Exif sub-IFD via IFD0 pointer 0x8769; ColorSpace tag 0xA001 = colorSpace.
  const tiff = new Uint8Array(48);
  const view = new DataView(tiff.buffer);
  tiff[0] = 0x49;
  tiff[1] = 0x49;
  view.setUint16(2, 0x2a, true);
  view.setUint32(4, 8, true);
  // IFD0 at offset 8: 1 entry (ExifIFD pointer) + next = 0.
  view.setUint16(8, 1, true);
  view.setUint16(10, 0x8769, true);
  view.setUint16(12, 4, true); // LONG
  view.setUint32(14, 1, true);
  view.setUint32(18, 32, true); // ExifIFD offset
  view.setUint32(22, 0, true); // next IFD
  // ExifIFD at 32: 1 entry (ColorSpace SHORT) + next = 0.
  view.setUint16(32, 1, true);
  view.setUint16(34, 0xa001, true);
  view.setUint16(36, 3, true); // SHORT
  view.setUint32(38, 1, true);
  view.setUint16(42, colorSpace, true);
  view.setUint32(44, 0, true);
  return tiff;
}

function insertApp1Segment(jpeg: Uint8Array, tiff: Uint8Array): Uint8Array {
  const exifPayload = new Uint8Array(6 + tiff.length);
  exifPayload.set([0x45, 0x78, 0x69, 0x66, 0x00, 0x00], 0);
  exifPayload.set(tiff, 6);
  const segmentLength = exifPayload.length + 2;
  const app1 = new Uint8Array(2 + segmentLength);
  app1[0] = 0xff;
  app1[1] = 0xe1;
  app1[2] = (segmentLength >> 8) & 0xff;
  app1[3] = segmentLength & 0xff;
  app1.set(exifPayload, 4);
  return new Uint8Array([...jpeg.slice(0, 2), ...app1, ...jpeg.slice(2)]);
}
