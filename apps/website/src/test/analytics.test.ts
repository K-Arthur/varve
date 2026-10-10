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
  delete (window as Window & { __varveWebsiteAnalytics?: unknown }).__varveWebsiteAnalytics;
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 202 }));
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
  delete (window as Window & { __varveWebsiteAnalytics?: unknown }).__varveWebsiteAnalytics;
  document.body.innerHTML = '';
});

describe('website analytics consent boundary', () => {
  it('shows an equally actionable choice and sends nothing before consent', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    initWebsiteAnalytics({ domain: 'varve-test.goatcounter.com', enabled: true });
    expect(document.getElementById('website-analytics-consent')?.hidden).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('sends a normalized page route only after explicit grant', async () => {
    initWebsiteAnalytics({ domain: 'varve-test.goatcounter.com', enabled: true });
    document.querySelector<HTMLElement>('[data-analytics-choice="granted"]')?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.querySelector('script[data-varve-plausible]')).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
    const [request, options] = vi.mocked(fetch).mock.calls[0]!;
    const url = new URL(String(request));
    expect(url.origin).toBe('https://varve-test.goatcounter.com');
    expect(url.searchParams.get('p')).toBe('/docs');
    expect(url.searchParams.get('ns')).toBe('true');
    expect(url.searchParams.has('q')).toBe(false);
    expect(url.searchParams.has('s')).toBe(false);
    expect(String(request)).not.toContain('private-design');
    expect(options).toMatchObject({ credentials: 'omit', referrerPolicy: 'no-referrer' });
  });

  it('forwards only an allowlisted campaign ref after consent', async () => {
    window.history.replaceState({}, '', '/download?ref=masto-p1&utm_source=other&q=secret');
    initWebsiteAnalytics({ domain: 'varve-test.goatcounter.com', enabled: true });
    document.querySelector<HTMLElement>('[data-analytics-choice="granted"]')?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetch).toHaveBeenCalledTimes(1);
    const url = new URL(String(vi.mocked(fetch).mock.calls[0]![0]));
    expect(url.searchParams.get('p')).toBe('/download?ref=masto-p1');
    expect(String(url)).not.toContain('utm_source');
    expect(String(url)).not.toContain('secret');
  });

  it('honors Global Privacy Control and does not show a consent prompt', () => {
    Object.defineProperty(navigator, 'globalPrivacyControl', {
      configurable: true,
      value: true,
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    initWebsiteAnalytics({ domain: 'varve-test.goatcounter.com', enabled: true });
    expect(document.getElementById('website-analytics-consent')?.hidden).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('does not initialize when the deployment has no analytics domain', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    initWebsiteAnalytics({ domain: '', enabled: false });
    expect(document.getElementById('website-analytics-consent')?.hidden).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it('does not transfer a grant to the previous analytics provider', () => {
    localStorage.setItem('varve:website-analytics-consent', 'granted');
    initWebsiteAnalytics({ domain: 'varve-test.goatcounter.com', enabled: true });
    expect(document.getElementById('website-analytics-consent')?.hidden).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps a previous refusal and honors DNT even after clicking Allow', async () => {
    localStorage.setItem('varve:website-analytics-consent', 'denied');
    Object.defineProperty(navigator, 'doNotTrack', { configurable: true, value: '1' });
    initWebsiteAnalytics({ domain: 'varve-test.goatcounter.com', enabled: true });
    document.querySelector<HTMLElement>('[data-analytics-choice="granted"]')?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetch).not.toHaveBeenCalled();
  });

  it('initializes once and counts a page only once after repeated grants', async () => {
    initWebsiteAnalytics({ domain: 'varve-test.goatcounter.com', enabled: true });
    initWebsiteAnalytics({ domain: 'varve-test.goatcounter.com', enabled: true });
    const allow = document.querySelector<HTMLElement>('[data-analytics-choice="granted"]');
    allow?.click();
    allow?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
