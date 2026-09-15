# Inspector Panel Information Architecture — Audit & Redesign Plan

**Date:** 2026-07-23
**Scope:** Inspector tab hierarchy, workspace-aware panels, density, navigation

---

## 1. Current State Audit

### 1.1 Tab Inventory

| Tab ID | Lines | Content | Visibility |
|--------|-------|---------|------------|
| **Properties** | 681 (orchestrator) + ~13,400 (sections) | 37 registered sections, dynamically composed per selection | All modes |
| **Appearance** | 33 | Mask + Paint Library + Effects section | All modes |
| **Adjustments** | 55 | 11 image sections OR adjustment-node editor | Image mode + dynamic |
| **Prototype** | 41 | Interaction section + flow view | Design + Motion |
| **Export** | inline | Format sub-tab (AssetExportControls) + Code sub-tab (CodeGenView) | All modes |
| **Audit** | 31 → 1607 (IntelligencePanel) | 10 sub-tabs: audit, spacing, naming, governance, debt, prototype, layout, components, similar, linter | All except Drawing |

### 1.2 Per-Mode Tab Count

| Mode | Tabs | Count |
|------|------|-------|
| Design | Properties, Appearance, Prototype, Export, Audit | 5 |
| Print | Properties, Appearance, Audit, Export | 4 |
| Drawing | Properties, Appearance, Export | 3 |
| Image | Properties, Adjustments, Appearance, Export, Audit | 5 |
| Motion | Properties, Appearance, Prototype, Export, Audit | 5 |

### 1.3 Properties Tab Section Density

**Single shape selection** surfaces ~12 sections:
- Position & Size, Constraints, Corner Radius (rect/frame), Layout (frame), Appearance, Fills, Stroke, Effects, plus conditional sections

**Single image selection** surfaces ~16 sections:
- All of the above + Image Placement, Crop & Bounds, Image Enhancement, Background Removal, Colorize, AI Denoise, Lens Blur, Line Art, Content-Aware Fill, Detect Text, OCR, Blend Images, Extract Palette, plus collapsed-by-default sections

**Single text selection** surfaces ~8 sections:
- Position & Size, Constraints, Appearance, Fills, Stroke, Effects, Typography, Adaptive Contrast

### 1.4 IntelligencePanel Density

10 sub-tabs is excessive. Only 3 (audit, spacing, naming) are "primary." The remaining 7 are behind a "More" dropdown that is just a flat wrap grid — no grouping, no visual hierarchy.

---

## 2. Problems Identified

### P1: Flat tab hierarchy — all panels compete equally

All 6 top-level tabs sit in one horizontal strip with identical visual weight. Properties (used 80% of the time) looks the same as Adjustments (image-only, used rarely). The 3 group separators (primary/workflow/output) are just a chevron SVG — visually negligible.

**Evidence:** `inspector.css:57-78` — all tabs use identical `.insp-panel__tab` styling. The group separator at `inspector.css` is a 10×10 chevron SVG with no label.

### P2: Appearance tab duplicates Properties content

The Appearance panel (33 lines) renders Mask + Paint Library + Effects — content that ALSO appears in the Properties tab as sections. Users see the same controls in two places with no clear distinction of which is "the place to go."

**Evidence:** `panels/AppearancePanel.tsx` renders `MaskSection`, `PaintLibrarySection`, `EffectsSection` — all three also exist in `SECTION_DEFINITIONS` and render in `SingleSelectionPanel`.

### P3: Properties tab is overloaded — especially for images

A single image selection surfaces ~16 conditional sections in a single scroll. Image-editing controls (enhancement, background removal, denoise, blur, OCR, etc.) sit alongside geometry and appearance controls, forcing users to scroll past basic shape controls to reach image tools.

**Evidence:** `sectionRegistry.ts:358-488` — 13 image-specific sections, all gated on `isImageNode`, all rendered in a flat list.

