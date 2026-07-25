/**
 * Unified Audit Finding Types
 *
 * This module defines the unified finding model used across all audit systems.
 * It normalizes audit results from Scene Intelligence, Debt Scanner, Governance Rules,
 * Design Linter, Codegen Audits, and Prototype Validation into a single consistent format.
 *
 * @module auditTypes
 */

// NodeId is a string identifier for nodes in the document
// Defined locally to avoid circular dependencies with @strata/scene
export type NodeId = string;

// ============================================================================
// Severity and Classification
// ============================================================================

/**
 * Severity classification - normalized across all audit systems.
 *
 * - **error**: Blocks correctness, accessibility, save, export, or output integrity
 * - **warning**: Likely to cause degraded results or usability issues
 * - **suggestion**: Useful improvement with objective evidence
 * - **advisory**: Subjective or context-dependent recommendation
 */
export type AuditSeverity = 'error' | 'warning' | 'suggestion' | 'advisory';

/**
 * Category for grouping in the panel and filtering.
 */
export type AuditCategory =
  | 'contrast'
  | 'typography'
  | 'layout'
  | 'accessibility'
  | 'vector'
  | 'raster'
  | 'color'
  | 'performance'
  | 'spacing'
  | 'codegen'
  | 'prototype'
  | 'governance'
  | 'layer-hygiene'
  | 'touch-target'
  | 'focus-order';

/**
 * Fix capability - what kind of fix is available.
 */
export type FixCapability = 'none' | 'automatic' | 'assisted' | 'manual';

/**
 * Execution cost for scheduling.
 */
export type ExecutionCost = 'immediate' | 'cheap' | 'moderate' | 'expensive';

/**
 * Scope this rule operates in.
 */
export type AuditScope = 'document' | 'page' | 'selection' | 'prototype';

/**
 * Editor mode this finding applies to.
 */
export type EditorMode =
  | 'standard'
  | 'text-editing'
  | 'vector-editing'
  | 'crop'
  | 'mask-editing'
  | 'adjustment-editing'
  | 'prototype-linking'
  | 'animation-editing'
  | 'isolation'
  | 'export-preflight'
  | 'presentation';

/**
 * Workspace mode.
 */
export type WorkspaceMode = 'design' | 'drawing' | 'image' | 'print' | 'motion';

/**
 * Node kind this finding applies to.
 */
export type NodeKind = 'frame' | 'group' | 'shape' | 'text' | 'image' | 'component' | 'instance';

// ============================================================================
// Fix Types
// ============================================================================

/**
 * A named, previewable fix for a finding.
 */
export interface AuditFix {
  /** Machine-readable fix ID (unique within the rule). */
  id: string;

  /** Human-readable label (e.g., "Fix contrast to meet WCAG AA"). */
  label: string;

  /** Description of what the fix does. */
  description?: string;

  /** Pure function that transforms the document. Returns null when the fix
   *  would have no effect (issue already resolved by other means).
   */
  apply: (doc: unknown) => unknown | null;

  /** Whether the fix has a side effect beyond the document (e.g., selection). */
  changesSelection?: boolean;

  /** Whether this fix can be previewed before applying. */
  previewable: boolean;

  /** Preview function - returns a preview of the fix without applying it. */
  preview?: (doc: unknown) => FixPreview;
}

/**
 * Preview of a fix before applying.
 */
export interface FixPreview {
  /** Description of what will change. */
  description: string;

  /** Nodes that will be modified. */
  affectedNodeIds: NodeId[];

  /** Before/after values for key properties. */
  changes: Array<{
    nodeId: NodeId;
    property: string;
    before: unknown;
    after: unknown;
  }>;

  /** Visual preview (if applicable). */
  visualPreview?: {
    type: 'color' | 'number' | 'text';
    before: string;
    after: string;
  };
}

// ============================================================================
// Suppression Types
// ============================================================================

/**
 * Suppression record for a finding.
 */
export interface SuppressionRecord {
  /** Suppression ID. */
  id: string;

  /** User who suppressed this finding. */
  userId?: string;

  /** Reason for suppression (optional). */
  reason?: string;

  /** Timestamp when suppressed. */
  suppressedAt: number;

  /** Expiry timestamp (if applicable). */
  expiresAt?: number;

