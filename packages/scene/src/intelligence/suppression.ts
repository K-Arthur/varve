/**
 * Suppression System with Revalidation
 *
 * Manages suppression of audit findings with automatic revalidation.
 * Supports finding-level, rule-level, and node-level suppression.
 *
 * @module suppression
 */

import type { AuditFinding, SuppressionRecord } from '@strata/shared';

// ============================================================================
// Types
// ============================================================================

/**
 * Suppression scope.
 */
export type SuppressionScope = 'finding' | 'rule' | 'node' | 'category';

/**
 * Suppression options.
 */
export interface SuppressionOptions {
  /** Whether to revalidate on document changes */
  revalidateOnEdit?: boolean;

  /** Revalidation interval in milliseconds (for time-based revalidation) */
  revalidationInterval?: number;

  /** Reason for suppression */
  reason?: string;

  /** User who suppressed the finding */
  userId?: string;
}

/**
 * Suppression result.
 */
export interface SuppressionResult {
  /** Whether suppression was successful */
  success: boolean;

  /** Suppression record created */
  record?: SuppressionRecord;

  /** Error if suppression failed */
  error?: string;
}

/**
 * Revalidation result.
 */
export interface RevalidationResult {
  /** Findings that remain suppressed */
  stillSuppressed: string[];

  /** Findings that are no longer valid (can be removed) */
  invalid: string[];

  /** Findings that need attention (reappeared) */
  reappeared: AuditFinding[];
}

// ============================================================================
// Suppression Manager
// ============================================================================

/**
 * Suppression manager.
 */
export class SuppressionManager {
  private suppressions: Map<string, SuppressionRecord> = new Map();
  private findingMap: Map<string, string> = new Map(); // Maps suppression key to finding ID
  private revalidationTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

