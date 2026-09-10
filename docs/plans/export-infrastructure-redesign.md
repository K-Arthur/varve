# Export Infrastructure Redesign — Screenshot-Grounded Prompt + Audit

Status, 2026-08-01: created from a pasted redesign brief (reproduced verbatim in
"§A — Source brief" below) written against a screenshot of the compact Export
tab. Before acting on it, the codebase was audited to find the real components
behind that screenshot — see "§B — Audit findings". Most of the data model and
the advanced batch-export surface the brief asks for **already exist**; the
actual gap is narrower than the brief implies, and §C scopes the work that is
real, ordered by what closes that gap first. This is a sibling document to
[`export-system-deferred.md`](./export-system-deferred.md), which owns the
still-open print-engine workstream (font outlining, PDF/X, ICC CMYK) — this
doc does not duplicate that scope.

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development
> (recommended) or executing-plans to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

---

## §B — Audit findings (read this before §A)

The screenshot in the originating request is
`packages/editor/src/components/SpecPanel/AssetExportControls.tsx`, rendered
in two places:

1. `PropertiesPanel.tsx` (Inspector → **Export** tab → **Format** sub-tab —
   this is the live, editable surface end users hit; the sibling **Code**
   sub-tab renders `CodeGenView`, confirming the brief's guess in §9 that
   `FORMAT`/`CODE` are real sibling tabs today).
2. `SpecPanel/SpecPanel.tsx`, a read-only "dev handoff" panel active only in
   `inspect` tool mode — no node-mutation path is available here by design.

Trace requested by §1 of the brief:

| Question | Answer |
|---|---|
| Buttons/tabs/radios? | Plain `<button aria-pressed>` group, not a native radio/select. |
| Default format | `suggestExportFormat()` in `intelligence/exportAdvisor.ts` — heuristic per node kind (image source, vector shape, text, large canvas, mixed-content frame). |
| Selection state communicated? | Yes — `aria-pressed` + `.spec-export__btn--active`, not color-only. |
| Does Download use selected format? | Yes, via `handleExport` in the same file. |
| What does the copy icon copy? | `CopyButton` copies the raw SVG markup (`exportNodeToSvg(node, doc)`), labeled `"SVG markup"` — already has an explicit accessible name, contrary to the brief's assumption. |
| Info icon | `Tooltip label={suggestion.reason}` + `aria-label="Why {format}?"` — already has an accessible name and a reason string, contrary to the brief's assumption. |
| Selection/frame/page/document scope? | Always the single selected node (`node` prop), never multi-select or page/doc. |
| Effects/masks/fonts/transparency preserved? | Yes, real pipeline: `composeFlattenedRasterAssetsForNode`, `flattenSceneToEngine`, font-readiness gating (`awaitExportsReady`) before raster/PDF export — this is not a stub. |
| PDF: screen or print? | Screen only from this panel (`exportNodeAsPdf`, desktop-only via Tauri IPC `export_node_pdf`). Print-intent PDF/X-1a/X-4 is the deferred-plan's Workstream A. |
| Browser vs Tauri differ? | Yes, correctly: `isTauriPlatform(platform)` branches `saveBinaryFile` vs `downloadBlob`. |
| Settings persisted? | No — format/scale choice is ephemeral React state (`useState`), reset per node change via `suggestedForNodeRef`. |
| Does CODE subtab share export architecture? | No — separate component (`CodeGenView`), separate settings model. Already satisfies the brief's §9 requirement to keep them architecturally distinct. |

**The multi-configuration data model the brief asks for in §2 already exists**
and is more complete than the brief assumes:

- `packages/scene/src/types.ts:899` — `SceneNode.presets?: ExportPreset[]`
  (multi-preset per node, exactly the "stackable configurations" §2 wants).
- `packages/scene/src/export-types.ts` — `ExportPreset`, `ExportJob`,
  `ExportBatch`, `ExportSettings`, plus format-specific option interfaces
  (`RasterOptions`, `VectorOptions`, `PrintOptions`, `CodeOptions`) already
  covering most of §10's per-format settings list.
