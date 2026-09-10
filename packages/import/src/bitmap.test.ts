import { describe, expect, it } from 'vitest';
import { bytesToDataUrl, dataUrlToBytes, detectImageMime, getImageDimensions } from './bitmap';
import { importImageAsFill } from './image';

// Minimal valid PNG (1x1 pixel, red)
function createMinimalPng(): Uint8Array {
  const png = Uint8Array.from([
    0x89,
    0x50,
    0x4e,
    0x47, // PNG signature
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    0x00,
    0x00,
    0x00,
    0x0d, // IHDR chunk length
    0x49,
    0x48,
    0x44,
    0x52, // IHDR type
    0x00,
    0x00,
    0x00,
    0x01, // width = 1
    0x00,
    0x00,
    0x00,
    0x01, // height = 1
    0x08,
    0x02,
    0x00,
    0x00,
    0x00,
    0x90,
    0x77,
    0x53,
    0xde, // CRC
    0x00,
    0x00,
    0x00,
    0x0c, // IDAT chunk length
    0x49,
    0x44,
    0x41,
    0x54, // IDAT type
    0x08,
    0xd7,
    0x63,
    0xf8,
    0xcf,
    0xc0,
    0x00,
    0x00,
    0x00,
    0x03,
    0x00,
    0x01,
    0x36,
    0x28,
    0x1b,
    0x00, // IDAT CRC (4 bytes)
    0x00,
    0x00,
    0x00,
    0x00, // IEND chunk
    0x49,
    0x45,
    0x4e,
    0x44,
    0xae,
    0x42,
    0x60,
    0x82,
  ]);
  return png;
}

function createMinimalJpeg(): Uint8Array {
  // Minimal JPEG (1x1 pixel grey)
  return Uint8Array.from([
    0xff,
    0xd8,
    0xff,
    0xe0, // SOI + APP0
    0x00,
    0x10,
    0x4a,
    0x46,
    0x49,
    0x46,
    0x00,
    0x01,
    0x01,
    0x00,
    0x00,
    0x01,
    0x00,
    0x01,
    0x00,
    0x00,
    0xff,
    0xdb,
    0x00,
    0x43,
    0x00,
    0x08,
    0x06,
    0x06,
    0x07,
    0x06,
    0x05,
    0x08,
    0x07,
    0x07,
    0x07,
    0x09,
    0x09,
    0x08,
    0x0a,
    0x0c,
    0x14,
    0x0d,
    0x0c,
    0x0b,
    0x0b,
    0x0c,
    0x19,
    0x12,
    0x13,
    0x0f,
    0x14,
    0x1d,
    0x1a,
    0x1f,
    0x1e,
    0x1d,
    0x1a,
    0x1c,
    0x1c,
    0x20,
    0x24,
    0x2e,
    0x27,
    0x20,
    0x22,
    0x2c,
    0x23,
    0x1c,
    0x1c,
    0x28,
    0x37,
    0x29,
    0x2c,
    0x30,
    0x31,
    0x34,
    0x34,
    0x34,
    0x1f,
    0x27,
    0x39,
    0x3d,
    0x38,
    0x32,
    0x3c,
    0x2e,
    0x33,
    0x34,
    0x32,
    0xff,
    0xc0,
    0x00,
    0x0b,
    0x08,
    0x00,
    0x01,
    0x00,
    0x01,
    0x01,
    0x01,
    0x11,
    0x00,
    0xff,
    0xc4,
    0x00,
    0x1f,
    0x00,
    0x00,
    0x01,
    0x05,
    0x01,
    0x01,
    0x01,
    0x01,
    0x01,
    0x01,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x01,
    0x02,
    0x03,
    0x04,
    0x05,
    0x06,
    0x07,
    0x08,
    0x09,
    0x0a,
    0x0b,
    0xff,
    0xda,
    0x00,
    0x08,
    0x01,
    0x01,
    0x00,
    0x00,
    0x3f,
    0x00,
    0x7b,
    0x94,
    0x11,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0xff,
    0xd9,
  ]);
}

