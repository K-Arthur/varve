// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initWebsiteAnalytics } from '../lib/analytics';

type PlausibleTestClient = {
  o?: Record<string, unknown>;
  q?: Array<
    [string, { u?: string; props?: Record<string, string>; interactive?: boolean } | undefined]
  >;
};

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
  document.querySelector('script[data-varve-plausible="true"]')?.remove();
  delete (window as Window & { plausible?: unknown }).plausible;
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
    initWebsiteAnalytics({ domain: 'varve.studio', enabled: true });
    document.querySelector<HTMLElement>('[data-analytics-choice="granted"]')?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const script = document.querySelector<HTMLScriptElement>('script[data-varve-plausible="true"]');
    expect(script?.src).toBe('https://plausible.io/js/pa-9Rpt-MZjJts8awPbiRZl3.js');
    const plausible = (window as Window & { plausible?: PlausibleTestClient }).plausible;
    expect(plausible?.o).toMatchObject({
      domain: 'varve.studio',
      autoCapturePageviews: false,
      fileDownloads: false,
      outboundLinks: false,
      formSubmissions: false,
    });
    expect(plausible?.q?.[0]?.[0]).toBe('pageview');
    expect(plausible?.q?.[0]?.[1]?.u).toBe(`${window.location.origin}/docs`);
    expect(plausible?.q?.[0]?.[1]?.u).not.toContain('search=private-design');
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
