# Logo System Architecture

Status: implemented (manual workflow). AI-assisted concept generation is
out of scope for this iteration and documented as a gap.

## Scope

Strata's logo workflow is a **manual-first, editable, non-destructive**
logo design experience built on the ordinary document model. There is no
second editor: a logo project is metadata (concepts, variants, brief,
palette) layered over regular artboard frames.

## Components

| Layer | Files | Responsibility |
|---|---|---|
| Workspace mode | `packages/editor/src/workspace/workspaceTypes.ts` (`logo` config) | Panel/toolbar/tab composition for logo work; `Ctrl+Shift+6` |
| Presets | `packages/shared/src/presetRegistry.ts` (`LOGO_GROUP`) | Transparent-canvas logo presets (square/horizontal/vertical/badge/mark/favicon) |
| Project model | `packages/scene/src/logo/logoProject.ts` | LogoProject/Concept/Variant/Brief/Palette types + pure ops + `normalizeLogoProject` |
| Document schema | `Document.logoProject` + migration `2.11 → 2.12` | Serialization, codec normalize step |
| Editor glue | `packages/editor/src/context/useLogoProject.ts` | Undo-aware command surface on `EditorContextValue` |
| Geometry ops | `packages/editor/src/geometry/vectorOps.ts` | Expand stroke, offset, round, simplify, mirror/radial duplicate (pure) |
| Wordmark typography | `TextNode.tracking` end-to-end + TypographySection field | Tracking in 1/1000 em; `graphemeTracking()` in engine shaping |
| Previews | `packages/editor/src/logo/logoPreview.ts` + `components/LogoPreview/LogoPreviewDialog.tsx` | Small-size ladder (16–128 px), light/dark/checker surfaces, monochrome/grayscale/reversed modes |
| Audit | `packages/scene/src/auditAdapter.ts` (`createLogoRules`) | 4 advisory rules (editable text, thin strokes, excessive points, missing monochrome variant) |
| Export | `packages/editor/src/logo/logoPackageExport.ts` | Deterministic ZIP: per-concept/variant PNG+SVG, palette JSON, README, source |
| SVG transparency | `packages/codegen/src/svg.ts` (`background: 'transparent'`) | Logo marks never delivered on an opaque white box |

## State model

- `doc.logoProject` is document-scoped and fully serializable. Concepts
  reference artboard frame ids; the artwork itself is ordinary scene data.
- **No derived data is stored.** Stale references (deleted artboards,
  detached concepts) are repaired by `normalizeLogoProject` on load and on
  every mutation.
- `provenance` defaults to `'user-created'` and is only changed by explicit
  user or pipeline actions. `sourcePrompt` stores generation metadata when a
  future AI pipeline provides it — it is never invented.
- Undo/redo: all mutations flow through `updateDoc` (single undo entries).
  Long-running work (package export, preview rendering) never holds a
  transaction.

## Manual workflows

- **New Logo Project** (`Ctrl+Alt+N`): creates the project + first
  transparent 1024×1024 artboard + concept; selects the artboard.
- **Concept management** (`Ctrl+Alt+1` create, `Ctrl+Alt+2` duplicate):
  concepts are registrations over artboards; duplication deep-clones the
  artwork and preserves z-order.
- **Variant registration**: File → Create Monochrome/Reversed/Icon/Small
  Variant registers a variant over the active artboard.
- **Geometry**: Object menu Path Operations (expand stroke, offset, round,
  simplify) and duplicate transforms (mirror horizontal/vertical, radial).
- **Clear-space guides**: Object → Generate Clear-Space Guides (four locked
  guides at a configurable gap).
- **Small-size testing**: View → Test Logo at Small Sizes
  (`Ctrl+Alt+Shift+P`).
- **Package export**: File → Export Logo Package… (ZIP).

## Privacy and licensing

