// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ColorSpaceSelector } from './ColorSpaceSelector';

afterEach(cleanup);

describe('ColorSpaceSelector', () => {
  it('renders all four space buttons', () => {
    render(<ColorSpaceSelector active="rgb" onChange={() => {}} />);
    expect(screen.getByRole('radio', { name: 'RGB' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'CMYK' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Grayscale' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Spot' })).toBeTruthy();
  });

  it('marks active space as checked', () => {
    render(<ColorSpaceSelector active="cmyk" onChange={() => {}} />);
    const cmykBtn = screen.getByRole('radio', { name: 'CMYK' });
    expect(cmykBtn.getAttribute('aria-checked')).toBe('true');
    const rgbBtn = screen.getByRole('radio', { name: 'RGB' });
    expect(rgbBtn.getAttribute('aria-checked')).toBe('false');
  });

  it('calls onChange when a button is clicked', () => {
    const onChange = vi.fn();
    render(<ColorSpaceSelector active="rgb" onChange={onChange} />);
    screen.getByRole('radio', { name: 'CMYK' }).click();
    expect(onChange).toHaveBeenCalledWith('cmyk');
  });
});
