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

  it('surfaces clipped shadows and highlights as a visible warning', () => {
    const channel = new Uint32Array(256);
    channel[0] = 5; // 0.5% of 1000 opaque pixels
    channel[255] = 3; // 0.3%
    channel[128] = 992;
    const clipped = {
      ...mockHistogram,
      luminance: channel,
      opaquePixels: 1000,
    };
    render(<HistogramWidget histogram={clipped} levels={defaultLevels} onChange={vi.fn()} />);
    const warning = screen.getByTestId('histogram-clipping');
    expect(warning.textContent).toContain('Clipped shadows 0.5%');
    expect(warning.textContent).toContain('Clipped highlights 0.3%');
  });

  it('stays quiet when the histogram endpoints are empty', () => {
    const channel = new Uint32Array(256);
    for (let i = 1; i < 255; i += 1) channel[i] = 4;
    const clean = {
      ...mockHistogram,
      luminance: channel,
      opaquePixels: 1016,
    };
    render(<HistogramWidget histogram={clean} levels={defaultLevels} onChange={vi.fn()} />);
    expect(screen.queryByTestId('histogram-clipping')).toBeNull();
  });
});
