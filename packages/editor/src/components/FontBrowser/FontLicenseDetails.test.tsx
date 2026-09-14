import { cleanup, render, screen } from '@testing-library/react';
import { getFontRegistry, resetFontRegistry } from '@varve/engine';
import { afterEach, describe, expect, it } from 'vitest';
import { FontLicenseDetails } from './FontLicenseDetails';

afterEach(() => {
  cleanup();
  resetFontRegistry();
});

describe('FontLicenseDetails', () => {
  it('makes the color-font fallback explicit', () => {
    getFontRegistry().registerMetadata({
      family: 'Noto Color',
      hasColorGlyphs: true,
      colorFormats: ['colr0', 'cpal'],
      paletteCount: 3,
    });

    render(<FontLicenseDetails family="Noto Color" />);

    expect(screen.getByText('Detected · COLR0, CPAL · 3 palettes')).toBeInTheDocument();
    expect(
      screen.getByText('Color glyphs stay live or rasterized; outline export is unavailable'),
    ).toBeInTheDocument();
  });

  it('does not add color warnings to ordinary faces', () => {
    getFontRegistry().registerMetadata({ family: 'Plain', hasColorGlyphs: false });

    render(<FontLicenseDetails family="Plain" />);

    expect(screen.queryByText(/Color glyphs stay live/)).not.toBeInTheDocument();
  });
});
