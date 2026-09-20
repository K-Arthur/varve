// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Slider } from './Slider';

/**
 * The Slider is a composition over the native range. Keyboard stepping,
 * Home/End/PageUp/PageDown, click-to-set (WCAG 2.5.7), and AT exposure are
 * browser behavior, so these tests assert the native contract rather than
 * re-simulating key events jsdom does not implement.
 */
describe('Slider', () => {
  it('renders with label and value', () => {
    const onChange = () => {};
    render(<Slider value={50} min={0} max={100} label="Quality" onChange={onChange} />);
    expect(screen.getByText('Quality')).toBeDefined();
    expect(screen.getByText('50')).toBeDefined();
  });

  it('uses formatValue to display the value', () => {
    const onChange = () => {};
    render(
      <Slider
        value={75}
        min={0}
        max={100}
        label="Opacity"
        onChange={onChange}
        formatValue={(v) => `${v}%`}
      />,
    );
    expect(screen.getByText('75%')).toBeDefined();
  });

  it('exposes the native range contract with the canonical skin', () => {
    const { container } = render(
      <Slider value={30} min={0} max={100} step={5} label="Test" onChange={() => {}} />,
    );
    const slider = screen.getByRole('slider');
    expect(slider.tagName).toBe('INPUT');
    expect(slider).toHaveAttribute('type', 'range');
    expect(slider).toHaveClass('varve-native-range');
    expect(slider).toHaveAttribute('min', '0');
    expect(slider).toHaveAttribute('max', '100');
    expect(slider).toHaveAttribute('step', '5');
    expect(slider).toHaveValue('30');
    // No parallel role="slider" widget.
    expect(container.querySelector('div[role="slider"]')).toBeNull();
  });

  it('names the range from the legend', () => {
    render(<Slider value={30} min={0} max={100} label="Volume" onChange={() => {}} />);
    expect(screen.getByRole('slider', { name: 'Volume' })).toBeDefined();
  });

  it('reports value changes through onChange', () => {
    let val = 50;
    const onChange = (v: number) => {
      val = v;
    };
    render(<Slider value={50} min={0} max={100} label="Test" onChange={onChange} />);
    fireEvent.change(screen.getByRole('slider'), { target: { value: '73' } });
    expect(val).toBe(73);
  });

  it('syncs the progress fill to the value', () => {
    render(<Slider value={25} min={0} max={100} label="Test" onChange={() => {}} />);
    expect(screen.getByRole('slider').style.getPropertyValue('--varve-native-range-fill')).toBe(
      '25%',
    );
  });

  it('adds aria-valuetext only when the raw number is not the value', () => {
    const { rerender } = render(
      <Slider value={50} min={0} max={100} label="Plain" onChange={() => {}} />,
    );
    expect(screen.getByRole('slider')).not.toHaveAttribute('aria-valuetext');
    rerender(
      <Slider
        value={50}
        min={0}
        max={100}
        label="Formatted"
        onChange={() => {}}
        formatValue={(v) => `${v}%`}
      />,
    );
    expect(screen.getByRole('slider')).toHaveAttribute('aria-valuetext', '50%');
  });

  it('disables the range when disabled', () => {
    render(<Slider value={50} min={0} max={100} label="Test" onChange={() => {}} disabled />);
    // The platform blocks pointer and keyboard interaction on a disabled
    // control; the component only has to expose the disabled state.
    expect(screen.getByRole('slider')).toBeDisabled();
    expect(screen.getByRole('slider')).toHaveAttribute('aria-labelledby');
  });

  it('renders numeric input when showInput is true', () => {
    const onChange = () => {};
    render(<Slider value={42} min={0} max={100} label="Volume" onChange={onChange} showInput />);
    const input = screen.getByRole('spinbutton', { name: 'Volume' });
    expect(input).toBeDefined();
    expect((input as HTMLInputElement).value).toBe('42');
  });

  it('numeric input calls onChange with typed value', () => {
    let val = 50;
    const onChange = (v: number) => {
      val = v;
    };
    render(<Slider value={50} min={0} max={100} label="Test" onChange={onChange} showInput />);
    const input = screen.getByRole('spinbutton', { name: 'Test' });
    fireEvent.change(input, { target: { value: '75' } });
    expect(val).toBe(75);
  });

  it('clamps numeric input value to min/max', () => {
    let val = 50;
    const onChange = (v: number) => {
      val = v;
    };
    render(<Slider value={50} min={0} max={100} label="Test" onChange={onChange} showInput />);
    const input = screen.getByRole('spinbutton', { name: 'Test' });
    fireEvent.change(input, { target: { value: '200' } });
    expect(val).toBe(100);
    fireEvent.change(input, { target: { value: '-10' } });
    expect(val).toBe(0);
  });

  it('renders reset button when onReset is provided', () => {
    const onReset = vi.fn();
    render(
      <Slider value={50} min={0} max={100} label="Test" onChange={() => {}} onReset={onReset} />,
    );
    const resetBtn = screen.getByRole('button', { name: 'Reset Test' });
    expect(resetBtn).toBeDefined();
    fireEvent.click(resetBtn);
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it('does not render reset button when onReset is absent', () => {
    render(<Slider value={50} min={0} max={100} label="Test" onChange={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Reset Test' })).toBeNull();
  });

  it('applies size class when size prop is set', () => {
    const { container } = render(
      <Slider value={50} min={0} max={100} label="Test" onChange={() => {}} size="lg" />,
    );
    expect(container.firstChild).toHaveClass('varve-slider--lg');
  });

  it('shows value text when showInput is false (default)', () => {
    const onChange = () => {};
    render(<Slider value={60} min={0} max={100} label="Test" onChange={onChange} />);
    expect(screen.getByText('60')).toBeDefined();
    expect(screen.queryByRole('spinbutton')).toBeNull();
  });
});
