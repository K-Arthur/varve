import { makeAdjustment } from '@varve/engine';
import { describe, expect, it } from 'vitest';
import { summarizeAdjustmentStack } from './adjustmentStackSummary';

describe('summarizeAdjustmentStack', () => {
  it('identifies an empty adjustment layer', () => {
    expect(summarizeAdjustmentStack([])).toMatchObject({
      label: 'No adjustments',
      tooltip: 'No adjustments applied',
      totalCount: 0,
      activeCount: 0,
      inactiveCount: 0,
    });
  });

  it('shows one or two adjustment names in stack order', () => {
    const summary = summarizeAdjustmentStack([
      makeAdjustment('threshold-1', 'threshold'),
      makeAdjustment('map-1', 'gradientMap'),
    ]);

    expect(summary.label).toBe('Threshold + Gradient Map');
    expect(summary.tooltip).toBe('Threshold, Gradient Map. 2 of 2 active.');
    expect(summary.activeCount).toBe(2);
  });

  it('keeps the row compact while retaining every name in the tooltip', () => {
    const summary = summarizeAdjustmentStack([
      makeAdjustment('one', 'threshold'),
      makeAdjustment('two', 'gradientMap'),
      makeAdjustment('three', 'colorBalance'),
    ]);

    expect(summary.label).toBe('Threshold + Gradient Map + 1 more');
    expect(summary.tooltip).toContain('Color Balance');
  });

  it('reports disabled entries without hiding their identity', () => {
    const summary = summarizeAdjustmentStack([
      makeAdjustment('active', 'threshold'),
      makeAdjustment('disabled', 'gradientMap', { visible: false }),
      makeAdjustment('zero', 'colorBalance', { opacity: 0 }),
    ]);

    expect(summary.label).toBe('Threshold + Gradient Map + 1 more');
    expect(summary.activeCount).toBe(1);
    expect(summary.inactiveCount).toBe(2);
    expect(summary.tooltip).toBe(
      'Threshold, Gradient Map (off), Color Balance (off). 1 of 3 active.',
    );
  });
});
