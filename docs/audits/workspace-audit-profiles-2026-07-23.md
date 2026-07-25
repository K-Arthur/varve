# Workspace-Aware Audit Profiles

Generated: 2026-07-23
Purpose: Define audit rule exposure per workspace and mode

## Profile Philosophy

**Core Principle:** Show only relevant, high-confidence findings in the primary workspace. Deeper audits remain accessible through the Audit panel or command palette.

**Exposure Rules:**
1. **Blocking errors** always visible (missing fonts, broken targets)
2. **Workspace-specific rules** prioritized in relevant workspaces
3. **Specialist diagnostics** hidden from unrelated workflows
4. **Full access** always available via Audit panel or commands
5. **Mode-aware behavior** adjusts exposure during editing vs. review

---

## Profile: General / Essentials

**Primary Workspace:** design (default)
**Target Users:** General designers, UI/UX practitioners
**Focus:** High-confidence, blocking issues affecting correctness and export

### Passive Status Indicators
- Document health badge (critical errors only)
- Selection issue count (when applicable)
- Export readiness indicator

### Contextual Summaries
- Properties panel: contrast issues (text nodes only)
- Export panel: export-blocking problems
- Tool options: relevant warnings (e.g., text overflow)

### Default Rules (Immediate)
| Rule ID | Category | Severity | Rationale |
|---------|----------|----------|-----------|
| `contrast-aa-fail` | contrast | error | WCAG AA failure, blocks accessibility |
| `missing-fonts` | typography | error | Text will render incorrectly |
| `broken-target` | prototype | error | Prototype flow will break |
| `missing-home-screen` | prototype | error | Prototype has no entry point |
| `low-resolution` | raster | error | Image will appear pixelated |
| `layer-hygiene/zero-size/v1` | layer-hygiene | warning | Node will be invisible |
| `layer-hygiene/off-canvas/v1` | layer-hygiene | warning | Node may be unintentional |

### Available On-Demand (via Audit panel)
- All debt scanner rules (design system governance)
- All governance rules (token compliance)
- All linter rules (accessibility, touch targets, focus order)
- Codegen audits (vector/raster export readiness)
- Typography rules (type scale, overset)

### Mode-Specific Behavior
- **Standard selection:** Show selection-specific findings in contextual summaries
- **Text editing:** Suppress layout/spacing audits until editing settles
- **Prototype mode:** Add prototype validation to default rules
- **Export preflight:** Run full codegen audit automatically

### Commands
- `runAudit` → Opens Audit panel with essentials profile
- `scanDebt` → Opens Audit panel with debt scanner
- `checkAccessibility` → Opens Audit panel with linter (accessibility category)

---

## Profile: Vector

**Primary Workspace:** drawing
**Target Users:** Illustrators, vector artists, icon designers
**Focus:** Path quality, SVG compatibility, print readiness

### Passive Status Indicators
- Path quality badge (open paths, self-intersections)
- Anchor point count (excessive anchors warning)

### Contextual Summaries
- Properties panel: path-specific issues (open endpoints, zero area)
- Tool options: pen/pencil warnings (collinear points)

### Default Rules (Immediate)
| Rule ID | Category | Severity | Rationale |
|---------|----------|----------|-----------|
| `open-path` | vector | warning | May cause rendering artifacts |
| `self-intersection` | vector | warning | Fill rendering incorrect |
| `zero-area-path` | vector | warning | Path defines no meaningful geometry |
| `unnecessary-anchors` | vector | info | Performance/file size optimization |
| `inconsistent-stroke` | vector | info | Style consistency |
| `malformed-path` | vector | warning | Path data may be corrupted |
| `boolean-artifact` | vector | warning | Leftover from boolean operations |
| `unlinked-mask` | vector | warning | Mask may not update |

### Available On-Demand
- Contrast audit (text in vector artwork)
- Governance rules (token colors, naming)
- Layer hygiene (zero-size, off-canvas)

### Mode-Specific Behavior
- **Pen/pencil tools:** Real-time anchor optimization suggestions
- **Node edit:** Highlight redundant anchors on canvas
- **Boolean operations:** Warn about artifacts immediately after operation

### Canvas Overlays
- Red highlight: self-intersecting paths
- Yellow highlight: open endpoints (near-closed)
- Blue dots: redundant anchor points
- Toggle: View → Show Path Issues

### Commands
- `checkVectorQuality` → Opens Audit panel with vector profile
- `simplifyPath` → Opens Audit panel with unnecessary-anchors focus
- `closeOpenPaths` → Batch fix for open-path findings

---

## Profile: Raster / Photo

**Primary Workspace:** image
**Target Users:** Photo editors, retouchers, digital artists
**Focus:** Image quality, resolution, color accuracy, performance

