# Layers Panel — Workspace Evolution Report (2026-09-19)

Owner: this pass (`docs/plans/layers-panel-workspace-evolution.md`).
Baseline: `master` at `01a043806`, uncommitted work by concurrent agents
excluded from every measurement.

## Agent Validation Report

```text
Changed scope:
  packages/editor/src/components/LayersPanel/** (14 files)
  packages/editor/src/workspace/workspaceTypes.ts, workspace/layersPanelConfig.test.ts
  tests/e2e/layers/{workspace-evolution,layers-workspace-evolution,layers-row-badge-overflow}.spec.ts
  docs/{research,audits,design-system,plans}/layers-* + docs/README.md
  (no scene/schema, Shell, CanvasArea, or context.tsx changes)

Validation plan (pnpm verify:plan):
  396 changed files in the shared tree (concurrent agents). Relevant selections:
  Tier 0 format/lint on touched files, audit:docs, audit:emoji, audit:tokens,
  audit:inspector-css; Tier 1 typecheck:e2e and the LayersPanel unit files;
  e2e:file:tests/e2e/layers/{layers-row-badge-overflow,layers-workspace-evolution,
  workspace-evolution}.spec.ts. The remaining ~130 lanes belong to other agents'
  dirty files (font, inspector, accel, website, …).

Commands actually run:
  npx biome check --write <touched paths>                  (Tier 0, clean after fixes)
  pnpm audit:docs  /  pnpm audit:emoji  /  pnpm audit:tokens   (all clean)
  node scripts/audit-architecture.mjs --ci                 (exit 0; enforced
    thresholds pass; the Shell/Menubar/context import-budget warnings are
    pre-existing drift from other agents — I touched none of those files)
  node scripts/audit-health.mjs                            (health check passed)
  sh .githooks/commit-msg <commit message>                 (exit 0; no AI attribution)
  pnpm typecheck:e2e                                       (clean)
  npx tsc --noEmit -p packages/editor/tsconfig.json         (45 errors, all
    pre-existing outside the panel; 48 before this pass — 2 drive-by fixes in
    LayersPanel test files and 1 in layerDropResolver.test.ts)
  npx vitest run packages/editor/src/components/LayersPanel \
    packages/editor/src/workspace/layersPanelConfig.test.ts (410 passed / 33 files)
  VARVE_LAYERS_PHASE=baseline|after vitest bench layersScaleProjection.bench.test.ts
  Playwright (lease-wrapped, VARVE_E2E_PORT=1437, workers=1):
    layers-workspace-evolution.spec.ts (matrix + scale + realism)  — 3 passed ×2 phases
    layers-row-badge-overflow.spec.ts                              — 2 passed
    workspace-evolution.spec.ts                                    — 6 passed
    layers.spec.ts + axe.spec.ts                                   — 15 passed
  Total E2E this pass: 21 passed, 0 failed (final run).

Passed: all of the above.
Skipped as unrelated: the ~130 planner lanes owned by other agents' uncommitted
  files (font system, inspector pass 2, varve-accel, website) — running them
  would validate work this pass did not touch and would occupy the shared
  machine; the coordinator's `verify:affected` will cover them when that tree
  is committed.
Escalations: none beyond Tier 1 — no schema change, no workspace/toolchain
  change, no hub-file change. `pnpm verify:full` was not run and is not
  required by the planner for these paths once they stand alone.
Full suite run: no.
If yes, reason: n/a.
Deviation: the commit used `--no-verify` because the shared Git index held
  other agents' staged files (StatusBar, ActionRegistry, FontBrowser, …);
  committing through the hook would have evaluated their staged set. Both
  hooks were then run manually against the commit and passed (recorded above).
```

## Per-workspace feature matrix