- `packages/editor/src/components/Export/ExportDialog.tsx` — the "full export
  workspace" §3 asks for: batch job list, per-job selection, destination +
  filename-template + folder-rule picker (`DestinationPicker.tsx`), progress
  bar with cancel (`ExportProgressBar.tsx`), background-removal-before-export,
  motion/video/GIF export, package (ZIP) export, aria-live announcements,
  partial-failure reporting. Wired live via `editor.showExportDialog` /
  `ExportLayer.tsx`, reachable today (check `Menubar.tsx` for the trigger).
- `packages/editor/src/components/Export/ExportPresetPanel.tsx` — a
  **complete, untested, and completely unwired** implementation of §2's
  configuration-list UI (add/remove/toggle/suffix-edit multiple presets per
  node). It is not imported by any live panel — confirmed via repo-wide grep,
  only self-referenced. This is the actual missing link.

**The real gap:** `AssetExportControls` never reads or writes
`node.presets`, so `ExportDialog`'s `buildJobs()` — which iterates
`node.presets` — has no way to ever be populated from the UI. The batch
"advanced" export surface the brief wants already works end-to-end except
for the one connector piece that lets a user create a preset in the first
place. `ExportPresetPanel` was built to be that connector and then never
wired in.

This reframes the brief: it is not "build a Figma-style export system from a
flat button row," it is "connect the compact inspector to the multi-preset
model and the batch dialog that already exist, and fix the primary-action
wording/icon-labeling issues that survive in the real component" (most of the
brief's assumed defects — unlabeled icons, no advisor reasoning, no
scope/pipeline fidelity — turned out to already be handled; see table above).

---

## §C — Scoped implementation plan

Ordered by what closes the real gap first. Each closed item is checked off in
this document as it lands, with the commit hash noted.

### C1. Wire the configuration-list UI into the compact inspector

- [x] Add `onAddPreset` / `onUpdatePreset` / `onRemovePreset` /
      `onOpenAdvancedExport` optional props to `AssetExportControls`. Absent
      in `SpecPanel.tsx`'s read-only dev-handoff usage (intentionally —
      that surface has no node-mutation path); present in
      `PropertiesPanel.tsx`, wired to `editor.updateNode` and
      `editor.setShowExportDialog(true)`.
