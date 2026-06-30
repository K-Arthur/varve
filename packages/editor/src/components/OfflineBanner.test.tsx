import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OfflineBanner } from './OfflineBanner';

describe('OfflineBanner', () => {
  beforeEach(() => {
    // jsdom: navigator.onLine is true, and addEventListener exists.
    vi.stubGlobal('navigator', {
      onLine: true,
      addEventListener: window.addEventListener.bind(window),
      removeEventListener: window.removeEventListener.bind(window),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not render when online', () => {
    const { container } = render(<OfflineBanner />);
    expect(container.querySelector('.editor-offline-banner--visible')).toBeNull();
  });

  it('renders when offline', () => {
    vi.stubGlobal('navigator', {
      onLine: false,
      addEventListener: window.addEventListener.bind(window),
      removeEventListener: window.removeEventListener.bind(window),
    });
    const { container } = render(<OfflineBanner />);
    expect(container.querySelector('.editor-offline-banner--visible')).toBeTruthy();
  });

  it('appears when going offline and disappears when going online', () => {
    const { container } = render(<OfflineBanner />);
    expect(container.querySelector('.editor-offline-banner--visible')).toBeNull();

    fireEvent(window, new Event('offline'));
    expect(container.querySelector('.editor-offline-banner--visible')).toBeTruthy();

    fireEvent(window, new Event('online'));
    expect(container.querySelector('.editor-offline-banner--visible')).toBeNull();
  });

  it('can be dismissed with close button', () => {
    vi.stubGlobal('navigator', {
      onLine: false,
      addEventListener: window.addEventListener.bind(window),
      removeEventListener: window.removeEventListener.bind(window),
    });
    const { container } = render(<OfflineBanner />);
    expect(container.querySelector('.editor-offline-banner--visible')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /dismiss|close/i }));
    expect(container.querySelector('.editor-offline-banner--visible')).toBeNull();
  });

  it('has aria-live polite when visible', () => {
    vi.stubGlobal('navigator', {
      onLine: false,
      addEventListener: window.addEventListener.bind(window),
      removeEventListener: window.removeEventListener.bind(window),
    });
    render(<OfflineBanner />);
    const banner = screen.getByRole('status');
    expect(banner.getAttribute('aria-live')).toBe('polite');
  });
});
