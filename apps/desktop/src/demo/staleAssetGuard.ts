/**
 * Stale-asset recovery for the browser demo.
 *
 * The demo's index.html is served with a short max-age; a visitor who keeps a
 * tab open across a deploy can hold a stale HTML shell that references old
 * hashed chunk URLs. Those chunks are gone after the Pages artifact swap, so
 * the load fails with a 404 and the app would otherwise sit on a dead screen.
 *
 * This guard (demo mode only) watches for resource-load failures and dynamic
 * import rejections and offers a one-click reload. It never retries silently
 * and never touches the user's data — reloading re-reads IndexedDB, where
 * documents already live.
 *
 * Styling is injected inline rather than imported from a stylesheet on
 * purpose: the failure this guard exists for is "an expected asset is gone",
 * so the recovery UI must not itself depend on a chunk that may be missing.
 * For the same reason it uses the brand-fixed dark palette of the boot
 * fallback in index.html instead of theme tokens, which live in a stylesheet
 * that may never have loaded.
 */

const STYLE_ID = 'varve-stale-asset-style';

/** Self-contained styles — no tokens, no external stylesheet. */
const STYLES = `
.varve-stale-asset-banner {
  position: fixed;
  left: 50%;
  bottom: 24px;
  transform: translateX(-50%);
  /* Just below the boot fallback (2147483646) so a genuine boot failure,
     which is the more severe state, still wins the stacking order. */
  z-index: 2147483645;
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  max-width: min(560px, calc(100vw - 32px));
  padding: 12px 16px;
  border: 1px solid rgb(255 255 255 / 0.14);
  border-radius: 10px;
  background: #10151f;
  color: #fff;
  color-scheme: dark;
  box-shadow: 0 10px 30px -8px rgb(0 0 0 / 0.55);
  font: 14px/1.45 system-ui, sans-serif;
  animation: varve-stale-asset-in 180ms ease-out;
}
.varve-stale-asset-banner p { margin: 0; flex: 1 1 220px; }
.varve-stale-asset-banner button {
  flex-shrink: 0;
  padding: 7px 14px;
  border: none;
  border-radius: 6px;
  font: 600 14px/1 system-ui, sans-serif;
  cursor: pointer;
}
.varve-stale-asset-banner button:first-of-type { background: #39d0c6; color: #10151f; }
.varve-stale-asset-banner button:first-of-type:hover { background: #4adecc; }
.varve-stale-asset-banner button:last-of-type {
  background: transparent;
  color: rgb(255 255 255 / 0.72);
}
.varve-stale-asset-banner button:last-of-type:hover { color: #fff; }
.varve-stale-asset-banner button:focus-visible {
  outline: 2px solid #4adecc;
  outline-offset: 2px;
}
@keyframes varve-stale-asset-in {
  from { opacity: 0; transform: translate(-50%, 8px); }
  to { opacity: 1; transform: translate(-50%, 0); }
}
@media (prefers-reduced-motion: reduce) {
  .varve-stale-asset-banner { animation: none; }
}
`;

function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = STYLES;
  document.head.appendChild(style);
}

export function installStaleAssetGuard(): () => void {
  let shown = false;
  let host: HTMLDivElement | null = null;

  const show = (kind: string) => {
    if (shown || typeof document === 'undefined') return;
    shown = true;
    injectStyles();
    host = document.createElement('div');
    host.setAttribute('role', 'alert');
    host.className = 'varve-stale-asset-banner';
    const message = document.createElement('p');
    message.textContent =
      'A newer version of the browser demo is available. Reload to continue with the latest build.';
    const reload = document.createElement('button');
    reload.type = 'button';
    reload.textContent = 'Reload demo';
    reload.addEventListener('click', () => {
      window.location.reload();
    });
    const close = document.createElement('button');
    close.type = 'button';
    close.setAttribute('aria-label', 'Dismiss update notice');
    close.textContent = 'Dismiss';
    close.addEventListener('click', () => host?.remove());
    host.append(message, reload, close);
    document.body.appendChild(host);
    // Deliberately not focus-stealing: the prompt is non-modal and the visitor
    // may be mid-edit. role="alert" announces it, and both buttons sit in the
    // normal tab order at the end of the document.
    console.warn(`[varve-demo] stale asset detected (${kind}); showing reload prompt`);
  };

  const onError = (event: ErrorEvent) => {
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      (target.tagName === 'SCRIPT' || target.tagName === 'LINK')
    ) {
      event.preventDefault();
      show('resource');
    }
  };

  const onUnhandledRejection = (event: PromiseRejectionEvent) => {
    const reason = event.reason;
    if (
      reason instanceof Error &&
      (reason.name === 'TypeError' || reason.name === 'ChunkLoadError') &&
      /import|fetch|module/i.test(reason.message)
    ) {
      event.preventDefault();
      show('chunk');
    }
  };

  window.addEventListener('error', onError, true);
  window.addEventListener('unhandledrejection', onUnhandledRejection);
  return () => {
    window.removeEventListener('error', onError, true);
    window.removeEventListener('unhandledrejection', onUnhandledRejection);
    host?.remove();
    document.getElementById(STYLE_ID)?.remove();
  };
}
