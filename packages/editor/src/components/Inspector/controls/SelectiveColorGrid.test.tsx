import type { SelectiveColorParams } from '@strata/engine';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { SelectiveColorGrid } from './SelectiveColorGrid';

afterEach(cleanup);

function defaultParams(): SelectiveColorParams[] {
  const targets = [
    'red',
    'green',
    'blue',
    'cyan',
    'magenta',
    'yellow',
    'white',
    'neutral',
    'black',
  ] as const;
  return targets.map((color) => ({
    color,
    cyan: 0,
    magenta: 0,
    yellow: 0,
    black: 0,
    method: 'relative' as const,
  }));
}

describe('SelectiveColorGrid', () => {
  it('renders 9 color target cells', () => {
    const onChange = () => {};
    render(<SelectiveColorGrid value={defaultParams()} onChange={onChange} />);
    expect(screen.getByText('Reds')).toBeTruthy();
    expect(screen.getByText('Greens')).toBeTruthy();
    expect(screen.getByText('Blues')).toBeTruthy();
    expect(screen.getByText('Cyans')).toBeTruthy();
    expect(screen.getByText('Magentas')).toBeTruthy();
    expect(screen.getByText('Yellows')).toBeTruthy();
    expect(screen.getByText('Whites')).toBeTruthy();
    expect(screen.getByText('Neutrals')).toBeTruthy();
    expect(screen.getByText('Blacks')).toBeTruthy();
  });

  it('adjusts a slider value', () => {
    let params: SelectiveColorParams[] = defaultParams();
    const onChange = (p: SelectiveColorParams[]) => {
      params = p;
    };
    render(<SelectiveColorGrid value={params} onChange={onChange} />);
    const cInputs = screen.getAllByLabelText('C');
    expect(cInputs.length).toBe(9);
    const firstC = cInputs[0] as HTMLInputElement;
    fireEvent.change(firstC, { target: { value: '50' } });
    fireEvent.keyDown(firstC, { key: 'Enter' });
    const redParams = params.find((p) => p.color === 'red');
    expect(redParams?.cyan).toBe(50);
  });

  it('switches method between Absolute and Relative', () => {
    let params: SelectiveColorParams[] = defaultParams();
    const onChange = (p: SelectiveColorParams[]) => {
      params = p;
    };
    render(<SelectiveColorGrid value={params} onChange={onChange} />);
    const absoluteBtn = screen.getByRole('radio', { name: /absolute/i });
    fireEvent.click(absoluteBtn);
    expect(params.every((p) => p.method === 'absolute')).toBe(true);
  });
});