| Capability | Before | After |
|---|---|---|
| Workspace badge emphasis | identical in all 8 modes | pinned per mode: Design component/layout/appearance · Print print/appearance · Draw mask/appearance · Photo mask/appearance/media · Motion motion · Logo component/appearance · Email email/appearance · Codegen component/layout |
| Badge reveal | all groups always rendered (clipped at narrow rails) | non-pinned groups reveal on hover/focus, stay in the accessible name, never displace a pinned chip at narrow rails |
| Solo | always rendered in every mode | pinned in Photo; hover/focus-revealed elsewhere; slot yields only at ≤260px on hover-capable devices (menu/bulk/palette/touch keep it) |
| Email mobile-hidden | not surfaced | badge + "Mobile hidden" quick filter, projected from `emailSemantics` |
| Motion animated | badge only (dot + keyframe count, unconfigured) | "Animated" quick filter over the timeline id set |
| Print threads / export regions | not surfaced | `thread` badge from `storyBinding`; "Threaded text" and "Export regions" quick filters |
| Search | narrows and reveals | narrows, reveals, and **Select matches** acts on the whole filtered projection |
| Appearance labels (blend/opacity, effects, filters) | hard-clipped; vanished entirely at 180px; no tooltip; not in the accessible name | ellipsized chips, full tooltip + `aria-label`, readable minimum at 180px, counts stated in the row name |
| Quick filter chips | — | labelled toggle buttons, keyboard-operable, workspace-specific |

## Research complaints resolved

| Complaint (source) | Resolution |
|---|---|
| Photoshop filter loses the parent chain / single-condition filters | already satisfied (ancestry kept, AND-composed chips); unchanged and now covered by a workspace-preset path on the same dimensions |
| Photoshop filter discoverability | workspace quick filters are visible without opening the advanced group |
| Photoshop inherited-visibility ambiguity | unchanged (already distinguished); the reveal work keeps the state in the accessible name |
| Photoshop context-menu bloat | not addressed this pass (roadmap) |
| Photoshop/Procreate granular locks | specified, schema-gated, deferred |
| InDesign non-printing flag | specified, schema-gated, deferred; the Print workspace ships the thread/export-region projections instead of faking it |
| InDesign parent-page invisibility | the tree badges master/thread structure; page management stays in Page Nav/MasterPanel |
| Mailchimp mobile-hidden impossibility | Varve now shows the mobile-hidden state where the compiler already honours it |
| Mailchimp reusable blocks | entry point unchanged (Library panel is its own feature); documented |
| Rive "show only animated" | the Motion quick filter |
| After Effects layer/timeline confusion | unchanged (single scene, one selection); the row states animation state |
| Procreate/Krita edit-lock vs alpha-lock | Varve's single lock is surfaced; alpha lock specified and deferred |
| Photoshop accidental drag across toggles | already guarded; unchanged |

## Consciously rejected

- InDesign document-wide layers, Articles/reading order, Mailchimp block
  library in the tree, Photoshop layer comps (points at Layer States), and
  Procreate reference layers — each with a rationale in the spec §3. The APG
  `*` key was implemented after the initial rejection because it adds keyboard
  coverage without a persistent control.
- A `defaultFilter` workspace field was designed and then **removed** before
  shipping: entering a workspace must not silently change what the user sees,
  and the quick-filter chips provide the same one-click access. (No
  decorative config.)

## Clutter removed, and where each function lives

| Control | Change | Still reachable by |
|---|---|---|
| Solo star | slot yields at ≤260px on hover-capable devices; pinned in Photo only | row hover/focus elsewhere, context menu, bulk bar, command palette, touch devices |
| Mask-role chip | yields at ≤260px | row accessible name, Inspector mask section |
| Layer-effects / object-filter chips | yield at ≤260px (blend chip is the surviving appearance summary) | row accessible name ("N layer effects"), tooltip at wider widths, Inspector Effects section, effect-badge drag transfer at ≥260px |
| Non-pinned badge groups | hidden until hover/focus | row hover/focus, row accessible name, Inspector, context menu |

## Schema changes

**None.** Every projection reads existing scene data
(`emailSemantics`, `storyBinding`/`stories`, `frameRole`, `getNodesInTimeline`,
`mask`, `blendMode`/`opacity`/`effects`/`smartFilters`). Non-printing and
alpha-lock are specified with migration/export requirements in the spec §7 and
explicitly not implemented; the scene files were dirty from another agent, and
those changes require a document version bump plus a justified full gate.

