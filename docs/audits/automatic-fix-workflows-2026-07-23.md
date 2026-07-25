# Automatic and Assisted Fix Workflows

Generated: 2026-07-23
Purpose: Design fix workflows with preview, undo, and batch support

## Current State

### Existing Fix Capabilities

**Scene Intelligence Audit:**
- `contrast-aa-fail` has `autoFix` function
- Adjusts text fill color to meet minimum contrast
- No preview, no undo integration, no batch support

**Debt Scanner:**
- `untokenized-colors` has `autoFix` (add swatch)
- `missing-fonts` has `autoFix` (replace with available font)
- No preview, no undo integration, no batch support

**Governance Rules:**
- No auto-fixes implemented

**Design Linter:**
- `fixes` array exists but always empty
- Fix interface defined but not implemented

**Codegen Audits:**
- `autoFixAvailable` boolean flag
- No actual fix implementations

**Prototype Validation:**
- No fix capabilities

### Problems
1. **No preview:** Users can't see what will change before applying
2. **No undo integration:** Fixes don't integrate with command history
3. **No batch support:** Can't fix multiple findings at once
4. **No fix categorization:** No distinction between automatic, assisted, manual
5. **No fix validation:** No check if fix would actually resolve the issue
6. **No fix conflicts:** No detection of conflicting fixes
7. **No fix rollback:** No way to revert specific fixes
8. **No fix history:** No tracking of which fixes were applied

---

## Fix Capability Classification

### Fix Types

**Automatic Fix**
- One-click fix with predictable outcome
- No user input required
- Safe to apply without preview (but preview still available)
- Examples: Contrast adjustment, missing font replacement, add swatch

**Assisted Fix**
- Fix requires user input or confirmation
- User selects from options or provides parameters
- Preview required before applying
- Examples: Path simplification (threshold selection), color replacement (select from palette)

**Manual Fix**
- Fix requires manual intervention
- System provides guidance but user must complete the fix
- Examples: Broken prototype targets (user must select new target), naming violations (user must rename)

**No Fix**
- Issue cannot be automatically fixed
- System provides guidance only
- Examples: Orphan styles (must be deleted manually), overset text (must adjust frame size)

### Fix Safety Levels

**Safe Fix**
- Changes are reversible via undo
- Changes are isolated to affected nodes
- Changes don't affect document structure
- Changes don't affect other findings
- Examples: Color changes, font replacement

**Destructive Fix**
- Changes may affect document structure
- Changes may affect other findings
- Changes may not be fully reversible
- Requires explicit confirmation
- Examples: Delete orphan styles, merge duplicate styles, simplify paths

**Irreversible Fix**
- Changes cannot be undone
- Requires explicit confirmation + warning
- Rare, only for critical issues
- Examples: Delete critical nodes (should be avoided)

---

## Fix Preview System

### Preview Types

**Color Preview**
```typescript
interface ColorFixPreview {
  type: 'color';
  before: {
    color: ManagedColor;
    hex: string;
    rgba: [number, number, number, number];
  };
  after: {
    color: ManagedColor;
    hex: string;
    rgba: [number, number, number, number];
  };
  contrastRatio?: {
    before: number;
    after: number;
    minRatio: number;
  };
}
```

**Number Preview**
```typescript
interface NumberFixPreview {
  type: 'number';
  property: string;
  before: number;
  after: number;
  unit: string;
  threshold?: {
    min?: number;
    max?: number;
  };
}
```

**Text Preview**
```typescript
interface TextFixPreview {
  type: 'text';
  property: string;
  before: string;
  after: string;
  maxLength?: number;
}
```

**Visual Preview**
```typescript
interface VisualFixPreview {
  type: 'visual';
  nodeId: NodeId;
  before: {
    thumbnail: string; // Data URL
    bounds: { x: number; y: number; w: number; h: number };
  };
  after: {
    thumbnail: string; // Data URL
    bounds: { x: number; y: number; w: number; h: number };
  };
}
```

**Structural Preview**
```typescript
interface StructuralFixPreview {
  type: 'structural';
  description: string;
  affectedNodeIds: NodeId[];
  changes: Array<{
    nodeId: NodeId;
    action: 'delete' | 'merge' | 'split' | 'reparent';
    details: string;
  }>;
}
```