### Passive Status Indicators
- Resolution badge (effective DPI)
- Asset size warning (oversized images)
- Color profile mismatch indicator

### Contextual Summaries
- Properties panel: image-specific issues (resolution, scaling)
- Adjustments panel: color profile warnings
- Tool options: mask quality warnings (alpha fringes)

### Default Rules (Immediate)
| Rule ID | Category | Severity | Rationale |
|---------|----------|----------|-----------|
| `low-resolution` | raster | error/warning | Below print/web minimum |
| `oversized-asset` | raster | warning | Performance impact |
| `low-quality-scaling` | raster | warning | Will appear pixelated |
| `no-alt-text` | raster | info | Accessibility metadata |
| `hidden-large-layer` | raster | info | Document size optimization |

### Available On-Demand (Deferred - Pixel Analysis)
| Rule ID | Category | Severity | Execution Cost |
|---------|----------|----------|----------------|
| `alpha-fringe` | raster | warning | expensive (pixel) |
| `banding-risk` | raster | warning | expensive (pixel) |
| `excessive-transparency` | raster | warning | moderate |
| `over-compressed` | raster | warning | moderate |
| `color-profile-mismatch` | raster | warning | cheap |

### Mode-Specific Behavior
- **Crop tool:** Warn if crop reduces resolution below threshold
- **Mask editing:** Run alpha-fringe check after mask changes (debounced)
- **Adjustments:** Check color profile mismatch when applying ICC profiles
- **Export:** Run full raster audit before export

### Canvas Overlays
- Red outline: low-resolution regions (when zoomed in)
- Yellow overlay: alpha fringe areas (mask editing mode)
- Toggle: View → Show Image Quality

### Commands
- `checkImageQuality` → Opens Audit panel with raster profile
- `analyzeAlphaFringe` → Triggers expensive alpha-fringe analysis
- `optimizeImageSize` → Opens Audit panel with oversized-asset focus

---

## Profile: Typography / Publishing

**Primary Workspace:** design, print
**Target Users:** Type designers, editorial designers, publishers
**Focus:** Font availability, text overflow, hierarchy consistency, print readiness

### Passive Status Indicators
- Font availability badge (missing fonts)
- Text overflow indicator (overset text)
- Print readiness status (DPI, color mode)

### Contextual Summaries
- Properties panel: font-specific issues (missing fonts, overset)
- Typography panel: hierarchy warnings (inconsistent sizing)
- Export panel: print-specific issues (DPI, color space)

### Default Rules (Immediate)
| Rule ID | Category | Severity | Rationale |
|---------|----------|----------|-----------|
| `missing-fonts` | typography | error | Text will not render |
| `overset-text` | typography | warning | Content may be truncated |
| `hardcoded-font-sizes` | typography | info | Type scale governance |
| `mixed-color-spaces` | color | warning | Print production issue |
| `contrast-aa-fail` | contrast | error | WCAG accessibility |
| `low-resolution` | raster | error | Print DPI requirement |

### Available On-Demand
- Naming violations (component/style naming)
- Duplicate styles (style governance)
- Excessive nesting (layout complexity)
- Missing export presets (export readiness)

### Mode-Specific Behavior
- **Text editing:** Real-time overset detection
- **Print mode:** Add mixed-color-spaces to default rules
- **Export preflight:** Run full typography + raster audit

### Canvas Overlays
- Red highlight: overset text frames
- Yellow underline: text below minimum contrast
- Toggle: View → Show Typography Issues

### Commands
- `checkTypography` → Opens Audit panel with typography profile
- `validatePrint` → Opens Audit panel with print preflight
- `fixMissingFonts` → Batch fix for missing-fonts findings

---

## Profile: Prototype

**Primary Workspace:** design, motion (prototype mode)
**Target Users:** UX designers, interaction designers
**Focus:** Flow integrity, accessibility of interactive elements, touch targets

### Passive Status Indicators
- Prototype health badge (broken flows)
- Touch target compliance (WCAG 2.5.8)
- Focus order warnings

### Contextual Summaries
- Prototype panel: flow-specific issues (broken targets, orphan screens)
- Properties panel: touch target warnings (interactive nodes)
- Export panel: prototype export readiness

### Default Rules (Immediate)
| Rule ID | Category | Severity | Rationale |
|---------|----------|----------|-----------|
| `broken-target` | prototype | error | Flow will break |
| `missing-home-screen` | prototype | error | No entry point |
| `disabled-interaction` | prototype | warning | Action may not fire |
| `orphan-node` | prototype | info | Screen not reachable |
| `accessibility/touch-target/v1` | touch-target | warning | WCAG 2.5.8 |
| `accessibility/focus-order/v1` | focus-order | warning | Tab order issues |
| `accessibility/non-text-contrast/v1` | color | warning | WCAG 2.1 SC 1.4.11 |