  /** Whether to revalidate on document changes. */
  revalidateOnEdit: boolean;

  /** Whether suppression is active. */
  active: boolean;

  /** Timestamp when suppression was lifted (if inactive). */
  liftedAt?: number;

  /** User who lifted the suppression. */
  liftedBy?: string;

  /** Reason for lifting. */
  liftReason?: string;
}

// ============================================================================
// Unified Finding Model
// ============================================================================

/**
 * Unified audit finding - the single finding type used across all audit systems.
 *
 * Designed for:
 * - Stable identification across re-runs (findingId)
 * - Navigation to affected content (nodeIds, regions)
 * - Suppression and exception management (suppressionEligible)
 * - Automatic and assisted fixes (fixCapability, previewFix)
 * - Workspace and mode filtering (applicableWorkspaces, applicableModes)
 * - Cache invalidation (documentRevision)
 * - Evidence and standards (evidence, standardReference)
 */
export interface AuditFinding {
  // ── Identification ───────────────────────────────────────────────────────

  /** Stable finding ID - unique across all findings in a document scan.
   *  Format: `{ruleId}:{nodeId}:{hash}` where hash is derived from finding-specific
   *  parameters (e.g., contrast ratio, DPI value). This ID remains stable across
   *  re-runs if the underlying issue hasn't changed, enabling suppression,
   *  navigation, and tracking.
   */
  findingId: string;

  /** Rule ID that produced this finding. Stable across rule versions.
   *  Format: `{category}/{rule-name}/{version}` e.g., "contrast/aa-fail/v1"
   */
  ruleId: string;

  /** Rule version string - increment when rule logic changes meaningfully.
   *  Used to invalidate suppressions when rules are updated.
   */
  ruleVersion: string;

  // ── Classification ───────────────────────────────────────────────────────

  /** Human-readable severity classification. */
  severity: AuditSeverity;

  /** Category for grouping in the panel and filtering. */
  category: AuditCategory;

  /** Confidence in the finding (0-1). 1.0 = certain, 0.5 = probable, <0.5 = uncertain.
   *  Low-confidence findings should be filtered by default in general profiles.
   */
  confidence: number;

  // ── Affected Content ───────────────────────────────────────────────────────

  /** Node IDs affected by this finding. May be empty for document-level issues. */
  nodeIds: NodeId[];

  /** Optional region on canvas (for visual findings like contrast, overflow).
   *  Coordinates in document space (not screen space).
   */
  region?: {
    x: number;
    y: number;
    w: number;
    h: number;
    pageId?: string;
  };

  /** Optional interaction ID (for prototype findings). */
  interactionId?: string;

  /** Optional component/style/variable name (for governance findings). */
  targetName?: string;

  // ── Description ─────────────────────────────────────────────────────────

  /** One-line user-facing explanation. */
  message: string;

  /** Longer explanation shown in the finding detail view. */
  detail?: string;

  /** Machine-readable evidence (e.g., contrast ratio, DPI value, color difference). */
  evidence?: Record<string, unknown>;

  /** Reference to relevant standard or export constraint (e.g., "WCAG 2.1 SC 1.4.3"). */
  standardReference?: string;

  /** URL to documentation about this issue (optional). */
  documentationUrl?: string;

  // ── Fix Capability ─────────────────────────────────────────────────────────

  /** Whether this finding has any fix available. */
  fixCapability: FixCapability;

  /** Available fixes (empty when no automatic fix exists). */
  fixes: AuditFix[];

  // ── Applicability ─────────────────────────────────────────────────────────

  /** Workspaces where this finding is relevant. Empty = all workspaces. */
  applicableWorkspaces: WorkspaceMode[];

  /** Editor modes where this finding is relevant. Empty = all modes. */
  applicableModes: EditorMode[];

  /** Node kinds this finding applies to. Empty = all node kinds. */
  applicableNodeKinds: NodeKind[];

  // ── Lifecycle ────────────────────────────────────────────────────────────

  /** Document revision when this finding was generated. Used for staleness detection. */
  documentRevision: number;

  /** Timestamp when this finding was generated. */
  timestamp: number;

  /** Whether this finding is stale (document has changed since generation). */
  stale: boolean;

