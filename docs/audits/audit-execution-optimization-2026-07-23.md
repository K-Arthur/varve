# Audit Execution Optimization

Generated: 2026-07-23
Purpose: Optimize audit execution with immediate, debounced, on-demand, and preflight runs using caching and invalidation

## Current State

### Current Execution Behavior

**All Systems:**
- All rules run immediately on document change
- No debouncing
- No on-demand deferral
- No caching
- No invalidation
- No cost-based scheduling
- No preflight mode

**Performance Impact:**
- Every edit triggers full audit scan
- Expensive rules (pixel analysis) block main thread
- No differentiation between cheap and expensive rules
- No incremental updates (re-runs everything)

### Problems
1. **No debouncing:** Rapid edits trigger multiple scans
2. **No cost awareness:** Expensive rules run immediately
3. **No caching:** Same calculations repeated
4. **No invalidation:** Stale results treated as current
5. **No preflight:** Export checks run immediately, not at export time
6. **No incremental:** Full re-scan on every change
7. **No user control:** Users can't defer expensive checks

---

## Execution Modes

### Immediate Execution

**Purpose:** Run critical, blocking checks immediately

**Trigger:** Document change (debounced 50ms)

**Rules:**
- Missing fonts (blocking)
- Broken prototype targets (blocking)
- Missing home screen (blocking)
- Low resolution below minimum (blocking)

**Behavior:**
- Run immediately after short debounce
- No caching (always fresh)
- Block main thread briefly (< 10ms)
- Update findings immediately

**Use Case:** User needs immediate feedback on critical issues

### Debounced Execution

**Purpose:** Run non-critical checks after editing settles

**Trigger:** Document change (debounced 300ms)

**Rules:**
- Contrast checks (non-blocking)
- Overset text (non-blocking)
- Zero-size layers (non-blocking)
- Off-canvas layers (non-blocking)
- Naming violations (non-blocking)

**Behavior:**
- Wait for editing to settle
- Use cache where possible
- Incremental updates (only affected rules)
- Update findings after debounce

**Use Case:** User is actively editing, don't interrupt

### On-Demand Execution

**Purpose:** Run expensive checks only when requested

**Trigger:** User command or explicit request

**Rules:**
- Alpha fringe analysis (expensive pixel analysis)
- Banding risk analysis (expensive pixel analysis)
- Color profile mismatch (moderate)
- Path self-intersection (moderate geometry)
- Unnecessary anchors (moderate geometry)

**Behavior:**
- Run only when user requests
- Show progress indicator
- Cache results
- Update findings after completion

**Use Case:** User explicitly requests deep analysis

### Preflight Execution

**Purpose:** Run export-specific checks immediately before export

**Trigger:** Export command (before export dialog)

**Rules:**
- All export-relevant rules for target format
- Resolution checks for export DPI
- Color space checks for export format
- Unsupported features for export format

**Behavior:**
- Run on immutable export snapshot
- No caching (always fresh)
- Block export if critical errors
- Show preflight dialog

**Use Case:** Ensure export readiness before committing

### Scheduled Execution

**Purpose:** Run maintenance checks periodically

**Trigger:** Timer (e.g., every 5 minutes of inactivity)

**Rules:**
- Orphan styles (maintenance)
- Unused components (maintenance)
- Duplicate styles (maintenance)
- Excessive nesting (maintenance)

**Behavior:**
- Run in background
- Don't interrupt user
- Show notification if new issues found
- Cache results

**Use Case:** Catch maintenance issues without interrupting workflow

---

## Cost-Based Scheduling

### Cost Classification

**Immediate (0-5ms):**
- Document structure checks
- Simple property checks
- Flag checks (visible, locked)

**Cheap (5-50ms):**
- Single-node calculations
- Simple geometry checks
- Color calculations (contrast)

**Moderate (50-500ms):**
- Multi-node calculations
- Path geometry analysis
- Prototype flow validation

**Expensive (500ms+):**
- Pixel analysis (alpha fringe, banding)
- Full document traversal
- Complex geometry calculations

### Scheduling Algorithm

