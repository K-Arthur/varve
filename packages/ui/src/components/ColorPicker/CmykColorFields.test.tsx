// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { ManagedColor } from '@strata/scene';
import { CmykColorFields } from './CmykColorFields';

afterEach(cleanup);

describe('CmykColorFields', () => {
  const cmykColor: ManagedColor & { space: 'cmyk' } = {
    space: 'cmyk',
    c: 0,
    m: 128,
    y: 255,
    k: 0,
    a: 255,
  };

  it('renders C, M, Y, K, A spinbuttons', () => {
    render(<CmykColorFields value={cmykColor} onChange={() => {}} />);
    expect(screen.getByRole('spinbutton', { name: 'C' })).toBeTruthy();
    expect(screen.getByRole('spinbutton', { name: 'M' })).toBeTruthy();
    expect(screen.getByRole('spinbutton', { name: 'Y' })).toBeTruthy();
    expect(screen.getByRole('spinbutton', { name: 'K' })).toBeTruthy();
    expect(screen.getByRole('spinbutton', { name: 'A' })).toBeTruthy();
  });
});
