// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Slider } from './Slider';

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

  it('sets ARIA attributes on the thumb', () => {
    const onChange = () => {};
    const { container } = render(
      <Slider value={30} min={0} max={100} label="Test" onChange={onChange} />,
    );
    const slider = container.querySelector('[role="slider"]');
    expect(slider).not.toBeNull();
    expect(slider?.getAttribute('aria-valuenow')).toBe('30');
    expect(slider?.getAttribute('aria-valuemin')).toBe('0');
    expect(slider?.getAttribute('aria-valuemax')).toBe('100');
  });

  it('calls onChange on ArrowRight', () => {
    let val = 50;
    const onChange = (v: number) => {
      val = v;
    };
    const { container } = render(
      <Slider value={50} min={0} max={100} label="Test" onChange={onChange} />,
    );
    const slider = container.querySelector('[role="slider"]') as HTMLElement;
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(val).toBe(51);
  });

  it('calls onChange on Home/End', () => {
    let val = 50;
    const onChange = (v: number) => {
      val = v;
    };
    const { container } = render(
      <Slider value={50} min={0} max={100} label="Test" onChange={onChange} />,
    );
    const slider = container.querySelector('[role="slider"]') as HTMLElement;
    fireEvent.keyDown(slider, { key: 'Home' });
    expect(val).toBe(0);
    val = 50;
    fireEvent.keyDown(slider, { key: 'End' });
    expect(val).toBe(100);
  });

  it('does not respond to keys when disabled', () => {
    let val = 50;
    const onChange = (v: number) => {
      val = v;
    };
    const { container } = render(
      <Slider value={50} min={0} max={100} label="Test" onChange={onChange} disabled />,
    );
    const slider = container.querySelector('[role="slider"]') as HTMLElement;
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(val).toBe(50);
  });

  it('clicks on track updates value', () => {
    let val = 0;
    const onChange = (v: number) => {
      val = v;
    };
    const { container } = render(
      <Slider value={0} min={0} max={100} label="Test" onChange={onChange} />,
    );
    const track = container.querySelector('fieldset > div > div:first-child') as HTMLElement;
    Object.defineProperty(track, 'getBoundingClientRect', {
      value: () => ({ left: 0, width: 100, top: 0, height: 10, right: 100, bottom: 10 }),
    });
    fireEvent.click(track, { clientX: 50 });
    expect(Math.abs(val - 50)).toBeLessThanOrEqual(1);
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