### Preview Generation

```typescript
function generateFixPreview(
  fix: AuditFix,
  doc: Document,
  finding: AuditFinding
): FixPreview {
  // Apply fix to a copy of the document
  const previewDoc = fix.apply({ ...doc });
  
  if (!previewDoc) {
    return {
      type: 'none',
      description: 'Fix would have no effect (issue already resolved)',
    };
  }
  
  // Compare before/after for affected nodes
  const changes = compareDocuments(doc, previewDoc, finding.nodeIds);
  
  // Generate appropriate preview type based on changes
  if (changes.some(c => c.property === 'fill' || c.property === 'color')) {
    return generateColorPreview(changes);
  }
  
  if (changes.some(c => typeof c.before === 'number' && typeof c.after === 'number')) {
    return generateNumberPreview(changes);
  }
  
  if (changes.some(c => typeof c.before === 'string' && typeof c.after === 'string')) {
    return generateTextPreview(changes);
  }
  
  // Default to structural preview
  return generateStructuralPreview(changes);
}
```

### Preview UI

```
┌─────────────────────────────────────────┐
│ Fix Preview: Adjust Contrast            │
├─────────────────────────────────────────┤
│ Before:          After:                  │
│ [■ #333333]  →   [■ #555555]            │
│ 2.1:1 ratio       3.2:1 ratio           │
│ (below AA)        (meets AA)            │
│                                         │
│ Affected nodes: 2                       │
│ • Header                                 │
│ • Button                                 │
│                                         │
│ [Apply] [Cancel]                         │
└─────────────────────────────────────────┘
```

---

## Fix Application Flow

### Single Fix Flow

```
1. User clicks "Auto-fix" button on finding
   ↓
2. System checks if fix is previewable
   ↓
3a. If previewable:
   - Generate preview
   - Show preview dialog
   - User clicks "Apply" or "Cancel"
   ↓
3b. If not previewable:
   - Show confirmation dialog
   - User clicks "Apply" or "Cancel"
   ↓
4. System applies fix via command
   ↓
5. System re-runs affected rules
   ↓
6. System updates findings (mark as resolved or updated)
   ↓
7. System adds undo entry to command history
   ↓
8. System shows success notification (optional)
```

### Batch Fix Flow

```
1. User selects multiple findings
   ↓
2. System checks if all findings have same fix
   ↓
3a. If same fix:
   - Show "Fix all (N)" button
   - User clicks button
   ↓
3b. If different fixes:
   - Show "Fix individually" button
   - User clicks button
   - System opens each fix dialog sequentially
   ↓
4. System generates combined preview
   ↓
5. System shows preview dialog with all changes
   ↓
6. User clicks "Apply All" or "Cancel"
   ↓
7. System applies all fixes in single command
   ↓
8. System re-runs affected rules
   ↓
9. System updates findings
   ↓
10. System adds single undo entry for all fixes
   ↓
11. System shows success notification
```

### Assisted Fix Flow

```
1. User clicks "Fix" button on finding
   ↓
2. System shows assisted fix dialog
   ↓
3. User provides input (selects option, adjusts slider, etc.)
   ↓
4. System generates preview based on user input
   ↓
5. User adjusts input and preview updates in real-time
   ↓
6. User clicks "Apply" or "Cancel"
   ↓
7. System applies fix via command
   ↓
8. System re-runs affected rules
   ↓
9. System updates findings
   ↓
10. System adds undo entry
```

### Manual Fix Flow

```
1. User clicks "Fix" button on finding
   ↓
2. System shows manual fix guidance
   ↓
3. System navigates to affected node on canvas
   ↓
4. System highlights relevant property in inspector
   ↓
5. User makes manual changes
   ↓
6. System detects manual fix (via document change)
   ↓
7. System re-runs affected rules
   ↓
8. System updates findings (mark as resolved)
```

---

## Undo Integration

### Command Pattern

All fixes must be applied via the command system to ensure proper undo/redo support.

```typescript
interface ApplyFixCommand {
  type: 'apply-fix';
  findingId: string;
  fixId: string;
  params?: Record<string, unknown>;
  before: Document;
  after: Document;
  timestamp: number;
}

function executeApplyFixCommand(
  command: ApplyFixCommand,
  doc: Document
): Document {
  return command.after;
}

function undoApplyFixCommand(
  command: ApplyFixCommand,
  doc: Document
): Document {
  return command.before;
}
```

