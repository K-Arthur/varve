# Suppression and Exception Management

Generated: 2026-07-23
Purpose: Design suppression and exception management with portability and revalidation

## Current State

### Existing Suppression Support

**Design Linter:**
- `dismissable` flag per issue
- `LinterConfig.suppressedFindings` array (ruleId + nodeId combinations)
- Stored on Document.linterConfig
- No revalidation logic
- No portability across documents
- No exception management

**Other Systems:**
- No suppression support
- No dismissal capability
- No exception tracking

### Problems
1. **Inconsistent suppression:** Only linter supports suppression
2. **No revalidation:** Suppressed findings never re-validated
3. **No portability:** Suppressions don't transfer across documents
4. **No exception management:** No way to manage exceptions at team level
5. **No suppression hierarchy:** No distinction between finding/node/rule/document suppression
6. **No suppression expiry:** Suppressions last forever
7. **No suppression audit:** No tracking of who suppressed what and why
8. **No suppression migration:** Suppressions break when rules change

---

## Suppression Philosophy

### Core Principles

**1. Suppression is an exception, not a workaround**
- Suppressions should be rare and intentional
- Require explicit confirmation for errors/warnings
- Require reason for audit trail
- Subject to team review in collaborative environments

**2. Suppressions must be portable**
- Suppressions should transfer across documents
- Suppressions should be shareable across teams
- Suppressions should survive document format changes
- Suppressions should be exportable/importable

**3. Suppressions must revalidate**
- Suppressions should revalidate on document changes
- Suppressions should revalidate on rule changes
- Suppressions should expire after a period
- Suppressions should be manually revalidatable

**4. Suppressions must be auditable**
- Track who suppressed what and when
- Track reason for suppression
- Track suppression lifecycle
- Provide suppression history

---

## Suppression Scope

### Scope Levels

**Finding-Level Suppression**
- Suppresses a single finding instance
- Finding ID: `{ruleId}:{nodeId}:{hash}`
- Use case: One-off issue that won't recur
- Revalidation: On document change affecting this finding

**Node-Level Suppression**
- Suppresses all findings on a specific node
- Node ID: `{nodeId}`
- Use case: Node is intentionally non-compliant (e.g., decorative element)
- Revalidation: On document change affecting this node

**Rule-Level Suppression**
- Suppresses all findings from a specific rule
- Rule ID: `{ruleId}`
- Use case: Rule is not applicable to this document
- Revalidation: On rule version change

**Document-Level Suppression**
- Suppresses all findings in the document
- Document ID: `{documentId}`
- Use case: Document is a prototype/scratchpad
- Revalidation: Manual only
- Requires explicit confirmation

### Scope Hierarchy

```
Document (broadest)
  ↓
Rule
  ↓
Node
  ↓
Finding (narrowest)
```

**Precedence:**
- Narrower scope overrides broader scope
- Finding suppression overrides node suppression
- Node suppression overrides rule suppression
- Rule suppression overrides document suppression

**Example:**
- Document-level suppression for "unnamed-layers" rule
- Node-level suppression for "Header" node (overrides document)
- Finding-level suppression for specific contrast issue on "Header" (overrides node)

---

## Suppression Record

### Suppression Schema

```typescript
interface SuppressionRecord {
  /** Unique suppression ID */
  id: string;
  
  /** Suppression scope */
  scope: 'finding' | 'node' | 'rule' | 'document';
  
  /** Target identifier (findingId, nodeId, ruleId, or documentId) */
  targetId: string;
  
  /** User who suppressed this finding */
  userId?: string;
  
  /** Reason for suppression (required for errors/warnings) */
  reason?: string;
  
  /** Timestamp when suppressed */
  suppressedAt: number;
  
  /** Expiry timestamp (null = never expires) */
  expiresAt: number | null;
  
  /** Whether to revalidate on document changes */
  revalidateOnEdit: boolean;
  
  /** Whether to revalidate on rule version changes */
  revalidateOnRuleChange: boolean;
  
  /** Rule version at time of suppression (for revalidation) */
  ruleVersion?: string;
  
  /** Document revision at time of suppression (for staleness detection) */
  documentRevision: number;
  
  /** Whether suppression is active */
  active: boolean;
  
  /** Timestamp when suppression was lifted (if inactive) */
  liftedAt?: number;
  
  /** User who lifted the suppression */
  liftedBy?: string;
  
  /** Reason for lifting */
  liftReason?: string;
}
```

### Suppression Storage

**Document-level storage:**
```typescript
interface DocumentAuditState {
  /** Suppressions for this document */
  suppressions: SuppressionRecord[];
  
  /** Current findings */
  findings: AuditFinding[];
  
  /** Suppression preferences */
  suppressionPreferences: {
    defaultExpiryDays: number;
    revalidateOnEdit: boolean;
    revalidateOnRuleChange: boolean;
  };
}
```

