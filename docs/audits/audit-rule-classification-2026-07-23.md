# Audit Rule Classification

Generated: 2026-07-23
Purpose: Workspace-aware audit system design

## Executive Summary

Strata has **4 distinct audit systems** with **35+ individual rules** across multiple categories:

1. **Scene Intelligence Audit** (1 rule) - WCAG contrast checking
2. **Design Debt Scanner** (15 rules) - Design system governance
3. **Governance Rules** (5 rules) - Real-time design-system validation
4. **Design Linter** (6 rules) - Accessibility and layer hygiene
5. **Codegen Audits** (vector/raster) - Export readiness
6. **Prototype Validation** (3 rules) - Prototype integrity

**Key Finding:** Audit exposure is currently **not workspace-aware**. All rules run in all contexts, and the Audit tab is a permanent inspector tab in design, print, image, and motion workspaces.

---

## Rule Classification Matrix

### Scene Intelligence Audit

| Rule ID | Category | Severity | Auto-Fix | Node Types | Execution Cost | Workspaces | Modes |
|---------|----------|----------|----------|------------|----------------|------------|-------|
| `contrast-aa-fail` | contrast | error/warning | Yes | text (solid RGB) | immediate | all | all |

**Source:** `@varve/scene/intelligence/audit.ts`

**Applicability:**
- All workspaces (text contrast is universal)
- All modes (document-wide check)
- Contextual: per-node, requires solid RGB fills
- Blocking: No (warning unless severe)
- Standard: WCAG 2.1 §1.4.3

---

### Design Debt Scanner (15 rules)

| Rule ID | Category | Severity | Auto-Fix | Node Types | Execution Cost | Workspaces | Modes |
|---------|----------|----------|----------|------------|----------------|------------|-------|
| `untokenized-colors` | color | warning | Yes | all with fills | immediate | design, print | all |
| `inline-spacing` | spacing | warning | No | frame | immediate | design, print | all |
| `naming-violations` | governance | error/warning/info | No | component, style, variable | immediate | all | all |
| `orphan-styles` | governance | info | No | style | immediate | all | all |
| `unused-components` | governance | info | No | component | immediate | all | all |
| `missing-fonts` | typography | error | Yes | text | immediate | all | all |
| `duplicate-styles` | governance | warning | No | style | immediate | all | all |
| `inconsistent-radius` | layout | info | No | shape (rect) | immediate | design | all |
| `hardcoded-font-sizes` | typography | info | No | text | immediate | design, print | all |
| `mixed-color-spaces` | color | warning | No | all with fills | immediate | print | all |
| `low-contrast` | contrast | error/warning | Yes | text | immediate | all | all |
| `overset-text` | typography | warning | No | text | immediate | design, print | all |
| `unnamed-layers` | governance | info | No | all | immediate | all | all |
| `excessive-nesting` | layout | warning | No | all | immediate | all | all |
| `missing-export-presets` | export | info | No | root nodes | immediate | all | all |

**Source:** `@varve/scene/intelligence/debtScanner.ts`

**Applicability Notes:**
- `mixed-color-spaces`: Print-specific (CMYK/gray docs with RGB fills)
- `inconsistent-radius`: Design-specific (UI consistency)
- `hardcoded-font-sizes`: Design/print (type scale governance)
- `missing-export-presets`: All workspaces (export readiness)

---

### Governance Rules (5 rules)

| Rule ID | Category | Severity | Auto-Fix | Node Types | Execution Cost | Workspaces | Modes |
|---------|----------|----------|----------|------------|----------------|------------|-------|
| `token-color` | color | warning | No | all with fills | immediate | design, print | all |
| `spacing-token` | spacing | warning | No | frame | immediate | design, print | all |
| `naming` | governance | error/warning/info | No | component, style, variable | immediate | all | all |
| `orphan` | governance | info | No | style, component | immediate | all | all |
| `font` | typography | error | No | text | immediate | all | all |

**Source:** `@varve/scene/intelligence/governanceRules.ts`

**Applicability Notes:**
- Real-time design-system governance
- Runs on every document change (lightweight)
- Specialist-focused (design system maintainers)

---

### Design Linter (6 rules)