  /** Whether this finding is resolved (issue no longer exists). */
  resolved: boolean;

  // ── Suppression ───────────────────────────────────────────────────────────

  /** Whether this finding can be suppressed/dismissed by the user. */
  suppressionEligible: boolean;

  /** Suppression scope - what gets suppressed. */
  suppressionScope: 'finding' | 'node' | 'rule' | 'document';

  /** If suppressed, the suppression record. */
  suppression?: SuppressionRecord;

  // ── Execution Metadata ────────────────────────────────────────────────────

  /** Performance cost hint for the scan scheduler. */
  cost: ExecutionCost;

  /** Scope this rule operates in. */
  scope: AuditScope;

  /** Scan ID that produced this finding (for staleness detection). */
  scanId: number;
}

// ============================================================================
// Finding ID Generation
// ============================================================================

/**
 * Generate a stable finding ID.
 *
 * Format: `{ruleId}:{nodeId}:{hash}`
 *
 * The hash is derived from finding-specific parameters (e.g., contrast ratio,
 * DPI value) to ensure the ID remains stable across re-runs if the underlying
 * issue hasn't changed.
 *
 * @param ruleId - Rule identifier
 * @param nodeId - Affected node ID (or "document" for document-level issues)
 * @param params - Finding-specific parameters for hash generation
 * @returns Stable finding ID
 */
export function generateFindingId(
  ruleId: string,
  nodeId: string,
  params: Record<string, unknown>,
): string {
  const key = `${ruleId}:${nodeId}:${JSON.stringify(params)}`;
  // Simple hash function (replace with proper hash in production)
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    const char = key.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return `${ruleId}:${nodeId}:${Math.abs(hash).toString(36)}`;
}

/**
 * Serialize evidence for hashing and storage.
 *
 * @param evidence - Evidence object to serialize
 * @returns Serialized evidence string
 */
export function serializeEvidence(evidence: Record<string, unknown>): string {
  return JSON.stringify(evidence, Object.keys(evidence).sort());
}

/**
 * Generate a hash from evidence for comparison.
 *
 * @param evidence - Evidence object to hash
 * @returns Evidence hash
 */
export function evidenceHash(evidence: Record<string, unknown>): string {
  const serialized = serializeEvidence(evidence);
  // Simple hash (replace with proper hash in production)
  let hash = 0;
  for (let i = 0; i < serialized.length; i++) {
    const char = serialized.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

// ============================================================================
// Severity Mapping
// ============================================================================

/**
 * Map legacy severity to unified severity.
 *
 * @param legacySeverity - Legacy severity value
 * @returns Unified severity
 */
export function mapLegacySeverity(legacySeverity: string): AuditSeverity {
  switch (legacySeverity) {
    case 'error':
      return 'error';
    case 'warning':
      return 'warning';
    case 'info':
      return 'suggestion';
    case 'suggestion':
      return 'advisory';
    default:
      return 'advisory';
  }
}

/**
 * Determine if a severity is blocking (error).
 *
 * @param severity - Severity to check
 * @returns True if blocking
 */
export function isBlockingSeverity(severity: AuditSeverity): boolean {
  return severity === 'error';
}

// ============================================================================
// Confidence Classification
// ============================================================================

/**
 * Classify confidence level.
 *
 * - **certain**: 0.9-1.0 - Finding is definitively correct
 * - **probable**: 0.7-0.9 - Finding is likely correct
 * - **uncertain**: 0.5-0.7 - Finding may be correct
 * - **speculative**: <0.5 - Finding is a guess
 *
 * @param confidence - Confidence value (0-1)
 * @returns Confidence level
 */
export type ConfidenceLevel = 'certain' | 'probable' | 'uncertain' | 'speculative';

export function classifyConfidence(confidence: number): ConfidenceLevel {
  if (confidence >= 0.9) return 'certain';
  if (confidence >= 0.7) return 'probable';
  if (confidence >= 0.5) return 'uncertain';
  return 'speculative';
}

/**
 * Check if confidence is high enough to show by default.
 *
 * @param confidence - Confidence value (0-1)
 * @returns True if should show by default
 */
export function shouldShowByDefault(confidence: number): boolean {
  return confidence >= 0.7;
}
