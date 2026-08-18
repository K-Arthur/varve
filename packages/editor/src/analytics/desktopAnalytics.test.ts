import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  configureDesktopAnalytics,
  durationBucket,
  hasConfiguredAnalyticsEndpoint,
  resetDesktopAnalyticsForTests,
  startDesktopFlushTimer,
  stopDesktopFlushTimer,
} from './desktopAnalytics';

describe('desktop Plausible analytics adapter', () => {
  beforeEach(() => {
    resetDesktopAnalyticsForTests();
    vi.restoreAllMocks();
  });

  it('sends only after usage consent and keeps the payload aggregate', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    const client = configureDesktopAnalytics({ domain: 'varve.studio' });

    expect(client.track('feature_used', { feature: 'pen' })).toBe(false);
    client.updateConsent({ website: 'denied', usage: 'granted', diagnostics: 'denied' });
    expect(client.track('feature_used', { feature: 'pen' })).toBe(true);
    await client.flush();

    expect(fetchMock).toHaveBeenCalledOnce();
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(request.body)) as {
      domain: string;
      name: string;
      url: string;
      props: Record<string, string>;
    };
    expect(body.domain).toBe('varve.studio');
    expect(body.name).toBe('feature_used');
    expect(body.url).toBe('https://varve.studio/app');
    expect(body.props).toMatchObject({ feature: 'pen', platform: 'unknown' });
    expect(body.props).not.toHaveProperty('filename');
    expect(body.props).not.toHaveProperty('path');
  });

  it('does not create a provider for an invalid domain', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const client = configureDesktopAnalytics({ domain: 'https://not-a-domain' });

    client.updateConsent({ website: 'denied', usage: 'granted', diagnostics: 'denied' });
    client.track('app_launched', { surface: 'desktop' });
    await client.flush();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  describe('hasConfiguredAnalyticsEndpoint', () => {
    it('returns false when no endpoint or domain is configured', () => {
      configureDesktopAnalytics({});
      expect(hasConfiguredAnalyticsEndpoint()).toBe(false);
    });

    it('returns false for an invalid domain', () => {
      configureDesktopAnalytics({ domain: 'https://not-a-domain' });
      expect(hasConfiguredAnalyticsEndpoint()).toBe(false);
    });

    it('returns true when a valid domain is configured', () => {
      configureDesktopAnalytics({ domain: 'varve.studio' });
      expect(hasConfiguredAnalyticsEndpoint()).toBe(true);
    });

    it('returns true when an endpoint is configured', () => {
      configureDesktopAnalytics({ endpoint: 'https://example.com/api/event' });
      expect(hasConfiguredAnalyticsEndpoint()).toBe(true);
    });

    it('resets to false after resetDesktopAnalyticsForTests', () => {
      configureDesktopAnalytics({ domain: 'varve.studio' });
      expect(hasConfiguredAnalyticsEndpoint()).toBe(true);
      resetDesktopAnalyticsForTests();
      expect(hasConfiguredAnalyticsEndpoint()).toBe(false);
    });
  });

  describe('durationBucket', () => {
    it('buckets durations correctly', () => {
      expect(durationBucket(0)).toBe('under_16ms');
      expect(durationBucket(15)).toBe('under_16ms');
      expect(durationBucket(16)).toBe('16_33ms');
      expect(durationBucket(32)).toBe('16_33ms');
      expect(durationBucket(33)).toBe('33_50ms');
      expect(durationBucket(49)).toBe('33_50ms');
      expect(durationBucket(50)).toBe('50_100ms');
      expect(durationBucket(99)).toBe('50_100ms');
      expect(durationBucket(100)).toBe('100_250ms');
      expect(durationBucket(249)).toBe('100_250ms');
      expect(durationBucket(250)).toBe('over_250ms');
      expect(durationBucket(5000)).toBe('over_250ms');
    });
  });

  describe('flush timer', () => {
    it('starts and stops without error', () => {
      vi.useFakeTimers();
      startDesktopFlushTimer();
      stopDesktopFlushTimer();
      vi.useRealTimers();
    });

    it('is idempotent on start', () => {
      vi.useFakeTimers();
      startDesktopFlushTimer();
      startDesktopFlushTimer();
      stopDesktopFlushTimer();
      vi.useRealTimers();
    });
  });
});
