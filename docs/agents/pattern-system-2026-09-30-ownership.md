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
- Fills reference a definition and keep per-fill placement. Shared source edits
  and Make Unique have distinct scope. Pattern Library mutations use labeled
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
- The research ledger links versioned primary documentation and firsthand
  issue reports to product decisions and acceptance checks. Competitor reports
  are regression leads, not Varve defects.

## Validation status

The 300-test pattern-specific Vitest suite and 5-test Chromium workflow pass;
the added supertile exporter has 5 focused passing tests and a focused Chromium
download workflow also passes.
The browser flow verifies pixel periodicity, arrangement changes, raster source
replacement, Make Unique undo/redo, and no history-bypass warnings. Website and
codegen builds, docs/emoji/token/inspector audits, a standalone E2E typecheck,
and targeted PDF tests pass. The escalated full gate is not green: its formatter
blocks on an unrelated missing newline in
`native-webgl2-2026-09-28T10-16-25-630Z.json`; its full-run E2E typecheck exited
silently but passed standalone. The shared-tree architecture audit also sees
75 unstable modules; the supplied AGENTS guidance says the ceiling is 49, while
`.architecture-baseline.json` says 55. The audit result exceeds both, alongside
existing hub import-budget warnings. Details and exact commands are recorded
in the validation report.

## Remaining scope

No contextual canvas motif-edit session, neighbor ghost hit mapping, session
Cancel, raster seam inspection/offset repair, wraparound painting,
Expand-to-objects, or shared page-origin mode is implemented. The three
requested rich real-world design documents,
offline real-app save/reopen, native Tauri/physical touch validation, and dense
repeat performance measurements remain unverified. These gaps are listed in
the validation report and must remain visible in user-facing status copy.
