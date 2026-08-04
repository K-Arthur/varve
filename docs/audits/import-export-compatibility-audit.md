# Import/Export Compatibility Audit

Date: 2026-07-07

This audit covers the compatibility push across document persistence, import
entry points, parser reporting, export execution, package export, token
exchange, and platform binary transfer. The implementation target was broad,
honest interoperability: `.strata` remains the lossless source of truth, while
foreign formats produce editable structure only where the source format and
current parser can support it.

## Research Basis

- Figma import separates file-browser imports from in-file media insertion and
  supports Sketch, Figma-family local files, PNG/JPG, and PPTX in the browser:
  https://help.figma.com/hc/en-us/articles/360041003114-Import-files-to-the-file-browser
- Figma export exposes format-specific settings for PNG, JPG, SVG, and PDF,
  including scale, suffix, color profile, SVG text outlining, and PDF
  limitations: https://help.figma.com/hc/en-us/articles/13402894554519-Export-formats-and-settings-for-static-designs
- Figma REST is the stable path for Figma data interoperability, not reverse
  engineering changing local `.fig` bytes: https://developers.figma.com/docs/rest-api/
- Sketch documents are ZIP archives with JSON data and `meta.json`,
  `document.json`, `user.json`, `pages`, `images`, and `previews` folders:
  https://developer.sketch.com/file-format/
- Adobe Illustrator package export collects the document, linked graphics,
  permitted fonts, and a report, with explicit font-license warnings:
  https://helpx.adobe.com/illustrator/using/package-files.html
- Adobe Illustrator supports many interchange formats but still distinguishes
  open, place, import, linked assets, and package workflows:
  https://helpx.adobe.com/illustrator/desktop/get-started/learn-the-basics/supported-file-formats.html
- DTCG 2025.10 defines JSON token exchange, recommended file extensions, and
  structured color token values:
  https://www.designtokens.org/TR/2025.10/format/
- SVG 2 remains the relevant vector interchange baseline:
  https://www.w3.org/TR/SVG2/
- PDF/X requires print-specific constraints and output intents beyond ordinary
  PDF generation:
  https://pdfa.org/technical-side-and-requirements-of-pdfx/
- PDF.js is asynchronous and page-oriented, with `getDocument`, `getPage`, and
  viewport rendering as the integration shape:
  https://mozilla.github.io/pdf.js/examples/

## Implemented Architecture

- `DocumentCodec` in `@varve/scene` is now the canonical document boundary for
  decode, migrate, normalize, encode, and node closure collection.
- `ImportService.importFiles(inputs, options, signal)` is the shared import
  orchestration layer with typed file inputs, per-file status, warnings,
  unsupported features, timing, byte counts, artifacts, and progress hooks.
- Editor file picker, canvas drop, and clipboard paste now route foreign files
  through `ImportService` instead of direct parser calls.
- Imported subtrees are deep-cloned with remapped ids, preserving group/frame
  hierarchy instead of inserting only the selected root.
- `ExportService.run(batch, context, signal)` is the shared export executor for
  SVG, raster, code, PDF screen export, and unsupported-format reporting.
- File > Export, Spec Panel export, direct SVG export, batch export, and package
  export now share export job/report semantics.
- SVG export now writes SVG XML bytes with `image/svg+xml` instead of routing
  through raster PNG bytes.
- Package export creates a ZIP with `document.strata`, `manifest.json`, token
  export, asset manifest, font manifest, and export report.
- Sketch import uses `fflate` and the official ZIP/JSON archive shape.
- DTCG token export now emits structured color values with `colorSpace`,
  `components`, and `alpha`.
- Tauri binary save no longer expands `Uint8Array` into large JS arrays for IPC.
- `Shell` receives the real platform from the desktop app, so editor exports can
  call platform save APIs instead of wrapper-only fallbacks.

## Findings