### Available On-Demand
- All governance rules (naming, tokens)
- Layer hygiene (zero-size, off-canvas)
- Codegen readiness (flattening for web export)

### Mode-Specific Behavior
- **Prototype mode:** Activate prototype-specific rules
- **Presentation mode:** Suppress all audits (review-only)
- **Editing mode:** Show contextual touch target warnings on interactive nodes

### Canvas Overlays
- Red outline: touch targets below 44px minimum
- Blue arrows: focus order flow visualization
- Yellow highlight: low-contrast interactive elements
- Toggle: View → Show Prototype Issues

### Commands
- `validatePrototype` → Opens Audit panel with prototype profile
- `checkTouchTargets` → Opens Audit panel with touch-target focus
- `analyzeFocusOrder` → Opens Audit panel with focus-order visualization

---

## Profile: Motion

**Primary Workspace:** motion
**Target Users:** Motion designers, animators
**Focus:** Animation integrity, performance, export behavior

### Passive Status Indicators
- Timeline health badge (conflicting keyframes)
- Performance warning (expensive effects)
- Export compatibility status

### Contextual Summaries
- Timeline panel: animation-specific issues
- Properties panel: effect performance warnings
- Export panel: motion export compatibility

### Default Rules (Immediate)
| Rule ID | Category | Severity | Rationale |
|---------|----------|----------|-----------|
| `contrast-aa-fail` | contrast | error | WCAG accessibility |
| `missing-fonts` | typography | error | Text will not render |
| `low-resolution` | raster | error | Image quality in motion |
| `accessibility/touch-target/v1` | touch-target | warning | Interactive prototypes |
| `accessibility/focus-order/v1` | focus-order | warning | Tab order in motion |

### Motion-Specific Rules (To Be Implemented)
| Rule ID | Category | Severity | Description |
|---------|----------|----------|-------------|
| `conflicting-keyframes` | motion | warning | Multiple keyframes at same time |
| `unreachable-state` | motion | warning | Animation state cannot be reached |
| `expensive-effect` | performance | warning | Effect may cause lag |
| `unsupported-export` | export | error | Animation not supported in target format |
| `reduced-motion-alternative` | accessibility | suggestion | No prefers-reduced-motion fallback |

### Available On-Demand
- Prototype validation (if prototype interactions exist)
- Layer hygiene (zero-size, off-canvas)
- Codegen readiness (CSS animation support)

### Mode-Specific Behavior
- **Timeline editing:** Real-time keyframe conflict detection
- **Playback:** Suppress performance warnings during preview
- **Export:** Run motion-specific export checks

### Canvas Overlays
- Red markers: conflicting keyframes
- Yellow highlight: expensive effects
- Motion path visualization for keyframe navigation
- Toggle: View → Show Motion Issues

### Commands
- `checkMotion` → Opens Audit panel with motion profile
- `analyzePerformance` → Opens Audit panel with performance focus
- `validateExport` → Opens Audit panel with export compatibility

---

## Profile: Print

**Primary Workspace:** print
**Target Users:** Print designers, production artists
**Focus:** Print production readiness, color management, preflight

### Passive Status Indicators
- Preflight status badge (errors/warnings)
- Color mode indicator (CMYK/RGB mismatch)
- Bleed/trim warnings

### Contextual Summaries
- Properties panel: print-specific issues (DPI, color space)
- Export panel: preflight warnings
- Page navigation: page-specific issues

### Default Rules (Immediate)
| Rule ID | Category | Severity | Rationale |
|---------|----------|----------|-----------|
| `missing-fonts` | typography | error | Font will not print |
| `mixed-color-spaces` | color | warning | Color conversion required |
| `low-resolution` | raster | error | Below 200 DPI minimum |
| `overset-text` | typography | warning | Content may be truncated |
| `contrast-aa-fail` | contrast | error | WCAG accessibility |
| `layer-hygiene/off-canvas/v1` | layer-hygiene | warning | May be unintentional |

### Print-Specific Rules (To Be Implemented)
| Rule ID | Category | Severity | Description |
|---------|----------|----------|-------------|
| `bleed-margin-violation` | print | error | Content extends into trim area |
| `insufficient-bleed` | print | warning | Bleed less than 1/8" |
| `spot-color-usage` | color | info | Spot colors in document |
| `transparency-restriction` | print | warning | Flattening required |
| `overprint-warning` | print | warning | Overprint may not print correctly |
| `pdf-compatibility` | export | error | Feature not supported in PDF/X |