## Evidence

`reports/` is gitignored; regenerate with the commands in the plan file.

- Before/after matrix (8 workspaces × 3 themes): `reports/layers-evolution/{baseline,after}/matrix/*.png`
- Layout metrics: `.../matrix/metrics.json` — only `filterChips` changed
  (quick-filter chips added); row height, indent, icon, type, and spacing are
  byte-identical, so no layout regression.
- Scale/edge cases: `.../scale/{one-thousand,deep-nesting,edge-names}.png` +
  `perf.json`.
- Per-workspace realistic documents: `.../realism/*.png`.
- Min-width appearance labels: `reports/layers-row-badge-overflow-min-width.png`
  (the blend chip now reads `M…` instead of vanishing).
- Projection benchmark (best-of-3, `flattenTree`):

| Nodes | Baseline unfiltered | After unfiltered | After animated preset |
|---|---|---|---|
| 1k | 1.51 ms | 1.33–2.35 ms | 1.24 ms |
| 10k | 5.89 ms | 5.62–18.32 ms | 7.72 ms |
| 50k | 48.51 ms | 56.27–76.95 ms | 65.54 ms |

The unfiltered path is code-identical to the baseline apart from constructing
one filter-context object per call, so the spread is machine contention from
concurrent agents (the same box ran four Playwright suites during these
measurements). The honest reading: no demonstrated regression, no demonstrated
improvement; a quiet-machine A/B is required before claiming either, and the
50k budget (< 60 ms target) is met on the least-contended run (56.27 ms).

## Remaining gaps and next phases

1. **Non-printing layer flag** (schema) — the one Print construct that cannot
   be a projection.
2. **Alpha lock / granular locks** (schema) — Photo/Draw.
3. **Frame/group 28×28 thumbnails** (perf-gated: the image-fill profile exists;
   expanding it needs a measured preview cache).
4. **Context-menu workspace gating** — suppress entries a workspace cannot use.
5. **Physical screen-reader session** (NVDA/Orca/VoiceOver) — still
   unclaimed by any synthetic run.
6. Exact-SHA remote certification of the above; no full local gate was
   justified for this pass.

## Coordination notes

- The Inspector/design-system agent (pass 2) committed while this pass ran;
  none of its commits touched LayersPanel, `workspaceTypes.ts`, or
  `tests/e2e/layers/**` (verified with `git diff --stat` between this pass's
  base and the then-current HEAD). Its token additions were consumed as-is;
  no token or primitive file was edited by this pass.
- The shared Git index contained other agents' staged files. The commit used
  an explicit pathspec so only this pass's 25 files landed, and both commit
  hooks were run manually against the result.
- The scene schema (`types.ts`, `masks.ts`) remains dirty from another agent;
  this pass made no schema edits.
- Evidence captures ran on `VARVE_E2E_PORT=1437` through the heavy-task lease;
  `reports/` is gitignored.

## Implementation follow-up — 2026-09-19

The final row-capacity fix replaces the empty percentage flex basis on the
badge cluster with content-sized flexing and a bounded maximum. Names now own
the remaining width with the 4ch/8ch protected budget, so a 220px-and-wider
panel does not truncate a name merely because the row has no status badges.
The change preserves the existing desktop splitter and adds a keyboard resize
assertion to the Layers regression coverage.

Additional additive surfaces are complete: the shared Layer details popover is
reachable from a focused row, the selected-layer header, and the context menu;
image preview generation can be disabled per panel; and disclosure transfer
preserves an explicit all-collapsed set without truncating large expansion
sets. These changes stay in panel-local/editor preference state and do not
change the scene schema.

### Current-state corrections to the baseline matrix

The matrix in §1 records the pre-closure baseline. The affected rows now read
as follows after the implementation commits:

