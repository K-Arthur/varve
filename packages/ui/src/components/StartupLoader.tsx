import { useEffect, useState } from 'react';
import { StrataLogo } from '../icons/StrataLogo';
import './StartupLoader.css';

export interface StartupLoaderProps {
  /** Error message to display if initialization failed. */
  error?: string | null;
  /** Callback to retry initialization. */
  onRetry?: () => void;
  /** Whether the app is ready (triggers exit transition). */
  ready?: boolean;
}

/**
 * Branded startup loader for Strata.
 * Renders the symbolic Strata logo in white with a CSS/SVG chromatic aberration effect.
 */
export function StartupLoader({ error, onRetry, ready }: StartupLoaderProps) {
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    if (ready) {
      setExiting(true);
    }
  }, [ready]);

  if (ready && !exiting) return null;

  return (
    <div
      className={`startup-loader ${exiting ? 'startup-loader--exiting' : ''} ${error ? 'startup-loader--error' : ''}`}
      role="status"
      aria-live="polite"
      aria-busy={!error && !ready}
    >
      <div className="startup-loader__content">
        <div className="startup-loader__logo-container">
          {/* Chromatic aberration effect via 3 stacked layers (RGB offset) */}
          <StrataLogo
            className="startup-loader__logo startup-loader__logo--red"
            symbolic
            size={80}
          />
          <StrataLogo
            className="startup-loader__logo startup-loader__logo--green"
            symbolic
            size={80}
          />
          <StrataLogo
            className="startup-loader__logo startup-loader__logo--blue"
            symbolic
            size={80}
          />
          <StrataLogo
            className="startup-loader__logo startup-loader__logo--white"
            symbolic
            size={80}
            label="Strata"
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