### Undo Grouping

**Single Fix:**
- One undo entry per fix
- Undo label: "Fix contrast on Header"

**Batch Fix:**
- One undo entry for all fixes
- Undo label: "Fix 5 contrast issues"
- All fixes undone together

**Sequential Fixes:**
- Each fix creates separate undo entry
- User can undo individual fixes

### Undo Validation

**Before Undo:**
- Check if finding still exists
- Check if finding is still relevant
- Check if undo would cause new issues

**After Undo:**
- Re-run affected rules
- Update findings (may re-appear)
- Show notification if issues re-appear

---

## Fix Conflict Detection

### Conflict Types

**Node Conflict**
- Multiple fixes target the same node
- Example: Fix contrast AND fix font on same text node
- Resolution: Apply sequentially, validate after each

**Property Conflict**
- Multiple fixes target the same property
- Example: Fix contrast via fill color AND fix token color
- Resolution: Ask user to choose, or apply in order

**Structural Conflict**
- Fixes affect document structure
- Example: Delete orphan style AND merge duplicate styles
- Resolution: Apply in specific order, validate after each

**Dependency Conflict**
- One fix depends on another
- Example: Fix contrast requires font to be available first
- Resolution: Apply dependencies first

### Conflict Detection Algorithm

```typescript
function detectFixConflicts(
  fixes: Array<{ finding: AuditFinding; fix: AuditFix }>
): FixConflict[] {
  const conflicts: FixConflict[] = [];
  
  // Check for node conflicts
  const nodeMap = new Map<NodeId, Array<{ finding: AuditFinding; fix: AuditFix }>>();
  for (const { finding, fix } of fixes) {
    for (const nodeId of finding.nodeIds) {
      const existing = nodeMap.get(nodeId) ?? [];
      existing.push({ finding, fix });
      nodeMap.set(nodeId, existing);
    }
  }
  
  for (const [nodeId, nodeFixes] of nodeMap) {
    if (nodeFixes.length > 1) {
      conflicts.push({
        type: 'node',
        nodeId,
        fixes: nodeFixes,
      });
    }
  }
  
  // Check for property conflicts
  const propertyMap = new Map<string, Array<{ finding: AuditFinding; fix: AuditFix }>>();
  for (const { finding, fix } of fixes) {
    const properties = extractAffectedProperties(fix);
    for (const property of properties) {
      const key = `${finding.nodeIds.join(',')}:${property}`;
      const existing = propertyMap.get(key) ?? [];
      existing.push({ finding, fix });
      propertyMap.set(key, existing);
    }
  }
  
  for (const [key, propertyFixes] of propertyMap) {
    if (propertyFixes.length > 1) {
      conflicts.push({
        type: 'property',
        key,
        fixes: propertyFixes,
      });
    }
  }
  
  return conflicts;
}
```

### Conflict Resolution UI

```
┌─────────────────────────────────────────┐
│ Fix Conflict Detected                   │
├─────────────────────────────────────────┤
│ Multiple fixes target the same node:     │
│                                         │
│ Node: Header                            │
│                                         │
│ Conflicting fixes:                      │
│ □ Fix contrast (adjust fill color)      │
│ □ Fix font (replace with available)     │
│                                         │
│ Resolution:                             │
│ ○ Apply both (in order)                 │
│ ○ Apply only contrast                    │
│ ○ Apply only font                        │
│ ○ Cancel                                │
│                                         │
│ [Apply Selected] [Cancel]                │
└─────────────────────────────────────────┘
```

---

## Fix History Tracking

### Fix Record

```typescript
interface FixRecord {
  /** Fix record ID */
  id: string;
  
  /** Finding ID that was fixed */
  findingId: string;
  
  /** Fix ID that was applied */
  fixId: string;
  
  /** User who applied the fix */
  userId?: string;
  
  /** Timestamp when fix was applied */
  appliedAt: number;
  
  /** Document revision before fix */
  beforeRevision: number;
  
  /** Document revision after fix */
  afterRevision: number;
  
  /** Whether fix was successful */
  successful: boolean;
  
  /** Error message if fix failed */
  error?: string;
  
  /** Whether fix was undone */
  undone: boolean;
  
  /** Timestamp when fix was undone */
  undoneAt?: number;
}
```

