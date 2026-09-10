/**
 * Demo-mode detection — pure URL classification, no DOM required.
 */
import { describe, expect, it, vi } from 'vitest';
import { DEMO_PATH_MARKER, detectDemoMode, isDemoPathname, isDemoQuery } from './demoMode';

const TYPICAL_ORIGIN = 'https://varve.studio';

describe('demo mode detection', () => {
  it('detects the production /try path', () => {
    expect(detectDemoMode(`${TYPICAL_ORIGIN}${DEMO_PATH_MARKER}/`).active).toBe(true);
    expect(detectDemoMode(`${TYPICAL_ORIGIN}${DEMO_PATH_MARKER}`).active).toBe(true);
  });

  it('detects ?try=1 and ?demo=1 query params (dev servers, E2E)', () => {
    expect(detectDemoMode(`${TYPICAL_ORIGIN}/?try=1`).active).toBe(true);
    expect(detectDemoMode(`${TYPICAL_ORIGIN}/?demo=1`).active).toBe(true);
    expect(detectDemoMode(`${TYPICAL_ORIGIN}/?surface=panel-window&try=1`).active).toBe(true);
  });

  it('is inert on the normal app URL and unrelated paths', () => {
    expect(detectDemoMode(`${TYPICAL_ORIGIN}/`).active).toBe(false);
    expect(detectDemoMode(`${TYPICAL_ORIGIN}/download/`).active).toBe(false);
    expect(detectDemoMode('https://example.com/').active).toBe(false);
  });

  it('classifies /try path regardless of origin (path-based detection)', () => {
    expect(detectDemoMode('https://example.com/try/').active).toBe(true);
    expect(detectDemoMode('http://localhost:1420/try/').active).toBe(true);
  });

  it('never activates under Tauri, regardless of URL', () => {
    vi.stubGlobal('__TAURI_INTERNALS__', {});
    try {
      expect(detectDemoMode(`${TYPICAL_ORIGIN}${DEMO_PATH_MARKER}/`).active).toBe(false);
      expect(detectDemoMode(`${TYPICAL_ORIGIN}/?try=1`).active).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
    // Sanity: the same URLs classify as demo without the Tauri global.
    expect(detectDemoMode(`${TYPICAL_ORIGIN}${DEMO_PATH_MARKER}/`).active).toBe(true);
  });

  it('classifies pathname and query helpers independently', () => {
    expect(isDemoPathname('/try')).toBe(true);
    expect(isDemoPathname('/try/')).toBe(true);
    expect(isDemoPathname('/try/anything')).toBe(true);
    expect(isDemoPathname('/tryhard')).toBe(false);
    expect(isDemoPathname('/')).toBe(false);
    expect(isDemoQuery('?try=1')).toBe(true);
    expect(isDemoQuery('?demo=1')).toBe(true);
    expect(isDemoQuery('?try=0')).toBe(true);
    expect(isDemoQuery('?doc=1')).toBe(false);
    expect(isDemoQuery('')).toBe(false);
  });

  it('defaults the download CTA to the website download page', () => {
    const cfg = detectDemoMode(`${TYPICAL_ORIGIN}/try/`);
    expect(cfg.downloadUrl).toBe('https://varve.studio/download');
  });

  it('honors VITE_DEMO_DOWNLOAD_URL when provided', () => {
    const cfg = detectDemoMode(`${TYPICAL_ORIGIN}/try/`, {
      VITE_DEMO_DOWNLOAD_URL: 'https://example.com/get-varve',
    });
    expect(cfg.downloadUrl).toBe('https://example.com/get-varve');
  });
});
