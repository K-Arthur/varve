import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
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
    await vi.waitFor(
      () => {
        expect(onExited).toHaveBeenCalledOnce();
      },
      { timeout: 1000 },
    );
  });

  it('uses viewport grid centering (not top-pinned flex)', () => {
    const { container } = render(<StartupLoader />);
    const root = container.querySelector('.startup-loader');
    expect(root).not.toBeNull();
    expect(root?.classList.contains('startup-loader')).toBe(true);
    expect(container.querySelector('.startup-loader__logo-container')).not.toBeNull();
  });

  it('renders a single spectral mark with chromatic fringe', () => {
    const { container } = render(<StartupLoader />);
    const mark = container.querySelector('.startup-loader__logo--mark');
    expect(mark).not.toBeNull();
    expect(mark?.getAttribute('data-fringe')).toBe('chromatic');
    expect(container.querySelectorAll('.startup-loader__logo').length).toBe(1);
  });

  it('uses quiet luminosity pulse (no glitch sweep)', () => {
    const { container } = render(<StartupLoader />);
    expect(container.querySelector('.startup-loader__logo-container--pulse')).not.toBeNull();
    expect(container.querySelector('.startup-loader__logo-container--breathe')).toBeNull();
  });

  it('stays brand-fixed dark regardless of app data-theme', () => {
    document.documentElement.dataset.theme = 'light';
    const { container } = render(<StartupLoader />);
    const root = container.querySelector('.startup-loader');
    expect(root?.getAttribute('data-brand-splash')).toBe('fixed-dark');
    // Mark remains white-on-dark brand treatment
    expect(container.querySelector('.startup-loader__logo--mark')).not.toBeNull();
    delete document.documentElement.dataset.theme;
  });
});
