# Audit Exposure Hierarchy

Generated: 2026-07-23
Purpose: Define 5-level exposure hierarchy for audit findings

## Hierarchy Philosophy

**Core Principle:** Progressive disclosure - show the right amount of information at the right time without overwhelming users or hiding critical issues.

**Exposure Levels:**
1. **Passive Status** - Always-visible, non-intrusive indicators
2. **Contextual Summary** - Concise summaries in relevant panels
3. **Full Audit Panel** - Complete audit interface with filtering
4. **Preflight** - Export-specific blocking checks
5. **Audit Workspace** - Dedicated review environment

**Navigation Flow:** Users can drill down from any level to deeper levels, but never forced to start at the deepest level.

---

## Level 1: Passive Status

### Purpose
Provide always-visible, non-intrusive indicators of document health without interrupting workflow.

### Locations

#### Status Bar
**Current Implementation:** DebtBadge shows total count

**Enhanced Implementation:**
- **Document Health Badge:** Shows critical error count only
  - Red: 1+ critical errors (missing fonts, broken targets, low resolution)
  - Orange: No critical errors but 5+ warnings
  - Gray: No issues
  - Click: Opens Audit panel with current profile

- **Export Readiness Indicator:** Shows export-blocking issues
  - Visible in: design, print, image workspaces
  - Red: Export blocked (critical errors)
  - Yellow: Export with warnings
  - Green: Export ready
  - Click: Opens Export panel with preflight section

- **Selection Issue Count:** Shows issues for current selection
  - Visible only when selection has issues
  - Format: "3 issues" (no severity breakdown)
  - Click: Opens Audit panel filtered to selection

#### Canvas Corner Indicator
**New Component:** Small badge in top-right corner of canvas
- Shows only during active editing modes
- Displays: "2 contrast issues" or "1 missing font"
- Auto-dismisses after 5 seconds or on next edit
- Click: Opens contextual summary in Properties panel

#### Menu Bar Indicator
**New Component:** Small dot in File menu
- Red dot: Document has unsaved critical errors
- Visible only when critical errors exist
- Tooltip: "Document has issues that may affect export"
- Click: Opens Audit panel

### Behavior Rules
- **No toasts:** Never interrupt with toast notifications
- **No badges during drag/type/paint:** Suppress during active interactions
- **Aggregate counts:** Show totals, not per-rule breakdowns
- **Critical-only:** Status bar shows only errors, not warnings/info
- **Auto-dismiss:** Corner indicators dismiss automatically

### Implementation
```typescript
interface PassiveStatusConfig {
  statusBar: {
    showDocumentHealth: boolean;
    showExportReadiness: boolean;
    showSelectionCount: boolean;
  };
  canvasCorner: {
    enabled: boolean;
    autoDismissMs: number;
    maxCount: number;
  };
  menuBar: {
    showCriticalIndicator: boolean;
  };
}
```

---

## Level 2: Contextual Summary

### Purpose
Show concise, relevant summaries in panels where users are already working on related properties.

### Locations

#### Properties Panel
**Current Implementation:** AdaptiveContrastSection for text nodes

**Enhanced Implementation:**

**Text Nodes:**
- "2 contrast issues" → Click to expand
- Shows: Contrast ratio, WCAG AA status, auto-fix button
- Location: Near fill color property

**Image Nodes:**
- "Image may export below 150 DPI" → Click to expand
- Shows: Effective DPI, source resolution, display size
- Location: Near image fill property

**Shape Nodes:**
- "Path has 1 open endpoint" → Click to expand
- Shows: Path status, close path button
- Location: Near path properties

**Frame Nodes:**
- "3 spacing violations" → Click to expand
- Shows: Non-grid values, harmonize button
- Location: Near layout properties

#### Appearance Panel
**Color Properties:**
- "Color not in document swatches" → Click to add
- Shows: Nearest swatch match, add button
- Location: Near color picker

#### Typography Panel
**Font Properties:**
- "Font not available" → Click to replace
- Shows: Missing font name, available alternatives
- Location: Near font family selector