- [x] Fold `ExportPresetPanel`'s row UI into `AssetExportControls` as an
      "Export settings" section below quick-export: list of `node.presets`
      (format, scale/suffix summary, enabled checkbox, remove), "+ Add export
      setting" seeded from the current quick-export format/scale selection,
      and an "Open advanced export…" action that hands off to the existing
      `ExportDialog` batch flow (closes brief §3's compact/advanced split).
- [x] Add the brief's §4 empty-state copy when no presets exist yet.
- [x] Delete the orphaned `ExportPresetPanel.tsx` / `export-preset-panel.css`
      now that their logic is folded in and reachable — dead code should not
      persist alongside its replacement.

### C2. Contextual primary action (brief §7)

- [x] Replace the generic "Download" label with a format- and
      platform-contextual one: `Export {FORMAT}` when saving via the desktop
      IPC bridge (Tauri `saveBinaryFile`), `Download {FORMAT}` for browser
      blob delivery — matching the brief's "Download only where a literal
      browser download happens" rule. Existing tests updated to match.

### C2b. Format coverage regression fix (2026-08-01, follow-up session)

The first pass of C1 folded `ExportPresetPanel`'s *reachable* behavior into
`AssetExportControls` but narrowed "add setting" to the five quick-export
formats, then deleted the panel. That silently dropped print (PDF/X-1a,
PDF/X-4) and codegen (React, Flutter, SwiftUI, SVG component) from the only
UI that can create a preset — a real scope regression against the goal of a
complete web *and* print pipeline, even though nothing user-reachable broke
(the old panel was already unwired). Closed by:

- [x] Capability-gated format picker for new export settings covering all 12
      encodable formats, ordered assets → print → code. Availability comes
      from `FORMAT_CAPABILITIES` via `formatSupportedOnPlatform`, so PDF/X
      shows disabled with "requires the desktop app" on web, and AVIF — which
      has no encoder (`supported: false`, defect D1) — is never offered.
- [x] Per-row filename-suffix editing (the other capability the deleted panel
      had and the port dropped).
- [x] Press formats seed at 1x with no `@Nx` suffix; scale is only applied to
      formats where it means something.

### C2c. Real PDF/X execution (defect D3)

- [x] `pdf-x1a` / `pdf-x4` previously **threw unconditionally** in
      `exportService.renderJob`, so offering them anywhere would have been a
      UI that lies. Worse, the throw called `capabilitiesForFormat(format)`
      with no platform argument, defaulting to `'web'` — so the message read
      "requires the desktop app" *even when running on desktop*.
- [x] Added `exportNodeAsPdfX` in `SpecPanel/export.ts`, invoking the existing
      Tauri commands `export_pdfx1a` / `export_pdfx4` (Rust
      `strata_print::cmyk::*`) with the camelCase `PdfXOptions` payload the
      command deserializes. Mirrors `exportNodeAsPdf`'s bridge rather than
      taking a new `@varve/print` dependency in the editor — and deliberately
      does *not* fall back to the `@varve/print` stub, which emits a
      placeholder rather than a real PDF.
- [x] Still desktop-only by capability contract: on web it throws with the
      format label instead of writing an invalid press file.

### C3. Tests

- [x] Cover: adding a preset persists onto `node.presets` via `updateNode`;
      removing/toggling a preset; empty state renders when no presets exist;
      "Open advanced export" invokes the provided callback; contextual
      primary-action label switches on platform/format.
- [x] `exportPresets.context.test.tsx` — the `addPreset`/`updatePreset`/
      `removePreset` reducers themselves (order preserved, siblings untouched,
      missing node is a no-op). Previously only the callbacks were asserted,
      never that the document actually changed.
- [x] `exportService.test.ts` — PDF/X-4 reaches `export_pdfx4` on desktop with
      a camelCase options payload (snake_case would silently hit serde
      defaults); the pre-existing web-failure case still holds.
- [x] `AssetExportControls.test.tsx` — print and code formats are offered,
      AVIF never is, PDF/X is disabled-with-reason on web, suffix editing
      round-trips.
- [x] Catalog wiring: applying a built-in preset adds one setting with the
      catalog's real scale/suffix; applying a bundle adds three with distinct
      ids; platform-unavailable presets are omitted from the picker.
- [x] Corrected a stale assertion that expected a native `title` attribute on
      the advisor info icon; `Tooltip` implements the APG pattern
      (`aria-describedby` + portaled `role="tooltip"`) and warns against
      `title`. The test now asserts the pattern the component actually
      implements.

### C4. Explicitly out of scope for this pass (tracked elsewhere or deferred)

- Rust print-engine work (font outlining, ICC-aware CMYK, real PDF/X-1a/X-4,
  crop/registration marks) — owned by `export-system-deferred.md` Workstream
  A, already implemented per that doc's session-26 status log; brief §10's
  print-PDF settings list should be re-audited against that doc rather than
  rebuilt here.
- Output preview/thumbnail rendering, transparency-grid/print-box preview
  (brief §11) — no existing scaffolding; would need a new render target and
  is a multi-session effort on its own.
- ~~Preset *library* / named built-in presets (brief §12)~~ **DONE.** The
  catalog (`packages/scene/src/export/presets.ts`, M6/`c3655d05`) is now wired
  into the inspector via an "Add from preset…" picker: single presets apply one
  export setting, bundles apply several at once (Web asset set → SVG + PNG 1×
  + PNG 2× in one click, which is the real multi-output workflow brief §12
  asks for, not renamed defaults). Entries are filtered two ways — the preset
  must map to a legacy `ExportPreset` the executor can run, *and* its format
  must be encodable on the active platform, so press presets simply do not
  appear on web.
- Full visual-regression baseline matrix (brief §15, 24 states) — needs a
  screenshot-testing harness decision (which this repo doesn't currently have
  for panel-level UI) before baselines are worth capturing.
- Code-emitter preview inside the Export tab (brief §9). The
  capability-driven format list it was bundled with is **done** — see C2b;
  both the quick-export row and the add-setting picker now resolve
  availability from `FORMAT_CAPABILITIES` rather than a hardcoded
  `desktopOnly` flag.

---

## §A — Source brief (verbatim)

The following is the redesign brief as provided, kept intact for reference.
Treat §B/§C above as the authoritative scoping against this codebase; where
the brief's assumptions about current defects were wrong (see the audit table
in §B), the code's actual behavior wins.