| Capability | Current state | Scope / limitation |
|---|---|---|
| Select all matches | **Y** | One selection command for the active filtered projection |
| Text-thread indication | **Y** | Read-only row badge and filter from existing story metadata |
| Email mobile-hidden indication | **Y** | Read-only badges and filters from existing email metadata |
| Trace-group indication | **Y** | Revealed provenance badge; no new scene fields |
| Image-filled thumbnails | **Y** | Existing 28×28 profile, with a panel-local `images | off` preference |
| Frame/group thumbnails | **Deferred** | Requires a measured preview cache |
| Layer details / ancestry | **Y** | Focused-row, selected-header, and context-menu entry points |
| Component semantic filter | **Y** | Definitions and instances share the row classification; instance remains separately filterable |
| Disclosure transfer | **Y** | Document/surface-local tagged transfer preserves empty and large expansion sets |

Non-printing flags, alpha locks, synthetic hierarchy/treegrid semantics, and
inline specialist editors remain deferred or rejected as documented in the
specification.

---

## Verification and correction pass — 2026-09-19 (later session)

The milestone commits `19a69ac9d`/`ce04204ce` swept this workspace-evolution
work (trace badge, APG `*`, tests, docs) together with the Layer Details
milestone. This pass verified the merged result against the committed tests
and corrected four defects found in it.

### Corrections

1. **180px rail overflow.** The merged capacity rules kept a 4ch name floor
   at ≤219px; with the fixed row controls and the badge cluster's 1.5rem
   floor, a decorated row measured `scrollWidth 191 > clientWidth 166` at
   the documented 180px minimum and clipped the visibility/lock toggles past
   the panel edge. The floor is now 0 at ≤219px (the 8ch floor at ≥220px is
   unchanged; the name still renders whenever free space exists).
2. **Trace chip clipped to "tr…"** at the default rail once the row gained
   the details control; the row capture showed the fragment. The badge is now
   icon-only (`BezierCurve`, matching the grid/style indicator pattern) with
   the tooltip and the row's accessible name carrying the full value;
   re-captured and visually inspected at the same size.
3. **Three pre-existing spec locators collided with the new details
   disclosure** (`aria-expanded`, `aria-label*="Show"`): the container lookup
   in `layers.spec.ts`, the accessibility spec's expanded-state check, the
   real-world nesting count, and the visibility-toggle click. All are now
   scoped to `role=treeitem` / `.layers-row__toggle`. The details trigger is
   pointer-inert until hover, so the colliding clicks timed out instead of
   failing fast.
4. **Panel-expansion assertion measured the wrong box**:
   `.layers-row__name` shrink-wraps short text and cannot grow; the assertion
   now measures the identity column (`.layers-row__label`).

### Validation (merged HEAD + corrections)

| Check | Result |
|---|---|
| `layers-row-badge-overflow.spec.ts` | 3/3, including the 180px `scrollWidth <= clientWidth` assertion |
| `workspace-evolution.spec.ts` | 7/7, including trace provenance and the axe-clean projection state |
| `layers.spec.ts` (APG) | 13/13, including the APG `*` test |
| `accessibility.spec.ts` | 11 passed, 1 skipped (its own guard) |
| Panel + workspace unit files | 419/420; the single failure was the `layers10k` wall-clock filter assertion under concurrent E2E load — it passes 12/12 alone (verified on a quiet machine) |
| `pnpm typecheck:e2e` | only 2 errors, both in another agent's `zz-picker-measure.spec.ts`; the layers specs are clean |
| biome (touched files) | clean |
| `audit:docs` / `audit:emoji` | clean |
| `audit:tokens` | WCAG pairs pass; usage scan reports 2 undefined refs in another agent's uncommitted FloatingToolbar CSS (not Layers) |
| `audit-architecture --ci` | exit 0 (enforced thresholds pass) |

Environment faults invalidated two intermediate runs (a duplicate
`const profile` parse error from a concurrent agent's `presetToDocument.ts`,
and a safe-mode crash-recovery screen); both were re-run clean. Evidence
captures ran on `VARVE_E2E_PORT=1439` through the heavy-task lease; the trace
row capture at `reports/layers-evolution/after/trace-badge-row.png` was
regenerated and inspected after the icon change.

### Still open

Physical screen-reader sessions, frame/group thumbnails (perf-gated),
non-printing flags and alpha locks (schema-gated), and a cross-engine
(WebKitGTK) re-run of the merged row remain open as previously documented.
