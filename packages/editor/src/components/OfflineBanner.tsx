import { useCallback, useEffect, useState } from 'react';

export function OfflineBanner() {
  const [isOffline, setIsOffline] = useState(() => !navigator.onLine);
  const [dismissed, setDismissed] = useState(false);

  const handleOffline = useCallback(() => setIsOffline(true), []);
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
    >
      <span className="editor-offline-banner__text">
        Working offline &mdash; changes will sync when you reconnect
      </span>
      <button
        type="button"
        className="editor-offline-banner__close"
        aria-label="Dismiss offline notice"
        onClick={() => setDismissed(true)}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden
        >
          <title>Close</title>
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  );
}