### P4: IntelligencePanel has 10 unstructured tabs

The "More" dropdown is a flat wrap of 7 tabs with no grouping. Governance, Debt, Prototype, Layout, Components, Similar, Linter — these have no logical ordering or grouping. Users must scan all 7 to find what they need.

**Evidence:** `IntelligencePanel.tsx:55-63` — `MORE_TABS` is a flat array with no category metadata.

### P5: Workspace modes don't meaningfully restructure the inspector

Switching from Design to Print just hides Prototype. Switching to Drawing hides Prototype + Audit. The remaining tabs are identical in order, weight, and content. Workspace modes don't define different default tabs, different ordering, or different panel width expectations.

**Evidence:** `workspaceTypes.ts:301-687` — all modes share the same Properties → Appearance → Export spine. Only the "extra" tabs (Prototype, Adjustments, Audit) change.

### P6: Density is extreme for primary controls

Number inputs are 20px tall, rows are 28px, sections have 0 gap (only 1px hairline separators). A single shape selection shows ~60 control rows in one scroll. The section headers are uppercase 11px with 0.04em letter-spacing.

**Evidence:** `inspector.css` — `.insp-panel { gap: 0 }`, `.insp-panel__tab { padding: var(--space-1) 0 }`, field rows at `min-height: 1.75rem`.

### P7: No contextual quick-access for frequent actions

The most common edits (position, size, fill color, opacity) are buried inside disclosure sections. Every edit requires finding the right section, expanding it, then finding the control. There is no persistent "quick bar" for the most frequent properties.

### P8: Export tab is both a tab and a dialog

Export appears as a top-level tab AND as an ExportDialog (modal). The tab only works with a single selected node. Multi-selection export requires the dialog. This creates two divergent UX paths.

---

## 3. Proposed Architecture

### 3.1 Panel Group Hierarchy

```
Inspector
├── Primary Tab: Properties (always visible, selection-driven)
│   ├── Quick Bar (persistent for single selection: X/Y/W/H/Opacity/Fill)
│   ├── Geometry (Position/Size, Corner Radius, Layout, Constraints)
│   ├── Appearance (Fills, Stroke, Appearance section)
│   ├── Content (Typography, Component)
│   └── Conditional (Image Placement, Crop, Adjustment, Frame Presets)
│
├── Workflow Panels (secondary switcher — workspace-aware)
│   ├── Appearance & Effects (the 1421-line EffectsSection + Mask + Paint Library)
│   ├── Adjustments (image editing workflows — image mode)
│   └── Prototype (interaction design — design/motion)
│
└── Output & Review (overflow or secondary position)
    ├── Export (format/code sub-tabs)
    └── Audit / Intelligence
```

### 3.2 Two-Tier Tab System

**Tier 1 — Primary (Properties):**
- Always visible, pinned left
- Visual weight: full-width tab with accent underline when active
- Selection-driven content

**Tier 2 — Workflow (secondary switcher):**
- Compact tab strip below or beside the primary tab
- Workspace-filtered: only shows panels relevant to the current mode
- Smaller text, lighter color, no accent underline — visually subordinate

This avoids the "6 equal tabs" problem without adding nested tab bars or overflow dependence.

### 3.3 Workspace-Aware Restructuring

| Mode | Tier 1 | Tier 2 (Workflow) | Output |
|------|--------|-------------------|--------|
| **Design** | Properties | Appearance & Effects, Prototype | Export, Audit |
| **Print** | Properties | Appearance & Effects | Export, Audit |
| **Drawing** | Properties | Appearance & Effects | Export |
| **Image** | Properties | Adjustments, Appearance & Effects | Export, Audit |
| **Motion** | Properties | Appearance & Effects, Prototype | Export, Audit |

**Key change:** The "Appearance" tab becomes "Appearance & Effects" — a dedicated home for the heavy effects workflow (1421 lines). It no longer duplicates Properties content; EffectsSection is REMOVED from the Properties tab composition.

