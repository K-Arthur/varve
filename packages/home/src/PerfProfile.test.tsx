import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PerfProfile } from './PerfProfile';

describe('PerfProfile', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.NODE_ENV = 'development';
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    vi.restoreAllMocks();
  });

  it('renders nothing in production', () => {
    process.env.NODE_ENV = 'production';
    const { container } = render(
      <PerfProfile fileCount={1} renderStartTime={0} searchResultCount={1} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows non-negative elapsed ms when start is on the performance.now timeline', () => {
    vi.spyOn(performance, 'now').mockReturnValue(1_250);
    render(<PerfProfile fileCount={3} renderStartTime={1_200} searchResultCount={2} />);

    expect(screen.getByLabelText('Performance profile')).toBeTruthy();
    expect(screen.getByText('50ms')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
  });

  it('does not show a wall-clock-sized negative duration for a performance-timeline start', () => {
    // Regression: HomeShell used to pass Date.now() while PerfProfile subtracted
    // from performance.now(), yielding ~-1.78e12 ms.
    const start = performance.now();
    render(<PerfProfile fileCount={1} renderStartTime={start} searchResultCount={1} />);

    const renderValue = screen.getByText(/ms$/).textContent ?? '';
    const ms = Number(renderValue.replace('ms', ''));
    expect(ms).toBeGreaterThanOrEqual(0);
    expect(ms).toBeLessThan(60_000);
  });
});