**Workspace-level storage:**
```typescript
interface WorkspaceAuditConfig {
  /** Default suppressions for this workspace */
  defaultSuppressions: SuppressionRecord[];
  
  /** Suppression templates (pre-configured common suppressions) */
  suppressionTemplates: SuppressionTemplate[];
}
```

**Team-level storage (for collaboration):**
```typescript
interface TeamAuditConfig {
  /** Team-wide suppressions (approved exceptions) */
  teamSuppressions: SuppressionRecord[];
  
  /** Suppression approval workflow */
  approvalWorkflow: {
    required: boolean;
    approvers: string[];
  };
}
```

---

## Suppression Workflow

### Suppress Finding Flow

```
1. User clicks "Dismiss" button on finding
   ↓
2. System checks if suppression is allowed
   ↓
3a. If finding is error:
   - Show confirmation dialog
   - Require reason (required field)
   - Show warning about blocking issues
   ↓
3b. If finding is warning:
   - Show confirmation dialog
   - Require reason (optional field)
   ↓
3c. If finding is suggestion/advisory:
   - Suppress immediately (no confirmation)
   ↓
4. User confirms suppression
   ↓
5. System creates suppression record
   ↓
6. System adds suppression to document
   ↓
7. System removes finding from display
   ↓
8. System shows success notification
```

### Suppression Confirmation Dialog

```
┌─────────────────────────────────────────┐
│ Suppress Finding                        │
├─────────────────────────────────────────┤
│ Are you sure you want to suppress this  │
│ finding?                                │
│                                         │
│ Finding: "Header" has 2.1:1 contrast    │
│ Severity: Error                         │
│                                         │
│ Reason (required):                      │
│ [This is a decorative element _______]  │
│                                         │
│ Scope:                                  │
│ ○ This finding only                    │
│ ○ All findings on this node            │
│ ○ All findings from this rule          │
│                                         │
│ Revalidation:                           │
│ ☑ Revalidate on document changes       │
│ ☑ Revalidate on rule updates           │
│                                         │
│ Expires:                                │
│ ○ Never                                │
│ ○ In 7 days                            │
│ ○ In 30 days                           │
│ ○ Custom: [___] days                   │
│                                         │
│ [Suppress] [Cancel]                      │
└─────────────────────────────────────────┘
```

### Lift Suppression Flow

```
1. User clicks "View suppressed findings" in Audit panel
   ↓
2. System shows list of suppressed findings
   ↓
3. User clicks "Lift" on a suppression
   ↓
4. System shows confirmation dialog
   ↓
5. User confirms
   ↓
6. System marks suppression as inactive
   ↓
7. System re-runs affected rule
   ↓
8. System shows finding if still exists
   ↓
9. System shows success notification
```

---

## Revalidation Logic

### Revalidation Triggers

**Document Change Revalidation:**
- Trigger: Document is edited
- Check: `suppression.revalidateOnEdit === true`
- Scope: Affected findings only
- Logic:
  1. Identify findings affected by document change
  2. Check if suppressions exist for affected findings
  3. Re-run rules for affected findings
  4. If finding still exists, keep suppression
  5. If finding changed, update finding ID
  6. If finding resolved, mark suppression as lifted

**Rule Version Change Revalidation:**
- Trigger: Rule version changes
- Check: `suppression.revalidateOnRuleChange === true`
- Scope: All findings from this rule
- Logic:
  1. Identify all suppressions for this rule
  2. Compare `suppression.ruleVersion` with current rule version
  3. If versions match, keep suppression
  4. If versions differ, re-run rule
  5. If finding still exists, update suppression with new version
  6. If finding changed, update finding ID
  7. If finding resolved, mark suppression as lifted

**Expiry Revalidation:**
- Trigger: Suppression expires
- Check: `suppression.expiresAt !== null && suppression.expiresAt < now`
- Scope: Expired suppressions
- Logic:
  1. Identify expired suppressions
  2. Re-run rules for affected findings
  3. If finding still exists, show notification
  4. If finding resolved, mark suppression as lifted

**Manual Revalidation:**
- Trigger: User clicks "Revalidate all suppressions"
- Scope: All active suppressions
- Logic:
  1. Re-run all rules for suppressed findings
  2. Update suppression status based on results
  3. Show summary of revalidation results

### Revalidation Algorithm