describe('getImageDimensions', () => {
  it('detects PNG dimensions', () => {
    const png = createMinimalPng();
    const dims = getImageDimensions(png);
    expect(dims.w).toBe(1);
    expect(dims.h).toBe(1);
  });

  it('detects JPEG dimensions', () => {
    const jpeg = createMinimalJpeg();
    const dims = getImageDimensions(jpeg);
    expect(dims.w).toBe(1);
    expect(dims.h).toBe(1);
  });

  it('returns 0x0 for unknown format', () => {
    const data = new Uint8Array([0x00, 0x01, 0x02, 0x03]);
    const dims = getImageDimensions(data);
    expect(dims.w).toBe(0);
    expect(dims.h).toBe(0);
  });
});

describe('importImageAsFill', () => {
  it('records natural dimensions for later source-pixel mask validation', () => {
    const fill = importImageAsFill(createMinimalPng(), 'pixel.png');

    expect(fill.image?.imageWidth).toBe(1);
    expect(fill.image?.imageHeight).toBe(1);
  });
});

describe('dataUrlToBytes / bytesToDataUrl', () => {
  it('round-trips data URL conversion', () => {
    const original = new Uint8Array([0x68, 0x65, 0x6c, 0x6c, 0x6f]); // "hello"
    const url = bytesToDataUrl(original, 'image/png');
    expect(url).toMatch(/^data:image\/png;base64,/);
    const decoded = dataUrlToBytes(url);
    expect(Array.from(decoded)).toEqual([0x68, 0x65, 0x6c, 0x6c, 0x6f]);
  });
});

describe('GIF dimension detection', () => {
  it('detects GIF87a dimensions', () => {
    // GIF87a header + logical screen descriptor (10x20)
    const data = new Uint8Array([
      0x47,
      0x49,
      0x46,
      0x38,
      0x37,
      0x61, // GIF87a
      0x0a,
      0x00, // width = 10 (LE)
      0x14,
      0x00, // height = 20 (LE)
      0x00,
      0x00,
      0x00, // padding
    ]);
    const dims = getImageDimensions(data);
    expect(dims.w).toBe(10);
    expect(dims.h).toBe(20);
  });

  it('detects GIF89a dimensions', () => {
    const data = new Uint8Array([
      0x47,
      0x49,
      0x46,
      0x38,
      0x39,
      0x61, // GIF89a
      0x01,
      0x00, // width = 1
      0x01,
      0x00, // height = 1
      0x00,
      0x00,
      0x00,
    ]);
    const dims = getImageDimensions(data);
    expect(dims.w).toBe(1);
    expect(dims.h).toBe(1);
  });
});

describe('TIFF dimension detection', () => {
  it('detects TIFF LE dimensions', () => {
    // Minimal TIFF LE with IFD containing width (0x0100) and height (0x0101)
    const data = new Uint8Array(40);
    // TIFF LE header
    data[0] = 0x49; // II
    data[1] = 0x49;
    data[2] = 0x2a;
    data[3] = 0x00;
    // IFD offset = 8
    data[4] = 0x08;
    data[5] = 0x00;
    data[6] = 0x00;
    data[7] = 0x00;
    // IFD at offset 8: 2 entries
    data[8] = 0x02;
    data[9] = 0x00;
    // Entry 1: tag=0x0100 (width), type=3, count=1, value=800
    data[10] = 0x00;
    data[11] = 0x01;
    data[12] = 0x03;
    data[13] = 0x00;
    data[14] = 0x01;
    data[15] = 0x00;
    data[16] = 0x00;
    data[17] = 0x00;
    data[18] = 0x20;
    data[19] = 0x03;
    data[20] = 0x00;
    data[21] = 0x00;
    // Entry 2: tag=0x0101 (height), type=3, count=1, value=600
    data[22] = 0x01;
    data[23] = 0x01;
    data[24] = 0x03;
    data[25] = 0x00;
    data[26] = 0x01;
    data[27] = 0x00;
    data[28] = 0x00;
    data[29] = 0x00;
    data[30] = 0x58;
    data[31] = 0x02;
    data[32] = 0x00;
    data[33] = 0x00;

    const dims = getImageDimensions(data);
    expect(dims.w).toBe(800);
    expect(dims.h).toBe(600);
  });

  it('detects TIFF BE dimensions', () => {
    const data = new Uint8Array(40);
    // TIFF BE header
    data[0] = 0x4d; // MM
    data[1] = 0x4d;
    data[2] = 0x00;
    data[3] = 0x2a;
    // IFD offset = 8
    data[4] = 0x00;
    data[5] = 0x00;
    data[6] = 0x00;
    data[7] = 0x08;
    // IFD: 2 entries
    data[8] = 0x00;
    data[9] = 0x02;
    // Entry 1: tag=0x0100 (width), value=320
    data[10] = 0x01;
    data[11] = 0x00;
    data[12] = 0x00;
    data[13] = 0x03;
    data[14] = 0x00;
    data[15] = 0x01;
    data[16] = 0x00;
    data[17] = 0x00;
    data[18] = 0x00;
    data[19] = 0x00;
    data[20] = 0x01;
    data[21] = 0x40;
    // Entry 2: tag=0x0101 (height), value=240
    data[22] = 0x01;
    data[23] = 0x01;
    data[24] = 0x00;
    data[25] = 0x03;
    data[26] = 0x00;
    data[27] = 0x01;
    data[28] = 0x00;
    data[29] = 0x00;
    data[30] = 0x00;
    data[31] = 0x00;
    data[32] = 0x00;
    data[33] = 0xf0;

    const dims = getImageDimensions(data);
    expect(dims.w).toBe(320);
    expect(dims.h).toBe(240);
  });
});

