// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ColorSpaceSelector } from './ColorSpaceSelector';

afterEach(cleanup);

describe('ColorSpaceSelector', () => {
  it('renders all four space buttons', () => {
    render(<ColorSpaceSelector active="rgb" onChange={() => {}} />);
    expect(screen.getByRole('button', { name: 'RGB' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'CMYK' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Grayscale' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Spot' })).toBeTruthy();
  });

  it('marks active space as pressed', () => {
    render(<ColorSpaceSelector active="cmyk" onChange={() => {}} />);
    const cmykBtn = screen.getByRole('button', { name: 'CMYK' });
    expect(cmykBtn.getAttribute('aria-pressed')).toBe('true');
    const rgbBtn = screen.getByRole('button', { name: 'RGB' });
    expect(rgbBtn.getAttribute('aria-pressed')).toBe('false');
  });

  it('calls onChange when a button is clicked', () => {
    const onChange = vi.fn();
    render(<ColorSpaceSelector active="rgb" onChange={onChange} />);
    screen.getByRole('button', { name: 'CMYK' }).click();
    expect(onChange).toHaveBeenCalledWith('cmyk');
  });
});
