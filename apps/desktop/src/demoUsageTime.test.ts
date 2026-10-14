// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createUsageTimeTracker } from './demoUsageTime';

describe('demoUsageTime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    // Reset localStorage
    localStorage.clear();
    // Reset document.hidden
    Object.defineProperty(document, 'hidden', {
      writable: true,
      value: false,
    });
    // Mock sendBeacon (not available in jsdom)
    if (!navigator.sendBeacon) {
      Object.defineProperty(navigator, 'sendBeacon', {
        writable: true,
        value: vi.fn(() => true),
      });
    }
    vi.spyOn(navigator, 'sendBeacon').mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('does not track without consent', () => {
    const tracker = createUsageTimeTracker();
    tracker.start();

    // Trigger activity and advance time
    document.dispatchEvent(new Event('mousedown'));
    vi.advanceTimersByTime(5000);

    tracker.stop();

    expect(navigator.sendBeacon).not.toHaveBeenCalled();
  });

  it('tracks usage time with consent', () => {
    localStorage.setItem('varve-analytics-consent', 'granted');

    const tracker = createUsageTimeTracker();
    tracker.start();

    // Trigger initial activity
    document.dispatchEvent(new Event('mousedown'));

    // Simulate some active time
    vi.advanceTimersByTime(120_000);

    tracker.stop();

    expect(navigator.sendBeacon).toHaveBeenCalledOnce();
    const callArgs = (navigator.sendBeacon as any).mock.calls[0];
    const url = new URL(callArgs[0]);
    const bucket = url.searchParams.get('p');
    // Should send a time bucket event
    expect(bucket).toMatch(/^demo-time-/);
  });

  it('respects DNT signal', () => {
    localStorage.setItem('varve-analytics-consent', 'granted');
    Object.defineProperty(navigator, 'doNotTrack', {
      writable: true,
      configurable: true,
      value: '1',
    });

    const tracker = createUsageTimeTracker();
    tracker.start();

    document.dispatchEvent(new Event('mousedown'));
    vi.advanceTimersByTime(60_000);

    tracker.stop();

    expect(navigator.sendBeacon).not.toHaveBeenCalled();

    // Clean up
    Object.defineProperty(navigator, 'doNotTrack', {
      writable: true,
      configurable: true,
      value: undefined,
    });
  });

  it('respects GPC signal', () => {
    localStorage.setItem('varve-analytics-consent', 'granted');
    (navigator as any).globalPrivacyControl = true;

    const tracker = createUsageTimeTracker();
    tracker.start();

    document.dispatchEvent(new Event('mousedown'));
    vi.advanceTimersByTime(60_000);

    tracker.stop();

    expect(navigator.sendBeacon).not.toHaveBeenCalled();

    delete (navigator as any).globalPrivacyControl;
  });

  it('sends time bucket events', () => {
    localStorage.setItem('varve-analytics-consent', 'granted');

    const tracker = createUsageTimeTracker();
    tracker.start();
    // Trigger activity
    document.dispatchEvent(new Event('mousedown'));
    vi.advanceTimersByTime(30_000);
    tracker.stop();

    expect(navigator.sendBeacon).toHaveBeenCalledOnce();
    const callArgs = (navigator.sendBeacon as any).mock.calls[0];
    const url = new URL(callArgs[0]);
    const bucket = url.searchParams.get('p');
    // Verify it's a valid time bucket
    expect(bucket).toMatch(/^demo-time-(lt1m|1-5m|5-15m|15-30m|30m-plus)$/);
  });

  it('pauses tracking when tab is hidden', () => {
    localStorage.setItem('varve-analytics-consent', 'granted');

    const tracker = createUsageTimeTracker();
    tracker.start();

    // Trigger initial activity
    document.dispatchEvent(new Event('mousedown'));

    // 1 minute active
    vi.advanceTimersByTime(60_000);

    // Hide tab
    Object.defineProperty(document, 'hidden', { value: true });
    document.dispatchEvent(new Event('visibilitychange'));

    // 2 minutes hidden (should not count)
    vi.advanceTimersByTime(120_000);

    // Show tab again
    Object.defineProperty(document, 'hidden', { value: false });
    document.dispatchEvent(new Event('visibilitychange'));

    // Trigger activity again
    document.dispatchEvent(new Event('mousedown'));

    // 1 more minute active
    vi.advanceTimersByTime(60_000);

    tracker.stop();

    expect(navigator.sendBeacon).toHaveBeenCalledOnce();
    const callArgs = (navigator.sendBeacon as any).mock.calls[0];
    const url = new URL(callArgs[0]);
    const bucket = url.searchParams.get('p');
    // Should be ~2 minutes (1m + 1m), not 4 minutes total
    expect(bucket).toMatch(/demo-time-(lt1m|1-5m)/);
  });

  it('sends beacon only once per session', () => {
    localStorage.setItem('varve-analytics-consent', 'granted');

    const tracker = createUsageTimeTracker();
    tracker.start();

    // Trigger activity
    document.dispatchEvent(new Event('mousedown'));
    vi.advanceTimersByTime(60_000);

    tracker.stop();
    tracker.stop(); // Call stop again

    expect(navigator.sendBeacon).toHaveBeenCalledOnce();
  });

  it('does not send beacon if no active time', () => {
    localStorage.setItem('varve-analytics-consent', 'granted');

    const tracker = createUsageTimeTracker();
    tracker.start();

    // Immediately stop without any time passing
    tracker.stop();

    expect(navigator.sendBeacon).not.toHaveBeenCalled();
  });
});