### 3.4 IntelligencePanel Restructuring

Reduce from 10 flat tabs to 3 primary + 1 grouped overflow:

**Primary tabs:** Audit, Spacing, Naming

**"More" dropdown — grouped:**
- **Quality:** Debt, Linter
- **Design Systems:** Governance, Components
- **Analysis:** Prototype Flow, Layout, Similar

Each group has a label in the overflow menu. Tabs are sorted by frequency within groups.

### 3.5 Density Improvements

1. **Quick bar** for single selection: persistent strip showing X, Y, W, H, Opacity, Fill color — the 6 most-edited properties
2. **Section spacing:** Increase from 0 to `var(--space-1)` (4px) between sections for visual separation
3. **Touch targets:** Increase primary control height from 20px to 24px (from `--space-5` to `--space-6`)
4. **Section headers:** Increase from `font-size-xs` (11px) to `font-size-sm` (12px) with reduced letter-spacing
5. **Image sections:** Move advanced image sections (denoise, blur, OCR, etc.) from Properties to the Adjustments panel. Keep only Image Placement (fit/replace) in Properties.

---

## 4. Specific Changes

### Change 1: Remove EffectsSection from Properties composition

**Why:** Effects is the largest section (1421 lines) and has a dedicated tab. Showing it in both places creates duplication and bloats Properties.

**How:** Remove `add('effects', ...)` from `SingleSelectionPanel` and `MultiSelectionPanel` in `PropertiesPanel.tsx`. The Effects tab (renamed "Appearance & Effects") becomes the sole home.

**Files:** `PropertiesPanel.tsx:576-630` (SingleSelectionPanel), `PropertiesPanel.tsx:632-680` (MultiSelectionPanel)

### Change 2: Rename "Appearance" tab to "Appearance & Effects"

**Why:** Clarifies that this is the dedicated home for effects, masks, and paint library — not a duplicate of Properties appearance controls.

**How:** Update label in `workspaceTypes.ts` for all modes.

**Files:** `workspaceTypes.ts:310,399,491,592,683`

### Change 3: Move advanced image sections to Adjustments panel

**Why:** 13 image sections in Properties create excessive scroll for image editing. The Adjustments panel already exists for this workflow.

**How:** Remove `image-enhancement`, `background-removal`, `colorize`, `ai-denoise`, `lens-blur`, `line-art`, `content-aware-fill`, `detect-text`, `ocr`, `blend-images`, `palette` from Properties composition. Keep them in AdjustmentsPanel. Keep only `image-placement` and `image-crop` in Properties.

**Files:** `PropertiesPanel.tsx` (SingleSelectionPanel), `sectionRegistry.ts` (mark sections as "workflow" instead of inline)

### Change 4: Implement two-tier tab system

**Why:** Creates clear visual hierarchy between the primary Properties panel and secondary workflow panels.

**How:**
- Primary tab strip: Properties (pinned, full visual weight)
- Secondary tab strip: Workflow panels (smaller, lighter, below primary)
- Both strips are keyboard navigable with roving tabindex

**Files:** `PropertiesPanel.tsx` (major refactor of tab rendering), `inspector.css` (new tier styles)

### Change 5: Group IntelligencePanel overflow tabs

**Why:** 7 flat overflow tabs are hard to scan. Grouping by purpose (Quality, Design Systems, Analysis) improves discoverability.

**How:** Replace flat `MORE_TABS` array with grouped structure. Render group labels in overflow menu.

**Files:** `IntelligencePanel.tsx:55-63`, overflow menu rendering

### Change 6: Add quick bar for single selection

**Why:** The 6 most-edited properties (X, Y, W, H, Opacity, Fill) should be immediately accessible without expanding sections.

**How:** Add a persistent `.insp-quick-bar` strip at the top of SingleSelectionPanel showing compact NumberFields for X/Y/W/H and a fill swatch + opacity slider.

