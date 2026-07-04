import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { HistogramWidget } from './HistogramWidget';

afterEach(cleanup);

const defaultLevels = {
  inputBlack: 0,
  inputWhite: 255,
  gamma: 1,
  outputBlack: 0,
  outputWhite: 255,
};

describe('HistogramWidget', () => {
  it('renders with histogram data', () => {
    const histogram = {
      luminance: new Uint32Array(256).fill(10),
      red: new Uint32Array(256).fill(5),
      green: new Uint32Array(256).fill(5),
      blue: new Uint32Array(256).fill(5),
      alpha: new Uint32Array(256).fill(255),
      totalPixels: 2560,
      opaquePixels: 2560,
    };
    const onChange = () => {};
    const { container } = render(
      <HistogramWidget histogram={histogram} levels={defaultLevels} onChange={onChange} />,
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
});
