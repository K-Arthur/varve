# Export Infrastructure — Audit and Rebuild Progress

Status: **In progress** — Inspector information architecture and the core static-export option handoff are complete; advanced encoder controls remain staged work.
Updated: 2026-08-02

This document tracks the repository-wide audit and staged rebuild of Varve's
export infrastructure. It is the single source of truth for the export
architecture map, known defects, target architecture, migration strategy, and
milestone verification.

---

## 1. Executive summary of the current state

Varve has a **working but shallow export system** organized as:

```
ExportDialog.tsx ──► ExportLayer.tsx ──► ExportService.run() ──► exportSaveAdapter.ts
   (modal)             (shell glue)        (render+report)        ──► platform.saveBinaryFile
                                             │                          (tauri / web / memory)
                                             └─► SpecPanel/export.ts (raster + vector + PDF)
                                             └─► export/compositor.ts (capability-driven flatten)
                                             └─► @varve/codegen (SVG / Tailwind / Flutter / SwiftUI)
                                             └─► varve-print (Rust: PDF screen / PDF-X1a / PDF-X4)
```

Supported formats today:

| Format | Path | Status |
|--------|------|--------|
| PNG / JPEG / WebP | `exportNodeAsRaster` → canvas `toBlob`/`convertToBlob` | Works (sRGB baseline) |
| GIF (timeline) | `engine/gifExport.ts` TS encoder | Works |
| MP4 / WebM (timeline) | WebCodecs / MediaRecorder / image-sequence | Works (Chromium) |
| SVG | `@varve/codegen/svg.ts` scene→SVG (+ subtree raster fallback) | Works with limits |
| PDF (screen) | Rust `varve_print::export_pdf`; browser fallback `makeSimpleImagePdf` | Works; browser output is a raster-backed PDF |
| PDF/X-1a / PDF/X-4 | Rust `varve_print::cmyk::{export_pdfx1a, export_pdfx4}` | Works on desktop; capability-gated on web |
| AVIF | none | **Advertised, throws at runtime** |
| React / Flutter / SwiftUI / CSS | `@varve/codegen` | Works (semantic, not pixel-exact) |
| `.strata-package.zip` | `packageExport.ts` + `DocumentCodec` | Works |
| TIFF / BMP / ICO / EPS / PSD / JSON / HTML | none | Not implemented |

The architecture is a **single-format-per-preset, single-executor** model with
no canonical export-plan layer, no capability contract, no shared preflight
service, no real batch cancellation, and no per-target multi-configuration
model. Details below.

---

## 2. Current architecture map

### 2.1 Live export surface (the path users actually hit)

| Layer | File | Role |
|-------|------|------|
| Modal | `packages/editor/src/components/Export/ExportDialog.tsx` | Batch job list, destination template, background-removal pre-pass, motion/video export, progress bar |
| Shell glue | `packages/editor/src/components/Shell/ExportLayer.tsx` | Owns the dialog; calls `ExportService.run`; package export; motion/video save |
| Executor | `packages/editor/src/exportService.ts` | `renderJob()` switch over `ExportFormat`; `ExportService.run()` sequential loop + report |
| Save sink | `packages/editor/src/exportSaveAdapter.ts` | `extensionForExport`, `saveExportBytes`, `createExportSaveFile` |
| Raster+vector+PDF | `packages/editor/src/components/SpecPanel/export.ts` | `exportNodeAsRaster`, `exportNodeAsSvg`, `exportNodeAsPdf`, `makeSimpleImagePdf`, `subtreeRequiresRasterPdfFallback` |
| Flatten | `packages/editor/src/export/compositor.ts` | `CAPABILITY` table, `assessNodeCapability`, `findFlattenBoundaries`, `composeFlattenedRasterAssetsForNode` |
| Inspector tab | `components/SpecPanel/AssetExportControls.tsx`, `CodeGenView.tsx` | Quick single-object export (PNG/JPEG/WebP/SVG/PDF), codegen |
| Menu / shortcuts | `Menubar.tsx`, `menu/defs.ts`, `shortcuts/ShortcutManager.ts`, `actions/createActionHandlers.ts` | `export` / `exportSvg` / `openExportPanel` actions |
| Settings | `components/Settings/ExportSettingsTab.tsx` + `settings.ts` | Saved defaults (see defect D2 — write-only) |

### 2.2 Rendering paths (preview vs export)

| Path | What it does | Used by |
|------|--------------|---------|
| Flat `replayIr` on OffscreenCanvas | `render/renderWorker.ts` + `workerHost.ts` | Editor preview |
| `replayStructuredScene` | Scene-graph superset of `replayIr` (frames clip, group blend isolation, masks w/ invert/feather/density) | Raster + SVG-flatten export |
| `varve-print` native PDF | Re-emits PDF operators from `SceneNode` (no IR) | PDF export (desktop) |
| `@varve/codegen/svg.ts` | Scene→SVG serializer | SVG export |