**Text Properties:**
- "Text may overflow" → Click to expand
- Shows: Overflow status, frame size suggestion
- Location: Near text alignment

#### Export Panel
**Export Settings:**
- "2 nodes need raster fallback" → Click to view
- Shows: Affected nodes, export format compatibility
- Location: Near export format selector

**Scale Settings:**
- "Export at 72 DPI (below print minimum)" → Click to fix
- Shows: Current DPI, recommended settings
- Location: Near scale input

#### Tool Options
**Context-Aware Warnings:**

**Pen Tool:**
- "Path has 5 redundant anchors" → Click to simplify
- Shows: Anchor count, simplify button

**Text Tool:**
- "Selected text has low contrast" → Click to fix
- Shows: Contrast ratio, auto-fix button

**Crop Tool:**
- "Crop will reduce resolution to 120 DPI" → Click to adjust
- Shows: Current vs. projected DPI

### Behavior Rules
- **Relevance only:** Show only when directly related to current selection/tool
- **Concise:** One-line summary, expandable for details
- **Action-oriented:** Always provide direct action button
- **No duplication:** Don't repeat full Audit panel UI
- **Selection-scoped:** Only show findings for selected nodes
- **Auto-hide:** Hide when selection changes to unrelated type

### Implementation
```typescript
interface ContextualSummary {
  panel: 'properties' | 'appearance' | 'typography' | 'export' | 'toolOptions';
  section: string;
  trigger: {
    nodeKinds: string[];
    findingTypes: string[];
  };
  summary: string;
  detail?: string;
  action?: {
    label: string;
    handler: () => void;
  };
  navigateTo?: {
    panel: string;
    subTab?: string;
    findingId?: string;
  };
}
```

---

## Level 3: Full Audit Panel

### Purpose
Complete audit interface with filtering, grouping, navigation, fixes, and suppression.

### Current Implementation
- IntelligencePanel with tabs (audit, spacing, naming, governance, debt, linter, etc.)
- DebtBadge in status bar
- Commands to open specific tabs

### Enhanced Implementation

#### Panel Structure
```
┌─────────────────────────────────────────┐
│ Audit  [Profile: General ▼] [Run All]   │
├─────────────────────────────────────────┤
│ Filters: [Severity ▼] [Category ▼]     │
│         [Scope: Document ▼]            │
├─────────────────────────────────────────┤
│ Errors (3)                              │
│ ▶ contrast-aa-fail (2)                  │
│   • "Header" has 2.1:1 contrast         │
│   • "Button" has 1.8:1 contrast         │
│ ▶ missing-fonts (1)                     │
│   • "Body" uses unavailable font        │
│                                         │
│ Warnings (5)                             │
│ ▶ layer-hygiene/zero-size (2)          │
│ ▶ overset-text (3)                      │
│                                         │
│ Info (12)                                │
│ ▶ unnamed-layers (8)                    │
│ ▶ inconsistent-radius (4)               │
└─────────────────────────────────────────┘
```

#### Features

**Profile Switcher**
- Dropdown to switch audit profile
- Shows current profile name
- Options: General, Vector, Raster, Typography, Prototype, Motion, Print, Review
- Changes visible rules immediately

**Filters**
- **Severity:** Error, Warning, Suggestion, Advisory (checkboxes)
- **Category:** Contrast, Typography, Layout, Accessibility, Vector, Raster, Color, Performance, Spacing, Codegen (checkboxes)
- **Scope:** Document, Current Page, Selection (radio)
- **Confidence:** Slider (0.5-1.0) for low-confidence filtering

**Grouping**
- **By Category:** Default grouping
- **By Severity:** Alternative grouping
- **By Node:** Group findings by affected node
- **Flat View:** No grouping, chronological list

**Finding Item**
```
┌─────────────────────────────────────────┐
│ ● contrast-aa-fail                       │
│ "Header" has 2.1:1 contrast against     │
│ its background, below WCAG AA minimum    │
│                                         │
│ Evidence: Ratio 2.1, Min 3.0, Large text│
│                                         │
│ [Auto-fix] [Select] [Dismiss]           │
└─────────────────────────────────────────┘
```

