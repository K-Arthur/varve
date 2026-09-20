// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  EffectBlendRow,
  EffectChoiceRow,
  EffectColourOpacityRow,
  EffectPercentField,
  EffectToggleRow,
  effectPercent,
} from './EffectControls';

afterEach(cleanup);

const BLACK = { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 255 };

describe('EffectPercentField', () => {
  it('renders a 0..1 model value as a percentage', () => {
    render(<EffectPercentField label="Opacity" value={0.42} mixed={false} onChange={() => {}} />);
    expect(screen.getByLabelText('Opacity')).toHaveValue('42');
  });

  it('reports edits back as a 0..1 fraction', () => {
    const onChange = vi.fn();
    render(<EffectPercentField label="Opacity" value={1} mixed={false} onChange={onChange} />);
    const input = screen.getByLabelText('Opacity');
    fireEvent.change(input, { target: { value: '65' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith(0.65);
  });

  it('shows a mixed state for disagreeing selections', () => {
    render(<EffectPercentField label="Noise" value={0.2} mixed onChange={() => {}} />);
    expect(screen.getByLabelText('Noise')).toHaveValue('Mixed');
  });

  it('normalizes percent display for non-integer model values', () => {
    expect(effectPercent(0.333)).toBe(33);
  });
});

describe('EffectBlendRow', () => {
  it('renders the selected blend mode', () => {
    render(
      <EffectBlendRow
        label="Effect blend mode"
        value="multiply"
        mixed={false}
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole('combobox', { name: 'Effect blend mode' })).toHaveTextContent(
      'Multiply',
    );
  });

  it('shows Mixed and reports the chosen mode', () => {
    const onChange = vi.fn();
    render(<EffectBlendRow label="Effect blend mode" value="normal" mixed onChange={onChange} />);
    const combobox = screen.getByRole('combobox', { name: 'Effect blend mode' });
    expect(combobox).toHaveTextContent('Mixed');
    fireEvent.click(combobox);
    fireEvent.click(screen.getByText('Screen'));
    expect(onChange).toHaveBeenCalledWith('screen');
  });
});

describe('EffectChoiceRow', () => {
  const options = [
    { value: 'linear' as const, label: 'Linear' },
    { value: 'smooth' as const, label: 'Soft' },
    { value: 'sharp' as const, label: 'Sharp' },
  ];

  it('selects a value through the segmented radiogroup', () => {
    const onChange = vi.fn();
    render(
      <EffectChoiceRow
        label="Glow contour"
        value="linear"
        mixed={false}
        options={options}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole('radio', { name: 'Sharp' }));
    expect(onChange).toHaveBeenCalledWith('sharp');
  });

  it('keeps a mixed selection usable with nothing selected', () => {
    const onChange = vi.fn();
    render(
      <EffectChoiceRow
        label="Glow contour"
        value="smooth"
        mixed
        options={options}
        onChange={onChange}
      />,
    );
    expect(screen.getByRole('radio', { name: 'Mixed' })).toBeDisabled();
    for (const option of options) {
      expect(screen.getByRole('radio', { name: option.label })).not.toBeChecked();
    }
    fireEvent.click(screen.getByRole('radio', { name: 'Soft' }));
    expect(onChange).toHaveBeenCalledWith('smooth');
  });
});

describe('EffectToggleRow', () => {
  it('reports a boolean change', () => {
    const onChange = vi.fn();
    render(<EffectToggleRow label="Edge highlight" checked={false} onChange={onChange} />);
    fireEvent.click(screen.getByRole('switch', { name: 'Edge highlight' }));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('names the mixed state', () => {
    render(<EffectToggleRow label="Edge highlight" checked={false} mixed onChange={() => {}} />);
    expect(screen.getByRole('switch', { name: 'Edge highlight (mixed)' })).not.toBeChecked();
  });
});

describe('EffectColourOpacityRow', () => {
  it('shows the colour swatch, mixed label, and percent opacity together', () => {
    render(
      <EffectColourOpacityRow
        colourLabel="Shadow colour"
        colour={BLACK}
        colourMixed
        opacity={0.3}
        opacityMixed={false}
        onColourChange={() => {}}
        onOpacityChange={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: 'Shadow colour' })).toHaveTextContent('Mixed');
    expect(screen.getByLabelText('Opacity')).toHaveValue('30');
  });
});
