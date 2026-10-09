import { describe, expect, it } from 'vitest';
import { insertJpegXmp, insertPdfXmp, insertPngXmp } from './xmpInjection';

describe('insertPngXmp', () => {
  it('inserts XMP into valid PNG bytes', () => {
    // Minimal valid PNG: signature + IHDR + IEND
    const png = new Uint8Array([
      0x89,
      0x50,
      0x4e,
      0x47, // PNG signature
      0x0d,
      0x0a,
      0x1a,
      0x0a,
      // IHDR chunk
      0x00,
      0x00,
      0x00,
      0x0d, // length: 13
      0x49,
      0x48,
      0x44,
      0x52, // "IHDR"
      0x00,
      0x00,
      0x00,
      0x01, // width: 1
      0x00,
      0x00,
      0x00,
      0x01, // height: 1
      0x08,
      0x02,
      0x00,
      0x00,
      0x00, // bit depth, color type, etc.
      0x90,
      0x77,
      0x53,
      0xde, // CRC (valid for this IHDR)
      // IEND chunk
      0x00,
      0x00,
      0x00,
      0x00, // length: 0
      0x49,
      0x45,
      0x4e,
      0x44, // "IEND"
      0xae,
      0x42,
      0x60,
      0x82, // CRC
    ]);

    const xmp = '<?xpacket begin="" id="test"?><x:xmpmeta>test</x:xmpmeta><?xpacket end="w"?>';
    const result = insertPngXmp(png, xmp);

    expect(result.length).toBeGreaterThan(png.length);
    // Check PNG signature preserved
    expect(result[0]).toBe(0x89);
    expect(result[1]).toBe(0x50);
    expect(result[2]).toBe(0x4e);
    expect(result[3]).toBe(0x47);
    // Check IEND still at end
    const iendPos = result.length - 12;
    expect(result[iendPos + 4]).toBe(0x49); // 'I'
    expect(result[iendPos + 5]).toBe(0x45); // 'E'
    expect(result[iendPos + 6]).toBe(0x4e); // 'N'
    expect(result[iendPos + 7]).toBe(0x44); // 'D'
  });

  it('throws for invalid PNG bytes', () => {
    const notPng = new Uint8Array([0x00, 0x01, 0x02, 0x03]);
    const xmp = '<test/>';
    expect(() => insertPngXmp(notPng, xmp)).toThrow('Not a PNG byte stream');
  });
});

describe('insertJpegXmp', () => {
  it('inserts XMP into valid JPEG bytes', () => {
    // Minimal valid JPEG: SOI + EOI
    const jpeg = new Uint8Array([
      0xff,
      0xd8, // SOI
      0xff,
      0xd9, // EOI
    ]);

    const xmp = '<?xpacket begin="" id="test"?><x:xmpmeta>test</x:xmpmeta><?xpacket end="w"?>';
    const result = insertJpegXmp(jpeg, xmp);

    expect(result.length).toBeGreaterThan(jpeg.length);
    // Check SOI preserved
    expect(result[0]).toBe(0xff);
    expect(result[1]).toBe(0xd8);
    // Check APP1 marker inserted after SOI
    expect(result[2]).toBe(0xff);
    expect(result[3]).toBe(0xe1); // APP1
    // Check XMP namespace marker present
    const marker = 'http://ns.adobe.com/xap/1.0/\0';
    const resultStr = new TextDecoder().decode(result);
    expect(resultStr).toContain(marker.slice(0, -1)); // Without null terminator in string
  });

  it('throws for invalid JPEG bytes', () => {
    const notJpeg = new Uint8Array([0x00, 0x01, 0x02, 0x03]);
    const xmp = '<test/>';
    expect(() => insertJpegXmp(notJpeg, xmp)).toThrow('Not a JPEG byte stream');
  });

  it('throws for XMP data exceeding segment size limit', () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const hugeXmp = 'x'.repeat(70000); // Exceeds 65535 byte limit
    expect(() => insertJpegXmp(jpeg, hugeXmp)).toThrow('XMP data too large');
  });
});

describe('insertPdfXmp', () => {
  it('appends an incremental Metadata stream to a classic PDF', () => {
    const pdf = new TextEncoder().encode(
      '%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\ntrailer\n<< /Size 3 /Root 1 0 R >>\nstartxref\n10\n%%EOF\n',
    );
    const xmp =
      '<?xpacket begin="" id="test"?><x:xmpmeta>AI disclosure</x:xmpmeta><?xpacket end="w"?>';
    const result = insertPdfXmp(pdf, xmp);
    const text = new TextDecoder().decode(result);
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text).toContain('/Type /Metadata');
    expect(text).toContain('/Subtype /XML');
    expect(text).toContain(xmp);
    expect(text).toContain('/Metadata ');
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
  });

  it('throws for invalid PDF bytes', () => {
    expect(() => insertPdfXmp(new Uint8Array([0x00, 0x01]), '<xmp/>')).toThrow(
      'Not a PDF byte stream',
    );
  });
});
