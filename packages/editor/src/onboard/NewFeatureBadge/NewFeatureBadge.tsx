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

  const featureVersion = FEATURE_VERSIONS[featureId];
  if (!featureVersion) {
    // Unknown feature — no badge
    return <span className={`new-feature-badge ${className}`}>{children}</span>;
  }

  if (dismissed) {
    return <span className={`new-feature-badge ${className}`}>{children}</span>;
  }

  // If lastSeenVersion is at or above the feature version, no badge needed
  if (lastSeenVersion && compareVersions(lastSeenVersion, featureVersion) >= 0) {
    return <span className={`new-feature-badge ${className}`}>{children}</span>;
  }

  // If lastSeenVersion is equal to current app version, no badge
  if (lastSeenVersion && compareVersions(lastSeenVersion, CURRENT_APP_VERSION) >= 0) {
    return <span className={`new-feature-badge ${className}`}>{children}</span>;
  }

  const handleInteraction = useCallback(() => {
    setDismissed(true);
    onSee?.(featureId);
  }, [featureId, onSee]);

  return (
    <span
      className={`new-feature-badge ${className}`}
      onClick={handleInteraction}
      onFocus={handleInteraction}
      role="presentation"
    >
      {children}
      <span
        className="new-feature-badge__dot"
        aria-label={`New: ${featureId}`}
        role="status"
      />
    </span>
  );
}