| ID | Finding | Root cause | Impact | Solution | Tests | Residual limitation |
|---|---|---|---|---|---|---|
| F1 | Import entry points disagreed | Shell, canvas drop, and paste called parsers directly | Different UX, reports, undo behavior, and format coverage per surface | Routed editor file picker, canvas drop, and clipboard files through `ImportService`; batched insertion into one undo unit per import batch | `context.import.test.tsx`, `service.test.ts`, `batch.test.ts` | Home bulk import should be migrated to the same service next if its package is active in this worktree |
| F2 | SVG export could write raster bytes | Export UI reused raster code path for SVG | Invalid SVG downloads and broken developer handoff | `ExportService` emits real SVG text and MIME metadata | `exportService.test.ts`, `ExportDialog.test.tsx`, `AssetExportControls.test.tsx` | SVG advanced options need broader goldens for gradients, masks, text, and effects |
| F3 | Imported groups lost descendants | Insertion cloned only the root node | Broken hierarchy, missing children, broken imported components | Added subtree clone/remap insertion and batch insertion | `batch.test.ts`, `context.import.test.tsx` | Dependency closure beyond node trees, such as page metadata and external fonts, is reported but not fully materialized |
| F4 | Document persistence had multiple codecs | Editor used direct migration helpers while import/export used codec work | Recovery/open/save could drift from import snapshots | `EditorProvider` now uses `DocumentCodec` for initial load, open, serialize, save, and save-as | `documentCodec.test.ts`, focused editor import regression suite | Autosave service still imports `serializeDocument` directly and should adopt `DocumentCodec.encode` in a follow-up hardening slice |
| F5 | Binary saves inflated memory | Tauri save path used `Array.from(Uint8Array)` | Large exports created avoidable allocation and IPC overhead | IPC now passes `ArrayBuffer` directly | `tauri.test.ts` | Rust IPC parity should be extended for package-size stress cases |
| F6 | DTCG colors were string-shaped | Token exporter used CSS strings as `$value` | Non-conformant token exchange with tools expecting 2025.10 structured colors | DTCG export emits structured OKLCH color values and preserves CSS string in an extension | `dtcg.test.ts` | DTCG import is not yet wired into editor token libraries |
| F7 | Sketch import was unsupported | No archive parser or ZIP safety checks | `.sketch` imports failed or needed unsafe assumptions | Added fflate ZIP parser with ZIP-slip prevention and page/layer extraction | `sketch.test.ts`, `service.test.ts` | Symbols, constraints, effects, and shared styles are reported as partial fidelity |
| F8 | Package export was missing | Export produced individual artifacts only | Enterprise handoff lacked source, assets, tokens, and compatibility manifest | Added package ZIP with document, manifests, tokens, assets, fonts notes, and report | `packageExport.test.ts`, `ExportDialog.test.tsx` | Font bytes are not copied unless license and source data are available |
| F9 | PDF/AI/EPS/PSD fidelity was over-trusted by UX | Parsers had limited structural extraction | Users could mistake best-effort output for editable round-trip | Import reports now expose warnings and unsupported feature records | `service.test.ts`, parser validation tests | PDF and PSD are still synchronous, basic parsers; true PDF.js and `@webtoon/psd` async layer rendering need a parser API revision |
| F10 | Export success state could overstate results | Dialog announced success without job-level artifact checks | False positive export completion | Dialog consumes `ExportReport`, shows job statuses, and only reports produced artifacts | `ExportDialog.test.tsx` | Destination picker and persisted export presets need broader E2E coverage |

## Roadmap

### Critical

- Completed: canonical `DocumentCodec` for open/save/serialize boundaries.
- Completed: shared `ImportService` and editor file picker/canvas/clipboard
  wiring.
- Completed: shared `ExportService` with batch report semantics.
- Completed: SVG bytes/MIME fix.
- Completed: deep subtree import with id remap.
- Completed: package export ZIP.
- Completed: real platform injection into `Shell`.

### High