> **Note:** the brief refers to "the larger export-infrastructure prompt" it
> should be appended to — this document *is* that prompt; there was no prior
> file by that name in the repo.

### Image-grounded findings

The current interface has:

* No visible export target or explanation of what will be exported.
* No selected-format state that is immediately clear.
* Format buttons presented as tightly packed generic controls.
* No dimensions, scale, resolution, quality, transparency, color, metadata, or naming settings.
* No distinction between web, development, print, and batch-export workflows.
* No preview of the output bounds or resulting image.
* No file-size or output-dimension estimate.
* No export presets.
* No multiple exports such as PNG at 1×, 2×, and SVG from one frame.
* No destination, filename, overwrite, or folder controls.
* No preflight, compatibility, missing-font, unsupported-effect, or rasterization warnings.
* No progress, cancellation, completed-output summary, or failure recovery.
* Large unused space with all controls compressed into the top-left corner.
* Weak visual hierarchy between "Export," "Format," and the format choices.
* An unlabeled information icon and ambiguous copy icon.
* A generic "Download" label that does not describe the selected target, output count, format, or destination.
* Small targets and dense spacing that may be difficult for keyboard, touch, or motor-impaired users.
* No empty-selection, unavailable-format, loading, error, or disabled states.
* No indication of whether PDF is intended for screen, print, or press production.
* A `FORMAT / CODE` split that risks treating code generation as a sibling of file format selection without enough context.
* No evidence that the UI is driven by real exporter capabilities.

Add the following section to the larger export-infrastructure prompt.

---

# Screenshot-Grounded Redesign Requirements for the Existing Export Panel

Use the attached screenshot of the current Export panel as the **before-state visual baseline**.

The existing implementation currently resembles:

```text
Export
Format: [PNG] [JPEG] [WebP] [SVG] [PDF]
[Download] [Copy icon]
```

Do not preserve this structure merely by adding more buttons beneath it. Replace it with a properly designed export workflow while retaining efficient access to quick export.

## 1. Audit the Existing Panel Before Replacing It

Locate the exact components, styles, state, commands, and exporter functions responsible for the visible interface.

Trace:

```text
Export tab
→ FORMAT/CODE sub-navigation
→ format buttons
→ Download action
→ copy action
→ current encoder or export command
```

Determine:

* Whether the format controls are buttons, tabs, radios, or stateful toggles.
* Which format is selected by default.
* Whether selection is communicated through semantic and visual state.
* Whether the Download button uses the selected format or hardcoded defaults.
* What the copy icon copies.
* Whether the information icon has a tooltip, popover, or accessible name.
* Whether the current panel exports the current selection, current frame, page, or complete document.
* Whether export dimensions come from nominal or visual bounds.
* Whether effects, masks, fonts, transparency, profiles, and hidden children are preserved.
* Whether the PDF path is intended for digital or print output.
* Whether browser and Tauri implementations behave differently.
* Whether settings are persisted anywhere.
* Whether the `CODE` subtab uses the same export architecture or an unrelated implementation.

