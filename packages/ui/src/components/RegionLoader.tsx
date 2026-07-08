import { useEffect, useState } from 'react';
import { InlineActivityIndicator } from './InlineActivityIndicator';
import './RegionLoader.css';

export interface RegionLoaderProps {
  /** Accessible label. */
  label?: string;
  /** Whether to show the loader. */
  loading?: boolean;
  /** Content to render once loaded. */
  children?: React.ReactNode;
  /** Optional extra class name for the wrapper. */
  className?: string;
  /** Delay in ms before showing the loader (defaults to 300). */
  delay?: number;
}

/**
 * Contextual panel/section-scoped loader.
 * Debounces appearance to avoid flicker on fast loads.
 */
export function RegionLoader({
  label = 'Loading section...',
  loading = false,
  children,
  className = '',
  delay = 300,
}: RegionLoaderProps) {
  const [shouldShow, setShouldShow] = useState(false);

  useEffect(() => {
    if (!loading) {
      setShouldShow(false);
      return;
    }

    const timer = setTimeout(() => {
      setShouldShow(true);
    }, delay);

    return () => clearTimeout(timer);
  }, [loading, delay]);

  return (
    <div className={`region-loader-container ${className}`} aria-busy={loading}>
      {shouldShow && loading && (
        <div className="region-loader" role="status">
          <InlineActivityIndicator size={24} label={label} />
          {label && <span className="region-loader__text">{label}</span>}
        </div>
      )}
      <div
        className={`region-loader__content ${loading && shouldShow ? 'region-loader__content--loading' : ''}`}
      >
        {children}
      </div>
    </div>
  );
}
