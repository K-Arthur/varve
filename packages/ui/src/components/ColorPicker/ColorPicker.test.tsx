// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ManagedColor } from '@varve/scene';
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

describe('ColorFields — hex input forms', () => {
  const hexInput = () => screen.getByRole('textbox', { name: 'Hex color' });

  function commitWith(raw: string) {
    act(() => {
      fireEvent.change(hexInput(), { target: { value: raw } });
      fireEvent.keyDown(hexInput(), { key: 'Enter' });
    });
  }

  it('accepts 6-digit hex without leading # and keeps alpha', () => {
    const onChange = vi.fn();
    render(<ColorFields color={[100, 150, 200, 128]} onChange={onChange} />);
    commitWith('6496c8');
    const emitted = onChange.mock.calls[0]?.[0] as Color;
    expect(emitted).toEqual([100, 150, 200, 128]);
  });

  it('accepts case-insensitive input', () => {
    const onChange = vi.fn();
    render(<ColorFields color={[0, 0, 0, 255]} onChange={onChange} />);
    commitWith('#AB12CD');
    const emitted = onChange.mock.calls[0]?.[0] as Color;
    expect(emitted[0]).toBe(0xab);
    expect(emitted[1]).toBe(0x12);
    expect(emitted[2]).toBe(0xcd);
  });

  it('accepts 8-digit hex and sets alpha', () => {
    const onChange = vi.fn();
    render(<ColorFields color={[0, 0, 0, 255]} onChange={onChange} />);
    commitWith('#ff000080');
    const emitted = onChange.mock.calls[0]?.[0] as Color;
    expect(emitted).toEqual([255, 0, 0, 128]);
  });

  it('accepts 3-digit hex and expands it', () => {
    const onChange = vi.fn();
    render(<ColorFields color={[0, 0, 0, 255]} onChange={onChange} />);
    commitWith('#f06');
    const emitted = onChange.mock.calls[0]?.[0] as Color;
    expect(emitted).toEqual([255, 0, 102, 255]);
  });

  it('rejects invalid input with an error and keeps the document color', () => {
    const onChange = vi.fn();
    render(<ColorFields color={[10, 20, 30, 255]} onChange={onChange} />);
    commitWith('not-a-color');
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent(/valid hex color/);
    expect(hexInput()).toHaveAttribute('aria-invalid', 'true');
  });

  it('clears the error once a valid prefix is typed again', () => {
    const onChange = vi.fn();
    render(<ColorFields color={[10, 20, 30, 255]} onChange={onChange} />);
    commitWith('zzzz');
    expect(screen.getByRole('status')).toBeTruthy();
    act(() => {
      fireEvent.change(hexInput(), { target: { value: '#f' } });
    });
    expect(screen.queryByRole('status')).toBeNull();
    expect(hexInput()).toHaveAttribute('aria-invalid', 'false');
  });

  it('keeps the previous valid color when invalid input is committed', () => {
    const onChange = vi.fn();
    render(<ColorFields color={[10, 20, 30, 255]} onChange={onChange} />);
    commitWith('xyz');
    // The field falls back to the canonical display value.
    expect(hexInput()).toHaveValue('#0a141e');
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

describe('ColorPicker — previous color preview', () => {
  it('shows a previous-color swatch when it differs from the current value', () => {
    const color: ManagedColor = { space: 'rgb', r: 255, g: 0, b: 0, a: 255 };
    render(<ColorPicker value={color} onChange={() => {}} previousColor={[0, 0, 255, 255]} />);
    const pair = screen.getByRole('img', { name: /current and previous color/i });
    expect(pair.querySelector('.color-picker__preview--previous')).toBeTruthy();
  });

  it('hides the previous-color swatch when nothing changed', () => {
    const color: ManagedColor = { space: 'rgb', r: 255, g: 0, b: 0, a: 255 };
    render(<ColorPicker value={color} onChange={() => {}} previousColor={[255, 0, 0, 255]} />);
    const pair = screen.getByRole('img', { name: /current and previous color/i });
    expect(pair.querySelector('.color-picker__preview--previous')).toBeNull();
  });
});

describe('ColorPicker — CMYK profile context', () => {
  it('labels converted CMYK values as approximate with the profile name', () => {
    const color: ManagedColor = { space: 'rgb', r: 255, g: 0, b: 0, a: 255 };
    render(
      <ColorPicker
        value={color}
        onChange={() => {}}
        cmykProfile={{ id: 'fogra39', name: 'Fogra39 (ISO Coated v2 300%)' }}
      />,
    );
    act(() => {
      screen.getAllByRole('radio', { name: 'CMYK' })[0]?.click();
    });
    expect(screen.getByRole('note')).toHaveTextContent(/approximate conversion for fogra39/i);
  });

  it('shows the profile of native CMYK values', () => {
    const color: ManagedColor = {
      space: 'cmyk',
      c: 0,
      m: 255,
      y: 255,
      k: 0,
      a: 255,
      profile: 'swop-coated',
    };
    render(<ColorPicker value={color} onChange={() => {}} />);
    expect(screen.getByRole('note')).toHaveTextContent(/profile: swop coated v2/i);
  });

  it('tags authored CMYK values with the document profile in CMYK documents', () => {
    const color: ManagedColor = { space: 'rgb', r: 255, g: 0, b: 0, a: 255 };
    const onChange = vi.fn();
    render(
      <ColorPicker
        value={color}
        onChange={onChange}
        documentColorMode="cmyk"
        cmykProfile={{ id: 'fogra39', name: 'Fogra39 (ISO Coated v2 300%)' }}
      />,
    );
    act(() => {
      fireEvent.keyDown(screen.getByRole('slider', { name: 'Hue' }), { key: 'ArrowRight' });
    });
    const emitted = onChange.mock.calls[0]?.[0] as ManagedColor;
    expect(emitted).toBeDefined();
    expect(emitted.space).toBe('cmyk');
    expect(emitted.space === 'cmyk' && emitted.profile).toBe('fogra39');
  });
});

describe('SpotColorBrowser', () => {
  it('renders search and options', () => {
    render(<SpotColorBrowser onSelect={() => {}} />);
    expect(screen.getByRole('textbox', { name: /search/i })).toBeTruthy();
    expect(screen.getAllByRole('option').length).toBeGreaterThan(0);
  });
});

describe('ColorPicker — emission space (display mode never changes storage)', () => {
  it('keeps an RGB value in RGB when editing in CMYK display mode', () => {
    const color: ManagedColor = { space: 'rgb', r: 100, g: 150, b: 200, a: 255 };
    const onChange = vi.fn();
    render(<ColorPicker value={color} onChange={onChange} />);
    act(() => {
      screen.getAllByRole('radio', { name: 'CMYK' })[0]?.click();
    });
    onChange.mockClear();
    act(() => {
      fireEvent.keyDown(screen.getByRole('slider', { name: 'Hue' }), { key: 'ArrowRight' });
    });
    const emitted = onChange.mock.calls[0]?.[0] as ManagedColor;
    expect(emitted).toBeDefined();
    expect(emitted.space).toBe('rgb');
  });

  it('keeps native CMYK values in CMYK when editing in RGB display mode', () => {
    const color: ManagedColor = { space: 'cmyk', c: 0, m: 128, y: 255, k: 0, a: 255 };
    const onChange = vi.fn();
    render(<ColorPicker value={color} onChange={onChange} />);
    act(() => {
      screen.getAllByRole('radio', { name: 'RGB' })[0]?.click();
    });
    onChange.mockClear();
    act(() => {
      fireEvent.keyDown(screen.getByRole('slider', { name: 'Hue' }), { key: 'ArrowRight' });
    });
    const emitted = onChange.mock.calls[0]?.[0] as ManagedColor;
    expect(emitted).toBeDefined();
    expect(emitted.space).toBe('cmyk');
  });

  it('converts CMYK field edits back to RGB when the stored value is RGB', () => {
    const color: ManagedColor = { space: 'rgb', r: 255, g: 0, b: 0, a: 255 };
    const onChange = vi.fn();
    render(<ColorPicker value={color} onChange={onChange} />);
    act(() => {
      screen.getAllByRole('radio', { name: 'CMYK' })[0]?.click();
    });
    onChange.mockClear();
    const cField = screen.getByRole('spinbutton', { name: 'C' });
    act(() => {
      fireEvent.change(cField, { target: { value: '50' } });
    });
    const emitted = onChange.mock.calls[0]?.[0] as ManagedColor;
    expect(emitted).toBeDefined();
    expect(emitted.space).toBe('rgb');
  });

  it('authors CMYK when the document is in CMYK mode and the value is RGB', () => {
    const color: ManagedColor = { space: 'rgb', r: 255, g: 0, b: 0, a: 255 };
    const onChange = vi.fn();
    render(<ColorPicker value={color} onChange={onChange} documentColorMode="cmyk" />);
    act(() => {
      fireEvent.keyDown(screen.getByRole('slider', { name: 'Hue' }), { key: 'ArrowRight' });
    });
    const emitted = onChange.mock.calls[0]?.[0] as ManagedColor;
    expect(emitted).toBeDefined();
    expect(emitted.space).toBe('cmyk');
  });

  it('preserves alpha and profile across edits', () => {
    const color: ManagedColor = {
      space: 'rgb',
      r: 100,
      g: 150,
      b: 200,
      a: 128,
      profile: 'srgb',
    };
    const onChange = vi.fn();
    render(<ColorPicker value={color} onChange={onChange} />);
    act(() => {
      fireEvent.keyDown(screen.getByRole('slider', { name: 'Hue' }), { key: 'ArrowRight' });
    });
    const emitted = onChange.mock.calls[0]?.[0] as ManagedColor;
    expect(emitted).toBeDefined();
    expect(emitted.space).toBe('rgb');
    expect(emitted.a).toBe(128);
    expect(emitted.space === 'rgb' && emitted.profile).toBe('srgb');
  });
});

describe('ColorPicker — draft sync on external value change', () => {
  it('resyncs the 2D area thumb when the value changes externally', () => {
    const color: ManagedColor = { space: 'rgb', r: 100, g: 150, b: 200, a: 255 };
    const { rerender } = render(<ColorPicker value={color} onChange={() => {}} />);
    const thumb = () =>
      screen
        .getByRole('slider', { name: 'Color' })
        .querySelector('.color-area__thumb') as HTMLElement;
    const leftPct = () => Number.parseFloat(thumb().style.left);
    const topPct = () => Number.parseFloat(thumb().style.top);
    // hsv(210, 50, 78.43) → left 50%, top 100 - 78.43 (float drafts)
    expect(leftPct()).toBeCloseTo(50, 5);
    expect(topPct()).toBeCloseTo(21.5686, 4);
    // External change (undo / selection switch) to hsv(20, 75, 78.43)
    rerender(
      <ColorPicker value={{ space: 'rgb', r: 200, g: 100, b: 50, a: 255 }} onChange={() => {}} />,
    );
    expect(leftPct()).toBeCloseTo(75, 5);
    expect(topPct()).toBeCloseTo(21.5686, 4);
  });

  it('does not fight the user during a drag (self-echo keeps drafts)', () => {
    const color: ManagedColor = { space: 'rgb', r: 100, g: 150, b: 200, a: 255 };
    const onChange = vi.fn((c: ManagedColor) => c);
    const { rerender } = render(<ColorPicker value={color} onChange={onChange} />);
    // Simulate a drag: move the hue slider right, then echo the emitted
    // value back as the new prop (controlled-parent behavior).
    act(() => {
      fireEvent.keyDown(screen.getByRole('slider', { name: 'Hue' }), { key: 'ArrowRight' });
    });
    const emitted = onChange.mock.calls[0]?.[0] as ManagedColor;
    rerender(<ColorPicker value={emitted} onChange={onChange} />);
    // Draft must follow the user's drag, not snap back to the original color.
    const thumb = screen
      .getByRole('slider', { name: 'Color' })
      .querySelector('.color-area__thumb') as HTMLElement;
    expect(thumb.style.left).toBe('50%');
  });
});

describe('ColorPicker — bit-depth-aware alpha', () => {
  it('shows normalized alpha for float32 values', () => {
    const color: ManagedColor = {
      space: 'rgb',
      bitDepth: 'float32',
      r: 1,
      g: 0,
      b: 0,
      a: 0.5,
    };
    render(<ColorPicker value={color} onChange={() => {}} />);
    const alpha = screen.getByRole('slider', { name: 'Alpha' });
    expect(alpha).toHaveAttribute('aria-valuenow', '50');
  });

  it('emits float32 alpha without quantizing through uint8', () => {
    const color: ManagedColor = {
      space: 'rgb',
      bitDepth: 'float32',
      r: 1,
      g: 0,
      b: 0,
      a: 0.5,
    };
    const onChange = vi.fn();
    render(<ColorPicker value={color} onChange={onChange} />);
    act(() => {
      fireEvent.keyDown(screen.getByRole('slider', { name: 'Alpha' }), { key: 'ArrowRight' });
    });
    const emitted = onChange.mock.calls[0]?.[0] as ManagedColor;
    expect(emitted).toBeDefined();
    expect(emitted.space).toBe('rgb');
    expect(emitted.space === 'rgb' && emitted.bitDepth).toBe('float32');
    expect(emitted.a).toBeCloseTo(0.51, 5);
  });
});

describe('ColorPicker — high-precision channel editing', () => {
  it('editing R in a uint16 color preserves G/B exactly', () => {
    const color: ManagedColor = {
      space: 'rgb',
      bitDepth: 'uint16',
      r: 32768,
      g: 40951,
      b: 47923,
      a: 65535,
    };
    const onChange = vi.fn();
    render(<ColorPicker value={color} onChange={onChange} />);
    act(() => {
      const btn = screen.getByRole('button', { name: 'RGB' });
      btn.click();
    });
    // uint16 fields are 0-65535 scale.
    const rField = screen.getByRole('spinbutton', { name: 'R' });
    expect(rField).toHaveAttribute('aria-valuemax', '65535');
    act(() => {
      fireEvent.change(rField, { target: { value: '32769' } });
    });
    const emitted = onChange.mock.calls[0]?.[0] as ManagedColor;
    expect(emitted.space).toBe('rgb');
    if (emitted.space === 'rgb') {
      expect(emitted.bitDepth).toBe('uint16');
      expect(emitted.r).toBe(32769);
      // Untouched channels survive at full uint16 precision — 32768 vs 32769
      // are adjacent 16-bit values that collapse to the same 8-bit value.
      expect(emitted.g).toBe(40951);
      expect(emitted.b).toBe(47923);
      expect(emitted.a).toBe(65535);
    }
  });

  it('editing R in a float32 color preserves G/B exactly', () => {
    const color: ManagedColor = {
      space: 'rgb',
      bitDepth: 'float32',
      r: 0.500015,
      g: 0.624817,
      b: 0.731232,
      a: 1,
    };
    const onChange = vi.fn();
    render(<ColorPicker value={color} onChange={onChange} />);
    act(() => {
      const btn = screen.getByRole('button', { name: 'RGB' });
      btn.click();
    });
    // float fields are 0-1 with decimals.
    const rField = screen.getByRole('spinbutton', { name: 'R' });
    expect(rField).toHaveAttribute('aria-valuemax', '1');
    act(() => {
      fireEvent.change(rField, { target: { value: '0.5001' } });
    });
    const emitted = onChange.mock.calls[0]?.[0] as ManagedColor;
    expect(emitted.space).toBe('rgb');
    if (emitted.space === 'rgb') {
      expect(emitted.bitDepth).toBe('float32');
      expect(emitted.r).toBeCloseTo(0.5001, 6);
      expect(emitted.g).toBeCloseTo(0.624817, 6);
      expect(emitted.b).toBeCloseTo(0.731232, 6);
    }
  });

  it('HSV editing of a uint16 color does not collapse channels to 8-bit', () => {
    const color: ManagedColor = {
      space: 'rgb',
      bitDepth: 'uint16',
      r: 32768,
      g: 40951,
      b: 47923,
      a: 65535,
    };
    const onChange = vi.fn();
    render(<ColorPicker value={color} onChange={onChange} />);
    act(() => {
      fireEvent.keyDown(screen.getByRole('slider', { name: 'Hue' }), { key: 'ArrowRight' });
    });
    const emitted = onChange.mock.calls[0]?.[0] as ManagedColor;
    expect(emitted.space).toBe('rgb');
    if (emitted.space === 'rgb') {
      // A channel quantized through 8-bit would be a multiple of 257
      // (65535/255). Float-preserving HSV math must not produce those.
      expect(emitted.g % 257).not.toBe(0);
      expect(emitted.b % 257).not.toBe(0);
    }
  });
});
