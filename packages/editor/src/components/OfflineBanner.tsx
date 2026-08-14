import { Icon } from '@varve/ui';
import { useCallback, useEffect, useState } from 'react';

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

  return (
    <div
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
        Offline — your document and all tools keep working locally. Online font and icon search is
        unavailable.
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
