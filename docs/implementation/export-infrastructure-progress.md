# Export Infrastructure — Audit and Rebuild Progress

Status: **In progress** — Milestone 1 (audit) complete.
Updated: 2026-08-01

This document tracks the repository-wide audit and staged rebuild of Strata's
export infrastructure. It is the single source of truth for the export
architecture map, known defects, target architecture, migration strategy, and
milestone verification.

---

## 1. Executive summary of the current state

Strata has a **working but shallow export system** organized as:

```
ExportDialog.tsx ──► ExportLayer.tsx ──► ExportService.run() ──► exportSaveAdapter.ts
   (modal)             (shell glue)        (render+report)        ──► platform.saveBinaryFile
                                             │                          (tauri / web / memory)
                                             └─► SpecPanel/export.ts (raster + vector + PDF)
                                             └─► export/compositor.ts (capability-driven flatten)
                                             └─► @strata/codegen (SVG / Tailwind / Flutter / SwiftUI)
                                             └─► strata-print (Rust: PDF screen / PDF-X1a / PDF-X4)
```

Supported formats today:

| Format | Path | Status |
|--------|------|--------|
| PNG / JPEG / WebP | `exportNodeAsRaster` → canvas `toBlob`/`convertToBlob` | Works (sRGB baseline) |
| GIF (timeline) | `engine/gifExport.ts` TS encoder | Works |
| MP4 / WebM (timeline) | WebCodecs / MediaRecorder / image-sequence | Works (Chromium) |
| SVG | `@strata/codegen/svg.ts` scene→SVG (+ subtree raster fallback) | Works with limits |
| PDF (screen) | Rust `strata_print::export_pdf`; browser fallback `makeSimpleImagePdf` | Works (strict subset) |
| PDF/X-1a / PDF/X-4 | Rust `strata_print::cmyk::{export_pdfx1a, export_pdfx4}` | Rust-exposed, **TS export path throws** |
| AVIF | none | **Advertised, throws at runtime** |
| React / Flutter / SwiftUI / CSS | `@strata/codegen` | Works (semantic, not pixel-exact) |
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
| `strata-print` native PDF | Re-emits PDF operators from `SceneNode` (no IR) | PDF export (desktop) |
| `@strata/codegen/svg.ts` | Scene→SVG serializer | SVG export |

Preview and export **share `replayIr` as the leaf painter but not the
structural layer**, so a node with mask/group-isolation semantics can look
different in preview vs export. This is intentional and documented
(`docs/architecture/canvas2d-system.md`) but must be kept explicit.

### 2.3 Rust backend (desktop)

| Crate | Export-relevant surface |
|-------|-------------------------|
| `strata-core` | Scene model only; no encoders |
| `strata-engine` | `build_render_ir` / `build_render_ir_flat` |
| `strata-bridge` | `IpcSceneNode` wire conversion |
| `strata-sync` | SQLite `DocumentStore`; SCHEMA_VERSION 1; save/load; no export storage |
| `strata-print` | `export_pdf`, `cmyk::export_pdfx1a/x4`, `outline.rs`, `subset.rs`, `marks.rs`, `resources.rs` (`ExportManifest`), `shaper.rs` |
| `strata-colour` | ICC/CMYK science: `rgb_to_cmyk_icc`, `IccEngine` (tintbox), bundled profiles; WASM bindings |
| `strata-trace` / `strata-wasm` | Raster→vector tracing; IR JSON |
| Desktop `lib.rs` | `write_binary_file`, `export_node_pdf`, `export_pdfx1a/x4`, `export_pdf_with_options`, `outline_text`, `shape_text_command`, `list_printers`, `print_pdf`, `cancel_print_job` |

### 2.4 Persistence / platform

