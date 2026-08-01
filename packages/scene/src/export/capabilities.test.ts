import { describe, expect, it } from 'vitest';
import {
  capabilitiesForFormat,
  FORMAT_CAPABILITIES,
  formatSupportedOnPlatform,
  supportedFormats,
} from './capabilities';
import { extensionForFormat } from './naming';

describe('capability contracts', () => {
  it('covers every canonical format with a supported flag', () => {
    const formats = [
      'png',
      'jpeg',
      'webp',
      'avif',
      'gif',
      'svg',
      'pdf',
      'pdf-x1a',
      'pdf-x3',
      'pdf-x4',
      'tiff',
      'bmp',
      'ico',
      'eps',
      'psd',
      'json',
      'css',
      'html',
      'react',
      'flutter',
      'swiftui',
    ];
    for (const format of formats) {
      const cap = capabilitiesForFormat(format as never);
      expect(cap.format, format).toBe(format);
      expect(typeof cap.supported, format).toBe('boolean');
      if (!cap.supported) {
        expect(cap.reasonUnsupported, format).toBeTruthy();
      }
      // A supported format must have at least one platform it can run on.
      if (cap.supported) {
        expect(cap.browser || cap.desktop, format).toBe(true);
      }
    }
  });

  it('advertises only implemented formats on the web', () => {
    const webFormats = supportedFormats('web');
    expect(webFormats).toContain('png');
    expect(webFormats).toContain('jpeg');
    expect(webFormats).toContain('svg');
    expect(webFormats).toContain('webp');
    expect(webFormats).not.toContain('avif');
    expect(webFormats).not.toContain('tiff');
    expect(webFormats).not.toContain('eps');
    expect(webFormats).not.toContain('psd');
    expect(webFormats).not.toContain('pdf-x1a');
    expect(webFormats).not.toContain('pdf-x4');
  });

  it('restricts print PDF/X formats to desktop', () => {
    expect(formatSupportedOnPlatform('pdf-x1a', 'web')).toBe(false);
    expect(formatSupportedOnPlatform('pdf-x1a', 'tauri')).toBe(true);
    expect(formatSupportedOnPlatform('pdf-x4', 'web')).toBe(false);
    expect(formatSupportedOnPlatform('pdf-x4', 'tauri')).toBe(true);
    expect(formatSupportedOnPlatform('png', 'web')).toBe(true);
    expect(formatSupportedOnPlatform('png', 'tauri')).toBe(true);
  });

  it('does not advertise codegen formats as raster-capable', () => {
    for (const format of ['react', 'flutter', 'swiftui', 'css'] as const) {
      const cap = FORMAT_CAPABILITIES[format];
      expect(cap.codegen, format).toBe(true);
      expect(cap.rasterizedByDefault, format).toBe(false);
      expect(cap.transparency, format).toBe(true);
    }
  });

  it('keeps raster format extensions consistent with the capability labels', () => {
    expect(extensionForFormat('png')).toBe('.png');
    expect(extensionForFormat('jpeg')).toBe('.jpg');
    expect(extensionForFormat('pdf')).toBe('.pdf');
    expect(extensionForFormat('react')).toBe('.tsx');
    expect(extensionForFormat('flutter')).toBe('.dart');
    expect(extensionForFormat('swiftui')).toBe('.swift');
  });

  it('flags PDF/X-3 and HTML as unsupported with reasons', () => {
    expect(FORMAT_CAPABILITIES['pdf-x3'].supported).toBe(false);
    expect(FORMAT_CAPABILITIES['pdf-x3'].reasonUnsupported).toContain('PDF/X-3');
    expect(FORMAT_CAPABILITIES.html.supported).toBe(false);
  });
});
