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
 */
export function installStaleAssetGuard(): () => void {
  let shown = false;
  let host: HTMLDivElement | null = null;

  const show = (kind: string) => {
    if (shown || typeof document === 'undefined') return;
    shown = true;
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
  };
}