**Actions**
- **Auto-fix:** Apply automatic fix (if available)
- **Select:** Navigate to affected node on canvas
- **Dismiss:** Suppress this finding (if dismissable)
- **Fix All:** Batch apply fixes for same rule
- **Suppress Rule:** Suppress all findings for this rule

**Navigation**
- Click finding → Select node on canvas, zoom to fit
- Keyboard navigation: Arrow keys between findings
- Enter: Select node
- Space: Expand/collapse detail
- Escape: Return to previous selection

**Export Report**
- Generate JSON report of current findings
- Generate PDF report for documentation
- Generate HTML report for sharing
- Include: Timestamp, document info, findings, evidence

### Behavior Rules
- **Respects profile:** Shows only rules in current profile
- **Real-time updates:** Re-runs affected rules on document change
- **Debounced expensive rules:** Defers pixel analysis until idle
- **Stale detection:** Shows "Results outdated" if document changed since scan
- **Keyboard accessible:** Full keyboard navigation
- **Screen reader support:** Proper ARIA labels and live regions

### Implementation
```typescript
interface AuditPanelConfig {
  defaultProfile: AuditProfileId;
  defaultGrouping: 'category' | 'severity' | 'node' | 'flat';
  defaultScope: 'document' | 'page' | 'selection';
  filters: {
    severity: AuditSeverity[];
    category: AuditCategory[];
    minConfidence: number;
  };
  autoRun: boolean;
  showEvidence: boolean;
  keyboardNav: boolean;
}
```

---

## Level 4: Preflight

### Purpose
Run export-specific blocking checks immediately before export, print, or code generation.

### Current Implementation
- No dedicated preflight mode
- Export checks run immediately on document change

### Enhanced Implementation

#### Trigger Points
- **File → Export:** Before export dialog
- **File → Print:** Before print dialog
- **File → Generate Code:** Before code generation
- **Prototype → Present:** Before prototype presentation
- **Command:** `runPreflight` (manual trigger)

#### Preflight Dialog
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

#### Preflight Rules per Export Type

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

#### Behavior Rules
- **Blocking mode:** Errors block export by default
- **Override option:** User can choose "Export Anyway"
- **Auto-fix:** Offer automatic fixes where available
- **Snapshot check:** Run on immutable export snapshot
- **Fast path:** Skip rules not relevant to export type
- **Progress indicator:** Show progress for expensive checks

### Implementation
```typescript
interface PreflightConfig {
  exportType: 'pdf' | 'png' | 'jpeg' | 'svg' | 'code' | 'prototype';
  blocking: boolean;
  autoFixAvailable: boolean;
  rules: string[];
  timeoutMs: number;
}

interface PreflightResult {
  passed: boolean;
  errors: PreflightIssue[];
  warnings: PreflightIssue[];
  durationMs: number;
  canAutoFix: boolean;
}
```

---

## Level 5: Audit Workspace

### Purpose
Dedicated review environment with complete audit system, visual overlays, batch operations, and reporting.

### Current Implementation
- No dedicated Audit workspace
- Full audit only available via Audit panel

### Enhanced Implementation

#### Workspace Configuration
```typescript
const AUDIT_WORKSPACE: WorkspaceConfig = {
  version: 1,
  panels: {
    layers: { visible: true, collapsed: false, order: 0 },
    inspector: { visible: true, collapsed: false, order: 0 },
    timeline: { visible: false, collapsed: false, order: 2 },
    pagenav: { visible: true, collapsed: false, order: 3 },
    library: { visible: false, collapsed: false, order: 4 },
  },
  inspectorTabs: [
    { id: 'audit', label: 'Audit', visible: true, default: true, group: 'primary' },
    { id: 'findings', label: 'Findings', visible: true, group: 'primary' },
    { id: 'overlays', label: 'Overlays', visible: true, group: 'workflow' },
    { id: 'reports', label: 'Reports', visible: true, group: 'output' },
  ],
  canvasOverlays: {
    rulers: true,
    guides: true,
    pixelGrid: false,
    dotGrid: true,
    bleedGuides: true,
    layoutGrid: false,
    baselineGrid: false,
    auditOverlays: true, // New: enable audit-specific overlays
  },
  // ... other config
};
```

