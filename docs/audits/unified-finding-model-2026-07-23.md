# Unified Finding Model

Generated: 2026-07-23
Purpose: Define a unified finding model that normalizes audit results across all audit systems

## Current State Analysis

### Existing Finding Models

**Scene Intelligence Audit:**
```typescript
interface AuditIssue {
  nodeId: string;
  type: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  autoFix?: () => Document;
}
```

**Debt Scanner:**
```typescript
interface DebtIssue {
  checkId: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  nodeId?: NodeId;
  fixable: boolean;
  autoFix?: (doc: Document) => Document;
}
```

**Governance Rules:**
```typescript
interface GovernanceIssue {
  ruleId: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  nodeId?: NodeId;
  targetName?: string;
  autoFix?: (doc: Document) => Document;
}
```

**Design Linter:**
```typescript
interface LinterIssue {
  ruleId: string;
  severity: 'error' | 'warning' | 'info' | 'suggestion';
  category: LinterCategory;
  nodeIds: NodeId[];
  message: string;
  detail?: string;
  evidence?: Record<string, unknown>;
  fixes: LinterFix[];
  dismissable: boolean;
  version: string;
  cost?: 'cheap' | 'moderate' | 'expensive';
  scope: LinterScope;
  confidence?: number;
}
```

**Codegen Audit:**
```typescript
interface AuditFinding {
  nodeId: string;
  nodeName: string;
  category: AuditCategory;
  severity: 'error' | 'warning' | 'info';
  message: string;
  recommendation?: string;
  autoFixAvailable: boolean;
}
```

**Prototype Validation:**
```typescript
interface ValidationIssue {
  code: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  nodeId?: NodeId;
  interactionId?: string;
}
```

### Problems with Current Models

1. **Inconsistent field names:** `type` vs `checkId` vs `ruleId` vs `code`
2. **Inconsistent severity:** Linter has 'suggestion', others don't
3. **No stable finding IDs:** Can't track findings across re-runs
4. **Inconsistent node references:** `nodeId` vs `nodeIds` vs `nodeId?`
5. **No confidence tracking:** Only linter has confidence
6. **Inconsistent evidence:** Only linter has evidence field
7. **No workspace applicability:** No field for which workspaces apply
8. **No mode applicability:** No field for which modes apply
9. **No suppression metadata:** Only linter has dismissable
10. **No document revision:** Can't detect stale results
11. **No fix preview:** No way to preview fix before applying
12. **No standard reference:** No link to standards or documentation

---

## Unified Finding Model

### Core Finding Interface

```typescript
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
```

### Supporting Types

```typescript
/** Severity classification - normalized across all audit systems. */
export type AuditSeverity = 'error' | 'warning' | 'suggestion' | 'advisory';

/** Category for grouping in the panel and filtering. */
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

/** Fix capability - what kind of fix is available. */
export type FixCapability = 'none' | 'automatic' | 'assisted' | 'manual';

/** Execution cost for scheduling. */
export type ExecutionCost = 'immediate' | 'cheap' | 'moderate' | 'expensive';

/** Scope this rule operates in. */
export type AuditScope = 'document' | 'page' | 'selection' | 'prototype';

/** Editor mode this finding applies to. */
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

/** Node kind this finding applies to. */
export type NodeKind =
  | 'frame'
  | 'group'
  | 'shape'
  | 'text'
  | 'image'
  | 'component'
  | 'instance';

/** A named, previewable fix for a finding. */
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
  apply: (doc: Document) => Document | null;
  
  /** Whether the fix has a side effect beyond the document (e.g., selection). */
  changesSelection?: boolean;
  
  /** Whether this fix can be previewed before applying. */
  previewable: boolean;
  
  /** Preview function - returns a preview of the fix without applying it. */
  preview?: (doc: Document) => FixPreview;
}

/** Preview of a fix before applying. */
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

/** Suppression record for a finding. */
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
}
```

---

## Finding ID Generation

### ID Format

```
{ruleId}:{nodeId}:{hash}
```

**Components:**
- `ruleId`: Rule identifier (e.g., "contrast/aa-fail/v1")
- `nodeId`: Affected node ID (or "document" for document-level issues)
- `hash`: Hash of finding-specific parameters (e.g., contrast ratio, DPI value)

### Hash Generation

```typescript
function generateFindingHash(
  ruleId: string,
  nodeId: string,
  params: Record<string, unknown>
): string {
  const key = `${ruleId}:${nodeId}:${JSON.stringify(params)}`;
  // Simple hash function (replace with proper hash in production)
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    const char = key.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(36);
}

// Example:
// ruleId: "contrast/aa-fail/v1"
// nodeId: "node-123"
// params: { ratio: 2.1, minRatio: 3.0, largeText: false }
// findingId: "contrast/aa-fail/v1:node-123:a7f3c"
```