  /**
   * Suppress a finding.
   *
   * @param finding - The finding to suppress
   * @param scope - Suppression scope
   * @param options - Suppression options
   * @returns Suppression result
   */
  suppress(
    finding: AuditFinding,
    scope: SuppressionScope = 'finding',
    options: SuppressionOptions = {},
  ): SuppressionResult {
    if (!finding.suppressionEligible) {
      return {
        success: false,
        error: 'Finding is not eligible for suppression',
      };
    }

    const suppressionKey = this.getSuppressionKey(finding, scope);
    const suppressionId = `supp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const record: SuppressionRecord = {
      id: suppressionId,
      userId: options.userId,
      reason: options.reason,
      suppressedAt: Date.now(),
      expiresAt: options.revalidationInterval
        ? Date.now() + options.revalidationInterval
        : undefined,
      revalidateOnEdit: options.revalidateOnEdit ?? true,
      active: true,
    };

    this.suppressions.set(suppressionKey, record);
    this.findingMap.set(suppressionKey, finding.findingId);

    // Set up revalidation timer if interval is specified
    if (options.revalidationInterval) {
      this.scheduleRevalidation(suppressionKey, options.revalidationInterval);
    }

    return {
      success: true,
      record,
    };
  }

  /**
   * Unsuppress a finding.
   *
   * @param findingId - The finding ID
   * @param scope - Suppression scope
   * @returns Whether unsuppression was successful
   */
  unsuppress(findingId: string, scope: SuppressionScope = 'finding'): boolean {
    const key = this.getSuppressionKeyById(findingId, scope);
    return this.suppressions.delete(key);
  }

  /**
   * Check if a finding is suppressed.
   *
   * @param finding - The finding to check
   * @returns Whether the finding is suppressed
   */
  isSuppressed(finding: AuditFinding): boolean {
    // Check finding-level suppression
    if (this.suppressions.has(this.getSuppressionKey(finding, 'finding'))) {
      return true;
    }

    // Check rule-level suppression
    if (this.suppressions.has(this.getSuppressionKey(finding, 'rule'))) {
      return true;
    }

    // Check node-level suppression
    for (const nodeId of finding.nodeIds) {
      if (this.suppressions.has(this.getSuppressionKeyByNode(nodeId, 'node'))) {
        return true;
      }
    }

    // Check category-level suppression
    if (this.suppressions.has(this.getSuppressionKeyByCategory(finding.category, 'category'))) {
      return true;
    }

    return false;
  }

  /**
   * Get suppression record for a finding.
   *
   * @param finding - The finding
   * @returns Suppression record or null
   */
  getSuppressionRecord(finding: AuditFinding): SuppressionRecord | null {
    const key = this.getSuppressionKey(finding, 'finding');
    return this.suppressions.get(key) || null;
  }

  /**
   * Revalidate suppressed findings.
   *
   * @param currentFindings - Current findings
   * @param documentRevision - Current document revision
   * @returns Revalidation result
   */
  revalidate(currentFindings: AuditFinding[], documentRevision: number): RevalidationResult {
    const stillSuppressed: string[] = [];
    const invalid: string[] = [];
    const reappeared: AuditFinding[] = [];

    for (const [key, record] of this.suppressions.entries()) {
      // Check if revalidation is needed
      if (!record.revalidateOnEdit) {
        stillSuppressed.push(key);
        continue;
      }

      // Get the finding ID from the map
      const findingId = this.findingMap.get(key);
      if (!findingId) {
        invalid.push(key);
        this.suppressions.delete(key);
        continue;
      }

      // Find the corresponding current finding
      const currentFinding = currentFindings.find((f) => f.findingId === findingId);

      if (!currentFinding) {
        // Finding no longer exists, can remove suppression
        invalid.push(key);
        this.suppressions.delete(key);
        this.findingMap.delete(key);
        continue;
      }

      // Check if document revision changed
      if (currentFinding.documentRevision > documentRevision) {
        // Document changed, re-validate
        invalid.push(key);
        this.suppressions.delete(key);
        this.findingMap.delete(key);
        reappeared.push(currentFinding);
        continue;
      }

      // Finding is still valid and suppressed
      stillSuppressed.push(key);
    }

    return {
      stillSuppressed,
      invalid,
      reappeared,
    };
  }

  /**
   * Clear all suppressions.
   */
  clearAll(): void {
    this.suppressions.clear();
    this.clearRevalidationTimers();
  }

  /**
   * Clear suppressions for a specific rule.
   *
   * @param ruleId - The rule ID
   */
  clearForRule(ruleId: string): void {
    for (const [key, findingId] of this.findingMap.entries()) {
      if (findingId.startsWith(`${ruleId}:`)) {
        this.suppressions.delete(key);
        this.findingMap.delete(key);
        this.clearRevalidationTimer(key);
      }
    }
  }

  /**
   * Clear suppressions for a specific node.
   *
   * @param nodeId - The node ID
   */
  clearForNode(nodeId: string): void {
    for (const [key, findingId] of this.findingMap.entries()) {
      if (findingId.includes(`:${nodeId}:`)) {
        this.suppressions.delete(key);
        this.findingMap.delete(key);
        this.clearRevalidationTimer(key);
      }
    }
  }

  /**
   * Get all suppression records.
   *
   * @returns All suppression records
   */
  getAllSuppressions(): SuppressionRecord[] {
    return Array.from(this.suppressions.values());
  }

  /**
   * Get suppression key for a finding.
   *
   * @param finding - The finding
   * @param scope - Suppression scope
   * @returns Suppression key
   */
  private getSuppressionKey(finding: AuditFinding, scope: SuppressionScope): string {
    switch (scope) {
      case 'finding':
        return `finding:${finding.findingId}`;
      case 'rule':
        return `rule:${finding.ruleId}`;
      case 'node':
        return `node:${finding.nodeIds[0]}`;
      case 'category':
        return `category:${finding.category}`;
      default:
        return `finding:${finding.findingId}`;
    }
  }

  /**
   * Get suppression key by finding ID.
   *
   * @param findingId - The finding ID
   * @param scope - Suppression scope
   * @returns Suppression key
   */
  private getSuppressionKeyById(findingId: string, scope: SuppressionScope): string {
    return `${scope}:${findingId}`;
  }

  /**
   * Get suppression key by node ID.
   *
   * @param nodeId - The node ID
   * @param scope - Suppression scope
   * @returns Suppression key
   */
  private getSuppressionKeyByNode(nodeId: string, scope: SuppressionScope): string {
    return `${scope}:${nodeId}`;
  }

  /**
   * Get suppression key by category.
   *
   * @param category - The category
   * @param scope - Suppression scope
   * @returns Suppression key
   */
  private getSuppressionKeyByCategory(category: string, scope: SuppressionScope): string {
    return `${scope}:${category}`;
  }

  /**
   * Schedule revalidation for a suppression.
   *
   * @param key - Suppression key
   * @param interval - Revalidation interval
   */
  private scheduleRevalidation(key: string, interval: number): void {
    this.clearRevalidationTimer(key);

    const timer = setTimeout(() => {
      this.suppressions.delete(key);
      this.revalidationTimers.delete(key);
    }, interval);

    this.revalidationTimers.set(key, timer);
  }

  /**
   * Clear revalidation timer for a suppression.
   *
   * @param key - Suppression key
   */
  private clearRevalidationTimer(key: string): void {
    const timer = this.revalidationTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.revalidationTimers.delete(key);
    }
  }

  /**
   * Clear all revalidation timers.
   */
  private clearRevalidationTimers(): void {
    for (const timer of this.revalidationTimers.values()) {
      clearTimeout(timer);
    }
    this.revalidationTimers.clear();
  }
}

// ============================================================================
// Suppression Utils
// ============================================================================

/**
 * Check if a finding can be suppressed.
 *
 * @param finding - The finding to check
 * @returns Whether the finding can be suppressed
 */
export function canSuppress(finding: AuditFinding): boolean {
  return finding.suppressionEligible;
}

/**
 * Get suppression scope for a finding based on its properties.
 *
 * @param finding - The finding
 * @returns Recommended suppression scope
 */
export function getRecommendedSuppressionScope(finding: AuditFinding): SuppressionScope {
  if (finding.severity === 'error') {
    return 'finding'; // Only suppress individual errors
  }

  if (finding.nodeIds.length === 0) {
    return 'rule'; // Document-level finding, suppress by rule
  }

  return 'finding'; // Default to finding-level
}