#### Audit Workspace Features

**Findings Tab (Enhanced Audit Panel)**
- All 35+ rules available
- Advanced filtering (regex search, custom filters)
- Comparative views (before/after, delta)
- Batch operations (fix all by category, suppress by rule)
- Finding history (track changes over time)

**Overlays Tab**
- Visual overlay controls
- Category visibility toggles
- Severity-based color coding
- Overlay density controls (aggregate markers for many findings)
- Canvas navigation between findings

**Reports Tab**
- Report generation (JSON, PDF, HTML)
- Custom report templates
- Schedule reports (run daily/weekly)
- Export to external tools (Jira, GitHub Issues)
- Report history

**Canvas Enhancements**
- Finding markers on canvas
- Click marker → Open finding in panel
- Arrow keys → Navigate between findings
- Zoom to fit selection
- Highlight affected regions

#### Navigation to Audit Workspace
- **Command:** `openAuditWorkspace`
- **Status bar:** "Review in Audit Workspace" link
- **Audit panel:** "Open Audit Workspace" button
- **Keyboard shortcut:** Ctrl+Shift+A

#### Behavior Rules
- **No editing restrictions:** Users can still edit in Audit workspace
- **Real-time updates:** Findings update as document changes
- **Overlay persistence:** Overlays remain visible until toggled off
- **Full access:** All rules available regardless of profile
- **Review mode:** Optional "read-only review" mode to prevent accidental edits

### Implementation
```typescript
interface AuditWorkspaceConfig {
  findingsTab: {
    showAllRules: boolean;
    enableComparativeView: boolean;
    enableBatchOperations: boolean;
    trackHistory: boolean;
  };
  overlaysTab: {
    defaultEnabledCategories: AuditCategory[];
    aggregateThreshold: number;
    colorScheme: Record<string, string>;
  };
  reportsTab: {
    templates: ReportTemplate[];
    schedule: ReportSchedule[];
    exportTargets: ExportTarget[];
  };
  canvas: {
    showFindingMarkers: boolean;
    markerSize: number;
    enableKeyboardNav: boolean;
  };
}
```

---

## Navigation Between Levels

### Drill-Down Paths

**From Level 1 (Passive Status) to Level 3 (Full Panel):**
- Click status bar badge → Opens Audit panel with current profile
- Click canvas corner indicator → Opens contextual summary → "View all" → Audit panel
- Click menu indicator → Opens Audit panel

**From Level 2 (Contextual Summary) to Level 3 (Full Panel):**
- Click "View all issues" in summary → Opens Audit panel filtered to relevant category
- Click finding in summary → Opens Audit panel with that finding selected

**From Level 3 (Full Panel) to Level 5 (Audit Workspace):**
- Click "Open Audit Workspace" button → Switches to Audit workspace
- Command: `openAuditWorkspace` → Switches to Audit workspace

**From Level 4 (Preflight) to Level 3 (Full Panel):**
- Click "View Issues" in preflight dialog → Opens Audit panel with preflight findings
- Click specific issue → Opens Audit panel with that finding selected

**From Any Level to Level 5 (Audit Workspace):**
- Command: `openAuditWorkspace`
- Status bar link: "Review in Audit Workspace"

### Return Navigation

**From Level 3/5 to Previous Workspace:**
- "Back to [Workspace]" button in Audit panel
- Command: `switchToPreviousWorkspace`
- Escape key (if in Audit workspace)

**From Level 3 to Previous Context:**
- "Back to [Panel]" button when drilled down from contextual summary
- Escape key returns to previous panel

### Deep Linking

**URI Scheme for Deep Links:**
```
strata://audit?workspace=design&profile=general&category=contrast&finding=finding-123
```

**Deep Link Components:**
- `workspace`: Target workspace mode
- `profile`: Audit profile to use
- `category`: Category to filter to
- `finding`: Specific finding ID to select
- `node`: Node ID to select on canvas
- `overlay`: Canvas overlay to enable

