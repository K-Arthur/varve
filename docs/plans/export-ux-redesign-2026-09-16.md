# Export UX & UI Redesign Plan

## 1. Executive Summary

This plan addresses user feedback, competitive weaknesses in industry tools (Figma, Illustrator, Sketch, Penpot), visual clutter, and workflow efficiency for both:
1. **The Inspector Export Tab** (`AssetExportControls.tsx`, `PropertiesPanel.tsx`, `SpecPanel.css`)
2. **The Batch Export Dialog** (`ExportDialog.tsx`, `BatchJobList.tsx`, `DestinationPicker.tsx`, `ExportProgressBar.tsx`, `ExportResultsList.tsx`, `ExportDialog.css`)

It also covers:
- **Marketing website synchronization** (`apps/website/src/pages/docs/tools/export.astro` and `apps/website/src/pages/features/export.astro`)
- **Real-world scenario verification & visual capture** using Playwright E2E tests with photo, vector, and multi-artboard fixtures.

---

## 2. Research & Competitive Analysis: What Other Apps Failed At

Based on public user complaints and community discussions across Figma, Adobe Illustrator, Sketch, and Penpot:

| App / Platform | Problem & User Complaint | Real-World Impact | Varve Resolution in This Redesign |
|---|---|---|---|
| **Figma** | **Wall of options & no preview:** Export panel is buried at the bottom of the property inspector; batch export has no visual feedback of what output looks like before downloading; naming collisions when exporting multi-resolution assets (e.g. `@2x`). | Users download corrupt, clipped, or colliding files and have to re-run exports one-by-one. | **Two-pane layout with instant job inspection:** Visual thumbnail/icon preview, clear scale suffixes, real-time file tree preview, and live byte-size estimates. |
| **Illustrator** | **Cluttered "Export for Screens":** Visually overwhelming dialog with rigid grids, tiny text, and nested modal sheets that freeze or confuse users with obscure settings (slug, bleeds, anti-aliasing types) visible simultaneously. | Cognitive overload; beginners and pros alike make errors in output selection or miss fatal preflight warnings. | **De-cluttered progressive disclosure:** Core assets list on the left with search/filters; contextual settings on the right organized into clean, collapsible cards (Destination, Print/Press, AI Background, Motion). |
| **Figma / Penpot** | **Silent multi-selection failures & batch omissions:** In large documents (50+ assets), exports timeout, omit layers, or fail silently without showing which layer broke. | Wasted hours troubleshooting which file in a 50-file ZIP is missing or broken. | **Actionable preflight & per-item status:** Preflight checks run before export with clear error/warning badges; completed export shows per-file duration, byte size, and a 1-click "Retry Failed" button. |
| **Sketch / Canva** | **Rigid format management:** Adding formats requires tedious repetition; preset libraries are disconnected from quick-export actions. | Tedious repetitive clicks (picking format, picking scale, typing suffix for every asset). | **Streamlined Add Configuration:** Section header with a clean "+" quick-add action; smart preset chips (`+ PNG 1x`, `+ PNG 2x`, `+ SVG`, `+ WebP`); 1-click arming from the current Quick Export selection; compact preset library selector without towering forms. |
| **All tools** | **Empty selection dead-ends:** Deselecting layers leaves a dead "Select a layer to export" text with no actionable route. | Breaks workflow momentum when a user just wants to export the whole document or launch batch export. | **Actionable Empty & Multi-selection States:** Empty state offers a clear "Open Export Workspace" card; multi-selection offers a dedicated batch export card with exact count. |

---

## 3. Detailed Redesign Blueprint

### 3.1 Inspector Export Tab (`AssetExportControls.tsx`, `PropertiesPanel.tsx`, `SpecPanel.css`)

#### A. Clutter Reduction without Functionality Loss
- **Current problem:** The "Add configuration" fieldset stacks a Legend, 3 "Quick add" buttons, a "Preset library" `<Select>`, a "Custom format" `<Select>`, and an "Add configuration" button. This towering block takes up over 250px of vertical height in a 240px wide sidebar.
- **Redesigned:**
  - Clean section header: **"Export configurations"** with a badge indicating count (e.g., `2`) and a clean, accessible `+ Add` trigger button in the header.
  - **Quick Add chips:** Sleek, modern pills (`+ PNG 1x`, `+ PNG 2x`, `+ SVG`, `+ WebP`) for instant 1-click addition without opening any form.
  - **Expandable Custom/Catalog Picker:** Seamlessly revealed when clicking "+ Add" or "+ More…", keeping the default state ultra-compact, clean, and scannable.
  - **Presets List:** Refined `PresetRow` with clear visual hierarchy: format pill (`PNG`, `SVG`), dimension/scale readout, inline suffix badge that expands cleanly to edit, and an accessible 24×24 remove button.

#### B. Quick Export Area Polish
- **Visual hierarchy:** Format `SegmentedControl` + Scale `SegmentedControl` styled with modern pill styling, subtle active elevation, and crisp focus rings.
- **Unified Action Group:**
  - Primary button: "Download [Format]" (web) / "Export [Format]" (desktop).
  - Clean secondary action for SVG (Copy markup) or raster image copy.
  - Contextual status pill: Reassuring, non-intrusive feedback ("Downloaded Logo@2x.png (48 KB)") with auto-fade on selection change.

