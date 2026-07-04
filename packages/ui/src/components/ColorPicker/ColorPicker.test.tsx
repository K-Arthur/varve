// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ManagedColor } from '@strata/scene';
import { ColorFields } from './ColorFields';
import { ColorPicker } from './ColorPicker';
import { ColorSlider } from './ColorSlider';
import type { Color } from './color-utils';
import { EyeDropperButton } from './EyeDropperButton';
import { SwatchPalette } from './SwatchPalette';
import { ColorSpaceSelector } from './ColorSpaceSelector';
import { CmykColorFields } from './CmykColorFields';
import { GrayColorFields } from './GrayColorFields';
import { GamutWarning } from './GamutWarning';
import { SpotColorBrowser } from './SpotColorBrowser';

afterEach(cleanup);

describe('ColorPicker', () => {
  it('renders with default RGB color', () => {
    const color: ManagedColor = { space: 'rgb', r: 255, g: 0, b: 0, a: 255 };
    const onChange = () => {};
    render(<ColorPicker value={color} onChange={onChange} />);
    expect(screen.getByText('#ff0000')).toBeTruthy();
  });

  it('renders space selector', () => {
    const color: ManagedColor = { space: 'rgb', r: 255, g: 0, b: 0, a: 255 };
    render(<ColorPicker value={color} onChange={() => {}} />);
    const spaceButtons = screen.getAllByRole('button', { name: 'RGB' });
    expect(spaceButtons.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole('button', { name: 'CMYK' })).toBeTruthy();
  });

  it('renders CMYK fields when space changes to CMYK', () => {
    const color: ManagedColor = { space: 'rgb', r: 255, g: 0, b: 0, a: 255 };
    const onChange = vi.fn();
    render(<ColorPicker value={color} onChange={onChange} />);
    act(() => {
      const btn = screen.getAllByRole('button', { name: 'CMYK' })[0];
      if (btn) btn.click();
    });
    // After switching to CMYK mode, the onChange fires with converted CMYK
    expect(onChange).toHaveBeenCalled();
    const call = onChange.mock.calls[0]?.[0] as ManagedColor | undefined;
    expect(call?.space).toBe('cmyk');
  });

  it('shows Spot browser when spot is selected', () => {
    const color: ManagedColor = { space: 'rgb', r: 255, g: 0, b: 0, a: 255 };
    render(<ColorPicker value={color} onChange={() => {}} />);
    act(() => {
      const btn = screen.getAllByRole('button', { name: 'Spot' })[0];
      if (btn) btn.click();
    });
    // Spot browser should appear
    expect(screen.getByRole('textbox', { name: /search/i })).toBeTruthy();
  });

  it('uses initial space from CMYK value', () => {
    const color: ManagedColor = { space: 'cmyk', c: 0, m: 128, y: 255, k: 0, a: 255 };
    render(<ColorPicker value={color} onChange={() => {}} />);
    // Should have CMYK fields visible
    const cmykBtn = screen.getByRole('button', { name: 'CMYK' });
    expect(cmykBtn.getAttribute('aria-pressed')).toBe('true');
  });

  it('works with Grayscale value', () => {
    const color: ManagedColor = { space: 'gray', v: 128, a: 255 };
    render(<ColorPicker value={color} onChange={() => {}} />);
    const grayBtn = screen.getByRole('button', { name: 'Grayscale' });
    expect(grayBtn.getAttribute('aria-pressed')).toBe('true');
  });

  it('works with Spot color value', () => {
    const color: ManagedColor = {
      space: 'spot',
      name: 'Pantone 185 C',
      tint: 100,
      a: 255,
      processFallback: { c: 0, m: 255, y: 255, k: 0 },
    };
    render(<ColorPicker value={color} onChange={() => {}} />);
    const spotBtn = screen.getByRole('button', { name: 'Spot' });
    expect(spotBtn.getAttribute('aria-pressed')).toBe('true');
  });
});