### Available On-Demand
- Typography rules (type scale, hierarchy)
- Governance rules (naming, tokens)
- Vector audit (path quality for print)

### Mode-Specific Behavior
- **Page navigation:** Show page-specific preflight status
- **Export:** Run full print preflight automatically
- **Soft proof:** Check color profile match when toggled

### Canvas Overlays
- Red outline: bleed margin violations
- Yellow area: insufficient bleed
- Blue overlay: transparency flattening regions
- Toggle: View → Show Print Issues

### Commands
- `runPreflight` → Opens Audit panel with print preflight
- `checkColorSeparations` → Opens Audit panel with color focus
- `validatePDFExport` → Opens Audit panel with PDF compatibility

---

## Profile: Review / Accessibility

**Primary Workspace:** Dedicated Audit workspace (to be added)
**Target Users:** Accessibility specialists, QA, design system maintainers
**Focus:** Complete audit system with filters, overlays, batch operations

### This Profile Provides
- **Full access** to all 35+ audit rules
- **Advanced filtering** by category, severity, confidence, scope
- **Visual overlays** for all applicable findings
- **Batch operations** (fix all, suppress by rule, export report)
- **Comparative views** (before/after, delta between scans)
- **Reporting** (exportable JSON, PDF, HTML reports)

### Default Behavior
- No rules hidden
- All categories available
- Full document scope by default
- Selection scope available via filter

### Canvas Overlays
- All overlay types available as toggles
- Category visibility controls
- Severity-based color coding
- Keyboard navigation between findings

### Commands
- `openAuditWorkspace` → Switches to dedicated Audit workspace
- `runFullAudit` → Triggers all audit rules
- `exportAuditReport` → Generates comprehensive report

---

## Profile Configuration Schema

```typescript
interface AuditProfile {
  /** Profile identifier */
  id: string;
  
  /** Human-readable name */
  name: string;
  
  /** Target workspace mode */
  workspace: WorkspaceMode;
  
  /** Target user persona */
  persona: string;
  
  /** Rules shown by default (immediate execution) */
  defaultRules: string[];
  
  /** Rules available on-demand (via Audit panel) */
  onDemandRules: string[];
  
  /** Rules with expensive execution (deferred) */
  deferredRules: string[];
  
  /** Mode-specific overrides */
  modeOverrides: Record<string, {
    additionalRules: string[];
    suppressedRules: string[];
  }>;
  
  /** Canvas overlay configuration */
  overlays: {
    enabled: string[];
    toggleable: string[];
    colorScheme: Record<string, string>;
  };
  
  /** Status bar indicators */
  statusIndicators: {
    badge: string;
    selectionCount: boolean;
    exportReadiness: boolean;
  };
  
  /** Contextual summary locations */
  contextualSummaries: {
    panel: string[];
    section: string[];
  };
  
  /** Commands that open this profile */
  commands: string[];
}
```

---

## Implementation Priority

### Phase 1: Core Profiles (High Priority)
1. General/Essentials (design workspace)
2. Print (print workspace)
3. Prototype (design/motion prototype mode)

### Phase 2: Specialist Profiles (Medium Priority)
4. Vector (drawing workspace)
5. Raster/Photo (image workspace)
6. Typography (design/print workspaces)

### Phase 3: Advanced Profiles (Lower Priority)
7. Motion (motion workspace - requires new rules)
8. Review/Accessibility (dedicated workspace - requires new UI)

---

## Migration Strategy

### Current State
- All rules run in all workspaces
- Audit tab is permanent in design, print, image, motion
- No workspace-specific filtering

### Migration Steps
1. Add `auditProfile` to `WorkspaceConfig`
2. Define default profiles for each workspace
3. Update `IntelligencePanel` to filter by profile
4. Add profile switcher in Audit panel header
5. Update status bar indicators to respect profile
6. Add contextual summaries to relevant inspector sections
7. Implement canvas overlays for vector/raster profiles
8. Add dedicated Audit workspace for Review profile

### Backward Compatibility
- Existing `setInspectorTab('audit')` behavior preserved
- Commands continue to work as before
- User can override profile via Audit panel
- Default profile can be changed in workspace settings

---

## Testing Requirements

### Unit Tests
- Profile configuration validation
- Rule filtering logic
- Mode-specific override application
- Profile switching behavior

### Integration Tests
- Audit panel respects active profile
- Status bar shows profile-specific indicators
- Contextual summaries appear in correct locations
- Canvas overlays toggle correctly

### E2E Tests
- Switch workspaces and verify profile changes
- Run audit in different profiles and verify results
- Test profile switcher in Audit panel
- Verify commands open correct profile
- Test mode-specific behavior (prototype mode, etc.)