### Stability Guarantees

**Finding ID remains stable when:**
- Document is edited but the specific issue hasn't changed
- Rule is re-run with same parameters
- Document is saved and reopened
- Finding is suppressed and later re-validated

**Finding ID changes when:**
- Rule version changes (ruleId changes)
- Node ID changes (node renamed, deleted, recreated)
- Finding parameters change (contrast ratio changes, DPI changes)
- Finding is resolved and re-occurs with different parameters

---

## Severity Normalization

### Severity Levels

| Severity | Definition | Examples | Blocking |
|----------|------------|----------|----------|
| **error** | Blocks correctness, accessibility, save, export, or output integrity | Missing fonts, broken prototype targets, below minimum DPI | Yes |
| **warning** | Likely to cause degraded results or usability | Low contrast (not critical), overset text, excessive nesting | No |
| **suggestion** | Useful improvement with objective evidence | Type scale violations, inconsistent border radius | No |
| **advisory** | Subjective or context-dependent recommendation | Naming style, design pattern suggestions | No |

### Mapping from Existing Systems

**Scene Intelligence:**
- `error` → `error`
- `warning` → `warning`
- `info` → `suggestion` (if objective) or `advisory` (if subjective)

**Debt Scanner:**
- `error` → `error`
- `warning` → `warning`
- `info` → `suggestion` (if objective) or `advisory` (if subjective)

**Governance:**
- `error` → `error`
- `warning` → `warning`
- `info` → `suggestion` (if objective) or `advisory` (if subjective)

**Linter:**
- `error` → `error`
- `warning` → `warning`
- `info` → `suggestion`
- `suggestion` → `advisory`

**Codegen:**
- `error` → `error`
- `warning` → `warning`
- `info` → `suggestion`

**Prototype:**
- `error` → `error`
- `warning` → `warning`
- `info` → `suggestion`

### Severity Upgrade Rules

**Upgrade to error when:**
- Finding blocks export (export preflight)
- Finding violates accessibility standard (WCAG AA failure)
- Finding causes data loss or corruption
- Finding breaks prototype flow

**Downgrade to advisory when:**
- Finding is purely stylistic (naming convention)
- Finding is subjective (design pattern)
- Finding has low confidence (< 0.5)
- Finding is in a specialist workspace and user is not a specialist

---

## Confidence Tracking

### Confidence Levels

| Confidence | Range | Definition | Default Filter |
|-------------|-------|------------|---------------|
| **Certain** | 0.9-1.0 | Finding is definitively correct | Always show |
| **Probable** | 0.7-0.9 | Finding is likely correct | Show in general profile |
| **Uncertain** | 0.5-0.7 | Finding may be correct | Show in specialist profile |
| **Speculative** | <0.5 | Finding is a guess | Hide by default |

### Confidence Assignment

**Certain (0.9-1.0):**
- Missing fonts (definitive check)
- Broken prototype targets (definitive check)
- Below minimum DPI (definitive calculation)
- Zero-size layers (definitive measurement)

**Probable (0.7-0.9):**
- Low contrast (calculated but may miss blends/masks)
- Touch target violations (calculated but may miss invisible padding)
- Overset text (calculated but may depend on rendering)

**Uncertain (0.5-0.7):**
- Non-text contrast (background context unclear)
- Focus order (depends on prototype interaction modeling)
- Color profile mismatch (depends on ICC profile interpretation)

**Speculative (<0.5):**
- Design pattern violations (subjective)
- Naming convention violations (subjective)
- Performance warnings (depends on runtime environment)

### Confidence in Existing Systems

**Currently has confidence:**
- Linter: 0.3-0.9 (non-text-contrast, touch-target)

**Needs confidence added:**
- Scene Intelligence: 1.0 (contrast is definitive for solid RGB)
- Debt Scanner: 1.0 (all checks are definitive)
- Governance: 1.0 (all checks are definitive)
- Codegen: 1.0 (all checks are definitive calculations)
- Prototype: 1.0 (all checks are definitive)

---

## Evidence Structure

### Standard Evidence Fields

**Contrast findings:**
```typescript
{
  ratio: number;           // Calculated contrast ratio
  minRatio: number;        // Required minimum ratio
  largeText: boolean;      // Whether text is large
  fgColor: [number, number, number, number];  // RGBA
  bgColor: [number, number, number, number];  // RGBA
}
```

