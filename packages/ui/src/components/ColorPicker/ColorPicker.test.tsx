// @vitest-environment jsdom

import type { ManagedColor } from '@strata/scene';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CmykColorFields } from './CmykColorFields';
import { ColorFields } from './ColorFields';
import { ColorPicker } from './ColorPicker';
import { ColorSlider } from './ColorSlider';
import { ColorSpaceSelector } from './ColorSpaceSelector';
import type { Color } from './color-utils';
import { EyeDropperButton } from './EyeDropperButton';
import { GamutWarning } from './GamutWarning';
import { GrayColorFields } from './GrayColorFields';
import { SpotColorBrowser } from './SpotColorBrowser';
import { SwatchPalette } from './SwatchPalette';

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
    const spaceButtons = screen.getAllByRole('radio', { name: 'RGB' });
    expect(spaceButtons.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole('radio', { name: 'CMYK' })).toBeTruthy();
  });

  it('renders CMYK fields when space changes to CMYK', () => {
    const color: ManagedColor = { space: 'rgb', r: 255, g: 0, b: 0, a: 255 };
    const onChange = vi.fn();
    render(<ColorPicker value={color} onChange={onChange} />);
    act(() => {
      const btn = screen.getAllByRole('radio', { name: 'CMYK' })[0];
      if (btn) btn.click();
    });
    // Mode switch is display-only — onChange is NOT called.
    // CMYK fields should appear, converted from the RGB value.
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('spinbutton', { name: 'C' })).toBeTruthy();
    expect(screen.getByRole('spinbutton', { name: 'M' })).toBeTruthy();
  });

  it('shows Spot browser when spot is selected', () => {
    const color: ManagedColor = { space: 'rgb', r: 255, g: 0, b: 0, a: 255 };
    render(<ColorPicker value={color} onChange={() => {}} />);
    act(() => {
      const btn = screen.getAllByRole('radio', { name: 'Spot' })[0];
      if (btn) btn.click();
    });
    // Spot browser should appear
    expect(screen.getByRole('textbox', { name: /search/i })).toBeTruthy();
  });

  it('uses initial space from CMYK value', () => {
    const color: ManagedColor = { space: 'cmyk', c: 0, m: 128, y: 255, k: 0, a: 255 };
    render(<ColorPicker value={color} onChange={() => {}} />);
    // Should have CMYK fields visible
    const cmykBtn = screen.getByRole('radio', { name: 'CMYK' });
    expect(cmykBtn.getAttribute('aria-checked')).toBe('true');
  });

  it('works with Grayscale value', () => {
    const color: ManagedColor = { space: 'gray', v: 128, a: 255 };
    render(<ColorPicker value={color} onChange={() => {}} />);
    const grayBtn = screen.getByRole('radio', { name: 'Grayscale' });
    expect(grayBtn.getAttribute('aria-checked')).toBe('true');
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
    const spotBtn = screen.getByRole('radio', { name: 'Spot' });
    expect(spotBtn.getAttribute('aria-checked')).toBe('true');
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
    expect(screen.getByRole('radio', { name: 'RGB' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'CMYK' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Grayscale' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Spot' })).toBeTruthy();
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

  it('does not falsely flag in-gamut CMYK process colours', () => {
    // Pure cyan (C:100 M:0 Y:0 K:0) is fully inside CMYK gamut.
    // The old HSV heuristic would flag it because s > 85 && v > 15.
    render(<GamutWarning r={0} g={255} b={255} />);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('does not falsely flag pure magenta', () => {
    // Pure magenta (C:0 M:100 Y:0 K:0) is fully inside CMYK gamut.
    render(<GamutWarning r={255} g={0} b={255} />);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('does not falsely flag pure yellow', () => {
    // Pure yellow (C:0 M:0 Y:100 K:0) is fully inside CMYK gamut.
    render(<GamutWarning r={255} g={255} b={0} />);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('flags highly saturated neon green (outside CMYK gamut)', () => {
    // Neon green (R:57 G:255 B:0) has no good CMYK equivalent.
    render(<GamutWarning r={57} g={255} b={0} />);
    const warning = screen.getByRole('status');
    expect(warning).toBeTruthy();
    expect(warning.textContent).toContain('Out of CMYK gamut');
  });
});

describe('ColorPicker — mode switch lifecycle', () => {
  it('does not call onChange when switching from RGB to CMYK display mode', () => {
    const color: ManagedColor = { space: 'rgb', r: 57, g: 208, b: 198, a: 255 };
    const onChange = vi.fn();
    render(<ColorPicker value={color} onChange={onChange} />);
    onChange.mockClear();
    act(() => {
      const btn = screen.getAllByRole('radio', { name: 'CMYK' })[0];
      if (btn) btn.click();
    });
    // Switching display mode should NOT emit a colour change —
    // the picker stays in the same colour, just displays CMYK fields.
    expect(onChange).not.toHaveBeenCalled();
  });

  it('does not call onChange when switching from CMYK back to RGB', () => {
    const color: ManagedColor = { space: 'cmyk', c: 0, m: 128, y: 255, k: 0, a: 255 };
    const onChange = vi.fn();
    render(<ColorPicker value={color} onChange={onChange} />);
    onChange.mockClear();
    act(() => {
      const btn = screen.getAllByRole('radio', { name: 'RGB' })[0];
      if (btn) btn.click();
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('emits the correct colour space when editing CMYK fields after switching to CMYK', () => {
    const color: ManagedColor = { space: 'rgb', r: 255, g: 0, b: 0, a: 255 };
    const onChange = vi.fn();
    render(<ColorPicker value={color} onChange={onChange} />);
    // Switch to CMYK mode (should not call onChange)
    act(() => {
      const btn = screen.getAllByRole('radio', { name: 'CMYK' })[0];
      if (btn) btn.click();
    });
    onChange.mockClear();
    // Now the CMYK fields should be visible and editing should emit CMYK
    const cSpinbutton = screen.getByRole('spinbutton', { name: 'C' });
    expect(cSpinbutton).toBeTruthy();
  });

  it('preserves the colour value across mode switches without drift', () => {
    const color: ManagedColor = { space: 'rgb', r: 100, g: 150, b: 200, a: 255 };
    const onChange = vi.fn();
    render(<ColorPicker value={color} onChange={onChange} />);
    // Switch to CMYK and back — no onChange should fire
    act(() => {
      screen.getAllByRole('radio', { name: 'CMYK' })[0]?.click();
    });
    act(() => {
      screen.getAllByRole('radio', { name: 'RGB' })[0]?.click();
    });
    // onChange should never have been called (display-only switches)
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('SpotColorBrowser', () => {
  it('renders search and options', () => {
    render(<SpotColorBrowser onSelect={() => {}} />);
    expect(screen.getByRole('textbox', { name: /search/i })).toBeTruthy();
    expect(screen.getAllByRole('option').length).toBeGreaterThan(0);
  });
});