### Fix History Storage

**Document-level storage:**
```typescript
interface DocumentAuditState {
  /** Fix history for this document */
  fixHistory: FixRecord[];
  
  /** Current finding IDs */
  currentFindings: string[];
  
  /** Suppressed findings */
  suppressedFindings: string[];
}
```

**Persistence:**
- Fix history stored in document metadata
- Survives save/load
- Survives undo/redo (fix records are not undone, only document changes)
- Exported with document (optional, may be large)

### Fix History UI

**Fix History Panel:**
```
┌─────────────────────────────────────────┐
│ Fix History                             │
├─────────────────────────────────────────┤
│ Today, 2:30 PM                          │
│ • Fixed contrast on Header (undo)       │
│ • Fixed font on Body (undo)             │
│                                         │
│ Today, 2:15 PM                          │
│ • Fixed 5 contrast issues (undo)       │
│                                         │
│ Yesterday, 4:45 PM                      │
│ • Added swatch for "Button color"       │
│                                         │
│ [Clear History] [Export History]         │
└─────────────────────────────────────────┘
```

---

## Fix Validation

### Pre-Fix Validation

**Before applying fix:**
1. Check if finding is still valid (not stale, not resolved)
2. Check if fix is still applicable (node still exists, property still relevant)
3. Check for conflicts with other pending fixes
4. Check if fix would cause new issues
5. Check if fix is safe (not destructive, or user confirmed)

**Validation failure:**
- Show error message
- Block fix application
- Suggest alternative fix if available

### Post-Fix Validation

**After applying fix:**
1. Re-run rule that produced the finding
2. Check if finding is resolved
3. Check for new findings caused by fix
4. Update finding status (resolved or updated)
5. Show success or error notification

**Validation failure:**
- Show error message
- Offer to undo fix
- Log failure for debugging

### Fix Rollback

**Automatic rollback:**
- If post-fix validation fails
- If fix causes critical error
- If fix causes data corruption

**Manual rollback:**
- User clicks "Undo" in command history
- User clicks "Undo" in fix history
- User clicks "Undo" in notification

**Rollback behavior:**
- Revert document to before-fix state
- Re-run affected rules
- Restore original findings
- Show notification

---

## Implementation Examples

### Example 1: Contrast Fix

```typescript
const contrastFix: AuditFix = {
  id: 'adjust-contrast',
  label: 'Fix contrast to meet WCAG AA',
  description: 'Adjust text fill color to meet minimum contrast ratio',
  previewable: true,
  apply: (doc: Document) => {
    const finding = getFinding(doc, 'contrast-aa-fail');
    if (!finding) return null;
    
    const nodeId = finding.nodeIds[0];
    const node = doc.nodes[nodeId];
    if (!node || node.kind !== 'text') return null;
    
    const evidence = finding.evidence as { ratio: number; minRatio: number };
    const targetRatio = evidence.minRatio;
    
    // Calculate required color adjustment
    const newColor = adjustColorForContrast(
      node.fill,
      evidence.ratio,
      targetRatio
    );
    
    // Apply fix
    return {
      ...doc,
      nodes: {
        ...doc.nodes,
        [nodeId]: {
          ...node,
          fill: newColor,
        },
      },
    };
  },
  preview: (doc: Document) => {
    const finding = getFinding(doc, 'contrast-aa-fail');
    const before = finding.evidence as { ratio: number; fgColor: [number, number, number, number] };
    
    // Apply fix to copy
    const afterDoc = contrastFix.apply({ ...doc });
    const afterNode = afterDoc.nodes[finding.nodeIds[0]];
    const afterColor = afterNode.fill;
    
    // Calculate new contrast
    const afterRatio = calculateContrastRatio(afterColor, before.bgColor);
    
    return {
      type: 'color',
      before: {
        color: before.fgColor,
        hex: rgbaToHex(before.fgColor),
        rgba: before.fgColor,
      },
      after: {
        color: afterColor,
        hex: rgbaToHex(afterColor),
        rgba: afterColor,
      },
      contrastRatio: {
        before: before.ratio,
        after: afterRatio,
        minRatio: before.minRatio,
      },
    };
  },
};
```