| Rule ID | Category | Severity | Auto-Fix | Node Types | Execution Cost | Workspaces | Modes |
|---------|----------|----------|----------|------------|----------------|------------|-------|
| `layer-hygiene/zero-size/v1` | layer-hygiene | warning | No | all (except path/line/arrow) | cheap | all | all |
| `layer-hygiene/off-canvas/v1` | layer-hygiene | warning | No | all | cheap | all | all |
| `layer-hygiene/empty-container/v1` | layer-hygiene | info | No | frame, group | cheap | all | all |
| `accessibility/non-text-contrast/v1` | color | suggestion/warning | No | interactive, icon-like | moderate | all | all |
| `accessibility/touch-target/v1` | touch-target | warning/info | No | interactive nodes | cheap | design, motion | all |
| `accessibility/focus-order/v1` | focus-order | warning | No | interactive nodes | moderate | design, motion | prototype |

**Source:** `@varve/scene/intelligence/linterScanner.ts`

**Applicability Notes:**
- `touch-target`: Design/motion (interactive prototypes)
- `focus-order`: Design/motion in prototype mode only
- `non-text-contrast`: All workspaces (accessibility)
- Confidence scores: 0.3-0.9 (low for undetermined backgrounds)

---

### Codegen Audits

#### Vector Audit (12 issue types)

| Issue Type | Category | Severity | Auto-Fix | Node Types | Execution Cost | Workspaces | Modes |
|------------|----------|----------|----------|------------|----------------|------------|-------|
| `unnecessary-anchors` | vector | info | No | shape (path) | moderate | design, drawing | all |
| `self-intersection` | vector | warning | No | shape (path) | moderate | design, drawing | all |
| `open-path` | vector | warning | No | shape (path) | cheap | design, drawing | all |
| `zero-area-path` | vector | warning | No | shape (path) | cheap | design, drawing | all |
| `off-canvas` | vector | warning | No | shape (rect) | cheap | all | all |
| `redundant-group` | vector | info | No | group | cheap | all | all |
| `empty-group` | vector | info | No | group | cheap | all | all |
| `invisible-object` | vector | info | No | all | cheap | all | all |
| `inconsistent-stroke` | vector | info | No | shape | cheap | design, drawing | all |
| `malformed-path` | vector | warning | No | shape (path) | moderate | design, drawing | all |
| `boolean-artifact` | vector | warning | No | shape | moderate | design, drawing | all |
| `unlinked-mask` | vector | warning | No | masked nodes | moderate | design, drawing | all |

**Source:** `@varve/codegen/src/vector-audit.ts`

**Applicability Notes:**
- Design/drawing-focused (vector artwork)
- Export readiness (SVG compatibility)
- Some checks require geometry analysis (moderate cost)

#### Raster Audit (10 issue types)

| Issue Type | Category | Severity | Auto-Fix | Node Types | Execution Cost | Workspaces | Modes |
|------------|----------|----------|----------|------------|----------------|------------|-------|
| `low-resolution` | raster | error/warning | No | image fills | cheap | image, print | all |
| `oversized-asset` | raster | warning | No | image fills | cheap | image, web | all |
| `excessive-transparency` | raster | warning | No | image fills | moderate | image | all |
| `alpha-fringe` | raster | warning | No | image fills | expensive (pixel) | image | all |
| `color-profile-mismatch` | raster | warning | No | image fills | cheap | print | all |
| `banding-risk` | raster | warning | No | image fills | expensive (pixel) | image, print | all |
| `hidden-large-layer` | raster | info | No | hidden with images | cheap | all | all |
| `low-quality-scaling` | raster | warning | No | image fills | cheap | image, web | all |
| `over-compressed` | raster | warning | No | image fills | moderate | image, web | all |
| `no-alt-text` | raster | info | No | image fills | cheap | all | all |

**Source:** `@varve/codegen/src/raster-audit.ts`

**Applicability Notes:**
- Image/print-focused (photo editing, print production)
- Pixel analysis rules are expensive (defer to on-demand)
- Web performance (oversized assets, low-quality scaling)

---

### Prototype Validation (3 rules)

| Rule ID | Category | Severity | Auto-Fix | Node Types | Execution Cost | Workspaces | Modes |
|---------|----------|----------|----------|------------|----------------|------------|-------|
| `missing-home-screen` | prototype | error | No | prototype config | cheap | design, motion | prototype |
| `broken-target` | prototype | error | No | interaction targets | cheap | design, motion | prototype |
| `disabled-interaction` | prototype | warning | No | interaction | cheap | design, motion | prototype |
| `orphan-node` | prototype | info | No | all | cheap | design, motion | prototype |

**Source:** `@varve/prototype/src/validation.ts`

**Applicability Notes:**
- Design/motion workspaces only
- Prototype mode only
- Interactive flows validation

---

## Current Exposure Architecture

