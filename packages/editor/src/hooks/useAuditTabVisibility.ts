/**
 * Use Audit Tab Visibility Hook
 *
 * Determines when the audit tab should be visible based on workspace mode,
 * findings, and user preferences.
 *
 * @module useAuditTabVisibility
 */

import type { AuditFinding, EditorMode } from '@varve/shared';
import { useMemo } from 'react';

interface AuditTabVisibilityOptions {
  /** Current editor mode */
  currentMode: EditorMode;

  /** Current findings */
  findings: AuditFinding[];

  /** Whether user has explicitly enabled audit tab */
  userEnabled?: boolean;

  /** Whether user has explicitly disabled audit tab */
  userDisabled?: boolean;

  /** Minimum number of findings to show tab automatically */
  minFindingsToShow?: number;
}

/**
 * Result of the visibility check.
 */
export interface AuditTabVisibilityResult {
  /** Whether the tab should be visible */
  visible: boolean;

  /** Reason for visibility state */
  reason: 'user-enabled' | 'findings-present' | 'workspace-mode' | 'user-disabled' | 'no-findings';

  /** Number of findings */
  findingCount: number;

  /** Number of blocking findings (errors) */
  blockingCount: number;
}

/**
 * Hook to determine audit tab visibility.
 */
export function useAuditTabVisibility({
  currentMode,
  findings,
  userEnabled,
  userDisabled,
  minFindingsToShow = 1,
}: AuditTabVisibilityOptions): AuditTabVisibilityResult {
  return useMemo(() => {
    // User explicitly disabled
    if (userDisabled) {
      return {
        visible: false,
        reason: 'user-disabled',
        findingCount: findings.length,
        blockingCount: findings.filter((f) => f.severity === 'error').length,
      };
    }

    // User explicitly enabled
    if (userEnabled) {
      return {
        visible: true,
        reason: 'user-enabled',
        findingCount: findings.length,
        blockingCount: findings.filter((f) => f.severity === 'error').length,
      };
    }

    // Check for blocking findings (errors)
    const blockingCount = findings.filter((f) => f.severity === 'error').length;
    if (blockingCount > 0) {
      return {
        visible: true,
        reason: 'findings-present',
        findingCount: findings.length,
        blockingCount,
      };
    }

    // Check for minimum findings threshold
    if (findings.length >= minFindingsToShow) {
      return {
        visible: true,
        reason: 'findings-present',
        findingCount: findings.length,
        blockingCount,
      };
    }

    // Check workspace mode - some modes always show audit
    if (currentMode === 'export-preflight') {
      return {
        visible: true,
        reason: 'workspace-mode',
        findingCount: findings.length,
        blockingCount,
      };
    }

    // No findings and not in special mode
    return {
      visible: false,
      reason: 'no-findings',
      findingCount: findings.length,
      blockingCount,
    };
  }, [currentMode, findings, userEnabled, userDisabled, minFindingsToShow]);
}

/**
 * Get tab visibility priority for sorting.
 * Higher priority means tab should appear earlier.
 */
export function getTabVisibilityPriority(result: AuditTabVisibilityResult): number {
  switch (result.reason) {
    case 'user-enabled':
      return 100;
    case 'findings-present':
      return result.blockingCount > 0 ? 90 : 80;
    case 'workspace-mode':
      return 70;
    case 'user-disabled':
      return 10;
    case 'no-findings':
      return 0;
    default:
      return 0;
  }
}

/**
 * Check if tab should be highlighted (e.g., badge indicator).
 */
export function shouldHighlightTab(result: AuditTabVisibilityResult): boolean {
  return result.blockingCount > 0 || result.findingCount > 0;
}

/**
 * Get badge text for the tab.
 */
export function getTabBadgeText(result: AuditTabVisibilityResult): string | null {
  if (result.blockingCount > 0) {
    return result.blockingCount.toString();
  }
  if (result.findingCount > 0) {
    return result.findingCount.toString();
  }
  return null;
}
