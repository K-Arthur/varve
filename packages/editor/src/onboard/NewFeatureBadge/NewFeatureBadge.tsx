import { type ReactNode, useCallback, useState } from 'react';
import { CURRENT_APP_VERSION, compareVersions, FEATURE_VERSIONS } from './featureVersions';
import './NewFeatureBadge.css';

interface NewFeatureBadgeProps {
  featureId: string;
  lastSeenVersion?: string;
  className?: string;
  children: ReactNode;
  /** Called when the user interacts with the wrapped element, so the parent
   *  can save the seen state (e.g. via seeFeatureBadge). */
  onSee?: (featureId: string) => void;
}

export function NewFeatureBadge({
  featureId,
  lastSeenVersion,
  className = '',
  children,
  onSee,
}: NewFeatureBadgeProps) {
  const [dismissed, setDismissed] = useState(false);

  const handleInteraction = useCallback(
    (_e?: unknown) => {
      setDismissed(true);
      onSee?.(featureId);
    },
    [featureId, onSee],
  );

  const featureVersion = FEATURE_VERSIONS[featureId];

  const showBadge =
    featureVersion !== undefined &&
    !dismissed &&
    (!lastSeenVersion || compareVersions(lastSeenVersion, featureVersion) < 0) &&
    (!lastSeenVersion || compareVersions(lastSeenVersion, CURRENT_APP_VERSION) < 0);

  return (
    <button
      type="button"
      className={`new-feature-badge ${className}`}
      onClick={showBadge ? handleInteraction : undefined}
      onFocus={showBadge ? handleInteraction : undefined}
      onKeyDown={
        showBadge
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleInteraction(e);
              }
            }
          : undefined
      }
      tabIndex={showBadge ? 0 : undefined}
    >
      {children}
      {showBadge && (
        <span className="new-feature-badge__dot" role="status" aria-label={`New: ${featureId}`} />
      )}
    </button>
  );
}
