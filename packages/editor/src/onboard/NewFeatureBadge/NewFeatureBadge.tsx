import { type ReactNode, useCallback, useState } from 'react';
import { FEATURE_VERSIONS, CURRENT_APP_VERSION, compareVersions } from './featureVersions';
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

  const handleInteraction = useCallback(() => {
    setDismissed(true);
    onSee?.(featureId);
  }, [featureId, onSee]);

  const featureVersion = FEATURE_VERSIONS[featureId];

  const showBadge =
    featureVersion !== undefined &&
    !dismissed &&
    (!lastSeenVersion || compareVersions(lastSeenVersion, featureVersion) < 0) &&
    (!lastSeenVersion || compareVersions(lastSeenVersion, CURRENT_APP_VERSION) < 0);

  return (
    <span
      className={`new-feature-badge ${className}`}
      onClick={showBadge ? handleInteraction : undefined}
      onFocus={showBadge ? handleInteraction : undefined}
      role="presentation"
    >
      {children}
      {showBadge && (
        <span
          className="new-feature-badge__dot"
          aria-label={`New: ${featureId}`}
          role="status"
        />
      )}
    </span>
  );
}
