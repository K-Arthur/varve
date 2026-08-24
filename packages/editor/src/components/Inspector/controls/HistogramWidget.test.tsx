import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HistogramWidget } from './HistogramWidget';

afterEach(cleanup);

const defaultLevels = {
  inputBlack: 50,
  inputWhite: 200,
  gamma: 0.8,
  outputBlack: 0,
  outputWhite: 255,
};

const mockHistogram = {
  luminance: new Uint32Array(256).fill(10),
  red: new Uint32Array(256).fill(5),
  green: new Uint32Array(256).fill(5),
  blue: new Uint32Array(256).fill(5),
  alpha: new Uint32Array(256).fill(255),
  totalPixels: 2560,
  opaquePixels: 2560,
};

describe('HistogramWidget', () => {
  it('renders with histogram data', () => {
    const onChange = () => {};
    const { container } = render(
      <HistogramWidget histogram={mockHistogram} levels={defaultLevels} onChange={onChange} />,
    );
    const canvas = container.querySelector('canvas');
    expect(canvas).toBeTruthy();
  });

  it('renders empty state without histogram data', () => {
    const onChange = () => {};
    const { container } = render(<HistogramWidget levels={defaultLevels} onChange={onChange} />);
    const canvas = container.querySelector('canvas');
    expect(canvas).toBeTruthy();
  });

  it('renders Auto button', () => {
    const onChange = () => {};
    render(<HistogramWidget levels={defaultLevels} onChange={onChange} />);
    expect(screen.getByText('Auto')).toBeTruthy();
  });

  it('exposes channel switching buttons', () => {
    const onChannelChange = vi.fn();
    render(
      <HistogramWidget
        histogram={mockHistogram}
        levels={defaultLevels}
        onChange={vi.fn()}
        onChannelChange={onChannelChange}
      />,
    );
    fireEvent.click(screen.getByRole('radio', { name: 'R' }));
    expect(onChannelChange).toHaveBeenCalledWith('red');
  });

  it('calls onDragStart when pointer down on slider', () => {
    const onDragStart = vi.fn();
    const onDragEnd = vi.fn();
    const { container } = render(
      <HistogramWidget
        histogram={mockHistogram}
        levels={defaultLevels}
        onChange={vi.fn()}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
      />,
    );
    const canvas = container.querySelector('canvas')!;
    // black slider at (50/255)*300 ≈ 58.8
    fireEvent.pointerDown(canvas, { clientX: 59 });
    expect(onDragStart).toHaveBeenCalledTimes(1);
    expect(onDragEnd).not.toHaveBeenCalled();
  });

  it('calls onDragEnd when pointer up', () => {
    const onDragStart = vi.fn();
    const onDragEnd = vi.fn();
    const { container } = render(
      <HistogramWidget
        histogram={mockHistogram}
        levels={defaultLevels}
        onChange={vi.fn()}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
      />,
    );
    const canvas = container.querySelector('canvas')!;
    fireEvent.pointerDown(canvas, { clientX: 59 });
    fireEvent.pointerUp(canvas);
    expect(onDragEnd).toHaveBeenCalledTimes(1);
  });

  it('calls onDragStart/onDragEnd for auto button', () => {
    const onDragStart = vi.fn();
    const onDragEnd = vi.fn();
    const onChange = vi.fn();
    render(
      <HistogramWidget
        histogram={mockHistogram}
        levels={defaultLevels}
        onChange={onChange}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
      />,
    );
    fireEvent.click(screen.getByText('Auto'));
    expect(onDragStart).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onDragEnd).toHaveBeenCalledTimes(1);
  });
});