- Completed: Sketch ZIP import with path-safety checks.
- Completed: binary platform IPC memory fix.
- Completed: package export with assets/tokens/report/manifests.
- Remaining: replace synchronous PDF token extraction with an async PDF.js
  adapter that can render previews, extract text per page, enforce page/pixel
  budgets, and emit one report per page.
- Remaining: replace PSD placeholders with an async `@webtoon/psd` adapter that
  extracts group hierarchy, layer bounds, opacity, visibility, and raster pixels.
- Remaining: add Tauri IPC parity tests for package export and multi-save.

### Medium

- Completed: DTCG structured color export.
- Remaining: DTCG import into document/library token stores.
- Remaining: missing-font and missing-asset report views in import results.
- Remaining: PDF/X preflight in the print package with output intents.
- Remaining: AVIF capability gating in the export dialog.
- Remaining: persisted export presets and keyboard-only import/export E2E.

### Low

- Remaining: richer EPS/AI tokenization beyond rectangles and text.
- Remaining: Figma REST importer UI using official API JSON.
- Remaining: Lottie and animated SVG validation in export reports.
- Remaining: import compatibility score surfaced in results UI.

### Future Opportunities

- Optional native/plugin adapters for heavyweight proprietary or print formats.
- Worker-based parser execution with progress events for all binary formats.
- Diff-on-re-export UX for developer handoff workflows.
- Enterprise policy controls for font packaging and external asset collection.

## Verification Report

Final Cascade gate commands run on 2026-07-07:

```bash
pnpm format
```

Result: passed. Biome formatted 991 files and reported no fixes applied.

```bash
pnpm typecheck
```

Result: passed. All 17 package typecheck tasks completed successfully.

```bash
pnpm lint
```

Result: passed with exit code 0. Biome still prints warnings for existing
large-file patterns, but no lint errors were introduced.

```bash
pnpm test
```

Result: passed. 335 test files passed; 3813 tests passed and 1 test was
skipped.

```bash
pnpm audit:emoji
```

Result: passed. The emoji audit scanned 939 files and reported clean.

```bash
pnpm audit:tokens
```

Result: passed. All 96 contrast pairs pass across light, dark, and
high-contrast themes.

Focused compatibility tests run during the compatibility push:

```bash
pnpm exec vitest run packages/scene/src/documentCodec.test.ts packages/import/src/service.test.ts packages/import/src/batch.test.ts packages/import/src/sketch.test.ts packages/editor/src/context.import.test.tsx packages/editor/src/exportService.test.ts packages/editor/src/exportSaveAdapter.test.ts packages/editor/src/packageExport.test.ts packages/editor/src/components/Export/ExportDialog.test.tsx packages/platform/src/tauri.test.ts packages/ui/src/tokens/dtcg.test.ts
```

Result: 11 test files passed, 52 tests passed.

```bash
pnpm exec biome check packages/editor/src/CanvasArea.tsx packages/editor/src/Shell.tsx packages/editor/src/context.tsx packages/editor/src/context.import.test.tsx
```

Result: exit code 0. The command still reports pre-existing non-null assertion
warnings in large editor files.

Previously verified focused slices in this branch:

- `DocumentCodec` migration/normalization/closure tests passed.
- `ImportService` report/status tests passed.
- Deep-clone import tests passed.
- Export service and save adapter tests passed.
- Export dialog tests passed.
- Platform binary IPC test passed.
- DTCG structured color tests passed.
- Sketch ZIP import tests passed.
- Package export ZIP tests passed.

Additional regression fixes made while driving the full gates green:

- Added background-removal mask interoperability helpers and tests so export,
  import, and worker-facing mask payloads can round-trip as bounded data URLs.
- Fixed Oklab color interpolation channel scaling and timeline sampler cache
  invalidation for easing/spatial tangent changes.
- Repaired prototype transition wiring, text engine node typing, WebGPU ambient
  types, print overlay accessibility, and dialog button semantics uncovered by
  strict typecheck, lint, and Testing Library regressions.
- Optimized the Layers search index tokenizer and snap-target filtering so the
  existing 10K-node performance regressions pass inside the full suite.
