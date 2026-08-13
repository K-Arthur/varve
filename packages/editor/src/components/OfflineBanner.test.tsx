// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OfflineBanner } from './OfflineBanner';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function setOnline(value: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value });
}

describe('OfflineBanner', () => {
  it('is hidden and inert while online', () => {
    setOnline(true);
    render(<OfflineBanner />);
    const banner = screen.getByRole('status', { hidden: true });
    expect(banner).toHaveAttribute('aria-hidden', 'true');
    expect(banner).toHaveAttribute('inert');
  });

  it('appears with an honest local-first message when going offline', () => {
    setOnline(true);
    render(<OfflineBanner />);
    fireEvent(window, new Event('offline'));
    const banner = screen.getByRole('status', { hidden: true });
    expect(banner).toHaveAttribute('aria-hidden', 'false');
    expect(banner).not.toHaveAttribute('inert');
    // Local-first copy: document and tools keep working; no fake "will sync".
    expect(banner.textContent).toMatch(/all tools keep working locally/);
    expect(banner.textContent).not.toMatch(/sync/i);
  });

  it('dismisses for the current offline period and reappears on the next outage', () => {
    setOnline(true);
    render(<OfflineBanner />);
    fireEvent(window, new Event('offline'));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss offline notice' }));
    expect(screen.getByRole('status', { hidden: true })).toHaveAttribute('aria-hidden', 'true');

    // Reconnect, then go offline again → the notice returns.
    fireEvent(window, new Event('online'));
    fireEvent(window, new Event('offline'));
    expect(screen.getByRole('status', { hidden: true })).toHaveAttribute('aria-hidden', 'false');
  });
});
