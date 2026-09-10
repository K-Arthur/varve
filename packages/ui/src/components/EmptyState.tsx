import type { ReactNode } from 'react';

export interface EmptyStateProps {
  /** SVG markup for illustration (no emoji). Use an `<svg>` fragment. */
  illustration: ReactNode;
  headline: string;
  description?: string;
  actions?: ReactNode;
}

export function EmptyState({ illustration, headline, description, actions }: EmptyStateProps) {
  return (
    <div className="varve-empty" role="status">
      <div className="varve-empty__illustration" aria-hidden>
        {illustration}
      </div>
      <h3 className="varve-empty__headline">{headline}</h3>
      {description && <p className="varve-empty__desc">{description}</p>}
      {actions && <div className="varve-empty__actions">{actions}</div>}
    </div>
  );
}