Preview and export **share `replayIr` as the leaf painter but not the
structural layer**, so a node with mask/group-isolation semantics can look
different in preview vs export. This is intentional and documented
(`docs/architecture/canvas2d-system.md`) but must be kept explicit.

### 2.3 Rust backend (desktop)

| Crate | Export-relevant surface |
|-------|-------------------------|
| `varve-core` | Scene model only; no encoders |
| `varve-engine` | `build_render_ir` / `build_render_ir_flat` |
| `varve-bridge` | `IpcSceneNode` wire conversion |
| `varve-sync` | SQLite `DocumentStore`; SCHEMA_VERSION 1; save/load; no export storage |
| `varve-print` | `export_pdf`, `cmyk::export_pdfx1a/x4`, `outline.rs`, `subset.rs`, `marks.rs`, `resources.rs` (`ExportManifest`), `shaper.rs` |
| `varve-colour` | ICC/CMYK science: `rgb_to_cmyk_icc`, `IccEngine` (tintbox), bundled profiles; WASM bindings |
| `varve-trace` / `varve-wasm` | Raster→vector tracing; IR JSON |
| Desktop `lib.rs` | `write_binary_file`, `export_node_pdf`, `export_pdfx1a/x4`, `export_pdf_with_options`, `outline_text`, `shape_text_command`, `list_printers`, `print_pdf`, `cancel_print_job` |

### 2.4 Persistence / platform

- **Docs:** SQLite (`varve-sync`) on desktop; IndexedDB `strata-home` on web; `.strata` JSON text file for disk save.
- **Document schema:** `packages/scene/src/version.ts` `CURRENT_DOCUMENT_VERSION = '2.10'`; `migrateDocumentDetailed`; `DocumentCodec` is the single normalize/migrate boundary.
- **Export settings:** `localStorage['strata-editor-settings']` (`settings.ts`).
- **Per-node export presets:** `SceneNode.presets?: ExportPreset[]`; document defaults `Document.exportDefaults?: Partial<ExportSettings>`.
- **File dialogs:** Tauri `plugin:dialog|save` + `write_binary_file`; browser File System Access API (`showSaveFilePicker`) with object-URL anchor fallback.

---

## 3. Known defects (evidence-backed)

