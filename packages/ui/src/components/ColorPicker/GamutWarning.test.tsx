// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { GamutWarning } from './GamutWarning';

afterEach(cleanup);

describe('GamutWarning', () => {
  it('renders warning for high-saturation green', () => {
    render(<GamutWarning r={0} g={255} b={0} />);
    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.getByText(/Out of CMYK gamut/i)).toBeTruthy();
  });

  it('does not render warning for gray', () => {
    render(<GamutWarning r={128} g={128} b={128} />);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('does not render warning for dark saturated color', () => {
    render(<GamutWarning r={30} g={0} b={0} />);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('does not render warning for low saturation bright color', () => {
    render(<GamutWarning r={200} g={200} b={200} />);
    expect(screen.queryByRole('status')).toBeNull();
  });
});