Do not remove the current implementation until its useful behavior and dependencies have been identified and covered by tests.

---

## 2. Replace the Flat Format Row With Export Configurations

The current format-button row should evolve into a list of explicit export configurations.

For example:

```text
Export settings

┌ PNG · 2× ───────────────────────────────┐
│ 2048 × 1536 px              Transparent │
│ logo@2x.png                         ⋮   │
└─────────────────────────────────────────┘

┌ SVG · Web optimized ────────────────────┐
│ Preserve text · Rasterize 1 effect      │
│ logo.svg                            ⋮   │
└─────────────────────────────────────────┘

[+ Add export setting]

[Export 2 files]
```

Each configuration must show enough information to understand the result without opening advanced settings:

* Format.
* Scale or dimensions.
* Filename or suffix.
* Transparency/background.
* Preset.
* Warning count.
* Estimated output dimensions.
* Enabled/disabled state.
* Menu for duplicate, reorder, copy, paste, and delete.

The user must be able to add multiple configurations to the same frame or object.

Do not use a single-choice format row as the primary architecture.

---

## 3. Provide a Compact Inspector Mode and a Full Advanced Mode

The current narrow Export panel is appropriate for quick, object-level settings, but not for every advanced option.

Create two coordinated surfaces.

### Compact inspector export section

Keep this optimized for common actions:

* Selected target name and type.
* Export scope.
* Existing export configurations.
* Add configuration.
* Format.
* Scale.
* Suffix or naming preview.
* Quick background/transparency option.
* Warning badge.
* Export selected target.
* Open advanced export.

### Full export workspace or dialog

Use this for:

* Multiple targets.
* Batch export.
* Detailed format options.
* Output preview.
* Web optimization.
* Color management.
* Metadata.
* SVG behavior.
* Print and PDF controls.
* Preflight.
* Naming.
* Destination.
* Progress and results.

Do not make users navigate a giant inspector accordion for advanced print production.

---

## 4. Improve the Panel's Information Hierarchy

The screenshot has all controls compressed into the top-left corner and leaves most of the panel unused.

Redesign the layout with a clear order:

```text
Export
Current selection: Homepage Hero Frame

[Export configurations]

[+ Add export setting]

Preflight
1 warning

Output
3 files · 4.2 MB estimated

[Export 3 files]
```

Use consistent spacing and section grouping.

Avoid:

* A heading immediately followed by an unrelated label.
* Unexplained icon-only controls.
* Buttons touching one another.
* A generic Download action detached from its settings.
* Large blank areas while required information remains hidden.
* Multiple navigation layers without a clear reason.

Where the panel remains mostly empty because no export setting exists, provide a meaningful empty state:

```text
No export settings

Add an export setting to export this frame as PNG,
SVG, PDF, or another supported format.

[Add export setting]
```

---

## 5. Clarify Export Scope

The screenshot does not indicate what will be exported.

Always show the active target, such as:

* Selection.
* Combined selection.
* Each selected object.
* Frame.
* Page.
* All pages.
* Slice.
* Document.
* All export-marked assets.

Examples:

```text
Exporting: "Landing Page"
Frame · 1440 × 1024
```

or:

```text
Exporting 7 selected frames
21 output files
```

When there is no valid target, disable the primary export action and explain how to resolve it.

Do not rely on hidden application context to communicate scope.

---

## 6. Replace Ambiguous Format Controls

If formats are still displayed as compact selectors inside configuration creation, use a semantic radio group, native select, or accessible segmented control.

A selected format must have:

* A visually distinct state.
* `aria-checked`, native selection, or equivalent semantic state.
* Keyboard navigation.
* A visible label.
* No color-only selection indication.
* Adequate target size.
* Consistent focus treatment.

Do not use several visually identical buttons with no obvious active state.

Format choices should be capability-driven. Only display formats supported in the current environment, or display unavailable formats with a clear explanation.

---

## 7. Redesign the Primary Action

