// @vitest-environment jsdom

import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { UnitSelector } from './UnitSelector';

describe('UnitSelector', () => {
  it('renders all unit options', () => {
    const onChange = vi.fn();
    const { container } = render(<UnitSelector value="px" onChange={onChange} />);
    const btns = container.querySelectorAll('[role="radio"]');
    expect(btns.length).toBe(4);
  });

  it('marks active unit as checked', () => {
    const onChange = vi.fn();
    const { container } = render(<UnitSelector value="rem" onChange={onChange} />);
    const active = container.querySelector('[aria-checked="true"]');
    expect(active?.textContent).toBe('rem');
  });
});