describe('ColorSlider', () => {
  it('renders hue slider with correct ARIA attributes', () => {
    render(<ColorSlider channel="hue" value={180} onChange={() => {}} />);
    const slider = screen.getByRole('slider', { name: 'Hue' });
    expect(slider).toHaveAttribute('aria-valuemin', '0');
    expect(slider).toHaveAttribute('aria-valuemax', '360');
    expect(slider).toHaveAttribute('aria-valuenow', '180');
    expect(slider).toHaveAttribute('aria-valuetext', '180 degrees');
  });

  it('renders alpha slider with correct ARIA attributes', () => {
    render(<ColorSlider channel="alpha" value={0.5} onChange={() => {}} />);
    const slider = screen.getByRole('slider', { name: 'Alpha' });
    expect(slider).toHaveAttribute('aria-valuemin', '0');
    expect(slider).toHaveAttribute('aria-valuemax', '100');
    expect(slider).toHaveAttribute('aria-valuenow', '50');
    expect(slider).toHaveAttribute('aria-valuetext', '50% opacity');
  });
});

describe('SwatchPalette', () => {
  it('renders with correct role and options', () => {
    render(<SwatchPalette onSelect={() => {}} />);
    expect(screen.getByRole('listbox', { name: 'Colors' })).toBeTruthy();
    const options = screen.getAllByRole('option');
    expect(options.length).toBeGreaterThan(0);
    expect(options[0]).toHaveAttribute('aria-label');
  });
});

describe('ColorFields', () => {
  it('renders HSB mode with H/S/B inputs', () => {
    const color: Color = [100, 150, 200, 255];
    const { container } = render(<ColorFields color={color} onChange={() => {}} />);
    const hsbButton = screen.getByRole('button', { name: 'HSB' });
    act(() => hsbButton.click());
    const spinbuttons = container.querySelectorAll('[role="spinbutton"]');
    expect(spinbuttons.length).toBe(4);
  });
});

describe('EyeDropperButton', () => {
  it('renders even when EyeDropper API is unsupported', () => {
    render(<EyeDropperButton onPick={() => {}} />);
    const btn = screen.getByRole('button', { name: /unavailable/ });
    expect(btn).toBeTruthy();
    expect(btn).toHaveAttribute('aria-label', 'Eyedropper unavailable (use native picker)');
  });
});

describe('ColorSpaceSelector', () => {
  it('renders all four space buttons', () => {
    render(<ColorSpaceSelector active="rgb" onChange={() => {}} />);
    expect(screen.getByRole('button', { name: 'RGB' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'CMYK' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Grayscale' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Spot' })).toBeTruthy();
  });
});

describe('CmykColorFields', () => {
  it('renders C, M, Y, K, A spinbuttons', () => {
    const color: ManagedColor & { space: 'cmyk' } = {
      space: 'cmyk',
      c: 0,
      m: 128,
      y: 255,
      k: 0,
      a: 255,
    };
    render(<CmykColorFields value={color} onChange={() => {}} />);
    expect(screen.getByRole('spinbutton', { name: 'C' })).toBeTruthy();
    expect(screen.getByRole('spinbutton', { name: 'M' })).toBeTruthy();
    expect(screen.getByRole('spinbutton', { name: 'Y' })).toBeTruthy();
    expect(screen.getByRole('spinbutton', { name: 'K' })).toBeTruthy();
    expect(screen.getByRole('spinbutton', { name: 'A' })).toBeTruthy();
  });
});

describe('GrayColorFields', () => {
  it('renders Gray and A spinbuttons', () => {
    const color: ManagedColor & { space: 'gray' } = { space: 'gray', v: 128, a: 255 };
    render(<GrayColorFields value={color} onChange={() => {}} />);
    expect(screen.getByRole('spinbutton', { name: 'Gray' })).toBeTruthy();
    expect(screen.getByRole('spinbutton', { name: 'A' })).toBeTruthy();
  });
});

describe('GamutWarning', () => {
  it('renders warning for out-of-gamut color', () => {
    render(<GamutWarning r={0} g={255} b={0} />);
    const warning = screen.getByRole('status');
    expect(warning).toBeTruthy();
    expect(warning.textContent).toContain('Out of CMYK gamut');
  });

  it('does not render for gray', () => {
    render(<GamutWarning r={128} g={128} b={128} />);
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('SpotColorBrowser', () => {
  it('renders search and options', () => {
    render(<SpotColorBrowser onSelect={() => {}} />);
    expect(screen.getByRole('textbox', { name: /search/i })).toBeTruthy();
    expect(screen.getAllByRole('option').length).toBeGreaterThan(0);
  });
});
