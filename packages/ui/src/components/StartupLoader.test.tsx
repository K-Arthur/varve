import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StartupLoader } from './StartupLoader';

describe('StartupLoader', () => {
  it('renders with role status when not ready', () => {
    render(<StartupLoader />);
    expect(screen.getByRole('status')).toBeDefined();
  });

  it('sets --exiting class when ready', () => {
    const { container } = render(<StartupLoader ready />);
    expect(container.querySelector('.startup-loader--exiting')).toBeDefined();
  });

  it('renders error state when error provided', () => {
    render(<StartupLoader error="Something failed" onRetry={() => {}} />);
    expect(screen.getByRole('alert')).toBeDefined();
    expect(screen.getByText('Something failed')).toBeDefined();
    expect(screen.getByText('Retry Startup')).toBeDefined();
  });

  it('adds simplified class when simplified prop is true', () => {
    const { container } = render(<StartupLoader simplified />);
    expect(container.querySelector('.startup-loader--simplified')).toBeDefined();
  });

  it('fires onExited callback after exit animation', async () => {
    const onExited = vi.fn();
    render(<StartupLoader ready onExited={onExited} />);
    // Default exit is 250ms via --duration-base; wait for timeout
    await vi.waitFor(
      () => {
        expect(onExited).toHaveBeenCalledOnce();
      },
      { timeout: 1000 },
    );
  });
});
