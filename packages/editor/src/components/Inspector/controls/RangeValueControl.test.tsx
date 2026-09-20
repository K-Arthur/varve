// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { RangeValueControl } from './RangeValueControl';

afterEach(cleanup);

function Holder() {
  const [value, setValue] = useState(25);
  return (
    <RangeValueControl
      label="Intensity"
      value={value}
      min={0}
      max={100}
      unit="%"
      onChange={setValue}
    />
  );
}

function NormalizedHolder() {
  const [value, setValue] = useState(0.25);
  return (
    <RangeValueControl
      label="Blend"
      value={value}
      min={0}
      max={1}
      step={0.05}
      displayScale={100}
      unit="%"
      onChange={setValue}
    />
  );
}

describe('RangeValueControl', () => {
  it('keeps exploratory slider changes and typed precision values in one control', () => {
    render(<Holder />);

    const slider = screen.getByRole('slider', { name: 'Intensity' });
    const precision = screen.getByRole('spinbutton', { name: 'Intensity value (%)' });

    fireEvent.change(slider, { target: { value: '40' } });
    expect(precision).toHaveValue('40');

    fireEvent.change(precision, { target: { value: '63' } });
    fireEvent.keyDown(precision, { key: 'Enter' });
    expect(slider).toHaveValue('63');
  });

  it('clamps manually entered values to the same range as the slider', () => {
    render(<Holder />);

    const precision = screen.getByRole('spinbutton', { name: 'Intensity value (%)' });
    fireEvent.change(precision, { target: { value: '250' } });
    fireEvent.keyDown(precision, { key: 'Enter' });

    expect(screen.getByRole('slider', { name: 'Intensity' })).toHaveValue('100');
  });

  it('scales normalized model values for percentage precision entry', () => {
    render(<NormalizedHolder />);

    const slider = screen.getByRole('slider', { name: 'Blend' });
    const precision = screen.getByRole('spinbutton', { name: 'Blend value (%)' });
    expect(precision).toHaveValue('25');

    fireEvent.change(precision, { target: { value: '65' } });
    fireEvent.keyDown(precision, { key: 'Enter' });
    expect(slider).toHaveValue('0.65');
  });

  it('renders the canonical skin by default and treats rangeClassName as layout only', () => {
    render(
      <RangeValueControl
        label="Intensity"
        value={25}
        min={0}
        max={100}
        rangeClassName="custom-layout"
        onChange={() => {}}
      />,
    );
    const slider = screen.getByRole('slider', { name: 'Intensity' });
    expect(slider).toHaveClass('varve-native-range');
    expect(slider).toHaveClass('custom-layout');
  });

  it('announces the displayed value when it differs from the raw number', () => {
    render(<NormalizedHolder />);
    expect(screen.getByRole('slider', { name: 'Blend' })).toHaveAttribute('aria-valuetext', '25%');
  });

  it('leaves aria-valuetext off when the raw number is the value', () => {
    render(<RangeValueControl label="Steps" value={12} min={0} max={100} onChange={() => {}} />);
    expect(screen.getByRole('slider', { name: 'Steps' })).not.toHaveAttribute('aria-valuetext');
  });
});