```typescript
async function revalidateSuppressions(
  doc: Document,
  suppressions: SuppressionRecord[],
  trigger: 'edit' | 'rule-change' | 'expiry' | 'manual'
): Promise<RevalidationResult> {
  const results: RevalidationResult = {
    total: suppressions.length,
    kept: 0,
    lifted: 0,
    updated: 0,
    errors: 0,
  };
  
  for (const suppression of suppressions) {
    if (!suppression.active) continue;
    
    // Check if revalidation is needed for this trigger
    if (trigger === 'edit' && !suppression.revalidateOnEdit) continue;
    if (trigger === 'rule-change' && !suppression.revalidateOnRuleChange) continue;
    if (trigger === 'expiry' && (suppression.expiresAt === null || suppression.expiresAt > Date.now())) continue;
    
    try {
      // Re-run rule for this suppression
      const finding = await revalidateFinding(doc, suppression);
      
      if (finding) {
        // Finding still exists
        if (finding.findingId !== suppression.targetId) {
          // Finding changed (parameters changed)
          suppression.targetId = finding.findingId;
          suppression.ruleVersion = finding.ruleVersion;
          results.updated++;
        } else {
          // Finding unchanged
          results.kept++;
        }
      } else {
        // Finding resolved
        suppression.active = false;
        suppression.liftedAt = Date.now();
        suppression.liftReason = 'Revalidation: finding resolved';
        results.lifted++;
      }
    } catch (error) {
      results.errors++;
    }
  }
  
  return results;
}
```

---

## Portability

### Export Format

**JSON Export:**
```json
{
  "version": "1",
  "exportedAt": "2026-07-23T12:00:00Z",
  "documentId": "doc-123",
  "documentName": "My Design",
  "suppressions": [
    {
      "id": "supp-1",
      "scope": "finding",
      "targetId": "contrast/aa-fail/v1:node-123:a7f3c",
      "reason": "This is a decorative element",
      "suppressedAt": "2026-07-23T10:00:00Z",
      "expiresAt": "2026-08-23T10:00:00Z",
      "revalidateOnEdit": true,
      "revalidateOnRuleChange": true
    }
  ]
}
```

**CSV Export:**
```csv
id,scope,targetId,reason,suppressedAt,expiresAt,revalidateOnEdit
supp-1,finding,contrast/aa-fail/v1:node-123:a7f3c,"This is a decorative element",2026-07-23T10:00:00Z,2026-08-23T10:00:00Z,true
```

### Import Format

**Import Options:**
- **Merge:** Add suppressions to existing suppressions
- **Replace:** Replace existing suppressions with imported
- **Selective:** User selects which suppressions to import

**Import Validation:**
- Check if target findings still exist
- Check if rule versions match
- Check if suppressions are expired
- Check for conflicts with existing suppressions

**Import Dialog:**
```
┌─────────────────────────────────────────┐
│ Import Suppressions                     │
├─────────────────────────────────────────┤
│ Found 5 suppressions to import          │
│                                         │
│ □ contrast/aa-fail/v1:node-123:a7f3c   │
│   Reason: This is a decorative element  │
│   Status: ✓ Valid (finding exists)      │
│                                         │
□ unnamed-layers:v1:node-456             │
│   Reason: Default name is acceptable    │
│   Status: ⚠ Expired (expired 2 days ago)│
│                                         │
□ token-color/v1:node-789                 │
│   Reason: Intentional deviation         │
│   Status: ✗ Invalid (node deleted)      │
│                                         │
│ Import mode:                             │
│ ○ Merge with existing suppressions       │
│ ○ Replace existing suppressions         │
│ ○ Selective import                     │
│                                         │
│ [Import] [Cancel]                        │
└─────────────────────────────────────────┘
```

### Cross-Document Portability

**Use Case:** Apply same suppressions to similar documents

**Implementation:**
1. Export suppressions from source document
2. Import to target document
3. System validates suppressions against target document
4. System maps finding IDs to target document
5. User confirms import

**Finding ID Mapping:**
- Source finding ID: `{ruleId}:{sourceNodeId}:{hash}`
- Target finding ID: `{ruleId}:{targetNodeId}:{hash}`
- Mapping based on node name or position

---

## Exception Management

### Team Exceptions

**Exception Request Workflow:**
1. User requests exception for a finding
2. System creates exception request
3. Approvers review request
4. Approvers approve or reject
5. If approved, exception is added to team suppressions
6. Exception applies to all team documents

**Exception Request Schema:**
```typescript
interface ExceptionRequest {
  id: string;
  requestedBy: string;
  requestedAt: number;
  ruleId: string;
  findingId?: string;
  nodeId?: string;
  reason: string;
  justification: string;
  impact: string;
  proposedExpiry: number | null;
  status: 'pending' | 'approved' | 'rejected';
  approvers: string[];
  approvedBy?: string;
  approvedAt?: number;
  rejectionReason?: string;
}
```

