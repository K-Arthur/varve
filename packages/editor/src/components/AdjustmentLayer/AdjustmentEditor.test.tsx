// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AdjustmentEditor,
  curvePointsToCurvesPoints,
  curvesPointsToCurvePoints,
} from './AdjustmentEditor';

afterEach(cleanup);

const base = { id: 'adj-1', visible: true, opacity: 1, blendMode: 'normal' as const };

describe('curvesPointsToCurvePoints / curvePointsToCurvesPoints', () => {
  it('converts document-space {input,output} (0-255) to plot-space {x,y} (0-1)', () => {
    expect(curvesPointsToCurvePoints([{ input: 0, output: 0 }])).toEqual([{ x: 0, y: 0 }]);
    expect(curvesPointsToCurvePoints([{ input: 255, output: 255 }])).toEqual([{ x: 1, y: 1 }]);
    expect(curvesPointsToCurvePoints([{ input: 128, output: 64 }])).toEqual([
      { x: 128 / 255, y: 64 / 255 },
    ]);
  });

  it('round-trips within +/-1 of the original 0-255 value (integer rounding)', () => {
    const original = [
      { input: 0, output: 0 },
      { input: 64, output: 200 },
      { input: 191, output: 32 },
      { input: 255, output: 255 },
    ];
    const roundTripped = curvePointsToCurvesPoints(curvesPointsToCurvePoints(original));
    for (let i = 0; i < original.length; i++) {
      expect(Math.abs(roundTripped[i]!.input - original[i]!.input)).toBeLessThanOrEqual(1);
      expect(Math.abs(roundTripped[i]!.output - original[i]!.output)).toBeLessThanOrEqual(1);
    }
  });

  it('clamps out-of-range plot-space values before converting back', () => {
    expect(curvePointsToCurvesPoints([{ x: -0.5, y: 1.5 }])).toEqual([{ input: 0, output: 255 }]);
  });

  it('preserves point order (does not sort)', () => {
    const points = curvesPointsToCurvePoints([
      { input: 200, output: 10 },
      { input: 10, output: 200 },
    ]);
    expect(points[0]).toEqual({ x: 200 / 255, y: 10 / 255 });
    expect(points[1]).toEqual({ x: 10 / 255, y: 200 / 255 });
  });
});

describe('AdjustmentEditor — curves', () => {
  it('renders the interactive CurveEditor (not the old raw number inputs)', () => {
    render(
      <AdjustmentEditor
        adjustment={{
          ...base,
          kind: 'curves',
          channel: 'rgb',
          points: [
            { input: 0, output: 0 },
            { input: 255, output: 255 },
          ],
        }}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByRole('img', { name: /curve editor/i })).toBeTruthy();
    expect(screen.queryByLabelText(/point 1 input/i)).toBeNull();
  });

  it("channel select drives the curve editor's own channel buttons (controlled, not decorative)", () => {
    render(
      <AdjustmentEditor
        adjustment={{
          ...base,
          kind: 'curves',
          channel: 'red',
          points: [
            { input: 0, output: 0 },
            { input: 255, output: 255 },
          ],
        }}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByRole('radio', { name: /^R$/i })).toBeChecked();
    expect(screen.getByRole('radio', { name: /rgb/i })).not.toBeChecked();
  });

  it('calls onChange with converted points when the curve editor edits', () => {
    const onChange = vi.fn();
    render(
      <AdjustmentEditor
        adjustment={{
          ...base,
          kind: 'curves',
          channel: 'rgb',
          points: [
            { input: 50, output: 200 },
            { input: 200, output: 50 },
          ],
        }}
        onChange={onChange}
      />,
    );
    const resetBtn = screen.getByRole('button', { name: /reset curve/i });
    resetBtn.click();
    expect(onChange).toHaveBeenCalledWith({
      points: [
        { input: 0, output: 0 },
        { input: 255, output: 255 },
      ],
    });
  });
});

describe('AdjustmentEditor — levels', () => {
  it('renders the interactive HistogramWidget (not the old raw number inputs)', () => {
    render(
      <AdjustmentEditor
        adjustment={{
          ...base,
          kind: 'levels',
          channel: 'rgb',
          inputShadows: 0,
          inputMidtones: 1,
          inputHighlights: 255,
          outputShadows: 0,
          outputHighlights: 255,
        }}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByLabelText(/histogram with level sliders/i)).toBeTruthy();
    expect(screen.queryByLabelText(/input shadows/i)).toBeNull();
  });
});

describe('AdjustmentEditor — shadow / highlight', () => {
  it('renders recovery controls for the persisted adjustment kind', () => {
    render(
      <AdjustmentEditor
        adjustment={{
          ...base,
          kind: 'shadowHighlight',
          shadows: 20,
          highlights: 30,
          tonalWidth: 50,
          midpoint: 50,
        }}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByRole('slider', { name: 'Shadow brightening' })).toBeTruthy();
    expect(screen.getByRole('slider', { name: 'Highlight recovery' })).toBeTruthy();
    expect(screen.getByRole('slider', { name: 'Tonal width' })).toBeTruthy();
    expect(screen.getByRole('slider', { name: 'Midpoint' })).toBeTruthy();
  });
});

describe('AdjustmentEditor — color controls', () => {
  it('renders editable colors for duotone without passing an invalid ColorPicker prop', () => {
    render(
      <AdjustmentEditor
        adjustment={{
          ...base,
          kind: 'duotone',
          shadowColor: [30, 40, 100, 255],
          highlightColor: [255, 220, 180, 255],
          shadowPoint: 0.25,
          highlightPoint: 0.75,
          intensity: 1,
          preserveLuminosity: false,
        }}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByText('Shadow Color')).toBeTruthy();
    expect(screen.getByText('Highlight Color')).toBeTruthy();
  });

  it('exposes the photo-filter color instead of only density', () => {
    render(
      <AdjustmentEditor
        adjustment={{
          ...base,
          kind: 'photoFilter',
          color: [255, 255, 0, 255],
          density: 25,
          preserveLuminosity: true,
        }}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByText('Filter Color')).toBeTruthy();
    expect(screen.getByRole('slider', { name: 'Density' })).toBeTruthy();
  });
});
