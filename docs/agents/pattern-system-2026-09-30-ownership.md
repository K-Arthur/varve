# Ownership — editable pattern system (2026-09-30)

**Branch:** `master`
**Scope:** shared, editable pattern definitions; repeat geometry and rendering;
Pattern Library and placement controls; portable SVG/PDF output; tests, docs,
marketing, and visual evidence.
**Checkout:** substantially dirty shared tree. Only pattern-owned changes are
included in the commits for this task; unrelated staged and unstaged paths are
preserved.

## Owned paths

| Area | Paths |
|---|---|
| Scene definitions and lifecycle | `packages/scene/src/types.ts`, `fills.ts`, `fills.test.ts`, `patternDefinitions.ts`, `patternDefinitions.test.ts`, `document.ts`, `documentCodec.ts`, `version.ts`, `assets.ts`, `clone.ts`, `__tests__/clone.test.ts`, `index.ts` |
| Repeat geometry and engine | `packages/shared/src/patternRepeat.ts`, `packages/engine/src/types.ts`, `engine.ts`, `replay.ts`, `patterns/patternGenerators.ts`, pattern tests, Rust pattern wire fields in `crates/varve-core/src/scene.rs` and `crates/varve-bridge/src/lib.rs` |
| Editor source/library, placement, and import | `packages/editor/src/components/Inspector/sections/PatternLibrarySection.tsx`, `PatternFillControls.tsx`, `FillSection.tsx`, `PatternRepeatPreview.tsx`, inspector CSS, `patterns/`, `clipboard.ts`, `render/sceneToEngine.ts`, `import/mergeImportedResources.ts` |
| Export | `packages/editor/src/export/patternTileSvg.ts`, print resource manifest and compositor integration/tests, `packages/codegen/src/svg.ts`, `crates/varve-print/src/lib.rs` pattern clauses/tests |
| Product docs and marketing | `docs/architecture/fill-system.md`, `docs/research/pattern-authoring-research-2026-09-30.md`, `apps/website/src/pages/features/patterns.astro`, `apps/website/src/pages/docs/tools/patterns.astro`, export claims, feature/docs indexes |
| Validation/evidence | `tests/e2e/canvas/pattern-repeat.spec.ts`, `docs/agents/validation-reports/pattern-system-2026-09-30.md`, `docs/screenshots/pattern-system-2026-09-30/` |

Some owned paths share diffs with other in-flight work. Before committing, use
an isolated Git index and inspect every staged hunk; never stage a whole mixed
path or alter the shared index. Hub files remain outside the pattern scope.

## Contract and findings

- Selected vector art is copied into a definition; the original source remains
  in the document. Raster assets stay embedded. Generator recipes and seeds are
  stored as the source of truth; preview tiles are caches.
- Fills reference a definition and keep per-fill placement. Object alignment
  follows the shape; Document/page alignment preserves shared phase across
  adjacent objects, and the Rust PDF route currently warns and omits that mode.
  Shared source edits and Make Unique have distinct scope. Pattern Library mutations use labeled
  history transactions; stale raster import results are revision-checked.
- Grid, column-offset half-drop, and row-offset brick share one repeat
  evaluator. Mirror flags use negative-index parity. Walks are bounded and
  return an explicit warning rather than silently yielding partial geometry.
- A visual review found the full repeat preview's explanatory hint spilling
  from the 20px swatch and over library controls. The compact library swatch
  now clips to its bounds and hides that hint; the real browser spec asserts
  containment.
- Native SVG applied-fill output is limited to linked grid patterns with a
  single supported visible fill and embedded source. Unsupported cases use an
  explicit raster fallback/report. PDF supports axis-aligned grid repeats with
  positive gaps; unsupported transforms and PDF/X-1a transparency are reported.
- Source tiles and rectangular repeat supertiles export as SVG. Supertiles
  support the conventional Grid, Half-drop, and Brick layouts, including
  mirror parity; custom stagger fractions without a supported rectangular
  period are rejected.
- Raster seam inspection applies whole-pixel cyclic offsets to embedded tiles
  up to 16 megapixels. It writes a new PNG from the original texels and changes
  linked uses of that definition; it does not synthesize edge content or
  enable wraparound painting.
- PDF and PDF/X preflight stops when a visible pattern fill has no resolved
  tile source. The Rust print renderer still omits missing resources with a
  warning comment as a defensive fallback; it never substitutes gray artwork.
- The research ledger links versioned primary documentation and firsthand
  issue reports to product decisions and acceptance checks. Competitor reports
  are regression leads, not Varve defects.

## Validation status

Focused pattern tests, the Chromium repeat/source-edit workflows, editor and
E2E typechecks, website/codegen builds, docs/emoji/token/inspector audits, and
targeted PDF tests pass. Browser checks cover pixel periodicity, arrangement
changes, raster source replacement, Make Unique undo/redo, source-draft Cancel,
offline browser save/reopen, mirrored ghost dragging, and no history-bypass
warnings. The latest escalated full gate is not green: the shared checkout has
an unrelated whole-tree format error in `packages/editor/src/editor.css` and
the combined E2E typecheck step exited without a diagnostic. The standalone
E2E typecheck immediately afterward passed; the full Vitest and Cargo lanes
were not reached. The architecture audit reported 14 distinct cycles, 76
unstable modules, and existing Shell/Menubar/context import-budget overruns,
with no layer violations. Exact commands and earlier attempts are recorded in
the validation report.

## Remaining scope

The source editor supports top-level motif selection, ghost-copy hit mapping,
translation/rotation, and draft Cancel/Done in the inspector. A contextual
canvas editing session with normal path, nested-child, text, paint, and raster
tools remains unimplemented. Raster offset inspection repositions existing
texels; it does not synthesize seams or enable wraparound painting. Finite
Expand-to-objects remains unimplemented. Document/page alignment now works in
browser replay and the Rust bridge; PDF warns and omits that mode. The
three requested rich real-world design documents, dense-repeat performance
measurements, and native Tauri/physical-touch validation remain unverified.
Browser offline save/reopen is covered; native offline persistence is not.
Keep these limits visible in user-facing status copy.