```typescript
interface ExecutionSchedule {
  immediate: string[];  // Rule IDs to run immediately
  debounced: string[];  // Rule IDs to run debounced
  onDemand: string[];   // Rule IDs to run on-demand
  preflight: string[];  // Rule IDs to run at preflight
  scheduled: string[];  // Rule IDs to run on schedule
}

function scheduleAuditExecution(
  doc: Document,
  changes: DocumentChange[],
  schedule: ExecutionSchedule
): AuditExecutionPlan {
  const plan: AuditExecutionPlan = {
    immediate: [],
    debounced: [],
    onDemand: [],
    preflight: [],
    scheduled: [],
  };
  
  // Identify affected rules based on changes
  const affectedRules = identifyAffectedRules(changes);
  
  // Classify by cost
  for (const ruleId of affectedRules) {
    const cost = getRuleCost(ruleId);
    
    if (schedule.immediate.includes(ruleId)) {
      plan.immediate.push(ruleId);
    } else if (cost === 'immediate' || cost === 'cheap') {
      plan.debounced.push(ruleId);
    } else if (cost === 'moderate') {
      plan.debounced.push(ruleId);
    } else if (cost === 'expensive') {
      plan.onDemand.push(ruleId);
    }
  }
  
  return plan;
}
```

---

## Caching Strategy

### Cache Levels

**Rule-Level Cache:**
- Cache results per rule
- Key: `{ruleId}:{documentRevision}:{scopeId}`
- Valid until document revision changes
- Used for: All rules

**Node-Level Cache:**
- Cache results per node
- Key: `{ruleId}:{nodeId}:{nodeRevision}`
- Valid until node revision changes
- Used for: Node-specific rules (contrast, resolution)

**Evidence-Level Cache:**
- Cache evidence calculations
- Key: `{ruleId}:{evidenceHash}`
- Valid until evidence parameters change
- Used for: Expensive calculations (contrast, DPI)

**Pixel-Level Cache:**
- Cache pixel analysis results
- Key: `{ruleId}:{imageHash}:{parameters}`
- Valid until image changes
- Used for: Expensive pixel analysis (alpha fringe, banding)

### Cache Invalidation

**Document Revision Invalidation:**
- Trigger: Document revision changes
- Scope: Invalidate all rule-level caches
- Logic: `if (cache.documentRevision !== doc.revision) invalidate()`

**Node Revision Invalidation:**
- Trigger: Node revision changes
- Scope: Invalidate node-level caches for affected node
- Logic: `if (cache.nodeRevision !== node.revision) invalidate()`

**Evidence Invalidation:**
- Trigger: Evidence parameters change
- Scope: Invalidate evidence-level cache
- Logic: `if (cache.evidenceHash !== currentEvidenceHash) invalidate()`

**Manual Invalidation:**
- Trigger: User clicks "Refresh"
- Scope: Invalidate all caches
- Logic: Clear all caches, re-run all rules

### Cache Implementation

```typescript
class AuditCache {
  private ruleCache: Map<string, CachedResult> = new Map();
  private nodeCache: Map<string, CachedResult> = new Map();
  private evidenceCache: Map<string, CachedResult> = new Map();
  private pixelCache: Map<string, CachedResult> = new Map();
  
  /** Get cached result or null if not cached or invalid */
  get(key: string, level: CacheLevel, validator: (result: CachedResult) => boolean): CachedResult | null {
    const cache = this.getCache(level);
    const result = cache.get(key);
    
    if (!result) return null;
    
    if (!validator(result)) {
      cache.delete(key);
      return null;
    }
    
    return result;
  }
  
  /** Set cached result */
  set(key: string, level: CacheLevel, result: CachedResult): void {
    const cache = this.getCache(level);
    cache.set(key, result);
  }
  
  /** Invalidate all caches */
  invalidateAll(): void {
    this.ruleCache.clear();
    this.nodeCache.clear();
    this.evidenceCache.clear();
    this.pixelCache.clear();
  }
  
  /** Invalidate specific level */
  invalidateLevel(level: CacheLevel): void {
    this.getCache(level).clear();
  }
  
  /** Invalidate specific key */
  invalidate(key: string, level: CacheLevel): void {
    this.getCache(level).delete(key);
  }
  
  private getCache(level: CacheLevel): Map<string, CachedResult> {
    switch (level) {
      case 'rule': return this.ruleCache;
      case 'node': return this.nodeCache;
      case 'evidence': return this.evidenceCache;
      case 'pixel': return this.pixelCache;
    }
  }
}

interface CachedResult {
  findingId: string;
  findings: AuditFinding[];
  timestamp: number;
  documentRevision: number;
  nodeRevision?: number;
  evidenceHash?: string;
  imageHash?: string;
}
```