### Exception Templates

**Pre-configured common exceptions:**
- Decorative elements (WCAG exceptions)
- Brand colors (color token exceptions)
- Legacy content (naming exceptions)
- Prototype content (export exceptions)

**Template Schema:**
```typescript
interface SuppressionTemplate {
  id: string;
  name: string;
  description: string;
  scope: 'finding' | 'node' | 'rule';
  ruleId?: string;
  defaultReason: string;
  defaultExpiryDays: number;
  revalidateOnEdit: boolean;
  revalidateOnRuleChange: boolean;
}
```

**Example Templates:**
```typescript
const SUPPRESSION_TEMPLATES: SuppressionTemplate[] = [
  {
    id: 'decorative-element',
    name: 'Decorative Element',
    description: 'Element is decorative and does not need to meet accessibility standards',
    scope: 'node',
    defaultReason: 'This is a decorative element with no semantic meaning',
    defaultExpiryDays: null,
    revalidateOnEdit: false,
    revalidateOnRuleChange: false,
  },
  {
    id: 'brand-color-deviation',
    name: 'Brand Color Deviation',
    description: 'Color is a brand color that intentionally deviates from design system',
    scope: 'finding',
    ruleId: 'token-color/v1',
    defaultReason: 'Brand color approved by design team',
    defaultExpiryDays: 365,
    revalidateOnEdit: false,
    revalidateOnRuleChange: true,
  },
];
```

---

## Suppression UI

### Suppressed Findings Panel

```
┌─────────────────────────────────────────┐
│ Suppressed Findings (3)                 │
├─────────────────────────────────────────┤
│ [Revalidate All] [Export] [Import]      │
├─────────────────────────────────────────┤
│ ▶ contrast/aa-fail on Header            │
│   Suppressed: 2 days ago                │
│   Reason: Decorative element            │
│   Expires: Never                        │
│   [Lift] [Edit]                         │
│                                         │
│ ▶ unnamed-layers on Rectangle 1        │
│   Suppressed: 1 week ago                │
│   Reason: Default name acceptable       │
│   Expires: In 23 days                   │
│   [Lift] [Edit]                         │
│                                         │
│ ▶ token-color on Button                 │
│   Suppressed: 3 days ago                │
│   Reason: Brand color deviation          │
│   Expires: In 362 days                  │
│   [Lift] [Edit]                         │
└─────────────────────────────────────────┘
```

### Suppression Status Indicator

**In Finding List:**
```
● contrast-aa-fail (2) [1 suppressed]
```

**Status Badge:**
```
[⚠ 1 suppressed]
```

**Tooltip:**
```
1 finding is suppressed:
- contrast-aa-fail on "Header"
Suppressed 2 days ago
Reason: Decorative element
```

---

## Implementation Priority

### Phase 1: Core Suppression (Week 1-2)
1. Define suppression schema
2. Implement suppression record storage
3. Implement finding-level suppression
4. Implement suppression confirmation dialog
5. Add suppression to linter (migrate existing)

### Phase 2: Revalidation (Week 3-4)
1. Implement document change revalidation
2. Implement rule version change revalidation
3. Implement expiry revalidation
4. Implement manual revalidation
5. Add revalidation to all audit systems

### Phase 3: Portability (Week 5-6)
1. Implement suppression export (JSON, CSV)
2. Implement suppression import
3. Implement cross-document portability
4. Implement finding ID mapping
5. Add suppression templates

### Phase 4: Exception Management (Week 7-8)
1. Implement team exceptions
2. Implement exception request workflow
3. Implement exception approval
4. Implement exception templates
5. Add exception management UI

---

## Testing Requirements

### Unit Tests
- Suppression record creation and validation
- Suppression scope hierarchy
- Revalidation algorithm
- Suppression expiry logic
- Finding ID mapping for portability

### Integration Tests
- Suppression workflow end-to-end
- Revalidation on document change
- Revalidation on rule version change
- Suppression export/import
- Cross-document portability

### E2E Tests
- Suppress finding and verify it's hidden
- Revalidate suppressions and verify findings re-appear
- Export suppressions and import to another document
- Apply team exception and verify it applies to all documents
- Expire suppression and verify finding re-appears

---

## Documentation Updates

### User Documentation
- "Suppressing Findings" - Guide for users
- "Suppression Best Practices" - When to suppress
- "Revalidation" - How revalidation works
- "Exception Management" - Team exceptions guide

### Developer Documentation
- "Suppression System Architecture" - Technical overview
- "Revalidation Algorithm" - Algorithm details
- "Portability" - Export/import format
- "Exception Management" - Team exception workflow
