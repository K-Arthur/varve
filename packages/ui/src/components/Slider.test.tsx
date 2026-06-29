// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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
});
