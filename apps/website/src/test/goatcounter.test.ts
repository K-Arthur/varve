import type { AnalyticsEvent } from '@varve/shared';
import { describe, expect, it, vi } from 'vitest';
import {
  GoatCounterProvider,
  pathWithCampaign,
  safeGoatCounterDomain,
  websiteCampaignRef,
  websiteReferrer,
} from '../lib/goatcounter';

function event(name: 'website_page_viewed' | 'website_download_started'): AnalyticsEvent {
  return {
    schemaVersion: 1,
    name,
    category: 'website',
    payload:
      name === 'website_page_viewed'
        ? { route: '/download' }
        : {
            release: '0.2.1',
            platform: 'linux',
            architecture: 'x64',
            packageType: 'appimage',
            releaseChannel: 'beta',
          },
    context: {
      appVersion: 'website',
      platform: 'unknown',
      runtime: 'web',
      releaseChannel: 'production',
    },
    occurredAt: 0,
  };
}

function fixture(search = '') {
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 202 }));
  let allowed = true;
  const provider = new GoatCounterProvider({
    domain: 'varve-test.goatcounter.com',
    canSend: () => allowed,
    route: () => '/download',
    referrer: () => 'https://example.org',
    search: () => search,
    fetchImpl,
  });
  return {
    provider,
    fetchImpl,
    deny: () => {
      allowed = false;
    },
  };
}

describe('minimal GoatCounter website transport', () => {
  it('accepts only a bare hosted account hostname', () => {
    expect(safeGoatCounterDomain('varve-test.goatcounter.com')).toBe('varve-test.goatcounter.com');
    for (const input of [
      '',
      'varve.studio',
      'https://varve.goatcounter.com',
      'user@varve.goatcounter.com',
      'varve.goatcounter.com.evil.test',
      'varve.goatcounter.com?secret=x',
    ]) {
      expect(safeGoatCounterDomain(input)).toBeNull();
    }
  });

  it('reduces external referrers to origins and drops internal or invalid ones', () => {
    expect(websiteReferrer('https://example.org/a?private=1#secret', 'https://varve.studio')).toBe(
      'https://example.org',
    );
    const credentialFixture = new URL('https://example.org/path');
    credentialFixture.username = 'fixture';
    credentialFixture.password = 'fixture';
    expect(websiteReferrer(credentialFixture.href, 'https://varve.studio')).toBe(
      'https://example.org',
    );
    expect(websiteReferrer('https://varve.studio/docs?q=private', 'https://varve.studio')).toBe('');
    expect(websiteReferrer('javascript:private', 'https://varve.studio')).toBe('');
  });

  it('sends only page category, source origin, and mandatory no-session flag', async () => {
    const { provider, fetchImpl } = fixture();
    provider.track(event('website_page_viewed'));
    await provider.flush();
    const [target, options] = fetchImpl.mock.calls[0]!;
    const query = Object.fromEntries(new URL(String(target)).searchParams);
    expect(query).toEqual({ p: '/download', ns: 'true', r: 'https://example.org' });
    expect(options).toMatchObject({
      method: 'POST',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      keepalive: true,
    });
    expect(options?.body).toBeUndefined();
  });

  it('labels installer events as clicks and never sends document context', async () => {
    const { provider, fetchImpl } = fixture();
    provider.track(event('website_download_started'));
    await provider.flush();
    expect(Object.fromEntries(new URL(String(fetchImpl.mock.calls[0]![0])).searchParams)).toEqual({
      p: 'website_download_clicked|/download|linux|x64|appimage|0.2.1|beta',
      ns: 'true',
      e: 'true',
    });
  });

  it('keeps an allowlisted campaign ref on the path and drops every other query param', async () => {
    expect(websiteCampaignRef('?ref=masto-p1&utm_source=evil&q=secret')).toBe('masto-p1');
    expect(pathWithCampaign('/download', '?ref=bsky-p1&next=/admin')).toBe('/download?ref=bsky-p1');
    const { provider, fetchImpl } = fixture('?ref=masto-p1&utm_campaign=other&token=secret');
    provider.track(event('website_page_viewed'));
    await provider.flush();
    const query = Object.fromEntries(new URL(String(fetchImpl.mock.calls[0]![0])).searchParams);
    expect(query).toEqual({ p: '/download?ref=masto-p1', ns: 'true', r: 'https://example.org' });
    expect(String(fetchImpl.mock.calls[0]![0])).not.toContain('utm_campaign');
    expect(String(fetchImpl.mock.calls[0]![0])).not.toContain('token');
    expect(String(fetchImpl.mock.calls[0]![0])).not.toContain('secret');
  });

  it('drops an unknown campaign ref and never forwards other query params', async () => {
    expect(websiteCampaignRef('?ref=unknown-channel&fbclid=1')).toBeNull();
    expect(pathWithCampaign('/docs', '?ref=not-ours&q=private')).toBe('/docs');
    const { provider, fetchImpl } = fixture('?ref=unknown-channel&q=private-design');
    provider.track(event('website_page_viewed'));
    await provider.flush();
    const query = Object.fromEntries(new URL(String(fetchImpl.mock.calls[0]![0])).searchParams);
    expect(query).toEqual({ p: '/download', ns: 'true', r: 'https://example.org' });
    expect(String(fetchImpl.mock.calls[0]![0])).not.toContain('unknown-channel');
    expect(String(fetchImpl.mock.calls[0]![0])).not.toContain('private-design');
  });

  it('drops events when consent is withdrawn before flushing', async () => {
    const { provider, fetchImpl, deny } = fixture();
    provider.track(event('website_page_viewed'));
    deny();
    await provider.flush();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('sends nothing without consent even when an allowlisted campaign ref is present', async () => {
    const { provider, fetchImpl, deny } = fixture('?ref=masto-p1');
    deny();
    provider.track(event('website_page_viewed'));
    await provider.flush();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('drops pending data on shutdown and ignores non-allowed website events', async () => {
    const { provider, fetchImpl } = fixture();
    provider.track(event('website_page_viewed'));
    await provider.shutdown();
    provider.track({
      ...event('website_page_viewed'),
      name: 'website_contact_clicked',
      payload: { channel: 'privacy' },
    });
    await provider.flush();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('never retries failed transport and bounds queued events', async () => {
    const { provider, fetchImpl } = fixture();
    fetchImpl.mockRejectedValue(new Error('blocked'));
    for (let i = 0; i < 30; i++) provider.track(event('website_page_viewed'));
    await provider.flush();
    await provider.flush();
    expect(fetchImpl).toHaveBeenCalledTimes(25);
  });
});