#### C. Empty & Multi-Selection States
- **Empty State (`PropertiesPanel.tsx`):**
  - Instead of dead text, render an engaging card with a subtle icon, title "No layer selected", and a primary action button "Open Export Workspace" so users can immediately batch-export the active canvas, page, or document without needing a selected node.
- **Multi-Selection State:**
  - Polished banner highlighting: "Multi-selection (N layers selected)".
  - Explains that quick export targets the primary node (`node.name`), with a prominent direct action: "Open Batch Workspace (N layers) →".

---

### 3.2 Export Dialog (`ExportDialog.tsx` & subcomponents)

#### A. Architecture: Two-Column Master-Detail Layout
- **Left Column: Batch Jobs & Assets View (~60% width)**
  - **Header Bar:**
    - Search input: Real-time filtering by node name or format (vital for 10+ jobs).
    - Format filter pills (`All`, `PNG`, `SVG`, `PDF`, etc.).
    - "Select all / Deselect all" checkbox with selected count (`4 of 6 files selected`).
    - Total estimated size badge (`Est. ~1.8 MB`).
  - **Job Cards / Rich List (`BatchJobList.tsx`):**
    - High-density, elegant cards.
    - Checkbox with 24×24 activation area.
    - Asset type icon (Frame, Vector, Text, Image).
    - File name with folder path preview.
    - Format pill badge with semantic color (PNG: emerald, SVG: amber, PDF: sky, WebP: indigo).
    - Resolution & scale badge (`1920 × 1080 · 2x · 300 PPI`).
    - Estimated file size (`240 KB`).
    - Status badge (`Pending`, `Rendering`, `Success`, `Failed`).
- **Right Column: Configuration Sidebar (~40% width)**
  - **Preflight Status Card:**
    - If clean: Subtle green checkmark badge "Preflight passed · Ready to export".
    - If warnings/errors: Expandable warning drawer with counts and explanations.
  - **Destination & File Naming:**
    - Destination folder picker (native desktop) or ZIP archive badge (browser).
    - Filename template input with interactive clickable token chips (`{name}`, `{suffix}`, `{ext}`) to insert variables without manual typing.
    - Organization segmented control: `Flat`, `By format`, `By node`.
    - Live file tree preview showing real folder nesting (e.g. `icons/arrow@2x.png`).
  - **Advanced Options Accordion / Tabs:**
    - *Raster Resolution:* Clean common PPI pills (`72`, `150`, `300`, `600`) + custom number field.
    - *Press / Print Settings:* Contextual when PDF/X is selected (bleed override, crop marks).
    - *AI Background Removal:* Clean toggle with method selector.
    - *Motion Export:* Clean accordion so CSS/Lottie/Video export doesn't clutter static exports.
- **Progress & Results State:**
  - In-flight: High-contrast, smooth progress bar with live stage label ("Rendering 3 of 8: hero.png") and Cancel button.
  - Completion: Clean `ExportResultsList` with success emphasis, file sizes, execution times, "Reveal in Files" (desktop) or "Download ZIP" (browser), and "Retry failed" button if any item failed.

---

### 3.3 Marketing Website Updates
- **`apps/website/src/pages/docs/tools/export.astro`:**
  - Update screenshots and documentation to accurately describe the two-column master-detail Export Dialog, the search/filter capabilities, the clickable filename token chips, and the streamlined Inspector Export tab.
- **`apps/website/src/pages/features/export.astro`:**
  - Highlight the decluttered, designer-friendly workflow: fast single-object quick export, intuitive multi-resolution preset library, and the professional batch workspace with real-time preflight and folder organization.

---

## 4. Implementation Steps & Validation
1. **Step 1: Inspector Export Tab Improvements**
   - Refactor `AssetExportControls.tsx` to streamline the configuration section (compact header, quick-add chips, collapsible catalog picker).
   - Improve empty state in `PropertiesPanel.tsx` with an actionable batch export trigger.
   - Update `SpecPanel.css` with clean layout, tokens, container queries, and accessibility compliance.
   - Verify unit tests & run Playwright inspector export tests.
2. **Step 2: Export Dialog Redesign**
   - Implement the master-detail two-column layout in `ExportDialog.tsx` and `ExportDialog.css`.
   - Enhance `BatchJobList.tsx` with asset type icons, format pills, search/filter, and rich rows.
   - Enhance `DestinationPicker.tsx` with interactive token chips and visual path tree preview.
   - Cleanly nest Resolution, Print, AI Background, and Motion settings.
   - Verify all unit tests (`ExportDialog.test.tsx`, `ExportProgressBar.test.tsx`, `ExportResultsList.test.tsx`).
3. **Step 3: Real-World E2E Scenario & Visual Verification**
   - Write/expand Playwright tests to cover real-world multi-asset documents (photos, vectors, text, frames).
   - Capture before/after visual evidence.
4. **Step 4: Marketing Website & Documentation Updates**
   - Update `apps/website/src/pages/docs/tools/export.astro` and `apps/website/src/pages/features/export.astro`.
   - Verify doc audits (`pnpm audit:docs`, `pnpm audit:emoji`, `pnpm audit:tokens`).
5. **Step 5: Verification & Progressive Commits**
   - Run verification suite (`pnpm verify:affected`).
   - Deliver comprehensive validation report.
