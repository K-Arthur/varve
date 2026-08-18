import './global.css';
import '@varve/ui/tokens.css';
import '@varve/editor/editor.css';
import '@varve/home/home.css';
import '@fontsource-variable/geist/index.css';
import '@fontsource-variable/ibm-plex-sans/index.css';
// Editorial serif (--font-editorial). Brand surfaces only — the wordmark and
// the welcome screen — never interface chrome, which stays on Geist. The
// `opsz` build carries weight + optical size; see the type system note in
// packages/ui/src/tokens/tokens.css.
import '@fontsource-variable/fraunces/opsz.css';

import { ErrorBoundary } from '@varve/editor';
import { AuxiliaryRoot } from '@varve/editor/auxiliary';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { demoMode } from './demo/demoMode';
import { installStaleAssetGuard } from './demo/staleAssetGuard';
import { initCspDiagnostics } from './security/cspDiagnostics';
import { dismissBootFallback } from './startup/revealMainWindow';

if ((import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV) {
  initCspDiagnostics();
}

// requestIdleCallback is not available in WebKitGTK (Linux Tauri).
// Polyfill so code using `requestIdleCallback?.()` doesn't throw in strict mode.
if (typeof globalThis.requestIdleCallback === 'undefined') {
  globalThis.requestIdleCallback = (cb: IdleRequestCallback, opts?: IdleRequestOptions) => {
    const id = setTimeout(
      () => cb({ didTimeout: false, timeRemaining: () => 0 }),
      opts?.timeout ?? 1,
    );
    return typeof id === 'object' ? 0 : id;
  };
  globalThis.cancelIdleCallback = (id: number) => clearTimeout(id);
}

async function bootstrap() {
  // The test bridge is excluded from normal builds by Vite's mode replacement.
  // It must load before React so WDIO can inspect a genuinely interactive window.
  const buildMode = (import.meta as ImportMeta & { env?: { MODE?: string } }).env?.MODE;
  if (buildMode === 'wdio') await import('@wdio/tauri-plugin');

  // Remove the pre-JS boot fallback before React paints (browser target).
  dismissBootFallback();
  if (typeof performance !== 'undefined' && performance.mark) {
    performance.mark('varve-boot-dismissed');
  }

  // Restore persisted theme before first paint so both home and editor surfaces
  // start with the correct [data-theme] attribute rather than falling through to
  // the OS prefers-color-scheme default.
  const savedTheme = localStorage.getItem('varve-theme') ?? localStorage.getItem('strata-theme');
  if (savedTheme === 'dark' || savedTheme === 'light' || savedTheme === 'high-contrast') {
    document.documentElement.dataset.theme = savedTheme;
  }

  const root = document.getElementById('root');
  if (!root) throw new Error('Root element not found');

  // Panel-window popups load the same bundle with a surface param and
  // render the minimal auxiliary shell instead of the full app.
  const isPanelWindow =
    new URLSearchParams(window.location.search).get('surface') === 'panel-window';

  // Stale-chunk recovery for the public browser demo (deploy swaps invalidate
  // old hashed chunks; a reload gets the fresh shell). No-op elsewhere.
  const demo = demoMode();
  if (demo.active && !isPanelWindow) {
    installStaleAssetGuard();
  }

  createRoot(root).render(
    <StrictMode>
      <ErrorBoundary>{isPanelWindow ? <AuxiliaryRoot /> : <App />}</ErrorBoundary>
    </StrictMode>,
  );
}

void bootstrap();
