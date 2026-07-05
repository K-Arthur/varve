import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { AdjustmentNode } from '@strata/scene';
import { EditorProvider } from '../../../context';
import { AdjustmentSection } from './AdjustmentSection';

afterEach(cleanup);

function makeAdjustmentNode(
  id: string,
  type: 'curves' | 'levels' | 'selectiveColor',
): AdjustmentNode {
  const base = {
    id,
    kind: 'adjustment' as const,
    name: 'Adjustment 1',
    index: 0,
    order: 'a0',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal' as const,
    rotation: 0,
    fill: [0, 0, 0, 0] as const,
    transform: [1, 0, 0, 1, 0, 0] as const,
    clipping: false,
    effects: [],
  };

  switch (type) {
    case 'curves':
      return {
        ...base,
        adjustmentType: 'curves' as const,
        params: {
          channel: 'rgb' as const,
          points: [
            { x: 0, y: 0 },
            { x: 1, y: 1 },
          ],
        },
      } as unknown as AdjustmentNode;
    case 'levels':
      return {
        ...base,
        adjustmentType: 'levels' as const,
        params: {
          channel: 'rgb' as const,
          inputBlack: 0,
          inputWhite: 255,
          gamma: 1,
          outputBlack: 0,
          outputWhite: 255,
        },
      } as unknown as AdjustmentNode;
    case 'selectiveColor':
      return {
        ...base,
        adjustmentType: 'selectiveColor' as const,
        params: [
          {
            color: 'red' as const,
            cyan: 0,
            magenta: 0,
            yellow: 0,
            black: 0,
            method: 'relative' as const,
          },
          {
            color: 'green' as const,
            cyan: 0,
            magenta: 0,
            yellow: 0,
            black: 0,
            method: 'relative' as const,
          },
          {
            color: 'blue' as const,
            cyan: 0,
            magenta: 0,
            yellow: 0,
            black: 0,
            method: 'relative' as const,
          },
          {
            color: 'cyan' as const,
            cyan: 0,
            magenta: 0,
            yellow: 0,
            black: 0,
            method: 'relative' as const,
          },
          {
            color: 'magenta' as const,
            cyan: 0,
            magenta: 0,
            yellow: 0,
            black: 0,
            method: 'relative' as const,
          },
          {
            color: 'yellow' as const,
            cyan: 0,
            magenta: 0,
            yellow: 0,
            black: 0,
            method: 'relative' as const,
          },
          {
            color: 'white' as const,
            cyan: 0,
            magenta: 0,
            yellow: 0,
            black: 0,
            method: 'relative' as const,
          },
          {
            color: 'neutral' as const,
            cyan: 0,
            magenta: 0,
            yellow: 0,
            black: 0,
            method: 'relative' as const,
          },
          {
            color: 'black' as const,
            cyan: 0,
            magenta: 0,
            yellow: 0,
            black: 0,
            method: 'relative' as const,
          },
        ],
      } as unknown as AdjustmentNode;
  }
}

function renderWithProvider(element: React.ReactElement) {
  return render(<EditorProvider>{element}</EditorProvider>);
}

describe('AdjustmentSection', () => {
  it('renders curves type with CurveEditor', () => {
    const node = makeAdjustmentNode('n1', 'curves');
    renderWithProvider(<AdjustmentSection nodes={[node]} />);
    expect(screen.getByRole('graphics-document', { name: /curve editor/i })).toBeTruthy();
  });

  it('renders levels type with HistogramWidget', () => {
    const node = makeAdjustmentNode('n1', 'levels');
    renderWithProvider(<AdjustmentSection nodes={[node]} />);
    expect(screen.getByText('Auto')).toBeTruthy();
  });

  it('renders selective color type with grid', () => {
    const node = makeAdjustmentNode('n1', 'selectiveColor');
    renderWithProvider(<AdjustmentSection nodes={[node]} />);
    expect(screen.getByText('Reds')).toBeTruthy();
  });

  it('toggles clipping checkbox', () => {
    const node = makeAdjustmentNode('n1', 'curves');
    renderWithProvider(<AdjustmentSection nodes={[node]} />);
    const checkbox = screen.getByRole('checkbox', { name: /clip to layer below/i });
    expect(checkbox).toBeTruthy();
    expect((checkbox as HTMLInputElement).checked).toBe(false);
  });
});