**Deep Link Use Cases:**
- External tools linking to specific findings
- Report exports with clickable links
- Collaboration (share finding link with team)
- Automation (CI/CD linking to specific issues)

---

## Mode-Aware Behavior

### Editing Modes
During active editing (drag, type, paint, transform):
- **Level 1:** Suppress canvas corner indicators
- **Level 2:** Defer contextual summary updates until interaction settles
- **Level 3:** Show "Results outdated" if document changed
- **Level 4:** Block preflight during active edits
- **Level 5:** Continue real-time updates but with debouncing

### Review Modes
During review (presentation, prototype playback):
- **Level 1:** Hide all passive status indicators
- **Level 2:** Hide all contextual summaries
- **Level 3:** Audit panel accessible but not auto-opened
- **Level 4:** Preflight not applicable
- **Level 5:** Audit workspace accessible

### Isolation Mode
During isolation mode (editing inside component/frame):
- **Level 1:** Show selection-scoped status only
- **Level 2:** Show findings for isolated nodes only
- **Level 3:** Default scope to "Selection"
- **Level 4:** Preflight checks entire document
- **Level 5:** Full document scope available

---

## Performance Considerations

### Level 1 (Passive Status)
- **Execution:** Immediate, cheap rules only
- **Update frequency:** On document change (debounced 100ms)
- **Cache:** Document-level cache with revision invalidation

### Level 2 (Contextual Summary)
- **Execution:** Immediate, selection-scoped rules
- **Update frequency:** On selection change (debounced 50ms)
- **Cache:** Selection-level cache

### Level 3 (Full Panel)
- **Execution:** Mixed - immediate for cheap rules, debounced for expensive
- **Update frequency:** On document change (debounced 300ms for expensive rules)
- **Cache:** Rule-level cache with cost-based invalidation

### Level 4 (Preflight)
- **Execution:** All relevant rules for export type
- **Update frequency:** On-demand only
- **Cache:** No caching (always fresh)

### Level 5 (Audit Workspace)
- **Execution:** All rules, including expensive pixel analysis
- **Update frequency:** On document change (debounced 500ms for expensive rules)
- **Cache:** Full cache with manual refresh option

---

## Accessibility Requirements

### Keyboard Navigation
- **Level 1:** Tab to status bar badges, Enter to open panel
- **Level 2:** Tab to summaries, Enter to expand, Space to action
- **Level 3:** Full keyboard navigation (arrows, Enter, Space, Escape)
- **Level 4:** Tab to dialog controls, Enter to proceed
- **Level 5:** Same as Level 3 plus overlay keyboard controls

### Screen Reader Support
- **Level 1:** ARIA live regions for status changes
- **Level 2:** ARIA expanded/collapsed states
- **Level 3:** Proper heading structure, list semantics
- **Level 4:** Dialog role, focus management
- **Level 5:** Canvas overlay descriptions via ARIA

### Visual Accessibility
- **Level 1:** Color + icon indicators (not color alone)
- **Level 2:** High contrast text in summaries
- **Level 3:** Severity icons + color coding
- **Level 4:** Clear error/warning distinction
- **Level 5:** Overlay patterns work in high-contrast mode

### Reduced Motion
- **Level 1:** No animations
- **Level 2:** Instant expand/collapse
- **Level 3:** No animated transitions
- **Level 4:** Progress bar respects prefers-reduced-motion
- **Level 5:** Overlay markers respect prefers-reduced-motion

---

## Implementation Priority

### Phase 1: Core Hierarchy (High Priority)
1. Level 1: Enhanced status bar indicators
2. Level 2: Contextual summaries in Properties panel
3. Level 3: Enhanced Audit panel with profile switcher

### Phase 2: Advanced Features (Medium Priority)
4. Level 4: Preflight dialog for export
5. Level 5: Dedicated Audit workspace
6. Deep linking support

### Phase 3: Polish (Lower Priority)
7. Canvas corner indicators
8. Menu bar indicators
9. Advanced reporting in Audit workspace
10. Comparative views and history tracking
