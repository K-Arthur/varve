import { describe, expect, it } from 'vitest';
import {
  detectFileFormat,
  formatForExtension,
  getFormatCapability,
  listFormatCapabilities,
} from './formatCapabilities';

const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe('format capability registry', () => {
  it('detects by signature before filename extension', () => {
    const result = detectFileFormat({ filename: 'camera.jpg', data: png });

    expect(result.format).toBe('png');
    expect(result.source).toBe('signature');
    expect(result.warnings[0]).toMatchObject({ code: 'extension-mismatch' });
  });

  it('reports a MIME/signature conflict without changing the detected format', () => {
    const result = detectFileFormat({
      filename: 'logo.png',
      mimeType: 'image/jpeg',
      data: png,
    });

    expect(result.format).toBe('png');
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'mime-mismatch' })]),
    );
  });

  it('detects AVIF only when the compatible brand says AVIF', () => {
    const avif = new Uint8Array(24);
    avif.set([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66], 0);
    expect(detectFileFormat({ filename: 'frame.avif', data: avif }).format).toBe('avif');

    const heif = new Uint8Array(24);
    heif.set([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x69, 0x66, 0x31], 0);
    expect(detectFileFormat({ filename: 'frame.heic', data: heif }).format).toBe('heif');
  });

  it('distinguishes PSB from PSD using the Photoshop header version', () => {
    const psd = new Uint8Array([0x38, 0x42, 0x50, 0x53, 0x00, 0x01]);
    const psb = new Uint8Array([0x38, 0x42, 0x50, 0x53, 0x00, 0x02]);

    expect(detectFileFormat({ filename: 'layered.psd', data: psd }).format).toBe('psd');
    expect(detectFileFormat({ filename: 'large.psb', data: psb }).format).toBe('psb');
  });

  it('does not claim unsupported formats are importable', () => {
    expect(getFormatCapability('heif')?.import.level).toBe('unsupported');
    expect(getFormatCapability('jxl')?.import.browser).toBe('unsupported');
    expect(getFormatCapability('psb')?.import.level).toBe('partial-document');
    expect(formatForExtension('.tiff')).toBe('tiff');
    expect(listFormatCapabilities().some((format) => format.id === 'svg')).toBe(true);
  });

  it('labels a TIFF-signature DNG as a RAW container without advertising generic import', () => {
    const dng = new Uint8Array([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00]);
    expect(detectFileFormat({ filename: 'camera.dng', data: dng })).toMatchObject({
      format: 'dng',
      source: 'signature',
    });
    expect(getFormatCapability('dng')?.import.level).toBe('unsupported');
  });

  it('identifies TIFF-family proprietary camera RAW by signature and extension', () => {
    // TIFF magic + .NEF extension must not be treated as a decodable TIFF.
    const tiffMagic = new Uint8Array([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00]);
    expect(detectFileFormat({ filename: 'DSC_0001.nef', data: tiffMagic })).toMatchObject({
      format: 'camera-raw',
      source: 'signature',
    });
    expect(detectFileFormat({ filename: 'img.cr2', data: tiffMagic }).format).toBe('camera-raw');
    expect(detectFileFormat({ filename: 'img.arw', data: tiffMagic }).format).toBe('camera-raw');
    expect(detectFileFormat({ filename: 'img.orf', data: tiffMagic }).format).toBe('camera-raw');
    expect(detectFileFormat({ filename: 'img.rw2', data: tiffMagic }).format).toBe('camera-raw');
    // Extension alone still routes honestly when the bytes are unavailable.
    expect(formatForExtension('.nef')).toBe('camera-raw');
    expect(detectFileFormat({ filename: 'IMG0004.raf' }).format).toBe('camera-raw');
  });

  it('identifies Fuji RAF and Canon CR3 containers by content signature', () => {
    const raf = new TextEncoder().encode('FUJIFILMCCD-RAW 0201FF393701');
    expect(detectFileFormat({ filename: 'frame.jpg', data: raf })).toMatchObject({
      format: 'camera-raw',
      source: 'signature',
    });
    const cr3 = new Uint8Array(24);
    cr3.set([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x63, 0x72, 0x78, 0x20], 0);
    expect(detectFileFormat({ filename: 'img.cr3', data: cr3 })).toMatchObject({
      format: 'camera-raw',
      source: 'signature',
    });
  });

  it('does not claim proprietary camera RAW is importable and names the conversion route', () => {
    const capability = getFormatCapability('camera-raw');
    expect(capability?.import.level).toBe('unsupported');
    expect(capability?.kind).toBe('container');
    expect(capability?.import.notes.join(' ')).toContain('DNG');
    // A real TIFF keeps its format; only RAW extensions route to camera-raw.
    const tiffMagic = new Uint8Array([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00]);
    expect(detectFileFormat({ filename: 'scan.tif', data: tiffMagic }).format).toBe('tiff');
  });

  it('can identify SVG content when the extension is absent', () => {
    expect(
      detectFileFormat({ filename: 'asset', data: '<svg viewBox="0 0 10 10"></svg>' }).format,
    ).toBe('svg');
  });
});
