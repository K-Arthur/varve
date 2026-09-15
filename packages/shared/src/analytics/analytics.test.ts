import { describe, expect, it, vi } from 'vitest';
import {
  AnalyticsClient,
  type AnalyticsContext,
  type AnalyticsEvent,
  type AnalyticsProvider,
  DEFAULT_ANALYTICS_CONSENT,
  NoopAnalyticsProvider,
  sanitizeAnalyticsEvent,
} from './index';

const context: AnalyticsContext = {
  appVersion: '0.1.0',
  platform: 'linux',
  runtime: 'desktop',
  releaseChannel: 'dev',
};

function granted() {
  return {
    website: 'granted' as const,
    usage: 'granted' as const,
    diagnostics: 'granted' as const,
  };
}

class RecordingProvider implements AnalyticsProvider {
  events: AnalyticsEvent[] = [];
  initialize = vi.fn(async () => undefined);
  track = vi.fn((event: AnalyticsEvent) => this.events.push(event));
  flush = vi.fn(async () => undefined);
  shutdown = vi.fn(async () => undefined);
}

describe('analytics privacy boundary', () => {
  it('fails closed for unknown consent', () => {
    const client = new AnalyticsClient({ context, consent: DEFAULT_ANALYTICS_CONSENT });
    expect(client.track('feature_used', { feature: 'pen' })).toBe(false);
    expect(client.getQueueSize()).toBe(0);
  });

  it('rejects unknown and sensitive payload fields at runtime', () => {
    expect(
      sanitizeAnalyticsEvent(
        'feature_used',
        { feature: 'pen', filename: 'client.varve' } as never,
        context,
        Date.now(),
      ),
    ).toBeNull();
    expect(
      sanitizeAnalyticsEvent(
        'feature_used',
        { feature: 'not-a-feature' } as never,
        context,
        Date.now(),
      ),
    ).toBeNull();
  });

  it('only sends explicitly granted categories', async () => {
    const provider = new RecordingProvider();
    const client = new AnalyticsClient({
      context,
      consent: { website: 'denied', usage: 'granted', diagnostics: 'unknown' },
      provider,
    });
    expect(client.track('feature_used', { feature: 'pen' })).toBe(true);
    expect(client.track('website_page_viewed', { route: '/docs' })).toBe(false);
    await client.flush();
    expect(provider.events).toHaveLength(1);
    expect(provider.events[0]?.name).toBe('feature_used');
  });

  it('accepts the current website and browser-demo event contract', () => {
    expect(
      sanitizeAnalyticsEvent(
        'website_page_viewed',
        { route: '/try' },
        { ...context, runtime: 'web' },
        Date.now(),
      ),
    ).not.toBeNull();
    expect(
      sanitizeAnalyticsEvent(
        'website_contact_clicked',
        { channel: 'support' },
        { ...context, runtime: 'web' },
        Date.now(),
      ),
    ).not.toBeNull();
    expect(
      sanitizeAnalyticsEvent(
        'browser_demo_launched',
        { entry: 'website' },
        { ...context, runtime: 'web' },
        Date.now(),
      ),
    ).not.toBeNull();
    expect(
      sanitizeAnalyticsEvent(
        'browser_demo_desktop_download',
        {
          release: '0.1.0',
          platform: 'linux',
          architecture: 'x64',
          packageType: 'appimage',
        },
        { ...context, runtime: 'web' },
        Date.now(),
      ),
    ).not.toBeNull();
  });

  it('revocation discards pending events and shuts down the provider', () => {
    const provider = new RecordingProvider();
    const client = new AnalyticsClient({ context, consent: granted(), provider });
    client.track('feature_used', { feature: 'pen' });
    client.updateConsent({ website: 'denied', usage: 'denied', diagnostics: 'denied' });
    expect(client.getQueueSize()).toBe(0);
    expect(provider.shutdown).toHaveBeenCalled();
  });

  it('does not allow the no-op default to perform network work', async () => {
    const provider = new NoopAnalyticsProvider();
    const client = new AnalyticsClient({ context, consent: granted(), provider });
    client.track('feature_used', { feature: 'pen' });
    await client.flush();
    expect(client.getQueueSize()).toBe(0);
  });
});
