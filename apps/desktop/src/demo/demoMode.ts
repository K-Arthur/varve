/**
 * Browser-demo ("try in browser") mode detection and configuration.
 *
 * The demo is the same editor frontend served from a sub-path of the public
 * site (e.g. https://varve.studio/try/) — no Tauri shell, no separate app.
 * Demo mode is a runtime property of the page, never of the build:
 *
 *   - served from a /try path (production deployment), or
 *   - `?try=1` / `?demo=1` in the URL (dev servers and E2E harnesses).
 *
 * It is inert under Tauri and on every other URL, so the desktop app and the
 * existing web surfaces (Home-first boot) are unaffected.
 */

export const DEMO_PATH_MARKER = '/try';

export interface DemoConfig {
  /** True when this page load is the public browser demo. */
  active: boolean;
  /** Where the "Download desktop" CTA points (absolute URL). */
  downloadUrl: string;
  /** Reason string recorded for startup marks / diagnostics. */
  label: string;
}

const DEFAULT_DOWNLOAD_URL = 'https://varve.studio/download';

interface DemoEnv {
  VITE_DEMO_DOWNLOAD_URL?: string;
}

function readEnv(): DemoEnv {
  return ((import.meta as ImportMeta & { env?: DemoEnv }).env ?? {}) as DemoEnv;
}

export function isDemoPathname(pathname: string): boolean {
  return pathname === DEMO_PATH_MARKER || pathname.startsWith(`${DEMO_PATH_MARKER}/`);
}

export function isDemoQuery(search: string): boolean {
  const params = new URLSearchParams(search);
  return params.has('try') || params.has('demo');
}

/** Detect demo mode from a URL (injectable for tests). */
export function detectDemoMode(href?: string, env: DemoEnv = readEnv()): DemoConfig {
  const url = href ? new URL(href) : new URL(globalThis.location.href);
  const active =
    typeof globalThis !== 'undefined' && '__TAURI_INTERNALS__' in globalThis
      ? false
      : isDemoPathname(url.pathname) || isDemoQuery(url.search);
  return {
    active,
    downloadUrl: env.VITE_DEMO_DOWNLOAD_URL?.trim() || DEFAULT_DOWNLOAD_URL,
    label: active ? 'demo' : 'standard',
  };
}

export const demoMode = (): DemoConfig => detectDemoMode();