### Example 2: Path Simplification (Assisted Fix)

```typescript
const pathSimplifyFix: AuditFix = {
  id: 'simplify-path',
  label: 'Simplify path',
  description: 'Remove redundant anchor points from path',
  previewable: true,
  apply: (doc: Document, params: { threshold: number }) => {
    const finding = getFinding(doc, 'unnecessary-anchors');
    if (!finding) return null;
    
    const nodeId = finding.nodeIds[0];
    const node = doc.nodes[nodeId];
    if (!node || node.kind !== 'shape') return null;
    
    // Simplify path with threshold
    const simplifiedPath = simplifyPath(node.shape.path, params.threshold);
    
    return {
      ...doc,
      nodes: {
        ...doc.nodes,
        [nodeId]: {
          ...node,
          shape: {
            ...node.shape,
            path: simplifiedPath,
          },
        },
      },
    };
  },
  preview: (doc: Document, params: { threshold: number }) => {
    const finding = getFinding(doc, 'unnecessary-anchors');
    const before = finding.evidence as { anchorCount: number; redundantCount: number };
    
    const afterDoc = pathSimplifyFix.apply({ ...doc }, params);
    const afterNode = afterDoc.nodes[finding.nodeIds[0]];
    const afterAnchorCount = countAnchors(afterNode.shape.path);
    
    return {
      type: 'number',
      property: 'anchorCount',
      before: before.anchorCount,
      after: afterAnchorCount,
      unit: 'anchors',
    };
  },
};
```

### Example 3: Broken Prototype Target (Manual Fix)

```typescript
const brokenTargetFix: AuditFix = {
  id: 'fix-broken-target',
  label: 'Select new target',
  description: 'Select a new target node for this interaction',
  previewable: false,
  apply: (doc: Document, params: { newTargetId: NodeId }) => {
    const finding = getFinding(doc, 'broken-target');
    if (!finding) return null;
    
    const interactionId = finding.interactionId;
    if (!interactionId) return null;
    
    // Update interaction target
    const prototype = { ...doc.prototype };
    const interaction = prototype.interactions[interactionId];
    
    for (const action of interaction.actions) {
      if (action.kind === 'navigateTo' || action.kind === 'openOverlay') {
        action.targetId = params.newTargetId;
      }
    }
    
    return {
      ...doc,
      prototype,
    };
  },
};
```

---

## Implementation Priority

### Phase 1: Core Fix System (Week 1-2)
1. Define fix interfaces (AuditFix, FixPreview, FixRecord)
2. Implement fix preview generation
3. Implement command integration for undo
4. Implement single fix flow
5. Add fix to existing contrast rule

### Phase 2: Batch and Assisted Fixes (Week 3-4)
1. Implement batch fix flow
2. Implement conflict detection
3. Implement assisted fix UI
4. Add assisted fix to path simplification
5. Add manual fix guidance to prototype validation

### Phase 3: Advanced Features (Week 5-6)
1. Implement fix history tracking
2. Implement fix validation
3. Implement fix rollback
4. Add fixes to more rules (debt scanner, governance)
5. Implement fix export/import

---

## Testing Requirements

### Unit Tests
- Fix preview generation for all preview types
- Fix application via command pattern
- Undo/redo of fixes
- Conflict detection algorithm
- Fix validation logic

### Integration Tests
- Single fix flow end-to-end
- Batch fix flow end-to-end
- Assisted fix flow end-to-end
- Manual fix guidance
- Fix history tracking

### E2E Tests
- Apply fix and verify finding resolved
- Apply fix and undo, verify finding re-appears
- Apply batch fix and verify all findings resolved
- Apply conflicting fixes and verify resolution UI
- Apply fix in different workspaces and verify behavior

---

## Documentation Updates

### User Documentation
- "Using Automatic Fixes" - Guide for users
- "Fix Previews" - How to use fix previews
- "Batch Fixes" - How to fix multiple issues at once
- "Fix History" - How to view and manage fix history

### Developer Documentation
- "Fix System Architecture" - Technical overview
- "Implementing Fixes" - Guide for developers
- "Fix Preview Types" - Reference for preview types
- "Fix Validation" - Guide for validation logic
