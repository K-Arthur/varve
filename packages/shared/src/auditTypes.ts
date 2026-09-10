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
// Defined locally to avoid circular dependencies with @varve/scene
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
export type WorkspaceMode =
  | 'design'
  | 'drawing'
  | 'image'
  | 'print'
  | 'motion'
  | 'codegen'
  | 'logo'
  | 'email';

/**
 * Node kind this finding applies to.
 */
export type NodeKind = 'frame' | 'group' | 'shape' | 'text' | 'image' | 'component' | 'instance';

// ============================================================================
// Fix Descriptor and Patch Types
// ============================================================================

/**
 * A description of what kind of fix this is.
 */
export type FixKind = 'safe' | 'destructive' | 'assisted';

/**
 * A single change entry in a patch summary.
 */
export interface PatchChange {
  nodeId: string;
  property: string;
  before: unknown;
  after: unknown;
}

/**
 * Summary of all changes in a patch.
 */
export interface PatchSummary {
  changes: PatchChange[];
}

/**
 * An affected-node entry in a patch.
 */
export interface PatchAffects {
  nodeId: string;
  properties: string[];
}

/**
 * A Patch describes how to transform a document to apply a fix.
 */
export interface Patch {
  apply: (doc: unknown) => unknown;
  affects: PatchAffects[];
  summary: PatchSummary;
}

/**
 * Result of computing a fix.
 */
export interface FixResult {
  ok: boolean;
  reason?: string;
  detail?: string;
  patch: Patch;
  affects: string[];
  summary: PatchSummary;
}

/**
 * A named, previewable fix descriptor.
 */
export interface FixDescriptor {
  id: string;
  labelKey: string;
  kind: FixKind;
  compute: (doc: unknown) => FixResult;
}

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

  /** Whether this fix is safe, destructive, or assisted. */
  kind?: FixKind;

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
 * @deprecated Use AuditFinding from @varve/scene instead. This type remains
 * for the intelligence subsystem migration. New code should import
 * AuditFinding from '@varve/scene'.
 *
 * Conversion functions:
 *   {@link sceneFindingToShared} — converts a scene AuditFinding to this shape.
 *   {@link sharedFindingToSceneFinding} — converts this shape to scene AuditFinding
 *   (in @varve/scene/src/auditFinding.ts).
 *
 * Migration tracking: packages/scene/src/intelligence/ files still import this
 * type. Once they are updated to import from '../auditFinding', this type can
 * be removed or reduced to a pure persistence schema.
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
// Cross-type bridge converters
// ============================================================================

/**
 * Convert a scene AuditFinding (from @varve/scene) to the shared format.
 * Accepts a plain object matching the scene shape so no import from
 * @varve/scene is needed (avoids circular dependency).
 *
 * The shared AuditFinding is used by the intelligence subsystem (scheduler,
 * overlay manager, cache, pipeline) which cannot depend on scene types.
 */
export function sceneFindingToShared(finding: {
  ruleId: string;
  ruleVersion: number;
  findingId: string;
  severity: AuditSeverity;
  confidence: number;
  message: string;
  detail?: string;
  nodeId?: string;
  nodeIds?: string[];
  pageId?: string;
  region?: { x: number; y: number; w: number; h: number; pageId?: string };
  interactionId?: string;
  targetName?: string;
  evidence?: Record<string, unknown>;
  standardReference?: string;
  documentationUrl?: string;
  recommendation?: string;
  autoFixAvailable?: boolean;
  cost: string;
  workspaceApplicable?: string[];
  applicableModes?: string[];
  blocking?: boolean;
  revision?: number;
  generatedAt?: number;
  stale?: boolean;
  resolved?: boolean;
  scanId?: number;
  suppressionEligible?: boolean;
  suppressionScope?: string;
  metadata?: Record<string, unknown>;
}): AuditFinding {
  return {
    findingId: finding.findingId,
    ruleId: finding.ruleId,
    ruleVersion: String(finding.ruleVersion),
    severity: finding.severity,
    category: mapSceneCategory(finding),
    confidence: finding.confidence,
    nodeIds: finding.nodeIds ?? (finding.nodeId ? [finding.nodeId] : []),
    region: finding.region,
    interactionId: finding.interactionId,
    targetName: finding.targetName,
    message: finding.message,
    detail: finding.detail,
    evidence: finding.evidence,
    standardReference: finding.standardReference,
    documentationUrl: finding.documentationUrl,
    fixCapability: finding.autoFixAvailable ? 'automatic' : 'none',
    fixes: [],
    applicableWorkspaces: (finding.workspaceApplicable ?? []) as WorkspaceMode[],
    applicableModes: [],
    applicableNodeKinds: [],
    documentRevision: finding.revision ?? 0,
    timestamp: finding.generatedAt ?? Date.now(),
    stale: finding.stale ?? false,
    resolved: finding.resolved ?? false,
    suppressionEligible: finding.suppressionEligible ?? false,
    suppressionScope: (finding.suppressionScope ?? 'finding') as
      | 'finding'
      | 'node'
      | 'rule'
      | 'document',
    cost:
      finding.cost === 'cheap' || finding.cost === 'moderate' || finding.cost === 'expensive'
        ? (finding.cost as ExecutionCost)
        : 'moderate',
    scope: 'document',
    scanId: finding.scanId ?? 0,
  };
}

function mapSceneCategory(finding: {
  category?: string;
  evidence?: Record<string, unknown>;
}): AuditCategory {
  const cat = finding.category;
  const valid: AuditCategory[] = [
    'contrast',
    'typography',
    'layout',
    'accessibility',
    'vector',
    'raster',
    'color',
    'performance',
    'spacing',
    'codegen',
    'prototype',
    'governance',
    'layer-hygiene',
    'touch-target',
    'focus-order',
  ];
  if (cat && (valid as string[]).includes(cat)) return cat as AuditCategory;
  return 'accessibility';
}

/**
 * Convert a shared AuditFinding back to the canonical scene shape.
 * Returns a plain object that matches AuditFinding from @varve/scene.
 * Use after importing the scene type separately.
 */
export function sharedFindingToSceneShape(finding: AuditFinding): Record<string, unknown> {
  return {
    ruleId: finding.ruleId,
    ruleVersion: parseInt(finding.ruleVersion, 10) || 1,
    findingId: finding.findingId,
    severity: finding.severity,
    confidence: finding.confidence,
    nodeIds: finding.nodeIds,
    message: finding.message,
    detail: finding.detail,
    region: finding.region,
    interactionId: finding.interactionId,
    targetName: finding.targetName,
    evidence: finding.evidence,
    standardReference: finding.standardReference,
    documentationUrl: finding.documentationUrl,
    autoFixAvailable: finding.fixCapability === 'automatic' || finding.fixCapability === 'assisted',
    cost: finding.cost === 'immediate' ? 'cheap' : finding.cost,
    workspaceApplicable: finding.applicableWorkspaces,
    blocking: finding.severity === 'error',
    revision: finding.documentRevision,
    generatedAt: finding.timestamp,
    stale: finding.stale,
    resolved: finding.resolved,
    scanId: finding.scanId,
    suppressionEligible: finding.suppressionEligible,
    suppressionScope: finding.suppressionScope,
  };
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