**Resolution findings:**
```typescript
{
  effectiveDPI: number;   // Calculated effective DPI
  imageWidth: number;      // Source image width
  imageHeight: number;     // Source image height
  displayWidth: number;    // Display width
  displayHeight: number;   // Display height
  minDPI: number;          // Required minimum DPI
}
```

**Touch target findings:**
```typescript
{
  actualSize: number;      // Actual touch target size
  minSize: number;         // Required minimum size
  width: number;           // Node width
  height: number;          // Node height
  isHidden: boolean;       // Whether node is hidden
}
```

**Path quality findings:**
```typescript
{
  anchorCount: number;     // Total anchor points
  redundantCount: number;  // Redundant anchor points
  selfIntersecting: boolean;
  openEndpoints: number;
  area: number;            // Path area
}
```

### Evidence Serialization

Evidence must be serializable for:
- Export to reports (JSON, PDF)
- Storage in document metadata
- Transmission to external tools
- Cache invalidation (compare evidence hashes)

```typescript
function serializeEvidence(evidence: Record<string, unknown>): string {
  return JSON.stringify(evidence, Object.keys(evidence).sort());
}

function evidenceHash(evidence: Record<string, unknown>): string {
  const serialized = serializeEvidence(evidence);
  // Simple hash (replace with proper hash in production)
  let hash = 0;
  for (let i = 0; i < serialized.length; i++) {
    const char = serialized.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}
```

---

## Fix Capability

### Fix Capability Levels

| Capability | Definition | Example |
|------------|------------|---------|
| **none** | No automatic fix available | Naming violations, orphan styles |
| **automatic** | Safe one-click fix with predictable outcome | Contrast adjustment, missing font replacement |
| **assisted** | Fix requires user input or confirmation | Path simplification (threshold selection) |
| **manual** | Fix requires manual intervention | Broken prototype targets (user must select new target) |

### Fix Preview

**Preview Types:**
- **Color preview:** Show before/after color swatches
- **Number preview:** Show before/after numeric values
- **Text preview:** Show before/after text content
- **Visual preview:** Show before/after on canvas (if applicable)

**Preview Implementation:**
```typescript
interface FixPreview {
  description: string;
  affectedNodeIds: NodeId[];
  changes: Array<{
    nodeId: NodeId;
    property: string;
    before: unknown;
    after: unknown;
  }>;
  visualPreview?: {
    type: 'color' | 'number' | 'text';
    before: string;
    after: string;
  };
}
```

### Batch Fixes

**Batch Fix Criteria:**
- All findings must have same rule ID
- All findings must have same fix ID
- Fixes must be independent (no conflicts)
- User must confirm batch operation

**Batch Fix Flow:**
1. User selects multiple findings
2. System checks if all have same fix
3. If yes, show "Fix all (N)" button
4. User clicks button
5. System shows preview of all changes
6. User confirms
7. System applies all fixes in single undo entry
8. System re-runs affected rules

---

## Suppression Model

### Suppression Scope

| Scope | What Gets Suppressed | Example |
|-------|---------------------|---------|
| **finding** | This specific finding only | Suppress one contrast issue on one node |
| **node** | All findings on this node | Suppress all issues on "Header" node |
| **rule** | All findings from this rule | Suppress all "unnamed-layers" findings |
| **document** | All findings in document | Suppress all findings (rare, requires confirmation) |

### Suppression Eligibility

**Always suppressible:**
- Advisory findings (subjective recommendations)
- Suggestion findings (objective but non-blocking)
- Info findings (informational)

**Conditionally suppressible:**
- Warning findings (require confirmation)
- Error findings (require explicit confirmation + reason)

**Never suppressible:**
- Security vulnerabilities
- Data corruption issues
- Critical export errors
- Findings that block save

### Suppression Record

```typescript
interface SuppressionRecord {
  id: string;
  userId?: string;
  reason?: string;
  suppressedAt: number;
  expiresAt?: number;
  revalidateOnEdit: boolean;
}
```

### Suppression Revalidation

**Revalidation triggers:**
- Document is edited (if `revalidateOnEdit: true`)
- Rule version changes
- Document revision changes significantly
- Suppression expires (if `expiresAt` set)

**Revalidation logic:**
1. Check if suppression is still valid
2. Re-run rule for affected scope
3. If finding still exists, keep suppression
4. If finding changed, update finding ID
5. If finding resolved, mark as resolved

---

## Migration Strategy

### Phase 1: Define Unified Model (Week 1)
1. Define `AuditFinding` interface in shared package
2. Define supporting types (AuditSeverity, AuditCategory, etc.)
3. Add finding ID generation utilities
4. Add evidence serialization utilities
5. Add migration adapters for existing systems

