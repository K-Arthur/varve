import './ContentSkeleton.css';

export interface ContentSkeletonProps {
  /** Accessible label for the loading region */
  label: string;
  /** Visual variant */
  variant?: 'list' | 'grid' | 'card' | 'inline';
  /** Number of rows (list variant) */
  rows?: number;
  /** Number of columns (grid variant) */
  columns?: number;
  /** Width percentage for inline variant */
  width?: string;
  /** Height for inline variant */
  height?: string;
  className?: string;
}

export function ContentSkeleton({
  label,
  variant = 'list',
  rows = 1,
  columns = 1,
  width,
  height,
  className = '',
}: ContentSkeletonProps) {
  const baseClass = 'content-skeleton';

  if (variant === 'inline') {
    return (
      <div
        className={`${baseClass} ${baseClass}--inline ${className}`}
        role="status"
        aria-label={label}
        style={{ width, height }}
      >
        <div className={`${baseClass}__shimmer`} />
      </div>
    );
  }

  if (variant === 'grid') {
    const cells = Array.from({ length: rows * columns }, (_, i) => i);
    return (
      <div
        className={`${baseClass} ${baseClass}--grid ${className}`}
        role="status"
        aria-label={label}
        style={{ '--skeleton-columns': columns } as React.CSSProperties}
      >
        {cells.map((i) => (
          <div key={i} className={`${baseClass}__cell`}>
            <div className={`${baseClass}__shimmer`} />
          </div>
        ))}
      </div>
    );
  }

  if (variant === 'card') {
    return (
      <div
        className={`${baseClass} ${baseClass}--card ${className}`}
        role="status"
        aria-label={label}
      >
        <div className={`${baseClass}__card-icon`}>
          <div className={`${baseClass}__shimmer`} />
        </div>
        <div className={`${baseClass}__card-title`}>
          <div className={`${baseClass}__shimmer`} />
        </div>
        <div className={`${baseClass}__card-desc`}>
          <div className={`${baseClass}__shimmer`} />
        </div>
      </div>
    );
  }

  const items = Array.from({ length: rows }, (_, i) => i);
  return (
    <div
      className={`${baseClass} ${baseClass}--list ${className}`}
      role="status"
      aria-label={label}
    >
      {items.map((i) => (
        <div key={i} className={`${baseClass}__row`}>
          <div className={`${baseClass}__shimmer`} />
        </div>
      ))}
    </div>
  );
}
