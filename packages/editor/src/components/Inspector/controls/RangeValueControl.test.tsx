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
});