### Phase 2: Migrate Existing Systems (Week 2-3)
1. Create adapter for Scene Intelligence Audit
2. Create adapter for Debt Scanner
3. Create adapter for Governance Rules
4. Create adapter for Design Linter
5. Create adapter for Codegen Audits
6. Create adapter for Prototype Validation

### Phase 3: Update Consumers (Week 4)
1. Update IntelligencePanel to use unified model
2. Update DebtBadge to use unified model
3. Update commands to use unified model
4. Update status bar indicators to use unified model
5. Update preflight to use unified model

### Phase 4: Add New Features (Week 5-6)
1. Implement suppression system
2. Implement fix preview system
3. Implement batch fix system
4. Implement confidence filtering
5. Implement evidence display

### Adapter Pattern

```typescript
interface AuditAdapter<T> {
  /** Convert from legacy finding to unified finding. */
  toUnified(legacy: T, doc: Document, scanId: number): AuditFinding;
  
  /** Convert from unified finding back to legacy format (if needed). */
  fromLegacy(unified: AuditFinding): T;
}

// Example adapter for Scene Intelligence
const sceneIntelligenceAdapter: AuditAdapter<AuditIssue> = {
  toUnified(legacy, doc, scanId) {
    const node = doc.nodes[legacy.nodeId];
    return {
      findingId: generateFindingId(legacy.type, legacy.nodeId, {}),
      ruleId: `contrast/${legacy.type}/v1`,
      ruleVersion: 'v1',
      severity: legacy.severity === 'error' ? 'error' : 
                 legacy.severity === 'warning' ? 'warning' : 'suggestion',
      category: 'contrast',
      confidence: 1.0,
      nodeIds: [legacy.nodeId],
      message: legacy.message,
      evidence: legacy.autoFix ? { hasAutoFix: true } : undefined,
      fixCapability: legacy.autoFix ? 'automatic' : 'none',
      fixes: legacy.autoFix ? [{
        id: 'auto-fix',
        label: 'Auto-fix',
        apply: legacy.autoFix,
        previewable: true,
      }] : [],
      applicableWorkspaces: [],
      applicableModes: [],
      applicableNodeKinds: ['text'],
      documentRevision: doc.revision,
      timestamp: Date.now(),
      stale: false,
      resolved: false,
      suppressionEligible: legacy.severity !== 'error',
      suppressionScope: 'finding',
      cost: 'immediate',
      scope: 'document',
      scanId,
    };
  },
  fromLegacy(unified) {
    // Not needed for this adapter
    return {} as AuditIssue;
  },
};
```

---

## Testing Requirements

### Unit Tests
- Finding ID generation stability
- Severity mapping correctness
- Confidence assignment logic
- Evidence serialization
- Fix preview generation
- Suppression record validation

### Integration Tests
- Adapter conversion for all systems
- Unified finding model in IntelligencePanel
- Suppression system with revalidation
- Fix preview and application
- Batch fix operations

### E2E Tests
- End-to-end finding lifecycle (generate → suppress → revalidate → resolve)
- Cross-system finding consistency
- Deep linking with finding IDs
- Export reports with unified findings
- Workspace switching with finding preservation

---

## Performance Considerations

### Finding Generation
- **Lazy evidence generation:** Only generate evidence when needed
- **Memoized ID generation:** Cache finding IDs for same parameters
- **Batch conversion:** Convert all findings in single pass
- **Parallel adapters:** Run adapters in parallel where possible

### Finding Storage
- **Limit finding count:** Cap at 10,000 findings per document
- **Compress evidence:** Store evidence as compressed JSON
- **Lazy loading:** Load findings on demand for large documents
- **Index by rule:** Create rule-based index for fast filtering

### Cache Invalidation
- **Revision-based:** Clear cache when document revision changes
- **Rule-based:** Clear cache when rule version changes
- **Selective:** Only re-run affected rules on document change
- **Debounced:** Debounce finding regeneration during rapid edits

---

## Documentation Updates

### API Documentation
- "Audit Finding Model" - Complete reference for AuditFinding interface
- "Finding ID Generation" - Algorithm and stability guarantees
- "Severity Levels" - Definitions and mapping rules
- "Confidence Tracking" - Assignment guidelines
- "Fix Capability" - Fix types and preview system

### Migration Guide
- "Migrating to Unified Finding Model" - Guide for developers
- "Adapter Pattern" - How to create adapters for custom rules
- "Breaking Changes" - List of breaking changes
- "FAQ" - Common questions about migration

### User Documentation
- "Understanding Audit Findings" - Guide for users
- "Severity Levels Explained" - What each severity means
- "Suppression Best Practices" - When to suppress findings
- "Fix Previews" - How to use fix previews