Replace the generic `Download` button with a contextual action.

Examples:

* `Export PNG`
* `Export 3 files`
* `Export selected frames`
* `Export print PDF`
* `Save SVG`
* `Download ZIP`

The action should reflect:

* Output count.
* Current mode.
* Selected destination.
* Platform behavior.
* Blocking preflight state.

On desktop, use "Export" or "Save" where a native destination picker is involved. Use "Download" only for browser delivery where that terminology is accurate.

Prevent double submissions.

Show real progress after activation.

---

## 8. Clarify or Remove the Existing Icons

The screenshot shows an information icon and a copy-style icon without enough context.

Every icon-only control must have:

* An accessible name.
* A tooltip.
* A visible focus state.
* A minimum interactive target.
* A clear disabled state.
* A purpose that can be understood independently.

The copy icon must explicitly represent one supported action, such as:

* Copy exported image.
* Copy SVG.
* Copy generated code.
* Copy export settings.
* Duplicate configuration.

Do not use one ambiguous copy icon whose behavior changes invisibly based on format.

Prefer text-plus-icon actions where space permits.

---

## 9. Reconsider the `FORMAT / CODE` Navigation

Audit whether `FORMAT` and `CODE` are appropriate sibling tabs.

Potential improved structure:

```text
Export
- Assets
- Print
- Code
```

or:

```text
Output
- Image & Vector
- Print & PDF
- Code
```

Code generation has different settings, validation, preview, and failure modes from image encoding.

If retained in the same top-level Export area:

* Use the same target resolution and job infrastructure.
* Maintain separate settings models.
* Provide generated-code preview.
* Include unsupported-feature findings.
* Avoid showing image format controls in Code mode.
* Preserve tab state.
* Ensure keyboard and screen-reader semantics are correct.

Do not use `FORMAT` as a vague category label when PDF, PNG, SVG, and code generation have fundamentally different workflows.

---

## 10. Add Progressive Format-Specific Settings

Selecting or creating a configuration should reveal only settings relevant to that format.

### PNG

```text
Scale
Dimensions
Transparent background
Background color
Color profile
Bit depth
Compression
Dithering
Metadata
```

### JPEG

```text
Scale
Dimensions
Quality
Chroma subsampling
Progressive
Background
Color profile
Metadata
```

### WebP and AVIF

```text
Lossless/lossy
Quality
Alpha quality
Encoder effort
Color profile
Metadata
```

### SVG

```text
Preserve text / outline text
Embed images
Responsive viewBox
Decimal precision
Minify
Preserve IDs
Rasterize unsupported effects
Accessibility title and description
```

### PDF for screen

```text
Page range
Image quality
Image downsampling
Font embedding
Bookmarks/links
Metadata
Color profile
```

### PDF for print

```text
PDF standard
Bleed
Crop and registration marks
Output profile
CMYK conversion
Image resolution
Compression
Font embedding
Transparency
Overprint
Preflight
```

Never show a control that the selected exporter ignores.

---

## 11. Add Output Preview and Summary

The screenshot provides no idea of the resulting file.

At minimum, the inspector should show:

* Resolved pixel or physical dimensions.
* Number of outputs.
* File naming preview.
* Transparency/background.
* Warning count.
* Rough size estimate where practical.

The full export surface should include:

* Render preview.
* Transparency grid.
* Target bounds.
* Background preview.
* Print boxes.
* Bleed.
* Crop marks.
* Zoom and fit controls.
* Quality comparison where helpful.

The preview must be generated from the same normalized export plan as the final output.

---

## 12. Add Presets and Common Quick Choices

Provide built-in, clearly named presets such as:

### Web

* PNG transparent.
* PNG 1× and 2×.
* JPEG high quality.
* WebP optimized.
* AVIF optimized.
* SVG for web.
* SVG editable.
* Social image.
* App icon variants.

### Print

* High-quality PDF.
* PDF/X-4.
* PDF/X-1a only if correctly supported.
* Print proof.
* CMYK press output.
* Client review PDF.

