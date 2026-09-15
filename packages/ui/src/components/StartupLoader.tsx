import { useEffect, useState } from 'react';
import { VarveLogo } from '../icons/VarveLogo';
import './StartupLoader.css';

export interface StartupLoaderProps {
  /** Error message to display if initialization failed. */
  error?: string | null;
  /** Callback to retry initialization. */
  onRetry?: () => void;
  /** Whether the app is ready (triggers exit transition). */
  ready?: boolean;
  /** Soften fringe slightly (low-capability). Motion still allowed. */
  simplified?: boolean;
  /** Fired after the exit animation completes. */
  onExited?: () => void;
  /** Exit animation duration in ms (default 250). */
  exitDuration?: number;
}

const LOGO_SIZE = 160;

/**
 * Branded startup loader — sharp white Varve mark, thin static spectral
 * fringe, quiet luminosity pulse. No sweep/glitch overlays.
 */
export function StartupLoader({
  error,
  onRetry,
  ready,
  simplified,
  onExited,
  exitDuration,
}: StartupLoaderProps) {
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    if (ready) {
      setExiting(true);
      const timer = setTimeout(() => {
        onExited?.();
      }, exitDuration ?? 250);
      return () => clearTimeout(timer);
    }
  }, [ready, onExited, exitDuration]);

  if (ready && !exiting) return null;

  return (
    <div
      className={`startup-loader ${exiting ? 'startup-loader--exiting' : ''} ${error ? 'startup-loader--error' : ''} ${simplified ? 'startup-loader--simplified' : ''}`}
      data-brand-splash="fixed-dark"
      role="status"
      aria-live="polite"
      aria-busy={!error && !ready}
    >
      <div className="startup-loader__content">
        <div className="startup-loader__logo-container startup-loader__logo-container--pulse">
          <VarveLogo
            className="startup-loader__logo startup-loader__logo--mark"
            data-fringe="chromatic"
            symbolic
            size={LOGO_SIZE}
            label="Varve"
          />
        </div>

        {error && (
          <div className="startup-loader__error" role="alert">
            <p className="startup-loader__error-msg">{error}</p>
            {onRetry && (
              <button type="button" className="startup-loader__retry-btn" onClick={onRetry}>
                Retry Startup
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
