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

  it('does not claim unsupported formats are importable', () => {
    expect(getFormatCapability('heif')?.import.level).toBe('unsupported');
    expect(getFormatCapability('jxl')?.import.browser).toBe('unsupported');
    expect(formatForExtension('.tiff')).toBe('tiff');
    expect(listFormatCapabilities().some((format) => format.id === 'svg')).toBe(true);
  });

  it('can identify SVG content when the extension is absent', () => {
    expect(
      detectFileFormat({ filename: 'asset', data: '<svg viewBox="0 0 10 10"></svg>' }).format,
    ).toBe('svg');
  });
});
