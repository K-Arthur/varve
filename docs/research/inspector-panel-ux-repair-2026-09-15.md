# Inspector Panel UI/UX Research, Failure Analysis, and Repair Ledger (2026-09-15)

## 1. Scope & Intent

Comprehensive review, diagnosis, repair, and verification across the actual app's Inspector panel — including all its sections, components, text legibility, spacing, disclosure contracts, and accessibility.

Companion records:
- Ownership & Coordination: `docs/agents/inspector-review-2026-09-15-ownership.md`
- Audit & Verification Evidence: `docs/audits/inspector-panel-ux-repair-2026-09-15.md`
- Rendered Audit Spec: `tests/e2e/inspector/design-tab-audit.spec.ts`

---

## 2. What Other Products & Offerings Failed at (Online Research & User Complaints)

### 2.1 Figma UI3 Inspector Redesign Backlash (2024–2025)
*Sources: Figma Community Forum threads (2024-2025), Reddit /r/FigmaDesign "UI3 Feedback", Hacker News (2024).*

1. **Floating / Detached Panel Obscuration**:
   - *User Complaint*: Figma's floating inspector panels hovered directly over the canvas edges, constantly blocking active artwork and forcing manual panning or panel toggling.
   - *Root Cause*: Treating the properties panel as a floating glass card rather than a docked workspace rail with predictable layout boundaries.
   - *Varve Resolution*: The Inspector is firmly anchored in the desktop layout rail (`editor-inspector`) with explicit collapse (`Ctrl+Shift+B`) and optional panel detachment (`PanelDetachButton`) only when the user explicitly requests a separate window.

2. **Accordion Desync and Loss of Section State**:
   - *User Complaint*: "Why do my sections keep closing or opening randomly when I switch between frames and components?"
   - *Root Cause*: Ephemeral, component-local `useState` or per-mount state in inspector sections that reset whenever the DOM node was recycled or selection changed.
   - *Varve Resolution*: Centralized `sectionRegistry` and `sectionVisibility` state in `EditorState`, with durable per-workspace persistence and single-source-of-truth `defaultExpanded` and `subsections` definitions.

3. **Silent Label Truncation without Accessible Tooltips or Wrapping**:
   - *User Complaint*: In narrow sidebar widths or multi-column layouts, labels like "Effective resolution", "Padding", or "Subject estimate quality" were truncated to `...`, leaving designers guessing what the field controlled.
   - *Varve Resolution*: Explicit `wrapLabel` (`.insp-field__label.insp-field__label--wrap`) using `overflow-wrap: anywhere`, verified in Playwright at 240px and 1440px viewports with zero silently clipped content-bearing labels.

### 2.2 Adobe Photoshop & Illustrator Properties Panel Issues
*Sources: Adobe Community Bugs & Feature Requests (2021–2025), e.g., "Properties panel not showing shape properties", "No scrollbar in type layer properties".*

1. **Disconnected Non-Registry Surfaces (The "Orphan Section" Problem)**:
   - *User Complaint*: Certain specialized tools or object types (Mockups, Masks, Snapping, Prototype Interactions) rendered inconsistent headers or lacked gear/customization options, while others could be hidden or reordered.
   - *Root Cause*: Some sections bypassed the shared disclosure and registry architecture, rendering bare `div` containers or unkeyed `<DisclosureSection>` tags without a `sectionId`.
   - *Varve Resolution*: Complete registry integration for `mockups`, `mask`, `interaction`, `snapping`, and nested subsections (`layoutGuides`, `settings`), allowing universal Section Manager customization, consistent chevron icons, and uniform styling.

2. **Inconsistent Vertical Rhythm and Jagged Alignment Columns**:
   - *User Complaint*: Eyes fatigue scanning down the inspector because one section used 50%/50% columns, another used 30%/70%, and a third used random inline flexboxes with unaligned inputs.
   - *Root Cause*: Ad-hoc CSS rules defined independently per section without a unified field grammar.
   - *Varve Resolution*: Strict 38% label track (`minmax(0, 38%)`) and 1fr control track (`minmax(0, 1fr)`) across all `.insp-field` rows, with shared `gap: var(--space-2)` and tabular numbers for digit alignment.

3. **Keyboard Inaccessibility & Invisible Focus Rings**:
   - *User Complaint*: Tabbing through compact inspector buttons and switches gave no indication of where focus was, or skipped sub-24px controls entirely.
   - *Root Cause*: Zero-size hidden inputs, missing `:focus-visible` styles, and icon buttons under the 24×24px WCAG minimum.
   - *Varve Resolution*: Explicit 24×24px minimum touch/pointer targets on all buttons and switches, with visible outline focus rings (`outline: 2px solid var(--color-interactive-focus-ring)`) and `:has(input:focus-visible)` selectors for styled wrappers.