- **Docs:** SQLite (`strata-sync`) on desktop; IndexedDB `strata-home` on web; `.strata` JSON text file for disk save.
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
| D3 | **`pdf-x1a`/`pdf-x4` are advertise-but-throw in TS.** Rust implements them; nothing in the editor reaches them. | `exportService.ts:228` | High |
| D4 | **Batch export Cancel is cosmetic.** `ExportDialog.handleCancel` only resets local state; no `AbortSignal` reaches `ExportService.run` from `ExportLayer`. | `ExportLayer.tsx:44`; `exportService.ts:261` | High |
| D5 | **PDF image manifest is defined but never wired.** `ExportManifest` exists on both sides (`strata-print/resources.rs:49`, `engine/iccImageConverter.ts:194`, `editor/export/resourceCollector.ts:38`) but no editor call passes `manifest_json`. Any image fill reaching the native vector PDF path resolves to a **checkerboard placeholder**. | `strata-print/lib.rs:1149`; `SpecPanel/export.ts:424` | High |
| D6 | **Three-way accelerator mismatch for Export.** Native menu: `export`=Ctrl+E, `exportSvg`=Ctrl+Shift+E; shortcut registry: `exportSvg`=Ctrl+Alt+E, `export`=Ctrl+Shift+E; help article claims Ctrl+E opens Export. | `menu/defs.ts:132-146`; `ShortcutManager.ts:33-42`; `packages/help/src/content/export.ts:8` | Medium |
| D7 | **Duplicate extension maps (3x).** `exportSaveAdapter.ts FORMAT_EXTENSIONS`, `ExportDialog.buildJobs` inline switch, `DestinationPicker` inline switch. | `exportSaveAdapter.ts:12`; `ExportDialog.tsx:139`; `DestinationPicker.tsx:38` | Low |
| D8 | **Duplicate whole-document SVG export.** `createActionHandlers.exportSvg` uses legacy `exportDocumentToSvg` + anchor download, bypassing ExportService and the save picker; File menu "Export…" is per-node. | `createActionHandlers.ts:93` | Medium |
| D9 | **`ExportPresetPanel.tsx` is dead code** (per-node preset CRUD UI imported nowhere). `context.tsx` `addPreset/updatePreset/removePreset` have no UI consumer. | grep importers | Medium |
| D10 | **Print preflight split-brain.** `runPrintPreflight` (scene, 427 lines) has no editor caller; the UI uses `runCombinedPreflight`. | `PreflightWarnings.tsx:14,56` | Low |
| D11 | **Three PDF writers.** Hand-rolled `makeSimpleImagePdf` (browser fallback), `rasterizeSubtreeToPdfViaPrintEngine` (no manifest → D5), Rust `strata-print`. | `SpecPanel/export.ts:241,424` | Medium |
| D12 | **`composeFlattenedExportSnapshot` (whole-doc) and `resourceCollector.ts` (ExportManifest) are unused.** | grep importers | Low |
| D13 | **Stale E2E test** driving a removed export dialog UI. | `tests/e2e/canvas/upscale-export-verification.spec.ts:37` | Low |
| D14 | **Home-app "Export" is a no-op.** | `packages/home/src/HomeShell.tsx:876` | Low |
| D15 | **`verboseOutput` toggle is dead** (set, rendered, never consumed). | `ExportDialog.tsx:199,695` | Low |
| D16 | **Slice tool creates plain frames.** `SliceTool.ts` comments claim export slices; no tagging or export wiring exists. | `tools/SliceTool.ts:32` | Medium |
| D17 | **No real batch cancellation/retry/summary-after-partial-failure.** `ExportService` reports failures but the dialog only aggregates counts; no per-file retry. | `exportService.ts:257` | Medium |
| D18 | **No deterministic plan layer.** Per-node presets → jobs is a blind expansion (`ExportDialog.buildJobs`) with per-dialog dimension heuristics (`nodeBaseDimensions`) that duplicate renderer bounds logic. | `ExportDialog.tsx:65-167` | High |

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
- No canonical export-plan type; settings are spread across `ExportPreset`/`ExportJob`/`ExportSettings`/per-dialog state.
- No capability contract; the UI lists formats/options the encoder rejects at runtime (D1, D3).
- No shared export preflight service; only print-mode preflight exists and it is not wired to export.
- No filename template engine (sanitization is ad hoc `safeFilename`); no collision detection before writing.
- No multi-configuration per target (Figma-style PNG@1x/2x/3x + SVG on one object is only approximated by stacking `ExportPreset[]`).
- No export queue/job system with real cancellation for static batch export (D4).
- No file-size estimation or export preview.
- No background/foreground export distinction; large raster exports block nothing but also show no per-stage progress.

---

## 5. Proposed target architecture

A **strangler migration** onto a canonical, versioned export domain model in
`@strata/scene`:

```
Settings (UI)                     ┌────────────────────────────────────────────┐
   │   ExportConfiguration[]      │        @strata/scene/export (canonical)   │
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
| 1 | Export architecture audit + progress documentation | **In progress** (this doc) |
| 2 | Canonical export model + migrations (`scene/export/model.ts`) | Pending |
| 3 | Capability contracts + plan normalization (`capabilities.ts`, `plan.ts`) | Pending |
| 4 | Shared target/bounds/scale/naming infra (`naming.ts`) | Pending |
| 5 | Export preflight service (`preflight.ts`) | Pending |
| 6 | Integration: ExportService cancellation, capability-gated errors, settings consumption, accelerator fix, dead-code removal | Pending |
| 7 | Inspector export section + preset management UI | Pending |
| 8 | Full export workspace + print UI + preview | Pending |
| 9 | Raster improvements (resampling, tiling), SVG preservation, PDF/print | Pending |
| 10 | Color-management + metadata controls | Pending |
| 11 | Destination integration (browser ZIP, Tauri folder, reveal), job queue | Pending |
| 12 | Accessibility, responsive, E2E/visual-regression/docs | Pending |

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
- [ ] M7+ UI milestones
- [ ] E2E export suite green
- [ ] Full `just gate` after each milestone

Gate results per milestone:

| Milestone | Typecheck | Lint (touched) | Unit tests | Audits |
|-----------|-----------|----------------|------------|--------|
| M2 | `@strata/scene` clean | Biome clean | 39/39 `scene/src/export` | n/a |
| M3 | `@strata/scene` clean | Biome clean | 90/90 `scene/src/export` | n/a |
| M4 | `@strata/scene` clean | Biome clean | 104/104 `scene/src/export` | n/a |
| M5 | editor + scene clean | Biome clean (touched) | scene+editor suites; 11 unrelated failures proven pre-existing | arch audit run (see below) |

Pre-existing failures on the shared branch (proven pre-existing via stash check,
not caused by this work): `ShortcutPalette.test.tsx` (8), `MasterPanel.test.tsx`
(1), `LayersRow.test.tsx` (1), `AssetExportControls.test.tsx` (1).

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

> Branch note: commits are shared with the concurrent agent's branch history
> (`feat/tooltip-system`); interleaved agent commits `45386252`,
> `96d7e111` (export panel redesign doc) are not part of this work.