### Panel Exposure
- **Audit tab** is a permanent inspector tab in: design, print, image, motion workspaces
- **Not present** in: drawing workspace
- **Overflow priority:** 5 (may be moved to overflow menu on narrow screens)

### Status Bar Exposure
- **DebtBadge:** Shows total debt count (errors + warnings + info)
- Color-coded: red (errors), orange (warnings), blue (info-only)
- Click opens Audit panel with 'debt' sub-tab
- Visible in: design, drawing workspaces

### Command Exposure
Commands registered in `createActionHandlers.ts`:
- `openAuditPanel` → `setInspectorTab('audit')`
- `runAudit` → `setInspectorTab('audit', 'audit')`
- `scanDebt` → `setInspectorTab('audit', 'debt')`
- `suggestNames` → `setInspectorTab('audit', 'naming')`
- `detectDuplicates` → `setInspectorTab('audit', 'components')`

### Intelligence Panel Tabs
Primary tabs: audit, spacing, naming
More tabs (grouped):
- Quality: debt, linter
- Design Systems: governance, components
- Analysis: prototype, layout, similar

### Canvas Overlays
- **No audit-specific canvas overlays** currently exist
- Existing overlays: rulers, guides, pixel grid, dot grid, bleed guides, layout grid, baseline grid
- Overlay configuration is workspace-specific in `workspaceTypes.ts`

---

## Severity Inconsistencies

### Current Severity Levels Across Systems
1. **Scene Intelligence:** error, warning, info
2. **Debt Scanner:** error, warning, info
3. **Governance:** error, warning, info
4. **Linter:** error, warning, info, **suggestion**
5. **Codegen:** error, warning, info
6. **Prototype:** error, warning, info

**Issue:** Linter introduces 'suggestion' which other systems don't have. No 'advisory' level exists anywhere.

### Confidence Scores
- **Linter only:** 0.3-0.9 confidence on some rules
- **Other systems:** No confidence tracking

---

## Execution Cost Classification

### Immediate (document structure only)
- All debt scanner rules
- All governance rules
- Most linter rules (zero-size, off-canvas, empty-container, touch-target)
- Contrast audit
- Prototype validation

### Moderate (geometry analysis)
- Vector audit (self-intersection, unnecessary anchors, malformed paths)
- Linter (non-text-contrast, focus-order)
- Raster audit (excessive transparency, over-compression)

### Expensive (pixel analysis)
- Raster audit (alpha-fringe, banding-risk)
- Not currently implemented in production

**Current Behavior:** All rules run immediately on document change. No debouncing, no on-demand deferral.

---

## Fix Capability Summary

### Has Auto-Fix
- `contrast-aa-fail` (contrast adjustment)
- `untokenized-colors` (add swatch)
- `missing-fonts` (replace with available font)

### No Auto-Fix
- All other 32+ rules

**Current Fix UX:** One-click "Auto-fix" button in IntelligencePanel for contrast issues only. No preview, no batch fixes.

---

## Suppression/Dismissal

### Current Support
- **Linter only:** `dismissable` flag per issue
- **LinterConfig:** `suppressedFindings` array (ruleId + nodeId combinations)
- **Persistence:** Stored on Document.linterConfig

### No Suppression Support
- Scene intelligence audit
- Debt scanner
- Governance rules
- Codegen audits
- Prototype validation

---

## Key Gaps Identified

1. **No workspace-aware filtering** - All rules run in all workspaces
2. **No mode-aware behavior** - No distinction between editing vs. review modes
3. **No contextual summaries** - Findings only shown in full Audit panel
4. **No canvas overlays** - Visual findings not shown on canvas
5. **Severity inconsistency** - 'suggestion' exists only in linter
6. **No confidence tracking** - Except linter, no confidence scores
7. **Limited auto-fix** - Only 3 rules have fixes, no preview/batch
8. **No suppression** - Only linter supports dismissal
9. **No exposure hierarchy** - Single panel, no passive status indicators
10. **No preflight mode** - Export checks run immediately, not at export time
11. **No motion-specific audits** - No animation-specific rules despite motion workspace
12. **No typography-specific audits** - Despite design/print workspaces, no deep typography checks

---

## Next Steps

1. Define workspace-aware audit profiles
2. Design 5-level exposure hierarchy
3. Unify finding model with stable IDs
4. Normalize severity levels (add 'advisory', standardize 'suggestion')
5. Add confidence tracking to all systems
6. Design canvas overlay system
7. Implement execution cost scheduling (immediate/debounced/on-demand)
8. Design suppression system (portable, revalidating)
9. Add contextual summaries to inspector panels
10. Implement preflight mode for export checks