- The manual workflow is fully local: no assets leave the device.
- The package README states that licensing status of fonts/images/templates
  must be reviewed before commercial adoption, and that Strata does not
  grant or assert trademark rights.
- Audit findings are advisory only; they never block export and never claim
  to score design quality.

## Performance

- Preview renders one 512 px snapshot through the export raster pipeline
  (OffscreenCanvas), cancellable via AbortController; the bitmap is closed
  on dialog close.
- Duplication is O(subtree) with structural sharing via immutable updates.
- Audit rules are cheap scans; the excessive-points rule is on-demand stage.
- Package export renders each asset sequentially; concurrency is bounded by
  the export pipeline itself.

## Testing

- `packages/scene/src/logo/logoProject.test.ts` — model ops, normalization,
  artboards, duplication, clear-space guides.
- `packages/scene/src/logo/logoAudit.test.ts` — advisory rule behavior.
- `packages/editor/src/geometry/vectorOps.test.ts` — 25 geometry tests.
- `packages/editor/src/logo/logoPreview.test.ts`, `logoPackageExport.test.ts`.
- `packages/engine/src/shaping.test.ts` — `graphemeTracking` math.
- `packages/scene/src/version.test.ts` — migration chain to 2.12.

## Known limitations (2026-08-03 update)

Implemented since the original release:

- **Visual Logo panel** (`packages/editor/src/components/LogoPanel/`):
  Project (brand/concept status/notes), Create (concept/variant actions),
  Vectorize (shared workflow), Typography (wordmark + glyph controls),
  Variants, Validation, Export Package. Workspace-config-backed visibility
  (logo mode only), persisted, command/menu/shortcut integrated.
- **Vectorization** (`packages/editor/src/logo/vectorization/` + shared
  `components/Vectorize/`): presets (8), source prep (grayscale/invert/
  contrast/brightness/denoise/threshold), live preview with diagnostics,
  stale-result/cancel protection, single-undo Apply inserting native paths
  beside the source via the existing tracer chain and insertTraceGroup.
  Available in the Logo panel and the Inspector Image & Vector dialog;
  the QuickBar keeps instant one-click tracing.
- **Per-glyph typography**: document 2.13 — `TextNode.kerningMode`
  (`auto`/`none`), per-grapheme-cluster `glyphAdjustments`
  (dx/dy/advance/rotation/scale) and `pairAdjustments`. Kerning-off is
  implemented in the canvas renderer (per-cluster drawing) and stays
  independent of ligature toggles and tracking. Editor surfaces: Logo
  panel Typography section + Inspector Typography section, with explicit
  disabled reasons for unsupported text (rich text, RTL, multi-line,
  case/list/path transforms).
- **Text-to-outline parity**: outlined output applies cluster adjustments
  (offsets, advance, pair spacing, rotation/scale around the cluster
  origin) so canvas placement and outlines agree.
- **Package export**: SVG, PNG ladder, vector PDF (raster fallback in
  browser), multi-size ICO (16-256), Retina ICNS (icp4-ic15); naming
  preview, folder-tree preview, file-count estimate, structured report.
  Deterministic encoders (`packages/scene/src/export/ico.ts`, `icns.ts`)
  with structural validators.

Remaining limitations:

- No AI-assisted concept generation; vectorization is local-only
  (TS/WASM/native providers, no remote processing).
- `monochrome` preview uses canvas filters, not true palette substitution.
- Variants are registrations over artboards, not live-linked instances.
- Optical kerning is not offered (no genuine optical algorithm); only
  `auto` (font kerning) and `none` are selectable.
- Kerning-off and glyph rendering constrain to single-line plain LTR text
  without case/list transforms; complex scripts fall back with an
  explanation rather than corrupting shaping.
- ICO/ICNS encode the modern PNG-based containers only (Vista+/10.7+).
- Playwright e2e for the panel is written and green for the core flows;
  full-suite runs are currently blocked by concurrent dev-server churn in
  the shared workspace (mid-test reloads), not by assertion failures.
