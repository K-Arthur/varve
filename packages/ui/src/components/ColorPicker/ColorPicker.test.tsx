// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ColorFields } from './ColorFields';
import { ColorPicker } from './ColorPicker';
import { ColorSlider } from './ColorSlider';
import type { Color } from './color-utils';
import { EyeDropperButton } from './EyeDropperButton';
import { SwatchPalette } from './SwatchPalette';

afterEach(cleanup);

describe('ColorPicker', () => {
  it('renders with default color', () => {
    const color: Color = [255, 0, 0, 255];
    const onChange = () => {};
    render(<ColorPicker value={color} onChange={onChange} />);
    expect(screen.getByText('#ff0000')).toBeTruthy();
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