describe('AVIF dimension detection', () => {
  it('detects AVIF dimensions via ispe box', () => {
    // Minimal AVIF structure: ftyp box + meta box (full box) with ispe inside
    const data = new Uint8Array(64);
    // ftyp box: size=20, type='ftyp', brand='avif'
    data[0] = 0x00;
    data[1] = 0x00;
    data[2] = 0x00;
    data[3] = 0x14; // size=20
    data[4] = 0x66;
    data[5] = 0x74;
    data[6] = 0x79;
    data[7] = 0x70; // 'ftyp'
    data[8] = 0x61;
    data[9] = 0x76;
    data[10] = 0x69;
    data[11] = 0x66; // 'avif'
    // meta box at offset 20: size=28, type='meta'
    data[20] = 0x00;
    data[21] = 0x00;
    data[22] = 0x00;
    data[23] = 0x1c; // size=28
    data[24] = 0x6d;
    data[25] = 0x65;
    data[26] = 0x74;
    data[27] = 0x61; // 'meta'
    // version+flags (4 bytes)
    data[28] = 0x00;
    data[29] = 0x00;
    data[30] = 0x00;
    data[31] = 0x00;
    // ispe box at offset 32: size=20, type='ispe'
    data[32] = 0x00;
    data[33] = 0x00;
    data[34] = 0x00;
    data[35] = 0x14; // size=20
    data[36] = 0x69;
    data[37] = 0x73;
    data[38] = 0x70;
    data[39] = 0x65; // 'ispe'
    // version+flags (4 bytes)
    data[40] = 0x00;
    data[41] = 0x00;
    data[42] = 0x00;
    data[43] = 0x00;
    // width = 1920 (BE)
    data[44] = 0x00;
    data[45] = 0x00;
    data[46] = 0x07;
    data[47] = 0x80;
    // height = 1080 (BE)
    data[48] = 0x00;
    data[49] = 0x00;
    data[50] = 0x04;
    data[51] = 0x38;

    const dims = getImageDimensions(data);
    expect(dims.w).toBe(1920);
    expect(dims.h).toBe(1080);
  });
});

describe('detectImageMime', () => {
  it('detects PNG mime', () => {
    expect(detectImageMime(createMinimalPng())).toBe('image/png');
  });

  it('detects JPEG mime', () => {
    expect(detectImageMime(createMinimalJpeg())).toBe('image/jpeg');
  });

  it('detects GIF mime', () => {
    const data = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00]);
    expect(detectImageMime(data)).toBe('image/gif');
  });

  it('detects TIFF LE mime', () => {
    const data = new Uint8Array([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00]);
    expect(detectImageMime(data)).toBe('image/tiff');
  });

  it('detects TIFF BE mime', () => {
    const data = new Uint8Array([0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08]);
    expect(detectImageMime(data)).toBe('image/tiff');
  });

  it('detects BMP mime', () => {
    const data = new Uint8Array([0x42, 0x4d, 0x00, 0x00]);
    expect(detectImageMime(data)).toBe('image/bmp');
  });

  it('detects WebP mime', () => {
    const data = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
    ]);
    expect(detectImageMime(data)).toBe('image/webp');
  });

  it('returns null for unknown format', () => {
    const data = new Uint8Array([0x00, 0x01, 0x02, 0x03]);
    expect(detectImageMime(data)).toBeNull();
  });
});
