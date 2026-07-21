// @vitest-environment jsdom

import type { ManagedColor } from '@strata/scene';
import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ColorPicker } from './ColorPicker';
import { GamutWarning } from './GamutWarning';

describe('ColorPicker — bit depth selector', () => {
  it('shows bit depth selector when bitDepth and onBitDepthChange are provided', () => {
    const color: ManagedColor = { space: 'rgb', r: 128, g: 64, b: 255, a: 255 };
    render(
      <ColorPicker
        value={color}
        onChange={() => {}}
        bitDepth="uint8"
        onBitDepthChange={() => {}}
      />,
    );
    expect(screen.getByRole('radiogroup', { name: 'Bit depth' })).toBeTruthy();
  });

  it('does not show bit depth selector when bitDepth is missing', () => {
    const color: ManagedColor = { space: 'rgb', r: 128, g: 64, b: 255, a: 255 };
    render(<ColorPicker value={color} onChange={() => {}} />);
    expect(screen.queryByRole('radiogroup', { name: 'Bit depth' })).toBeNull();
  });

  it('selecting 16-bit re-emits color with uint16 precision', () => {
    const color: ManagedColor = { space: 'rgb', r: 128, g: 64, b: 255, a: 255 };
    const onChange = vi.fn();
    const onBitDepthChange = vi.fn();
    render(
      <ColorPicker
        value={color}
        onChange={onChange}
        bitDepth="uint8"
        onBitDepthChange={onBitDepthChange}
      />,
    );
    const uint16Btn = screen.getByRole('radio', { name: '16-bit' });
    act(() => {
      uint16Btn.click();
    });
    expect(onBitDepthChange).toHaveBeenCalledWith('uint16');
    // The color should be reinterpreted at uint16
    const emittedColor = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(emittedColor.space).toBe('rgb');
    expect(emittedColor.bitDepth).toBe('uint16');
    // 128/255 * 65535 ≈ 32898
    expect(emittedColor.r).toBeGreaterThan(32000);
    expect(emittedColor.r).toBeLessThan(33500);
  });

  it('selecting 32-bit float emits color with float32 precision in 0-1 range', () => {
    const color: ManagedColor = { space: 'rgb', r: 128, g: 64, b: 255, a: 255 };
    const onChange = vi.fn();
    render(
      <ColorPicker
        value={color}
        onChange={onChange}
        bitDepth="uint8"
        onBitDepthChange={() => {}}
      />,
    );
    const float32Btn = screen.getByRole('radio', { name: '32f' });
    act(() => {
      float32Btn.click();
    });
    const emittedColor = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(emittedColor.bitDepth).toBe('float32');
    // uint8 128 → normalized ~0.502
    expect(emittedColor.r).toBeCloseTo(0.502, 2);
  });
});

describe('GamutWarning — bitDepth precision loss', () => {
  it('shows precision loss warning when color bitDepth exceeds CMYK target', () => {
    render(<GamutWarning r={128} g={64} b={255} bitDepth="float32" documentColorMode="cmyk" />);
    expect(screen.getByText(/Precision loss/i)).toBeTruthy();
  });

  it('does not show precision loss for uint8 in CMYK document', () => {
    const { container } = render(
      <GamutWarning r={128} g={64} b={255} bitDepth="uint8" documentColorMode="cmyk" />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('does not show gamut warning for CMYK document with uint8 color in gamut', () => {
    const { container } = render(<GamutWarning r={128} g={128} b={128} documentColorMode="cmyk" />);
    expect(container.firstChild).toBeNull();
  });
});
