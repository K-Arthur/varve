/**
 * Intelligence panel — audit issue types.
 *
 * Provides the core type definitions for the WCAG contrast audit system.
 * The actual audit logic is in @strata/shared (contrast.ts); this module
 * defines the structure that the intelligence panel UI consumes.
 *
 * Research basis: WCAG 2.1 §1.4.3, §1.4.6, §1.4.11 (Non-text Contrast).
 */

import type { Document } from '../document';

/** Severity level for an audit issue. */
export type AuditSeverity = 'error' | 'warning' | 'info';

/** A single audit issue discovered during a design review pass. */
export interface AuditIssue {
  /** The ID of the affected node. */
  nodeId: string;

  /** Machine-readable issue type (e.g. 'contrast-aa-fail'). */
  type: string;

  /** Human-readable severity classification. */
  severity: AuditSeverity;

  /** Human-readable description of the issue. */
  message: string;

  /**
   * Optional auto-fix function that returns a new Document with the
   * issue resolved. Undefined if no automated fix is available.
   */
  autoFix?: () => Document;
}
