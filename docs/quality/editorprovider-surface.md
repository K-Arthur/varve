# EditorProvider Consumer Surface — Clustering for the Strangler-Fig Split

Input to the Prompt 11 strangler-fig refactor plan. Method: static analysis of `useEditor()`'s
return shape (`EditorContextValue`, `packages/editor/src/context.tsx:518`) against every consumer,
not a guess at boundaries.

**Update 1 (fixed)**: `useViewport()`'s memoization was defeated on every `EditorProvider` render
— `ViewportContext.tsx`'s `panAnimationRef ?? { current: null }` fallback allocated a fresh object
each render. Fixed with a stable `useRef` default (commit `d163bb76`). Regression tests updated
accordingly.

**Update 2 (Phase B progress) — Tool extracted cleanly; Viewport is NOT ready for unification,
and the divergence is much worse than first thought.**

- **`ToolContext.tsx` extracted** (commit `dad22741`): `state.tool`/`setTool`, Ce=1, single
  shared `applyToolChange()` implementation used by both `useTool()` and the `useEditor()` facade
  so they cannot diverge. Zero regressions across 20 characterization/render-count/integration
  tests plus the full 53-file gate-test set.

- **`DocumentContext.tsx` requires no extraction work** — it's already structurally correct.
  `DocumentProvider` takes `value: DocumentContextValue` as a plain prop; `EditorProvider` computes
  the value once (inside its own `value` `useMemo`) and forwards it. There is only ever one
  implementation. What's left for Document is pure Phase C (migrating the 50 files still reading
  `state.document` through `useEditor()` to `useDocument()` instead) — not Phase B.

- **`ViewportContext.tsx` is a dead, unfinished, never-reconciled reimplementation — do not
  unify it without a dedicated effort.** What looked like one divergent method (`setZoom`, found
  during the memoization-bug investigation) turned out to be **at least 9 of ~15 methods** with
  substantive behavioral differences from `context.tsx`'s real implementation, found via a full
  method-by-method audit:

  | Method | Divergence |
  |---|---|
  | `setCamera` | `context.tsx` clamps against `computeDocumentUnionBounds` (document-aware bounds clamping); `ViewportContext.tsx` does no bounds clamping at all |
  | `setZoom` | `context.tsx` centers via `computeZoomTo` against the live canvas element; `ViewportContext.tsx` is a bare `clampZoom` |
  | `setPan` | `context.tsx` clamps against document bounds via `clampCamera`; `ViewportContext.tsx` does no clamping |
  | `smoothZoomTo` | `context.tsx` zooms about the viewport center (`zoomAboutPoint` + `editorScreenToWorld`); `ViewportContext.tsx` animates zoom with pan held fixed — a materially different feel |
  | `smoothPanTo` | default duration 150ms (`context.tsx`) vs 200ms (`ViewportContext.tsx`) |
  | `fitAll` | `context.tsx`: instant, via a dedicated `computeFitAllCamera` helper. `ViewportContext.tsx`: animated, via `revealSelection({fit:true})`, a different code path entirely |
  | `revealSelection` | `context.tsx` reveals one node (`opts.nodeId ?? state.selection[0]`), instantly. `ViewportContext.tsx` reveals the union bounds of the *entire* selection array, always animated — different target, different transition |
  | `canvasDeltaToWorld` | `context.tsx` accounts for `cameraRotation` via `screenDeltaToWorld`/`toCamera`; `ViewportContext.tsx` is a naive `dx/zoom` — wrong whenever the canvas is rotated |
  | `canvasToWorld`/`worldToCanvas` | different viewport-fallback values — likely equivalent in the common case, not verified equivalent in the fallback case |

  This reads as an earlier, independent implementation that was superseded by richer logic added
  directly to `context.tsx` later and never reconciled — not a handful of small drifts. It has
  effectively zero real consumers today (confirmed above), so nothing currently depends on its
  behavior, but "port the richer behavior over" means rewriting most of the file's real logic
  (document-bounds clamping, rotation-aware math, center-anchored zoom, instant-vs-animated
  semantics), and this repo currently has **no way to verify camera/pan/zoom interaction feel**
  — the visual-regression harness built alongside this work (`docs/quality/render-path-verification.md`)
  covers static rendering, not interactive pan/zoom. Attempting a single-pass fix here risks
  shipping a subtly broken camera system in a design app's core interaction — exactly the failure
  mode this whole audit chain exists to catch, not create. **Recommendation: treat Viewport as its
  own dedicated effort, one divergent method at a time, each backed by a real interaction test —
  not a Phase B sub-task to knock out alongside Tool/Selection/Document/Panels.** No commits were
  made against `ViewportContext.tsx` or `context.tsx` for this; the file is unchanged since the
  memoization fix.

## Headline finding: the split is already partially done