**Files:** New `QuickBar.tsx` component, `PropertiesPanel.tsx`, `inspector.css`

### Change 7: Improve density measurements

**Why:** Current density (20px inputs, 0 section gap) is below comfortable minimums.

**How:**
- Section gap: 0 → `var(--space-1)` (4px)
- NumberField height: `--space-5` (20px) → `--space-6` (24px)
- Section header font: `font-size-xs` → `font-size-sm`
- Quick bar height: 32px persistent

**Files:** `inspector.css`, `controls/NumberField.tsx`

---

## 5. Migration & Compatibility

### Deprecated tab IDs
- `'document'` → `'properties'` (already handled by `DEPRECATED_TAB_FALLBACKS`)
- `'spec'` → `'export'` (already handled)
- No new deprecations needed

### Persisted layout migration
- Existing `strata-workspace-preferences` will continue to work
- The new two-tier system maps each mode's tabs to a `tier` field
- Migration: all existing tabs default to `tier: 'workflow'` except `properties` → `tier: 'primary'`

### Command deep links
- `setInspectorTab('appearance')` still works (tab ID unchanged)
- No command changes needed

### Test impact
- Workspace panel-visibility tests need updating for new tab structure
- New tests for: two-tier rendering, quick bar, IntelligencePanel grouping

---

## 6. Testing Plan

1. **Workspace panel-visibility tests:** Verify each mode shows the correct tabs in the correct tier
2. **Two-tier rendering tests:** Verify primary vs secondary tab styling and keyboard navigation
3. **Quick bar tests:** Verify quick bar appears for single selection, hidden for multi/empty
4. **Effects deduplication tests:** Verify EffectsSection no longer appears in Properties, only in Appearance & Effects tab
5. **Image section migration tests:** Verify advanced image sections removed from Properties, still in Adjustments
6. **IntelligencePanel grouping tests:** Verify overflow menu shows grouped tabs
7. **Density tests:** Verify new measurements (section gap, touch targets, header size)
8. **Command deep link tests:** Verify `setInspectorTab` still opens the correct tab
9. **Keyboard navigation tests:** Verify roving tabindex in two-tier tab system
10. **Persistence tests:** Verify user customizations survive migration

---

## 7. Risks & Limitations

| Risk | Mitigation |
|------|-----------|
| Users accustomed to Effects in Properties | Quick bar + Appearance & Effects tab is one click away; command palette deep link |
| Two-tier tabs may confuse | Clear visual hierarchy (size, weight, color) distinguishes tiers |
| Image mode loses inline image controls | Image Placement + Crop remain in Properties; advanced tools in Adjustments |
| Export tab duality (tab + dialog) | Out of scope for this round — flagged for future work |
| IntelligencePanel grouped overflow is still a dropdown | Acceptable — primary 3 tabs cover 90% of use cases |
| Quick bar adds persistent height | Only shows for single selection (the common case); 32px is minimal |

---

## 8. What This Does NOT Do

- Does NOT remove Export tab (flagged for future consolidation with dialog)
- Does NOT add vertical navigation (two-tier horizontal is sufficient)
- Does NOT add telemetry or analytics
- Does NOT change the section registry architecture (it's sound)
- Does NOT change the lazy-loading strategy (preserved)
- Does NOT add new workspace modes (only restructures existing ones)
- Does NOT remove the "More" overflow from IntelligencePanel (only groups it)

---

## 9. Success Metrics

- Tab count per mode: max 5 (down from 5-6, but with clear hierarchy)
- Properties sections for image: max 8 (down from ~16)
- Properties sections for shape: max 8 (down from ~12)
- IntelligencePanel primary tabs: 3 (unchanged), grouped overflow: 3 groups
- Section spacing: 4px (up from 0)
- Touch targets: 24px (up from 20px)
- Quick bar: 6 most-edited properties always visible for single selection