### Developer

* SVG and PNG bundle.
* React component.
* HTML/CSS.
* Tailwind.
* Flutter.
* SwiftUI.

Presets must configure real backend behavior, not merely rename groups of defaults.

---

## 13. Add Empty, Loading, Error, and Completion States

Design and test all panel states.

### Empty target

```text
Select a frame, object, page, or slice to export.
```

### No configuration

```text
No export settings have been added.
[Add export setting]
```

### Preview loading

Show bounded, nonblocking progress and cancel stale work.

### Unsupported configuration

```text
SVG cannot preserve the selected background blur.
The affected group will be rasterized.
```

### Blocking error

```text
This output would be 0 × 0 pixels.
Choose another target or change the export bounds.
```

### Exporting

```text
Exporting 2 of 6
Rendering "Homepage"
[Cancel]
```

### Partial completion

```text
5 files exported
1 file failed

[Retry failed] [Open folder]
```

### Complete

```text
6 files exported to Assets/Homepage
[Open folder] [Copy paths]
```

Do not leave the button visually pressed with no feedback.

---

## 14. Make Better Use of the Available Panel Space

The screenshot shows substantial unused vertical space.

Use the space for:

* Configuration cards.
* Export target summary.
* Preview thumbnail.
* Output dimensions.
* Preflight warnings.
* File naming.
* Recent presets.
* Export history or job progress.
* Contextual help.

Do not fill space with decoration. Use it to expose the information currently missing from the workflow.

When content exceeds available height:

* Use one predictable panel scroll container.
* Keep the primary action accessible.
* Ensure focused controls are not hidden behind sticky elements.
* Avoid nested scrolling regions unless essential.

---

## 15. Screenshot-Specific Visual Regression Baselines

Create a baseline for the current screenshot before refactoring, then add new baselines for:

1. No selection.
2. One selected frame with no configurations.
3. One PNG configuration.
4. PNG, SVG, and PDF configurations.
5. Mixed multi-selection.
6. Configuration expanded.
7. Configuration collapsed.
8. Blocking preflight error.
9. Advisory warning.
10. Active export progress.
11. Partial completion.
12. Successful completion.
13. `FORMAT` or asset mode.
14. Print mode.
15. Code mode.
16. Light theme.
17. Dark theme.
18. High-contrast theme.
19. Minimum inspector width.
20. 200% zoom.
21. 400% zoom.
22. Long translated labels.
23. Keyboard focus on every interactive control.
24. Touch-sized control validation.

The regression test should specifically catch recurrence of:

* Controls compressed into the upper-left.
* Overlapping buttons.
* Invisible selection states.
* Clipped labels.
* Excessive unused space.
* Missing primary action.
* Unlabeled icon controls.
* Theme-token failures.

---

## 16. Image-Grounded Acceptance Criteria

The redesign is not complete until the current screenshot's limitations have been demonstrably resolved.

The final implementation must show that:

1. The export target is visible.
2. The selected format and configuration are unambiguous.
3. Multiple configurations can be added.
4. Output dimensions and count are visible.
5. The primary action describes what will happen.
6. Format-specific settings are available.
7. Web and print workflows are distinct.
8. Advanced settings do not overcrowd the narrow inspector.
9. Icons have explicit, accessible purposes.
10. Empty space is replaced by useful contextual information.
11. Preflight findings are visible.
12. Export progress and completion are represented.
13. Browser and desktop wording is accurate.
14. The panel remains usable at its current narrow width.
15. Light, dark, and high-contrast themes are supported.
16. Keyboard-only use is possible.
17. The UI is driven by real exporter capabilities.
18. Settings survive save and reopen where they belong to the document.
19. The implementation supports real multiple-output workflows rather than a single format toggle.
20. Before-and-after screenshots are included in the final implementation report.

Do not report the UI redesign as complete if it remains a row of format buttons above a Download button with additional controls merely appended underneath.