**Five sub-context hooks already exist and are exported from `context.tsx`**: `useDocument`,
`useSelection`, `useViewport`, `useMotion`, `usePrototype`. This is not a proposal — it's the
current state of the code, following the `onReady` composition pattern documented in AGENTS.md
("Sub-context `onReady` pattern (Session 44+)"). The strangler-fig plan's Phase A ("keep
`useEditor()` exactly as it is, compose from new sub-contexts internally") already describes
`context.tsx` as it exists today for motion and prototype, and partially for document/selection/
viewport.

**Motion and Prototype are substantially complete** — `state.motion`, `state.prototypeMode`,
`state.prototypeData`, and `state.prototypeRuntime` each have only 1 remaining direct
`useEditor().state.X` consumer, because almost everything already migrated to `useMotion()` /
`usePrototype()`. **Do not re-extract these.** The only remaining work is auditing the 1-2
stragglers per field and migrating them (Phase C in the plan's own terms), not a new Phase B
extraction.

**Document, Selection, and Viewport hooks exist but adoption is incomplete** — the data below
shows real remaining `useEditor().state.X` consumption for `document` (50 files), `selection` (21
files), `zoom`/`pan` (7/6 files) even though dedicated hooks are available for all three. This is
an **adoption gap**, not a missing extraction. Before writing any new sub-context code, first
determine how many of those files are legacy holdouts that should just be migrated to the
existing `useDocument()`/`useSelection()`/`useViewport()` hooks — that may close most of the gap
with zero new context code.

## Setup facts

- `useEditor()` throws if called outside `EditorProvider` (`context.tsx:7735`).
- **93 non-test files** call `useEditor()` — recounted; the plan's "87" has drifted (this
  codebase changes fast; treat any consumer count as a snapshot, re-verify before acting on it).