---

## Incremental Updates

### Change Detection

**Document Change Types:**
- Node added
- Node deleted
- Node property changed
- Node moved
- Node reparented
- Style changed
- Component changed

**Affected Rule Detection:**
```typescript
function identifyAffectedRules(changes: DocumentChange[]): string[] {
  const affectedRules = new Set<string>();
  
  for (const change of changes) {
    switch (change.type) {
      case 'node-added':
        affectedRules.add('unnamed-layers');
        affectedRules.add('zero-size');
        break;
      case 'node-deleted':
        affectedRules.add('orphan-styles');
        affectedRules.add('unused-components');
        break;
      case 'property-changed':
        if (change.property === 'fill') {
          affectedRules.add('contrast-aa-fail');
          affectedRules.add('untokenized-colors');
        }
        if (change.property === 'fontFamily') {
          affectedRules.add('missing-fonts');
        }
        break;
      case 'node-moved':
        affectedRules.add('off-canvas');
        break;
    }
  }
  
  return Array.from(affectedRules);
}
```

### Incremental Re-Run

**Strategy:**
1. Detect document changes
2. Identify affected rules
3. Re-run only affected rules
4. Merge with existing findings
5. Update display

**Implementation:**
```typescript
async function runIncrementalAudit(
  doc: Document,
  existingFindings: AuditFinding[],
  changes: DocumentChange[],
  cache: AuditCache
): Promise<AuditFinding[]> {
  // Identify affected rules
  const affectedRules = identifyAffectedRules(changes);
  
  // Remove findings from affected rules
  const unaffectedFindings = existingFindings.filter(
    f => !affectedRules.includes(f.ruleId)
  );
  
  // Re-run affected rules
  const newFindings: AuditFinding[] = [];
  for (const ruleId of affectedRules) {
    const rule = getRule(ruleId);
    const findings = await rule.run(doc, { cache });
    newFindings.push(...findings);
  }
  
  // Merge findings
  return [...unaffectedFindings, ...newFindings];
}
```

---

## Staleness Detection

### Staleness Indicators

**Document Revision Mismatch:**
- Finding was generated with different document revision
- Indicates document has changed since finding was generated
- Action: Re-run affected rules

**Rule Version Mismatch:**
- Finding was generated with different rule version
- Indicates rule has been updated since finding was generated
- Action: Re-run rule with new version

**Node Deletion:**
- Finding references a node that no longer exists
- Indicates node was deleted
- Action: Mark finding as resolved

**Evidence Parameter Change:**
- Finding evidence parameters have changed
- Indicates underlying issue has changed
- Action: Re-run rule to update finding

### Staleness UI

**Finding Status Indicator:**
```
● contrast-aa-fail (2.1:1 ratio) [⚠ Stale]
```

**Stale Finding Dialog:**
```
┌─────────────────────────────────────────┐
│ Finding is Stale                        │
├─────────────────────────────────────────┤
│ This finding was generated before the    │
│ document was changed. The issue may no  │
│ longer be accurate.                     │
│                                         │
│ [Re-run Rule] [Dismiss]                 │
└─────────────────────────────────────────┘
```

**Automatic Revalidation:**
- When user clicks finding, automatically re-validate
- If still valid, update timestamp
- If resolved, mark as resolved
- If changed, update finding

---

## Preflight Mode

### Preflight Triggers

**Export Triggers:**
- File → Export PNG
- File → Export JPEG
- File → Export SVG
- File → Export PDF
- File → Generate Code

**Print Triggers:**
- File → Print
- File → Print Preview

**Prototype Triggers:**
- Prototype → Present
- Prototype → Record

### Preflight Dialog

