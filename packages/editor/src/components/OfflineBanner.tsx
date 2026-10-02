import { Icon } from '@varve/ui';
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * OfflineBanner — a truthful offline indicator for a local-first app.
 *
 * Varve saves to local disk and runs all editing tools offline, so being
 * offline changes nothing about document safety. What offline actually
 * affects are the online conveniences: remote font providers (Google Fonts,
 * Fontsource), icon providers, and optional model downloads. The banner says
 * exactly that — it must never imply that changes are at risk or that a
 * "sync" is pending (there is none in a local-first product).
 */
export function OfflineBanner() {
  const [isOffline, setIsOffline] = useState(() => !navigator.onLine);
  const [dismissed, setDismissed] = useState(false);
  const bannerRef = useRef<HTMLDivElement>(null);

  const handleOffline = useCallback(() => {
    setIsOffline(true);
    setDismissed(false);
  }, []);
  const handleOnline = useCallback(() => setIsOffline(false), []);

  useEffect(() => {
    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);
    return () => {
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
    };
  }, [handleOffline, handleOnline]);

  const visible = isOffline && !dismissed;

  useEffect(() => {
    const banner = bannerRef.current;
    const shell = banner?.closest<HTMLElement>('.editor-shell');
    if (!banner || !shell) return;
    const header = banner.parentElement;
    const tabs = shell.querySelector<HTMLElement>('[role="tablist"][aria-label="Open documents"]');
    // The notice occupies a real header row. Responsive drawers use this
    // measured contribution so wrapped copy and text enlargement cannot
    // make them cover the application menus.
    const publishHeight = () => {
      const height = visible ? Math.ceil(banner.getBoundingClientRect().height) : 0;
      shell.style.setProperty('--editor-offline-notice-height', `${height}px`);
      if (visible && tabs) {
        // At enlarged text sizes the header's real controls can exceed their
        // nominal tracks by a few pixels. Include that actual tab edge rather
        // than adding a constant to a static header estimate.
        shell.style.setProperty(
          '--menubar-total-height',
          `${Math.ceil(tabs.getBoundingClientRect().bottom)}px`,
        );
      } else {
        shell.style.removeProperty('--menubar-total-height');
      }
    };
    publishHeight();
    let resizeFrame = 0;
    const scheduleHeight = () => {
      cancelAnimationFrame(resizeFrame);
      // Setting drawer geometry during ResizeObserver delivery can resize
      // another observed surface in the same cycle. Publish on the next
      // frame so the browser can complete the current layout first.
      resizeFrame = requestAnimationFrame(publishHeight);
    };
    const observer =
      typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(scheduleHeight);
    observer?.observe(banner);
    if (header) observer?.observe(header);
    if (tabs) observer?.observe(tabs);
    return () => {
      observer?.disconnect();
      cancelAnimationFrame(resizeFrame);
      shell.style.setProperty('--editor-offline-notice-height', '0px');
      shell.style.removeProperty('--menubar-total-height');
    };
  }, [visible]);

  return (
    <div
      ref={bannerRef}
      className={`editor-offline-banner${visible ? ' editor-offline-banner--visible' : ''}`}
      role="status"
      aria-live="polite"
      aria-hidden={!visible}
      // inert keeps the dismiss button out of the tab order while hidden —
      // aria-hidden alone would still leave it focusable.
      inert={!visible || undefined}
    >
      <Icon name="WifiOff" size={14} />
      <span className="editor-offline-banner__text">
        Offline — your document and all tools keep working locally.
        <span className="editor-offline-banner__detail">
          {' '}
          Online font and icon search is unavailable.
        </span>
      </span>
      <button
        type="button"
        className="editor-offline-banner__close"
        aria-label="Dismiss offline notice"
        onClick={() => setDismissed(true)}
      >
        <Icon name="X" size={14} />
      </button>
    </div>
  );
}
