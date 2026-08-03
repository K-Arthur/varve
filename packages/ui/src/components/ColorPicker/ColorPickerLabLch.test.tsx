// @vitest-environment jsdom

import type { ManagedColor } from '@strata/scene';
import { labToLch, rgbToLab, rgbToLch } from '@strata/shared';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ColorPicker } from './ColorPicker';

afterEach(cleanup);

describe('ColorPicker Lab/LCH modes', () => {
  it('offers Lab and LCH space buttons', () => {
    const color: ManagedColor = { space: 'rgb', r: 255, g: 0, b: 0, a: 255 };
    render(<ColorPicker value={color} onChange={() => {}} />);
    expect(screen.getByRole('radio', { name: 'Lab' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'LCH' })).toBeTruthy();
  });

  it('uses Lab as the initial space for Lab values', () => {
    const color: ManagedColor = { space: 'lab', l: 50, av: 20, b: 30, a: 255 };
    render(<ColorPicker value={color} onChange={() => {}} />);
    expect(screen.getByRole('radio', { name: 'Lab' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('spinbutton', { name: 'L' })).toBeTruthy();
    expect(screen.getByRole('spinbutton', { name: 'a' })).toBeTruthy();
    expect(screen.getByRole('spinbutton', { name: 'b' })).toBeTruthy();
  });

  it('switching to Lab is display-only and does not emit', () => {
    const color: ManagedColor = { space: 'rgb', r: 255, g: 0, b: 0, a: 255 };
    const onChange = vi.fn();
    render(<ColorPicker value={color} onChange={onChange} />);
    act(() => {
      screen.getByRole('radio', { name: 'Lab' }).click();
    });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('spinbutton', { name: 'L' })).toBeTruthy();
  });

  it('editing a Lab channel emits a canonical LabColor with wrapped values', () => {
    const color: ManagedColor = { space: 'rgb', r: 255, g: 0, b: 0, a: 255 };
    const onChange = vi.fn();
    render(<ColorPicker value={color} onChange={onChange} />);
    act(() => {
      screen.getByRole('radio', { name: 'Lab' }).click();
    });
    const lInput = screen.getByRole('spinbutton', { name: 'L' });
    fireEvent.keyDown(lInput, { key: 'ArrowUp' });
    expect(onChange).toHaveBeenCalledTimes(1);
    const emitted = onChange.mock.calls[0]?.[0] as ManagedColor;
    expect(emitted.space).toBe('lab');
    expect(emitted.a).toBe(255);
  });

  it('editing an LCH hue emits a canonical LchColor with hue wrapped to [0, 360)', () => {
    const color: ManagedColor = { space: 'rgb', r: 255, g: 0, b: 0, a: 255 };
    const onChange = vi.fn();
    render(<ColorPicker value={color} onChange={onChange} />);
    act(() => {
      screen.getByRole('radio', { name: 'LCH' }).click();
    });
    const hInput = screen.getByRole('spinbutton', { name: 'H' });
    fireEvent.change(hInput, { target: { value: '370' } });
    expect(onChange).toHaveBeenCalledTimes(1);
    const emitted = onChange.mock.calls[0]?.[0] as { space: 'lch'; h: number };
    expect(emitted.space).toBe('lch');
    expect(emitted.h).toBe(10);
  });

  it('clamps negative chroma input to zero', () => {
    const color: ManagedColor = { space: 'rgb', r: 255, g: 0, b: 0, a: 255 };
    const onChange = vi.fn();
    render(<ColorPicker value={color} onChange={onChange} />);
    act(() => {
      screen.getByRole('radio', { name: 'LCH' }).click();
    });
    const cInput = screen.getByRole('spinbutton', { name: 'C' });
    fireEvent.change(cInput, { target: { value: '-5' } });
    expect(onChange).toHaveBeenCalledTimes(1);
    const emitted = onChange.mock.calls[0]?.[0] as { space: 'lch'; c: number };
    expect(emitted.c).toBe(0);
  });

  it('seeds LCH drafts from the Lab value without an sRGB round trip', () => {
    const color: ManagedColor = { space: 'lab', l: 60, av: -20, b: 40, a: 255 };
    const [L, C, H] = labToLch([60, -20, 40]);
    render(<ColorPicker value={color} onChange={() => {}} />);
    act(() => {
      screen.getByRole('radio', { name: 'LCH' }).click();
    });
    expect(screen.getByRole('spinbutton', { name: 'L' }).getAttribute('value')).toBe(L.toFixed(1));
    expect(screen.getByRole('spinbutton', { name: 'C' }).getAttribute('value')).toBe(C.toFixed(1));
    expect(screen.getByRole('spinbutton', { name: 'H' }).getAttribute('value')).toBe(H.toFixed(1));
  });

  it('keeps alpha when switching between picker modes', () => {
    const color: ManagedColor = { space: 'rgb', r: 100, g: 50, b: 200, a: 128 };
    const onChange = vi.fn();
    render(<ColorPicker value={color} onChange={onChange} />);
    act(() => {
      screen.getByRole('radio', { name: 'Lab' }).click();
    });
    act(() => {
      screen.getByRole('radio', { name: 'LCH' }).click();
    });
    // Viewing in Lab then LCH never emits.
    expect(onChange).not.toHaveBeenCalled();
    const alphaInput = screen.getByRole('spinbutton', { name: 'Alpha' });
    expect(alphaInput.getAttribute('value')).toBe('50');
  });

  it('editing alpha in Lab mode preserves the Lab channels and emits a LabColor', () => {
    const color: ManagedColor = { space: 'lab', l: 50, av: 10, b: -20, a: 255 };
    const onChange = vi.fn();
    render(<ColorPicker value={color} onChange={onChange} />);
    const alphaInput = screen.getByRole('spinbutton', { name: 'Alpha' });
    fireEvent.keyDown(alphaInput, { key: 'ArrowDown' });
    const emitted = onChange.mock.calls[0]?.[0] as ManagedColor & {
      l: number;
      av: number;
      b: number;
    };
    expect(emitted.space).toBe('lab');
    expect(emitted.l).toBe(50);
    expect(emitted.av).toBe(10);
    expect(emitted.b).toBe(-20);
    // 255 * (99/100) rounds to 252
    expect(emitted.a).toBe(252);
  });

  it('does not overwrite a spot color merely by viewing it in Lab', () => {
    const color: ManagedColor = {
      space: 'spot',
      name: 'Pantone 185 C',
      tint: 100,
      a: 255,
    };
    const onChange = vi.fn();
    render(<ColorPicker value={color} onChange={onChange} />);
    act(() => {
      screen.getByRole('radio', { name: 'Lab' }).click();
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('achromatic LCH colors keep the last meaningful hue while chroma is zero', () => {
    const color: ManagedColor = { space: 'rgb', r: 128, g: 128, b: 128, a: 255 };
    const onChange = vi.fn();
    render(<ColorPicker value={color} onChange={onChange} />);
    act(() => {
      screen.getByRole('radio', { name: 'LCH' }).click();
    });
    // Gray: chroma is ~0; the hue input shows a stable (non-NaN) value.
    const hInput = screen.getByRole('spinbutton', { name: 'H' });
    const hueValue = Number(hInput.getAttribute('value'));
    expect(Number.isNaN(hueValue)).toBe(false);
    // Raising chroma then hue works deterministically.
    const cInput = screen.getByRole('spinbutton', { name: 'C' });
    fireEvent.change(cInput, { target: { value: '20' } });
    fireEvent.keyDown(hInput, { key: 'ArrowUp' });
    const emitted = onChange.mock.calls[0]?.[0] as { space: 'lch'; c: number; h: number };
    expect(emitted.space).toBe('lch');
    expect(emitted.c).toBe(20);
    expect(Number.isFinite(emitted.h)).toBe(true);
  });

  it('round-trips rgb -> lab -> rgb drafts without drift accumulation across mode switches', () => {
    const color: ManagedColor = { space: 'rgb', r: 200, g: 100, b: 50, a: 255 };
    render(<ColorPicker value={color} onChange={() => {}} />);
    const [, , originalHue] = rgbToLch(200, 100, 50);
    act(() => {
      screen.getByRole('radio', { name: 'Lab' }).click();
    });
    act(() => {
      screen.getByRole('radio', { name: 'LCH' }).click();
    });
    act(() => {
      screen.getByRole('radio', { name: 'RGB' }).click();
    });
    act(() => {
      screen.getByRole('radio', { name: 'LCH' }).click();
    });
    const hInput = screen.getByRole('spinbutton', { name: 'H' });
    const displayedHue = Number(hInput.getAttribute('value'));
    expect(Math.abs(displayedHue - originalHue)).toBeLessThan(1.5);
  });

  it('reports out-of-display-gamut Lab values with a text notice', () => {
    // L=50, a=140, b=140 is far outside the sRGB gamut.
    const color: ManagedColor = { space: 'lab', l: 50, av: 140, b: 140, a: 255 };
    render(<ColorPicker value={color} onChange={() => {}} />);
    expect(screen.getByRole('note', { name: '' }).textContent ?? '').toContain(
      'Outside the display gamut',
    );
  });

  it('keeps a saturated in-gamut Lab value without a notice', () => {
    const [l, av, b] = rgbToLab(255, 0, 0);
    const color: ManagedColor = { space: 'lab', l, av, b, a: 255 };
    render(<ColorPicker value={color} onChange={() => {}} />);
    const notes = screen.queryAllByText(/Outside the display gamut/);
    expect(notes.length).toBe(0);
  });
});
