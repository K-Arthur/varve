// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initWebsiteAnalytics } from '../lib/analytics';

function mountConsentUi() {
  document.body.innerHTML = `
    <aside id="website-analytics-consent" hidden>
      <button data-analytics-choice="denied">Not now</button>
      <button data-analytics-choice="granted">Allow</button>
    </aside>
  `;
}

beforeEach(() => {
  localStorage.clear();
  mountConsentUi();
  Object.defineProperty(navigator, 'globalPrivacyControl', {
    configurable: true,
    value: false,
  });
  Object.defineProperty(navigator, 'doNotTrack', { configurable: true, value: '0' });
  window.history.replaceState({}, '', '/docs?search=private-design');
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('website analytics consent boundary', () => {
  it('shows an equally actionable choice and sends nothing before consent', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    initWebsiteAnalytics({ domain: 'varve.studio', enabled: true });
    expect(document.getElementById('website-analytics-consent')?.hidden).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('sends a normalized page route only after explicit grant', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 202 }));
    initWebsiteAnalytics({ domain: 'varve.studio', enabled: true });
    document.querySelector<HTMLElement>('[data-analytics-choice="granted"]')?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const request = JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body));
    expect(request.name).toBe('pageview');
    expect(request.url).toBe(`${window.location.origin}/docs`);
    expect(request.url).not.toContain('search=private-design');
  });

  it('honors Global Privacy Control and does not show a consent prompt', () => {
    Object.defineProperty(navigator, 'globalPrivacyControl', {
      configurable: true,
      value: true,
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    initWebsiteAnalytics({ domain: 'varve.studio', enabled: true });
    expect(document.getElementById('website-analytics-consent')?.hidden).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('does not initialize when the deployment has no analytics domain', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    initWebsiteAnalytics({ domain: '', enabled: false });
    expect(document.getElementById('website-analytics-consent')?.hidden).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