### 2.3 Blender Properties Editor (T54951, T37453)
*Sources: Blender Developer Archive, BlenderArtists community.*

1. **Hard-to-Scan Multi-Column Density**:
   - *User Complaint*: Properties scattered across horizontal rows and nested sub-boxes made rapid visual parsing impossible.
   - *Root Cause*: Excessive visual box nesting ("card inside card inside card").
   - *Varve Resolution*: Flat Gestalt hierarchy: clean disclosure sections, quiet uppercase labels, prominent values, and subtle dividers only where functional groups divide.

---

## 3. Discovered Defects in Varve Inspector & Root Causes

| Component / Section | Defect | Root Cause | Fix Applied |
|---|---|---|---|
| `MockupsSection.tsx` | Rendered as bare `<div className="mockups-section">` with no title header or collapse chevron | Did not use `<DisclosureSection>` | Wrapped in `<DisclosureSection title="Mockup" sectionId="mockups">` |
| `MaskSection.tsx` | Expansion state desynced from section registry; could not be customized | `<DisclosureSection title="Mask" defaultExpanded={!!mask}>` lacked `sectionId="mask"` | Connected `sectionId={sectionId ?? 'mask'}` |
| `InteractionSection.tsx` | Prototype interaction section not connected to section registry | `<DisclosureSection title="Prototype Interactions" defaultExpanded>` lacked `sectionId` | Connected `sectionId={sectionId ?? 'interaction'}` |
| `LayoutSection.tsx` | Nested "Layout guides" subsection had no registry identity | `<DisclosureSection title="Layout guides" defaultExpanded={false}>` had no `sectionId` or `subsectionId` | Added `subsections: { layoutGuides: { defaultExpanded: false } }` to `layout` definition and connected `sectionId="layout" subsectionId="layoutGuides"` |
| `WarpSection.tsx` | Nested "Settings" subsection had no registry identity | `<DisclosureSection title="Settings">` had no `sectionId` or `subsectionId` | Added `subsections: { settings: { defaultExpanded: false } }` to `warp` definition and connected `sectionId="warp" subsectionId="settings"` |
| `DocumentPanel.tsx` | "Snapping" section used legacy DOM `id="snapping"` without registry support | Missing `snapping` in `SectionId`, `SECTION_DEFINITIONS`, and `FEATURE_OWNERSHIP` | Added `snapping` to registry and feature ownership; updated to `sectionId="snapping"` |
| `SelectionSourcesPanel.tsx` | "Estimate quality" label truncated to ellipsis in 38% track | `<FieldRow label="Estimate quality">` lacked `wrapLabel` prop | Added `wrapLabel` prop |
| `DepthMaskSection.tsx` | "Near transition" and "Far transition" at risk of clipping on narrow rails | Missing `wrapLabel` on long transition labels | Added `wrapLabel` to transition rows |
| `LensBlurSection.tsx` | "Focal Distance" and "Transition Range" at risk of clipping on narrow rails | Missing `wrapLabel` on long property labels | Added `wrapLabel` to blur controls |
| `AuditPanel.tsx` | Dead `defaultExpanded={false}` prop passed alongside `sectionId="cognitive-load"` | Redundant call-site prop ignored in registry mode | Removed dead prop; registry definition governs default |
| Website Docs (`interface.astro`) | Outdated list of Inspector sections and lack of documentation for Snapping, Mockups, and Section Manager | Documentation drift | Updated `interface.astro` with full section inventory and customization guidance |

---

## 4. Verification & Regression Plan

1. Unit tests:
   - `packages/editor/src/components/Inspector/__tests__/sectionRegistry.test.ts`
   - `packages/editor/src/components/Inspector/PropertiesPanel.test.tsx`
   - `packages/editor/src/components/Inspector/controls/controls.test.tsx`
   - `packages/editor/src/components/Inspector/sections/MockupsSection.test.tsx`
2. End-to-End audit:
   - `tests/e2e/inspector/design-tab-audit.spec.ts` (extended with zero truncated labels and complete section checks)
3. Visual & Token validation:
   - `pnpm audit:tokens` (120/120 WCAG AA token gate)
   - `pnpm audit:emoji`
   - `pnpm audit:docs`