- `EditorContextValue` has ~385 raw members by line count; **254 distinct fields are actually
  read** by the 93 consumers (destructuring-pattern extraction — a floor, not exact; spread
  patterns like `{...useEditor()}` aren't counted).
- 180 of 254 fields are touched by exactly one consumer file — a long tail of narrow methods that
  don't meaningfully constrain clustering either way.
- **4 informal wrapper hooks already exist** (call `useEditor()` internally, expose a narrower
  slice): `audit/overlay/useFindingsOverlay.ts`, `components/PageNav/usePageThumbnail.ts`,
  `intelligence/adaptiveContrast.ts`, `navigation/useFindingNavigation.ts`. Each is itself an
  informal micro-sub-context and a data point for where real seams already exist.

## Real bug found in passing: two drifted `EditorContextValue` interfaces

`context.tsx:518` defines the real interface `useEditor()` returns (889 lines). A **second,
shorter, independently-maintained `EditorContextValue`** exists at
`packages/editor/src/context/types.ts:288` and has drifted from it. Two files —
`packages/editor/src/navigation/deepLinkHandler.ts` and `packages/editor/src/workspace/useWorkspace.ts`
— import and type-check against the **stale** one from `context/types.ts`, not the real one. This
means TypeScript is not actually verifying these two files' usage against the true context shape;
any field these two files reference could be silently wrong if the two interfaces have diverged on
that field. Not fixed here (out of scope for a surface-mapping pass, and deciding whether to
delete the duplicate or reconcile it is a real design call) — flagged for a dedicated, separate PR.

## Field consumption (`state.X` sub-fields, the real clustering signal)

65 of 93 consumers destructure the whole `state: EditorState` blob rather than individual fields,
so the actual clustering signal is one level deeper — which of `EditorState`'s 63 fields
(`context/types.ts:117-286`) each of those 65 files reads:

| `state.X` | Files | `state.X` | Files |
|---|---|---|---|
| `document` | **50** | `sectionVisibility`, `rulerMode` | 3 each |
| `selection` | **21** | `cameraRotation`, `themeRevision`, `brushSettings`, `isolatedNodeId`, `beforeAfterCompare`, `distractionFreeMode`, `graphEditorVisible`, `snapEnabled`, `softProofEnabled`, `stateMachinePanelVisible`, `timelinePanelVisible`, `activeId`, `cursorPos` | 2 each |
| `tool` | 9 | 26 more fields (panel-visibility flags, prototype/motion/mask-editing session state, per-mode toggles) | 1 each |
| `zoom` | 7 | | |
| `workspaceMode` | 7 | | |
| `pan` | 6 | | |
| `canvasMode`, `currentPageId`, `isPresenting` | 3 each | | |

Top method/derived-state consumption (outside `state`): `announce`/`announceOperation`/
`announceSelection` (20 files — an accessibility live-region announcer), `updateDoc` (20),
`selectedNodes` derived array (18), `commitTransaction` (9), `updateNode` (9),
`beginTransaction` (8), `setSelection` (6), `documentColorMode`/`setTool` (5 each).

## Data-driven clusters (validated against the plan's guessed boundaries)

1. **Document/scene — by far the largest real cluster.** `state.document` (50), `updateDoc` (20),
   `beginTransaction`/`commitTransaction`/`abortTransaction` (8/9/8), `updateNode` (9),
   `rootNodes`, `activePageNodes*`. **Confirms the plan's guess.**

   **History/undo belongs here, not as a separate cluster.** Resolved directly (the mapping fork
   couldn't find undo/redo state and flagged it as needing verification): `undo`/`redo` are
   implemented via `undoStackRef`/`redoStackRef` — plain refs holding `Document[]` snapshots, not
   `EditorState` fields — and are **already re-exposed through `useDocument()`**
   (`context.tsx:7596-7597`, inside the existing `documentValue` memo). The plan asked "extract
   history first if it touches everything, or last if it's cleanly separable" — the actual answer
   is neither: it's already bundled with document and should stay that way, since undo/redo
   operates on whole-`Document` snapshots.

2. **Selection.** `state.selection` (21), `selectedNodes` derived (18), `setSelection` (6),
   `revealSelection` (5), `getWorldBounds` (4). Confirms the plan's guess — **`useSelection()`
   already exists.** The 21 files still reading `state.selection` directly are migration
   candidates, not evidence a new context is needed.

3. **Tool** and **4. Viewport/camera — the plan's guess should be split, not merged.** The plan
   grouped "tools" with "viewport/camera" as one likely boundary. The data doesn't support that:
   `state.tool` (9) / `setTool` (5) consumers and `state.zoom`/`pan`/`cameraRotation` (7/6/2) /
   `setCamera`/`setZoom`/`worldToCanvas` consumers are largely **different file sets**.
   Recommend two separate, smaller sub-contexts instead of one combined one.

5. **Panels/UI state.** `sectionVisibility`, `rulerMode`, `leftPanelVisible`, `rightPanelVisible`,
   `graphEditorVisible`, `timelinePanelVisible`, `stateMachinePanelVisible`,
   `distractionFreeMode`, `setInspectorTab` — a long tail of 1-3-file visibility flags. Confirms
   the plan's guess as real, but low per-field value — extracting this cluster helps tidiness more
   than it reduces coupling for any single consumer.

6. **Motion/Prototype — already done.** See headline finding above. Audit stragglers, don't
   re-extract.

7. **Cross-cutting — resists clustering, needs a different treatment than a domain sub-context.**
   `announce`/`announceOperation`/`announceSelection` (20 files — this is a horizontal service,
   not a domain concern), `platform` (4 files), `updateNode` (9, spans document *and* selection).
   These probably want a small, always-available shared context or plain module-level service
   rather than ownership by any single domain sub-context — forcing them into one cluster would
   just recreate a smaller version of the god-object problem.

## Ce estimates — directional only, not measured

Real Ce requires performing the extraction and re-running this repo's own madge-based Ce/Ca
tooling (`scripts/audit-architecture.mjs`) against the result — these are rough guesses based on
what each cluster's methods currently appear to depend on, offered as a starting point for the
plan's own stated success criterion ("sum of sub-context Ce meaningfully lower than 53, no
sub-context above ~15"), not a substitute for measuring it after the fact:

| Cluster | Rough Ce guess | Basis |
|---|---|---|
| Document/scene (incl. history) | 15-25 | Largest; touches scene ops, undo/redo internals, persistence (`usePersistence`) |
| Selection | 5-10 | Mostly derives from document + geometry helpers |
| Tool | 3-6 | Small, mostly local state |
| Viewport/camera | 5-8 | Camera math + canvas coordinate helpers |
| Panels/UI | 3-5 | Mostly boolean flags, minimal imports |
| Cross-cutting (announce/platform) | 2-4 | Thin, already close to leaf |

Document/scene alone is likely to land near or above the plan's own "~15 max" target — if that
holds after a real extraction, it's a signal this single cluster still needs its own internal
split (e.g. separating persistence/history from live document mutation), not that the clustering
above is wrong.

## What this means for the strangler-fig plan

- **Phase A (facade) is arguably already satisfied for motion/prototype.** Verify it hasn't
  regressed (i.e. that `useEditor()`'s shape and behavior for those fields is unchanged from
  before those hooks existed) rather than re-doing it.
- **Phase B's next real work is Tool and Viewport as two separate extractions**, per the
  data-driven split above, plus **Panels/UI** as a third, lower-value but cheap one. Document/
  scene (with history bundled in) is the biggest lift and should likely be split into sub-clusters
  internally rather than attempted as one PR.
- **Phase C (migration) has a head start**: the adoption-gap files for Document/Selection/Viewport
  are enumerable today (this document's per-cluster file lists, saved with the raw data at
  `/tmp/editor-consumer-matrix.json` and `/tmp/editor-state-subfield-matrix.json` from this
  analysis pass) — migrating those doesn't require any new context code and can start immediately,
  independent of and before the Tool/Viewport/Panels extractions.
- **Cross-cutting fields (`announce`, `platform`, `updateNode`) need a design decision before
  Phase B starts** — none of the plan's guessed boundaries have a home for them, and forcing them
  into document/selection would recreate coupling the split is trying to remove.

Per `docs/quality/test-reality.md`, none of this should proceed to actual extraction yet — 6 of 7
injected representative bugs in this exact code went uncaught by the current test suite. This
document defines *where* to cut; it does not clear *whether* it's safe to cut yet.