| ID | Defect | Evidence | Severity |
|----|--------|----------|----------|
| D1 | **AVIF advertised but unimplemented.** `ExportFormat` includes `avif`; `ExportSettingsTab` and preset pickers list it; `renderJob` throws `'AVIF export is not available in this runtime'`. | `exportService.ts:231` | High |
| D2 | **Export settings are write-only.** `settings.export.*` defaults (format, scale, ICC, bleed, template, intent) are read only by `ExportSettingsTab.tsx`; `ExportDialog` never reads them. | grep; `ExportDialog.tsx:181` hardcodes `'{name}{suffix}.{ext}'` | High |
| D3 | ~~**`pdf-x1a`/`pdf-x4` are advertise-but-throw in TS.**~~ **FIXED (M8).** `renderJob` now calls `exportNodeAsPdfX`, which invokes the `export_pdfx1a`/`export_pdfx4` Tauri commands. The old throw also mis-reported "requires the desktop app" *on desktop*, because it called `capabilitiesForFormat()` without a platform (defaulting to `'web'`). Still desktop-only by contract; web throws rather than emitting an invalid press file. | `exportService.ts:237`; `SpecPanel/export.ts` `exportNodeAsPdfX` | ~~High~~ Fixed |
| D4 | ~~**Batch export Cancel is cosmetic.**~~ **FIXED (M5/M11).** `AbortSignal` reaches `ExportService.run`; abort errors are no longer converted into failed outputs, and executor progress is driven by real stage transitions. | `ExportLayer.tsx`; `exportService.ts` | ~~High~~ Fixed |
| D5 | **PDF image manifest is defined but never wired.** `ExportManifest` exists on both sides (`varve-print/resources.rs:49`, `engine/iccImageConverter.ts:194`, `editor/export/resourceCollector.ts:38`) but no editor call passes `manifest_json`. Any image fill reaching the native vector PDF path resolves to a **checkerboard placeholder**. | `varve-print/lib.rs:1149`; `SpecPanel/export.ts:424` | High |
| D6 | **Three-way accelerator mismatch for Export.** Native menu: `export`=Ctrl+E, `exportSvg`=Ctrl+Shift+E; shortcut registry: `exportSvg`=Ctrl+Alt+E, `export`=Ctrl+Shift+E; help article claims Ctrl+E opens Export. | `menu/defs.ts:132-146`; `ShortcutManager.ts:33-42`; `packages/help/src/content/export.ts:8` | Medium |
| D7 | **Duplicate extension maps (3x).** `exportSaveAdapter.ts FORMAT_EXTENSIONS`, `ExportDialog.buildJobs` inline switch, `DestinationPicker` inline switch. | `exportSaveAdapter.ts:12`; `ExportDialog.tsx:139`; `DestinationPicker.tsx:38` | Low |
| D8 | **Duplicate whole-document SVG export.** `createActionHandlers.exportSvg` uses legacy `exportDocumentToSvg` + anchor download, bypassing ExportService and the save picker; File menu "Export…" is per-node. | `createActionHandlers.ts:93` | Medium |
| D9 | ~~**`ExportPresetPanel.tsx` is dead code**~~ **FIXED (M8).** Its behavior was folded into `AssetExportControls` (now live in the Inspector's Export tab) and the orphaned file + CSS deleted. Note: the first port narrowed "add setting" to 5 quick-export formats, dropping the panel's print/codegen formats and suffix editing; both were restored in the same milestone — see the redesign plan's §C2b. `addPreset/updatePreset/removePreset` now have a real UI consumer and direct reducer tests. | `AssetExportControls.tsx`; `exportPresets.context.test.tsx` | ~~Medium~~ Fixed |
| D10 | **Print preflight split-brain.** `runPrintPreflight` (scene, 427 lines) has no editor caller; the UI uses `runCombinedPreflight`. | `PreflightWarnings.tsx:14,56` | Low |
| D11 | **Three PDF writers.** Hand-rolled `makeSimpleImagePdf` (browser fallback), `rasterizeSubtreeToPdfViaPrintEngine` (no manifest → D5), Rust `varve-print`. | `SpecPanel/export.ts:241,424` | Medium |
| D12 | **`composeFlattenedExportSnapshot` (whole-doc) and `resourceCollector.ts` (ExportManifest) are unused.** | grep importers | Low |
| D13 | **Stale E2E test** driving a removed export dialog UI. | `tests/e2e/canvas/upscale-export-verification.spec.ts:37` | Low |
| D14 | **Home-app "Export" is a no-op.** | `packages/home/src/HomeShell.tsx:876` | Low |
| D15 | **`verboseOutput` toggle is dead** (set, rendered, never consumed). | `ExportDialog.tsx:199,695` | Low |
| D16 | **Slice tool creates plain frames.** `SliceTool.ts` comments claim export slices; no tagging or export wiring exists. | `tools/SliceTool.ts:32` | Medium |
| D17 | ~~**No real batch cancellation/retry/summary-after-partial-failure.**~~ **PARTIALLY FIXED (M9/M11).** Cancellation, per-file results, failed-output retry, and actual executor progress are live. A persistent background queue and memory-aware scheduling remain open. | `exportService.ts`; `ExportResultsList.tsx` | Medium → Low |
| D18 | **No deterministic plan layer.** Per-node presets → jobs is a blind expansion (`ExportDialog.buildJobs`) with per-dialog dimension heuristics (`nodeBaseDimensions`) that duplicate renderer bounds logic. | `ExportDialog.tsx:65-167` | High |
| D19 | ~~**PDF/X mark controls were accepted but ignored.**~~ **FIXED (M9).** Crop, registration, and color-bar options now reach the Rust PDF/X builders. | `ExportDialog.tsx`; Tauri PDF/X commands | ~~High~~ Fixed |
| D20 | ~~**The live Inspector mounted export controls without their stylesheet.**~~ **FIXED (M12a).** `AssetExportControls` now owns its style import, so it no longer depends on the unrelated `SpecPanel` entry point being mounted first. | `AssetExportControls.tsx`; `SpecPanel.css` | ~~High~~ Fixed |
| D21 | ~~**Built-in presets lost most of their options when added.**~~ **FIXED (M12a).** Catalog entries are materialized as canonical configurations and converted through the shared adapter; raster, vector, color, and print fields supported by the legacy boundary survive. | `AssetExportControls.tsx`; `export/adapter.ts` | ~~High~~ Fixed |
| D22 | ~~**Destination preview and execution disagreed.**~~ **FIXED (M12a).** Both now use the same filename/folder resolver, real suffixes, sanitization, and deterministic collision handling. | `exportBatchPaths.ts`; `DestinationPicker.tsx`; `ExportDialog.tsx` | ~~High~~ Fixed |
| D23 | ~~**Web advertised screen PDF but simple nodes threw at runtime.**~~ **FIXED (M12a).** All browser screen-PDF jobs now use the raster-backed local PDF writer; desktop retains the vector path where eligible. | `SpecPanel/export.ts` | ~~High~~ Fixed |
| D24 | **Canonical option exposure is incomplete.** Resize filter, sharpening, dithering, metadata policy, full ICC/color conversion, several print controls, vector precision/minification, and code-generation settings are not all editable and/or consumed by their encoder. Unsupported controls remain out of the Inspector rather than implying they work. | capability audit below | Medium |

---

## 4. Backend and frontend gaps

### 4.1 Backend (render/encode)
- No AVIF encoder (browser or native).
- Native PDF vector path supports only a strict subset (solid fills, strokes, linear gradients, drop-shadow, WinAnsi/subset/outline text, image fills *from a manifest*) and silently degrades otherwise (D5).
- `ExportManifest` (images + patterns) plumbing incomplete end-to-end.
- PDF/X output intent and validation are not connected to the TS export path; standards compliance is *named*, not *validated* (veraPDF script exists but no wired gate).
- No tiled raster export wired into the editor path (`engine/export.ts tiledExport` is dead).
- WebGPU compositor has no readback/export path.
- No TIFF/EPS/PSD/BMP/ICO encoders.

### 4.2 Frontend (plan/UI)
- A canonical export-plan type and capability contract exist, but the live executor still crosses the legacy `ExportPreset`/`ExportJob` adapter boundary.
- Format availability is capability-gated in the Inspector; AVIF remains absent because no real encoder exists.
- Batch export uses the canonical preflight service; the separate print preflight path still needs consolidation (D10).
- Naming templates, sanitization, folder rules, and collision resolution are shared by destination preview and execution.
- Per-target multi-configuration is live through stacked `ExportPreset[]`; the canonical configuration model still crosses that legacy boundary.
- Static batch export has real cancellation, progress, partial-failure results, and retry; it does not yet have a persistent background queue or memory-aware scheduler.
- Size estimates are heuristic and there is no content/pixel preview of the planned output.
- No background/foreground export distinction; static batches do report real per-stage progress.

### 4.3 Capability exposure audit (M12a)

The Inspector now separates a one-off **Quick export** from persistent **Export
configurations**, labels every preset/custom-format input, and provides one
clear handoff to the advanced workspace. The audit also traced configuration
values through catalog materialization, the legacy adapter, job construction,
rendering, naming, and destination preview.

| Capability | Current integrity |
|------------|-------------------|
| Format, scale, suffix | Editable, persisted, and consumed; suffix is used in the actual output path. |
| Raster quality, transparency, matte | Preserved from catalog presets, attached to jobs, and consumed by raster rendering. |
| Screen PDF on web | Exposed and functional through an explicit raster-backed PDF fallback. |
| PDF/X bleed, marks, DPI floor, outline text, ICC name | Preserved and consumed by the desktop print path. |
| Folder rule, filename template, collision handling | Preview and execution share one resolver. |
| Vector precision/minification/style and code options | Preserved on jobs, but the current SVG/code executors do not yet consume every field. |
| Resize mode, sharpening, dithering, metadata, full color conversion | Present in the canonical model but not fully represented by the legacy adapter/executor; controls intentionally remain out of the Inspector. |
| Full print model (page information, mark offset, downsampling, compression, ranges, spreads) | Canonical only or partially surfaced; dedicated print-plan integration remains M9/M10 work. |

---

## 5. Proposed target architecture

A **strangler migration** onto a canonical, versioned export domain model in
`@varve/scene`:

```
Settings (UI)                     ┌────────────────────────────────────────────┐
   │   ExportConfiguration[]      │        @varve/scene/export (canonical)   │
   ▼                              │                                            │
ExportRequest ──────────────────► │  model.ts     versioned types + migrations │
                                  │  capabilities format capability contracts  │
   collect → normalize → validate │  plan.ts       intent → normalized plan    │
   capabilities → build plan      │  naming.ts     tokens, sanitize, collisions│
   → preflight → execute          │  preflight.ts  findings + fix actions      │
                                  └────────────────────────────────────────────┘
                                                  │ ExportPlan (pure, deterministic)
                                                  ▼
                              Execution (engine-agnostic)
        ExportService / workers / Rust encoders / platform destinations
                                                  │
                             Preview ◄── shares ExportPlan ──► Final output
```

Principles:
1. **One canonical model** (`ExportConfiguration`, `ExportTarget`, `ExportScale`,
   format-specific settings) with `version` + migrations. Legacy
   `export-types.ts` types remain as an adapter boundary until migrated.
2. **Capability contracts** drive the UI: a format never advertises an encoder
   it cannot honor; ignored settings are reported, not silently dropped.
3. **Plan / execution split**: the UI produces intent; a pure builder resolves
   targets → bounds → scales → pixel dims → file names → preflight findings.
   Renderers consume plans; the plan is deterministic for tests.
4. **Shared preflight** feeds the plan and the UI from one findings pipeline.
5. **Render reuse**: render once at the highest required resolution and derive
   compatible lower-resolution outputs, when quality-preserving.
6. **Platform capability layer** rather than scattered runtime checks for
   browser vs Tauri.

---

## 6. Migration strategy

1. Add `packages/scene/src/export/` as a self-contained canonical module
   (model, capabilities, plan, naming, preflight) with unit tests. No app
   behavior changes yet.
2. Add adapters mapping legacy `ExportPreset`/`ExportJob`/`ExportBatch` to
   canonical `ExportConfiguration`/`ExportJobSpec`.
3. Migrate `ExportService` and `ExportDialog`/`ExportLayer` onto the canonical
   plan (fixing D1/D3/D4/D5/D17/D18 in the same move).
4. Migrate the inspector export section and settings store.
5. Migrate print/presets; collapse `runPrintPreflight` into the shared service.
6. Delete dead code (D9/D12/D15) and unify extension maps (D7).

Each step keeps the app green (regression protocol: format → typecheck → lint →
test → audits) before the next.

---

## 7. Test plan

- **Unit (scene)**: model migration, capability contracts, plan normalization,
  bounds (nominal/visual/bleed), scale/DPI resolution, pixel dims, filename
  templating + sanitization + collision resolution, preflight findings
  determinism, batch expansion, empty/invalid targets.
- **Rendering fixtures**: vector shapes, text/fonts, transparency, masks,
  clipping, blend modes, shadows/blur, adjustment layers, gradient maps,
  variable-width strokes, large images, CMYK, bleed, multi-page.
- **Encoder**: file signatures, dimensions, alpha, ICC, page count, PDF boxes,
  SVG structure, embedded images/fonts, malformed-option rejection.
- **Save/reopen**: per-node export configs, document presets, migration,
  copy/paste, duplicate frames.
- **E2E**: quick PNG, multi-scale assets, batch frames, SVG handoff, print PDF,
  preflight-with-issues, partial-failure retry, browser multi-file, desktop
  folder export, keyboard-only workflow.
- **Visual regression**: export dialog, inspector section, format settings,
  preflight findings, batch progress, completion summary, themes, narrow
  layout, high zoom, focus states, mixed multi-selection values.

---

## 8. Milestones

| # | Milestone | Status |
|---|-----------|--------|
| 1 | Export architecture audit + progress documentation | **Complete** (this doc) |
| 2 | Canonical export model + migrations (`scene/export/model.ts`) | **Complete** |
| 3 | Capability contracts + plan normalization (`capabilities.ts`, `plan.ts`) | **Complete** |
| 4 | Shared target/bounds/scale/naming infra (`naming.ts`) | **Complete** |
| 5 | Export preflight service (`preflight.ts`) | **Complete** |
| 6 | Integration: ExportService cancellation, capability-gated errors, settings consumption, accelerator fix, dead-code removal | **Complete** |
| 7 | Inspector export section + preset management UI | **Complete** |
| 8 | Full export workspace + print UI + preview | **In progress** (M8 inspector done; M9 batch-dialog surfaces done) |
| 9 | Raster improvements (resampling, tiling), SVG preservation, PDF/print | **In progress** (M9 print-mark wiring done) |
| 10 | Color-management + metadata controls | Pending |
| 11 | Destination integration (browser ZIP, Tauri folder, reveal), job queue | **In progress** (real executor stages, progress, cancellation, retry, browser archives, one-folder Tauri batches, and native reveal landed; persistent queue pending) |
| 12 | Accessibility, responsive, E2E/visual-regression/docs | **In progress** (M12a Inspector hierarchy, narrow-layout E2E, and capability audit complete) |

Commit hashes recorded below as milestones complete.

---

## 9. Risks

| Risk | Mitigation |
|------|------------|
| Preview/export rendering divergence (structural layer vs flat IR) | Keep the shared-`replayIr` invariant documented; compare preview vs export via fixtures (M12) |
| Breaking the 15-package regression gate on a large refactor | Strangler migration: canonical module first, app migration last; run `just gate` per milestone |
| Hub-file import budgets (`CanvasArea` 42, `Shell` 50) | New export code lives in leaf modules; no new imports added to hub files |
| Concurrent agent work (tooltip system, gradient map) in the same repo | This work lives on `feat/export-infrastructure`, based on committed `feat/tooltip-system` history; different files |
| Native PDF subset silently rasterizing | Capability contract + preflight findings must precede any raster fallback; never silent |
| AVIF/TIFF/EPS/PSD overreach | Not implemented formats stay out of the UI until encoders exist (capability-gated) |

> **Session note (2026-08-01):** a concurrent agent is working in the same repo
> (tooltip-system migration, gradient-map M4, and a screenshot-grounded export
> panel redesign in `docs/plans/export-infrastructure-redesign.md`). Git
> history on the working branch is interleaved: this export work shares the
> branch with that agent's commits. Export work is committed separately and the
> agent's uncommitted tooltip-doc files are left untouched in the working tree.

---

## 10. Deferred work and reasons

| Item | Reason |
|------|--------|
| AVIF encoder | No browser-native `canvas.toBlob('image/avif')` guarantee; native encoder not yet wired. Capability-gated until real. |
| TIFF / BMP / ICO / EPS / PSD / JSON / HTML | No encoder exists; would be UI that lies to users. |
| WebGPU readback export | WebGPU compositor has no pixel readback path. |
| Full PDF/X validation gate (veraPDF) | Validator script exists; wiring a standards gate is a dedicated milestone. |
| Print preview canvas | Depends on print-plan normalization (M8/M9). |
| Background job queue with concurrency/memory scheduling | Larger infrastructure; ExportService becomes the seam in M6, queue in M11. |
| Codegen HTML/CSS/Tailwind/Rust web export polish | Codegen exists; canonical-job reuse is M7+. |
| GIF animation controls beyond timeline export | Timeline+exporter can already produce deterministic frames; controls added with plan work. |

---

## 11. Verification status

- [x] M1 audit doc reviewed
- [x] M2 model migrations + unit tests green (39 tests in `scene/src/export`)
- [x] M3 capabilities + plan normalization green
- [x] M4 naming infra green
- [x] M5 preflight green
- [x] M6 integration green (typecheck editor+scene, lint 0 new, tests)
- [x] M7 built-in preset catalog green (115 tests in `scene/src/export`)
- [x] M8 inspector export section + per-node settings green
- [x] M9 batch-dialog surfaces green (preflight panel, print settings, per-file results + retry, PDF/X marks)
- [x] Export E2E suite green (export-workspace 3/3; export-settings 4/4; export.spec 5/5; plus inspector spec)
- [x] Full typecheck + lint + pre-commit gates after M8
- [x] M12a Inspector information architecture + option-integrity audit green

Gate results per milestone:

| Milestone | Typecheck | Lint (touched) | Unit tests | E2E / audits |
|-----------|-----------|----------------|------------|--------------|
| M2 | `@varve/scene` clean | Biome clean | 39/39 `scene/src/export` | n/a |
| M3 | `@varve/scene` clean | Biome clean | 90/90 `scene/src/export` | n/a |
| M4 | `@varve/scene` clean | Biome clean | 104/104 `scene/src/export` | n/a |
| M5 | editor + scene clean | Biome clean (touched) | scene+editor suites; 11 unrelated failures proven pre-existing | pre-commit audit-health pass |
| M6 | editor + scene clean | Biome clean | 133/133 (focused) | pre-commit audit-health pass |
| M7 | scene clean | Biome clean | 115/115 `scene/src/export` | pre-commit audit-health pass |
| M8 | editor clean | Biome clean | ExportDialog 12/12; AssetExportControls 11/12 (pre-existing tooltip-title failure); full typecheck 15/15 + E2E tsconfig exit 0 | **export-settings E2E 4/4**; export.spec 5/5; pre-commit audit-health pass |
| M9 | editor + scene clean; E2E tsconfig exit 0 | Biome clean (touched; only pre-existing DestinationPicker warning) | Export 48/48; exportService 8/8; scene export 115/115; bgRemovalFeatures 31/31 | **export-workspace E2E 3/3**; export.spec 5/5; export-settings 4/4; Rust pdfx 4/4; varve-print 131/131; varve-colour 70/70; audit:emoji clean; audit:tokens 123/123 |
| M11a | 16 packages + E2E clean | Biome clean on touched files | **10,879/10,879** full suite; focused export 32/32 | audit:emoji clean; audit:tokens 123/123; architecture gate clean against baseline (5 known cycles, 0 layer violations) |
| M11b | 16 packages + E2E clean | Biome clean on touched files | **10,881/10,881** full suite before final cancel-case assertion; final focused export 31/31 | audit:emoji clean; audit:tokens 123/123; architecture gate clean against baseline (5 known cycles, 0 layer violations) |
| M11c | 16 packages + E2E clean | Biome clean on touched files | **10,885/10,885** full suite; focused platform/export 30/30 | audit:emoji clean; audit:tokens 123/123; architecture gate clean against baseline (5 known cycles, 0 layer violations) |
| M11d | 16 packages + E2E clean | Biome clean on touched files | **10,887/10,887** full suite; focused export UI 24/24 | audit:emoji clean; audit:tokens 123/123; architecture gate clean against baseline (5 known cycles, 0 layer violations) |
| M12a | 16 packages + E2E clean | Biome clean | **10,917/10,917** full suite; 95/95 focused scene/editor export tests | **export-settings + export-workspace E2E 7/7**; audit:emoji clean; audit:tokens 123/123; architecture audit clean against baseline (6 known cycles, 0 layer violations) |

Pre-existing failures on the shared branch (proven pre-existing via stash check,
not caused by this work): `ShortcutPalette.test.tsx` (8), `MasterPanel.test.tsx`
(1), `LayersRow.test.tsx` (1). The former `AssetExportControls.test.tsx`
"advisor reason in a title tooltip" failure was **resolved** in M8-follow-up
(`a5d59f47`) by asserting the real Tooltip pattern (`aria-describedby` +
`role="tooltip"`) rather than a native `title` attribute.

Full-suite note (M9): under heavy concurrent-agent load the full Vitest run
produced 44 failures across 22 files. Every one was proven NOT a regression
from this work: 6 are `.bench.*` files (excluded from the gate per AGENTS.md),
12 are the documented pre-existing set, and the remaining 26 all pass when run
in isolation (verified one by one: NewFileDialog 9/9, FramePresetsSection 7/7,
AdjustmentPanel 13/13, bgRemovalFeatures 31/31, FloatingToolbar + ImageEnhancement
+ useFlatTree + viewportOps + videoExportBridge 53/53, ArchiveDialog + archiveRestorer
47/47). All changed-area suites pass in isolation (Export 48/48, scene export
115/115, exportService 8/8).

Architecture audit note: `scripts/audit-architecture.mjs --ci` hangs at the
module-instability step (engine `index.ts` madge graph, a pre-existing
condition unrelated to this work — the same step was slow before any export
changes). Pre-commit `audit-health` (dependency cycles, hub-file budgets,
complexity gates) passes on every commit. Pre-existing instability findings
(`shared/index.ts` I=1.000, `engine/index.ts` I=1.000) are barrel-file artifacts
that predate this work.

E2E note: the `@varve/scene/export` subpath requires a fresh Vite dev server
(`STRATA_E2E_PORT=<other>`); the long-lived server on the default port predates
the `package.json` exports change and does not re-resolve it.

Current gate state (baseline, before this work):

- Typecheck: 15/15 packages (must stay green).
- Lint: Biome across repo.
- Tests: Vitest full suite (excludes `*.bench.ts`).
- Audits: `pnpm audit:emoji`, `pnpm audit:tokens` (120/120 WCAG-AA, 3 themes),
  `node scripts/audit-architecture.mjs --ci` (baseline `.architecture-baseline.json`).

Pre-existing known limitations recorded (not introduced by this work):
`CanvasArea.tsx` is flagged over its 42-import hub budget (44 imports per
`.architecture-baseline.json`); this predates the export work.

## 12. Milestone commit hashes

| Milestone | Commit |
|-----------|--------|
| 1 — audit | `73a157bd` |
| 2 — canonical model + adapter | `3e242f34` |
| 3 — capabilities + plan + naming | `7689bf04` |
| 4 — preflight service | `5b1a118b` (+ lint `ac5ea669`) |
| 5 — integration (cancellation, gating, settings, shortcuts) | `f607df92` |
| 6 — built-in preset catalog | `c3655d05` |
| 7 — (folded into M5/M6 — integration + presets landed together) | — |
| 8 — inspector export section + per-node settings | `5ad069d0` |
| 8-follow-up — contextual primary action + tooltip test fix | `a5d59f47` |
| 8-E2E — inspector export-settings E2E spec | `a7a27246` |
| 9 — batch-dialog surfaces (preflight, print settings, results/retry) + PDF/X marks | `f0a4c4ea` (on `feat/export-workspace`) |
| 11a — real executor progress stages + abort propagation | `c3397093` |
| 11b — browser multi-file ZIP delivery + save-cancel integrity | `502c3838` |
| 12a — Inspector hierarchy + configuration integrity | `4048c306` |

> Branch note: commits are shared with the concurrent agent's branch history
> (`feat/tooltip-system`); interleaved agent commits `45386252`,
> `96d7e111` (export panel redesign doc) are not part of this work.
>
> **M9 worktree note (2026-08-01):** the M9 milestone was implemented in the
> `.worktrees/export-workspace` worktree on a dedicated branch
> `feat/export-workspace` (based on `c49304d7`), per the AGENTS.md worktree
> protocol, because the concurrent export agent is actively committing to the
> shared `feat/tooltip-system` checkout (it landed `c49304d7` — the real
> PDF/X pipeline — during this session). The worktree commit hash is recorded
> in the table above once pushed.

## 13. M9 — batch-dialog surfaces (2026-08-01)

What landed (in the worktree, on `feat/export-workspace`):

1. **PreflightFindingsPanel** — the shared `runBatchPreflight` findings are now
   surfaced visually in the export dialog (previously they only appeared as a
   count in the aria-live announcement): severity-grouped, collapsible, with
   deterministic codes, per-configuration detail, and an accessible
   visually-hidden severity label alongside each icon. Blocking vs advisory is
   visually distinct (error rows tinted, panel border highlighted when blocked).
2. **ExportResultsList** — after a batch, every requested file shows status,
   size, duration, and error message, plus a "Retry failed (N)" action that
   re-runs only the failed outputs (fixing D17's "no per-file retry").
3. **PrintSettingsPanel** — capability-honest press controls for PDF/X jobs
   (bleed mm, crop marks, registration marks, color bars, resolution floor,
   outline text). The ICC profile is shown as a read-only Fogra39 note rather
   than a selector the encoder would ignore (conversion hardcodes the bundled
   Fogra39 profile today).
4. **Rust PDF/X mark wiring (D19)** — `export_pdfx1a`/`export_pdfx4` Tauri
   commands now honor `bleedMm`, `includeCropMarks`, `includeRegistrationMarks`,
   and `colorBars` via `MarksGeometry` + the `*_with_marks` builders, and the
   pre-existing `registration_marks: include_crop_marks` mapping bug is fixed
   (`include_registration_marks`). Before this, those `PdfXOptions` fields were
   accepted by the command and silently ignored — a "UI claims support the
   encoder does not provide" defect.
5. **Batch-dialog root-node bug (D18-adjacent)** — page-scoped content lives
   under the active page's `contentRoot`, not `rootChildren`; the dialog sourced
   jobs from `editor.rootNodes()` so a frame created on a page never appeared
   in the batch list ("No export jobs to display"). `ExportLayer` now sources
   exportable nodes from the full document node table.

Test coverage added: `PreflightFindingsPanel.test.tsx` (8), `ExportResultsList.test.tsx`
(6), `PrintSettingsPanel.test.tsx` (5), 4 new `ExportDialog` tests (preflight
surfacing, print settings, batch print-option attachment, retry-failed), 2 new
Rust tests (`marks_geometry`, `registration_marks` mapping), and
`tests/e2e/spec/export-workspace.spec.ts` (3 tests: preflight panel, PDF/X
desktop-gate on web, batch results).

## 14. M11a — real executor progress and cancellation integrity (2026-08-01)

Static batch export now reports deterministic executor transitions for
preflight, rendering, encoding, writing, completion, and failure. The dialog
shows the current stage and file, updates completed/error counts per output,
and announces the stage through a polite live region. Progress comes from the
executor rather than an elapsed-time animation. Reduced-motion mode disables
the progress and cancel-control transitions.

Cancellation raised during rendering or writing remains an `AbortError` and is
not mislabeled as a failed export. Progress accounting uses constant-time
counters so batches containing hundreds or thousands of assets do not acquire
quadratic reporting overhead.

## 15. M11b — browser batch archive delivery (2026-08-01)

Browser batches containing more than one output are now buffered and delivered
through one ZIP save/download instead of opening one picker or uncontrolled
download per file. Single-file export keeps the direct format-specific save
path. Archive entries reuse the canonical cross-platform sanitizer, remove
path traversal, normalize separators, and resolve duplicate names
deterministically (`Logo.svg`, `Logo-2.svg`). A batch with no successful output
does not create an empty archive; partial-success batches contain only the
successful outputs and retain their per-file report.

Canceling a single-file picker or the final archive picker now propagates as
`AbortError`, so the dialog announces cancellation and never claims that an
unwritten file succeeded. Tests decode the generated ZIP and verify its actual
entry names rather than checking only that bytes were produced.

## 16. M11c — native one-folder batch delivery (2026-08-01)

Desktop batch export now opens the native Tauri directory picker once and
writes every successful output beneath that chosen folder. The platform facade
owns both folder selection and atomic folder-relative writes, keeping native
filesystem behavior out of the export dialog and executor. Relative output
paths are normalized and rejected when they are absolute, drive-qualified, or
contain empty, current-directory, or parent-directory segments; the existing
Rust `write_binary_file` command creates parent directories and completes each
write through its atomic temporary-file path.

Browser destination controls now state their actual capability: multi-file
exports download as one ZIP archive, so the unavailable folder button is
disabled instead of simulating a local `/exports` path. Canceling the native
folder picker leaves the previous destination unchanged. Tests cover the
native picker contract, safe nested writes, traversal rejection, the export
folder sink, and browser capability messaging.

## 17. M11d — reveal completed native outputs (2026-08-01)

Completed native exports now offer the platform-specific file-manager action
(`Reveal in Finder`, `Reveal in Explorer`, or `Reveal in Files`) when at least
one successful result has a real saved path. The action is absent for browser
downloads and failed or unsaved outputs, so the interface does not advertise a
capability it cannot perform. For folder batches it reveals the first
successful output; for single-file saves it reveals the file selected by the
user.

The results component prevents duplicate opener requests while one is in
flight and reports native opener failures through an accessible alert without
discarding the export report or retry controls. Tests cover path selection,
the native-only capability gate, and omission when no revealable output exists.

## 18. M12a — Inspector hierarchy and configuration integrity (2026-08-02)

The live Inspector export section is now a deliberate two-part workflow:
**Quick export** is a one-off download, while **Export configurations** are
persistent outputs for batch export. Preset-library and custom-format controls
have visible labels, the add form is grouped semantically, the empty state is
contained, and the advanced workspace is a single full-width handoff describing
the additional batch, print, naming, and destination features. The component
imports its own stylesheet, fixing the production-only unstyled layout caused
by mounting it outside the old `SpecPanel` entry point.

The same milestone closed four integrity gaps discovered while tracing the UI
to execution: catalog presets retain supported raster/vector/print options;
raster quality, transparency, and matte reach the renderer; destination preview
and execution use one filename/folder/collision resolver; and browser screen
PDF works for simple as well as complex nodes. Remaining canonical-but-not-yet-
consumed settings are listed in the capability audit rather than exposed as
controls that would silently do nothing.

Coverage includes 95 focused unit/component tests and 7 Chromium E2E tests for
the two export surfaces. The browser tests verify the visual hierarchy, visible
labels, literal-text regression, narrow-panel overflow, advanced-workspace
handoff, preflight, and completed batch results.
