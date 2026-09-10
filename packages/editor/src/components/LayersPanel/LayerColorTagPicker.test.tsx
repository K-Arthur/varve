import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LayerColorTagPicker } from './LayerColorTagPicker';

describe('LayerColorTagPicker', () => {
  it('exposes the canonical palette and assignment callbacks', () => {
    const colors: Array<string | null> = [];
    render(<LayerColorTagPicker includeClear onChange={(color) => colors.push(color)} />);

    expect(screen.getByRole('group', { name: 'Color tags' })).toBeTruthy();
    expect(screen.getByLabelText('Red')).toBeTruthy();
    expect(screen.getByLabelText('Gray')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Green'));
    fireEvent.click(screen.getByLabelText('Clear color tag'));
    expect(colors).toEqual(['green', null]);
  });

  it('communicates mixed selection and supports an untagged filter value', () => {
    const onChange = () => {};
    render(
      <LayerColorTagPicker
        value="mixed"
        includeNoTag
        ariaLabel="Filter by color tag"
        onChange={onChange}
      />,
    );

    expect(screen.getByRole('status')).toHaveTextContent('Mixed tags');
    expect(screen.getByLabelText('No color tag')).toHaveAttribute('aria-pressed', 'false');
  });
});
