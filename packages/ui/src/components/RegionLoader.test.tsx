import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RegionLoader } from './RegionLoader';

describe('RegionLoader', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('does not flash for work that settles before the delay', () => {
    const { rerender } = render(
      <RegionLoader loading label="Loading layers" delay={300}>
        <div>Layers</div>
      </RegionLoader>,
    );

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    rerender(
      <RegionLoader loading={false} label="Loading layers" delay={300}>
        <div>Layers</div>
      </RegionLoader>,
    );
    act(() => vi.advanceTimersByTime(300));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('shows a labelled overlay after the delay and removes it when done', () => {
    const { rerender } = render(
      <RegionLoader loading label="Loading layers" delay={100}>
        <div>Layers</div>
      </RegionLoader>,
    );

    act(() => vi.advanceTimersByTime(100));
    expect(screen.getByRole('status')).toHaveTextContent('Loading layers');
    expect(screen.getByText('Layers')).toBeInTheDocument();
    expect(screen.getByRole('status').closest('[aria-busy="true"]')).toBeTruthy();

    rerender(
      <RegionLoader loading={false} label="Loading layers" delay={100}>
        <div>Layers</div>
      </RegionLoader>,
    );
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
