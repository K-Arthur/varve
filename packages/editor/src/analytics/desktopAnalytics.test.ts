import { beforeEach, describe, expect, it, vi } from 'vitest';
import { configureDesktopAnalytics, resetDesktopAnalyticsForTests } from './desktopAnalytics';

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
});