```
┌─────────────────────────────────────────┐
│ Preflight Check                          │
├─────────────────────────────────────────┤
│ Checking document for export...          │
│ ████████████████████░░░░ 75%           │
├─────────────────────────────────────────┤
│ ✓ Color mode: CMYK (correct for print)  │
│ ✓ All fonts available                   │
│ ✓ Resolution: 300 DPI (above minimum)   │
│ ✗ 2 nodes have overset text             │
│ ✗ 1 image below 200 DPI                 │
├─────────────────────────────────────────┤
│ [View Issues] [Fix Automatically]        │
│ [Export Anyway] [Cancel]                │
└─────────────────────────────────────────┘
```

### Preflight Rules per Export Type

**PDF Export (Print):**
- Missing fonts (error)
- Mixed color spaces (warning)
- Low resolution (error)
- Overset text (warning)
- Bleed margin violations (error)
- Transparency restrictions (warning)

**PNG/JPEG Export (Web):**
- Missing fonts (error)
- Low resolution (warning)
- Oversized assets (warning)
- No alt text (info)

**SVG Export (Vector):**
- Open paths (warning)
- Self-intersections (warning)
- Unsupported effects (error)
- Unlinked masks (warning)

**Code Generation (Web):**
- Flattening required (warning)
- Unsupported blend modes (error)
- Missing accessibility labels (warning)
- Touch target violations (warning)

**Prototype Presentation:**
- Broken targets (error)
- Missing home screen (error)
- Disabled interactions (warning)

---

## User Control

### Manual Refresh

**Command:** `refreshAudit`

**Behavior:**
- Invalidate all caches
- Re-run all rules
- Update findings
- Show completion notification

**UI:**
- Refresh button in Audit panel header
- Keyboard shortcut: Ctrl+Shift+R

### Pause/Resume

**Command:** `pauseAudit` / `resumeAudit`

**Behavior:**
- Pause: Stop automatic audit execution
- Resume: Resume automatic audit execution
- Manual refresh still works when paused

**UI:**
- Pause/Resume button in Audit panel header
- Status indicator: "Audit paused"

### Schedule Configuration

**User Preferences:**
```typescript
interface AuditExecutionPreferences {
  /** Debounce delay for immediate rules (ms) */
  immediateDebounceMs: number;
  
  /** Debounce delay for debounced rules (ms) */
  debouncedDebounceMs: number;
  
  /** Whether to run expensive rules automatically */
  autoRunExpensive: boolean;
  
  /** Scheduled audit interval (ms, 0 = disabled) */
  scheduledIntervalMs: number;
  
  /** Whether to pause audit during rapid edits */
  pauseDuringRapidEdits: boolean;
  
  /** Rapid edit threshold (edits per second) */
  rapidEditThreshold: number;
}
```

---

## Implementation Architecture

### Audit Scheduler

