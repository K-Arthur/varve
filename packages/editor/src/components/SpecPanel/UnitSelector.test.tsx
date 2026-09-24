// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { UnitSelector } from './UnitSelector';

describe('UnitSelector', () => {
  it('renders all unit options', () => {
    const onChange = vi.fn();
    render(<UnitSelector value="px" onChange={onChange} />);
    expect(screen.getAllByRole('radio')).toHaveLength(4);
  });

  it('marks active unit as checked', () => {
    const onChange = vi.fn();
    render(<UnitSelector value="rem" onChange={onChange} />);
    expect(screen.getByRole('radio', { name: 'rem' })).toBeChecked();
  });
});
