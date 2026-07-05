// @vitest-environment jsdom

import type { ManagedColor } from '@strata/scene';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { GrayColorFields } from './GrayColorFields';

afterEach(cleanup);

describe('GrayColorFields', () => {
  const grayColor: ManagedColor & { space: 'gray' } = { space: 'gray', v: 128, a: 255 };

  it('renders Gray and A spinbuttons', () => {
    render(<GrayColorFields value={grayColor} onChange={() => {}} />);
    expect(screen.getByRole('spinbutton', { name: 'Gray' })).toBeTruthy();
    expect(screen.getByRole('spinbutton', { name: 'A' })).toBeTruthy();
  });
});