```typescript
class AuditScheduler {
  private cache: AuditCache;
  private preferences: AuditExecutionPreferences;
  private pendingRules: Set<string> = new Set();
  private debounceTimer: number | null = null;
  private isPaused: boolean = false;
  
  constructor(
    cache: AuditCache,
    preferences: AuditExecutionPreferences
  ) {
    this.cache = cache;
    this.preferences = preferences;
  }
  
  /** Schedule audit execution based on document changes */
  schedule(doc: Document, changes: DocumentChange[]): void {
    if (this.isPaused) return;
    
    const plan = scheduleAuditExecution(doc, changes, this.getSchedule());
    
    // Run immediate rules
    this.runImmediate(doc, plan.immediate);
    
    // Schedule debounced rules
    this.scheduleDebounced(doc, plan.debounced);
    
    // Queue on-demand rules (don't run automatically)
    this.pendingRules = new Set(plan.onDemand);
  }
  
  /** Run immediate rules */
  private async runImmediate(doc: Document, ruleIds: string[]): Promise<void> {
    for (const ruleId of ruleIds) {
      const rule = getRule(ruleId);
      const findings = await rule.run(doc, { cache: this.cache });
      this.updateFindings(findings);
    }
  }
  
  /** Schedule debounced rules */
  private scheduleDebounced(doc: Document, ruleIds: string[]): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    
    this.debounceTimer = setTimeout(async () => {
      for (const ruleId of ruleIds) {
        const rule = getRule(ruleId);
        const findings = await rule.run(doc, { cache: this.cache });
        this.updateFindings(findings);
      }
    }, this.preferences.debouncedDebounceMs);
  }
  
  /** Run on-demand rules */
  async runOnDemand(doc: Document, ruleIds?: string[]): Promise<void> {
    const rulesToRun = ruleIds || Array.from(this.pendingRules);
    
    for (const ruleId of rulesToRun) {
      const rule = getRule(ruleId);
      const findings = await rule.run(doc, { cache: this.cache });
      this.updateFindings(findings);
    }
    
    this.pendingRules.clear();
  }
  
  /** Run preflight */
  async runPreflight(doc: Document, exportType: ExportType): Promise<PreflightResult> {
    const rules = getPreflightRules(exportType);
    const findings: AuditFinding[] = [];
    
    for (const ruleId of rules) {
      const rule = getRule(ruleId);
      const ruleFindings = await rule.run(doc, { cache: this.cache });
      findings.push(...ruleFindings);
    }
    
    return {
      passed: findings.filter(f => f.severity === 'error').length === 0,
      errors: findings.filter(f => f.severity === 'error'),
      warnings: findings.filter(f => f.severity === 'warning'),
      durationMs: 0, // Track duration
    };
  }
  
  /** Pause automatic audit execution */
  pause(): void {
    this.isPaused = true;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }
  
  /** Resume automatic audit execution */
  resume(): void {
    this.isPaused = false;
  }
  
  /** Refresh all audits */
  async refresh(doc: Document): Promise<void> {
    this.cache.invalidateAll();
    const allRules = getAllRuleIds();
    const findings: AuditFinding[] = [];
    
    for (const ruleId of allRules) {
      const rule = getRule(ruleId);
      const ruleFindings = await rule.run(doc, { cache: this.cache });
      findings.push(...ruleFindings);
    }
    
    this.updateFindings(findings);
  }
  
  private updateFindings(findings: AuditFinding[]): void {
    // Emit event to update UI
    emit('findings-updated', findings);
  }
  
  private getSchedule(): ExecutionSchedule {
    return {
      immediate: ['missing-fonts', 'broken-target', 'missing-home-screen'],
      debounced: ['contrast-aa-fail', 'overset-text', 'zero-size'],
      onDemand: ['alpha-fringe', 'banding-risk', 'self-intersection'],
      preflight: [], // Determined by export type
      scheduled: ['orphan-styles', 'unused-components'],
    };
  }
}
```

---

## Implementation Priority

### Phase 1: Core Scheduling (Week 1-2)
1. Implement AuditScheduler class
2. Implement immediate execution
3. Implement debounced execution
4. Add cache infrastructure
5. Add manual refresh

### Phase 2: Caching and Invalidation (Week 3-4)
1. Implement rule-level caching
2. Implement node-level caching
3. Implement evidence-level caching
4. Implement cache invalidation
5. Add staleness detection

### Phase 3: Incremental Updates (Week 5-6)
1. Implement change detection
2. Implement affected rule identification
3. Implement incremental re-run
4. Implement finding merge logic
5. Add change tracking

### Phase 4: Preflight and On-Demand (Week 7-8)
1. Implement preflight mode
2. Implement preflight dialog
3. Implement on-demand execution
4. Add progress indicators
5. Add user control (pause/resume)

---

## Testing Requirements

### Unit Tests
- Scheduling algorithm
- Cache invalidation logic
- Staleness detection
- Change detection
- Incremental update logic

### Integration Tests
- Audit scheduler with real document changes
- Cache with real rules
- Incremental updates with real findings
- Preflight with real export types

### E2E Tests
- Edit document and verify debounced execution
- Make rapid edits and verify pause behavior
- Run manual refresh and verify cache invalidation
- Trigger export and verify preflight
- Run on-demand rule and verify execution

### Performance Tests
- Measure immediate execution time (< 10ms)
- Measure debounced execution time (< 100ms)
- Measure cache hit rate (> 80%)
- Measure incremental update time (< 50ms)
- Measure preflight execution time (< 500ms)

---

## Documentation Updates

### User Documentation
- "Audit Execution" - How audits run automatically
- "Manual Refresh" - How to refresh audits manually
- "Preflight" - How preflight works
- "Performance" - Performance considerations

### Developer Documentation
- "Audit Scheduler" - API reference
- "Caching Strategy" - Cache implementation
- "Incremental Updates" - Incremental logic
- "Preflight System" - Preflight implementation
