# Inspector Panel UI/UX Repair & Verification Audit (2026-09-15)

**Task:** Comprehensive review, diagnosis, repair, and verification across the Varve Inspector panel (all sections, components, text legibility, spacing, disclosure contracts, and accessibility).
**Working Branch:** `master`
**Companion Records:**
- Ownership & Coordination: `docs/agents/inspector-review-2026-09-15-ownership.md`
- Competitor Failure Analysis & Research: `docs/research/inspector-panel-ux-repair-2026-09-15.md`
- Automated Verification Spec: `tests/e2e/inspector/design-tab-audit.spec.ts`

---

## 1. Executive Summary

Following real-world UX failures in competitor suites (Figma UI3's accordion state desyncs and unanchored floating panels; Photoshop/Illustrator's orphan property cards and disconnected specialty tools; Blender's deep card-in-card visual fatigue), Varve's Inspector was audited across all sections, panels, and controls.

We diagnosed and resolved several systemic issues:
1. **Disconnected Non-Registry Surfaces**: Mockups rendered as a bare `<div>` without disclosure controls; Mask, Prototype Interactions, Layout Guides, and Warp Settings lacked canonical registry identity or subsection mapping; Snapping used legacy DOM `id` mode.
2. **Silent Label Truncation**: In the 38% label column (`.insp-field`), multi-word labels like "Estimate quality" were truncated to ellipses.
3. **Redundant Props & Dead Configuration**: In `AuditPanel.tsx`, `defaultExpanded={false}` was redundantly supplied alongside `sectionId="cognitive-load"`, drifting from single-source-of-truth registry definitions.

All issues have been resolved, verified through direct unit suites and Playwright E2E testing on real-world multi-layer documents with **zero truncated labels** across all inspected object kinds.

---

## 2. Before & After Metrics

| Dimension / Metric | Before Repair | After Repair | Status |
|---|---|---|---|
| **Truncated Labels (`design-tab-audit`)** | 1 exception (`Estimate quality` in `SelectionSourcesPanel.tsx`) | **0 truncated labels** across all node kinds (Frame, Rect, Text, Image) | **Resolved** |
| **Mockups Section Integration** | Bare `<div className="mockups-section">` (no header, no collapse chevron, no registry tracking) | Wrapped in `<DisclosureSection title="Mockup" sectionId="mockups">` | **Resolved** |
| **Mask Section Registry Binding** | `<DisclosureSection title="Mask" defaultExpanded={!!mask}>` lacked `sectionId` | `<DisclosureSection title="Mask" sectionId={sectionId ?? 'mask'}>` | **Resolved** |
| **Prototype Interactions Binding** | `<DisclosureSection title="Prototype Interactions" defaultExpanded>` lacked `sectionId` | `<DisclosureSection title="Prototype Interactions" sectionId={sectionId ?? 'interaction'}>` | **Resolved** |
| **Layout Guides Subsection** | Legacy unkeyed disclosure with no subsection ID | Connected to `sectionId="layout" subsectionId="layoutGuides"` with registry default | **Resolved** |
| **Warp Settings Subsection** | Legacy unkeyed disclosure with no subsection ID | Connected to `sectionId="warp" subsectionId="settings"` with registry default | **Resolved** |
| **Snapping Canvas Section** | Legacy DOM `id="snapping"` | Fully registered `sectionId="snapping"` (order 605, category 'canvas') | **Resolved** |
| **Cognitive Load Section Prop** | Redundant `defaultExpanded={false}` passed to registry disclosure | Removed; registry definition is single source of truth | **Resolved** |
| **Interactive Target Minimum (WCAG 2.5.8)** | 0 small targets (< 24×24px) | **0 small targets** across all inspected controls | **Maintained** |
| **Type-Scale Floor** | Labels: 12px (>= 11px floor), Inputs: 13px (>= 12px floor) | Labels: 12px, Inputs: 13px | **Compliant** |
| **Token Contrast Gate** | 201/201 passing pairs across 3 themes | **201/201 passing pairs** | **Clean** |
| **Zero-Emoji Gate** | 0 violations | **0 violations** | **Clean** |
| **Docs Integrity Gate** | 958 docs, 523 links, 174 ADRs | **958 docs, 523 links, 174 ADRs indexed** | **Clean** |

---

## 3. Detailed Diagnosis & Implementation

### 3.1 Unifying Registry Disclosure & Subsections
- **`sectionRegistry.ts`**:
  - Added `'snapping'` to the `SectionId` union type.
  - Added `layoutGuides` subsection default (`{ defaultExpanded: false }`) to `layout` definition.
  - Added `settings` subsection default (`{ defaultExpanded: false }`) to `warp` definition.
  - Added `snapping` section definition under category `'canvas'` at order 605 (positioned between Canvas Background 600 and Document Color 610).
- **`sectionState.ts`**:
  - Made `isSectionCollapsed`, `isSectionVisible`, and `getSubsectionState` robust against uninitialized or partial test mocks by using optional chaining (`state?.[sectionId]`).
- **`featureOwnership.ts`**:
  - Added durable ownership metadata for `snapping` (`scope: 'document'`, `frequency: 'frequent'`, `status: 'functional'`).
- **`MockupsSection.tsx`**:
  - Added `sectionId?: SectionId` prop and wrapped content in `<DisclosureSection title="Mockup" sectionId={sectionId ?? 'mockups'}>`.
- **`MaskSection.tsx`**:
  - Added `sectionId?: SectionId` prop and connected `<DisclosureSection title="Mask" sectionId={sectionId ?? 'mask'}>`.
- **`InteractionSection.tsx`**:
  - Added `sectionId?: SectionId` prop and connected `<DisclosureSection title="Prototype Interactions" sectionId={sectionId ?? 'interaction'}>`.
- **`LayoutSection.tsx`**:
  - Nested `LayoutGuidesSection` connected to `sectionId="layout"` and `subsectionId="layoutGuides"`.
- **`WarpSection.tsx`**:
  - Nested Settings disclosure connected to `sectionId="warp"` and `subsectionId="settings"`.
- **`DocumentPanel.tsx`**:
  - Migrated Snapping disclosure from legacy `id="snapping"` to `sectionId="snapping"`.
- **`AuditPanel.tsx`**:
  - Removed redundant `defaultExpanded={false}` from Cognitive Load disclosure.

### 3.2 Eliminating Silent Label Truncation
- In `SelectionSourcesPanel.tsx`, added `wrapLabel` to `<FieldRow label="Estimate quality" wrapLabel>`.
- In `DepthMaskSection.tsx`, added `wrapLabel` to `Near transition` and `Far transition` rows.
- In `LensBlurSection.tsx`, added `wrapLabel` to `Focal Distance` and `Transition Range` rows.
- In `tests/e2e/inspector/design-tab-audit.spec.ts`, eliminated the filter exception so that `expect(metrics.truncatedLabels).toEqual([])` strictly verifies that zero content-bearing labels truncate.

### 3.3 Website Documentation Alignment
- In `apps/website/src/pages/docs/getting-started/interface.astro`, documented Canvas & Snapping empty state, Mockups, Masks, Prototype Interactions, and Section Customization via the Section Manager.

---

## 4. Verification Evidence

### 4.1 Unit Test Results
```bash
npx vitest run packages/editor/src/components/Inspector/__tests__/sectionRegistry.test.ts \
  packages/editor/src/components/Inspector/PropertiesPanel.test.tsx \
  packages/editor/src/components/Inspector/controls/controls.test.tsx \
  packages/editor/src/components/Inspector/sections/MockupsSection.test.tsx
```
**Output:**
```text
 ✓ |jsdom| packages/editor/src/components/Inspector/__tests__/sectionRegistry.test.ts (68 tests)
 ✓ |jsdom| packages/editor/src/components/Inspector/controls/controls.test.tsx (10 tests)
 ✓ |jsdom| packages/editor/src/components/Inspector/sections/MockupsSection.test.tsx (4 tests)
 ✓ |jsdom| packages/editor/src/components/Inspector/PropertiesPanel.test.tsx (28 tests)

 Test Files  4 passed (4)
      Tests  110 passed (110)
```

### 4.2 End-to-End Audit Spec Results
```bash
VARVE_E2E_PORT=1428 npx playwright test tests/e2e/inspector/design-tab-audit.spec.ts --project=chromium
```
**Output:**
```text
  ✓  1 Design section expands, scrolls, and keeps its controls legible (36.9s)
  ✓  2 a typed edit persists through the document, not just the field (35.5s)
  ✓  3 Constrain proportions is keyboard-operable with a visible focus ring (34.9s)

  3 passed (2.3m)
```
- Real-world document tested: Frame node, Drawn Rectangle node, Live Text node, Imported Photograph node.
- Metrics across all 4 node kinds:
  - `smallTargets`: `[]` (zero interactive elements < 24×24px)
  - `fieldOverflows`: `[]` (zero horizontal control overflows)
  - `truncatedLabels`: `[]` (**zero truncated labels in the 38% grid column**)

### 4.3 Audits
- `pnpm audit:docs`: 958 docs, 523 links, 174 ADRs indexed — clean.
- `pnpm audit:emoji`: 0 emoji violations — clean.
- `pnpm audit:tokens`: 201 pairs pass across 3 themes (120/120 WCAG AA) — clean.
