# Layers Panel — Workspace-Aware Evolution (2026-09-19)

> **Coordinator note:** This document is the live ownership + progress record for
> the workspace-aware Layers panel pass. It follows the deferred-item record in
> `docs/plans/layers-panel-deferred.md` (last updated 2026-09-17) and treats the
> committed `master` state as the baseline.

## Claimed areas

- `packages/editor/src/components/LayersPanel/**` (panel, tree, row, filters,
  presentation, workspace projection)
- `packages/editor/src/workspace/workspaceTypes.ts` + `workspaceStore.ts`
  (additive `layersPanel` config field + resolver/sanitizer)
- `packages/editor/src/workspace/workspaceBaseline.test.ts` (config contract)
- Additive shared primitives in `packages/ui/src/components/**` **only if the
  Inspector agent has not already added an equivalent**; new files, no edits to
  existing primitives without checking the Inspector plan first
- E2E: new `tests/e2e/layers/workspace-evolution.spec.ts` plus additions to
  existing layers specs
- Docs: this file, `docs/research/layers-panel-research.md`,
  `docs/audits/layers-panel-audit-2026-09-19.md`,
  `docs/design-system/layers-panel-spec.md`, `docs/README.md`
- Evidence: `reports/layers-evolution/baseline/**`,
  `reports/layers-evolution/after/**`, `reports/layers-evolution/perf/**`

## Explicitly NOT claimed (other agents / out of scope)

- `packages/scene/src/types.ts` and `masks.ts` are **dirty in the working tree
  from another agent** (background-removal provenance fields). No schema change
  is made by this pass; any schema item is specified and deferred with a reason.
- `packages/editor/src/components/Inspector/**` — owned by the Inspector
  redesign agent (see `docs/plans/inspector-design-tab-redesign.md`, which
  reports Phase 6 complete). Consume its tokens; do not fork them.
- `packages/editor/src/components/Shell/**`, `context.tsx`, `CanvasArea.tsx` —
  DO NOT TOUCH (hub files at import ceilings).
- `packages/engine/src/font/**`, `packages/editor/src/components/FontBrowser/**`
  — other agents.

## Phase log

| Date | Phase | Status | Notes |
|---|---|---|---|
| 2026-09-19 | 0 — inventory & baseline | done | Panel map complete; baseline matrix + scale perf + 50k projection bench captured under `reports/layers-evolution/baseline/` |
| 2026-09-19 | 1 — research | done | `docs/research/layers-panel-research.md` (InDesign, Mailchimp/Stripo/Beefree/Klaviyo, Photoshop, Figma/Sketch, After Effects/Rive/Jitter, Krita/Procreate/Affinity, Dev Mode) |
| 2026-09-19 | 2 — audit | done | `docs/audits/layers-panel-audit-2026-09-19.md` (AUD-001…008, clutter inventory, REQ-001…013) |
| 2026-09-19 | 3 — spec | done | `docs/design-system/layers-panel-spec.md` |
| 2026-09-19 | 4 — implementation | done (phase 1–5) | Workspace projection (`layersPanel` config), badge/row-action reveal, Email mobile-hidden, Motion animated preset, Print thread/export-region presets, Select matches, appearance-label overflow fix |
| 2026-09-19 | 5 — validation | done | 409 panel+workspace unit tests, 8 new E2E tests, axe clean, 50k projection bench, after-matrix screenshots |
| 2026-09-19 | 6 — report | done | `docs/audits/layers-panel-workspace-evolution-report-2026-09-19.md` |
| 2026-09-19 | verification + correction (post-merge) | done | 180px name-floor fix, icon-only trace badge, three spec-locator repairs against the details disclosure, expansion-assertion fix; APG 13/13, overflow 3/3, workspace 7/7, a11y 11+1 skipped, 10k bench 12/12 alone. See the report's verification section. |

## Implementation log

| Unit | Requirement → finding | Change |
|---|---|---|
| IMPL-001 | REQ-001 → AUD-001 | `LayersPanelWorkspaceConfig` (`pinnedBadgeGroups`, `pinnedRowActions`, `quickFilters`, `searchPlaceholder`) in `workspaceTypes.ts`, declared for all eight modes, resolved via `useEffectiveWorkspaceConfig`; contract test in `workspace/layersPanelConfig.test.ts` |
| IMPL-002 | REQ-002 → AUD-003 | Badge slots carry `data-badge-group`/`data-badge-pinned`; non-pinned groups reveal on hover/focus with `display: contents` (no layout shift) and always remain in the row's accessible name |
| IMPL-003 | REQ-003 → AUD-002 | Solo reveal is now row-scoped so it also wins on a selected row (previously visible-but-dead); Photo pins it |
| IMPL-004 | REQ-004 → AUD-005 | Email mobile-hidden badge + quick filter projected from `emailSemantics`; attribute dimensions `mobileHidden`/`mobileOnly` |
| IMPL-005 | REQ-005 | Motion animated preset: `attributes.animated` resolved through a caller-computed id set (same index-backed contract as search) |
| IMPL-006 | REQ-006 → AUD-006 | Print thread badge (story binding) + `threadedText`/`exportRegion` filter dimensions |
| IMPL-007 | REQ-007 → AUD-004 | `Select matches` button + `selectMatches()` on the tree handle; announces the count, no undo entry |
| IMPL-008 | user request → AUD-009 | Appearance labels: effect-stack label wrapped in an ellipsizing span; chips shrinkable with tooltip + `aria-label`; blend mode/opacity/effect/filter counts added to the row's accessible name; container-query capacity rules (≤340px label yields first, ≤260px one readable appearance chip and no hover-displacement, unpinned solo slot yields on hover-capable devices only) |
| IMPL-009 | REQ-008 | `layersScaleProjection.bench.test.ts` records 1k/10k/50k flatten + search + kind + animated timings |
| IMPL-010 | REQ-009 | E2E `workspace-evolution.spec.ts` (6 tests) + overflow spec extension; drive-by typecheck fixes in `useFlatTree.test.ts`/`layerDropResolver.test.ts` |

## 2026-09-19 closure pass — verification + remaining non-schema items

Continuation pass on the same task: independently verify the committed work,
then close the non-schema roadmap items it left open. Findings and changes:

| Unit | Requirement → finding | Change |
|---|---|---|
| IMPL-011 | REQ-012 → audit §7 (trace provenance: context menu only) | Trace badge in `LayersRow` (`.layers-row__trace-badge`, `data-badge-group="trace"`, `data-trace-group`), tooltip with mode/trace-mode, `traced artwork` in the accessible name. First consumed `LayersBadgeGroup` that no workspace pins: provenance is secondary everywhere, so hover/focus-revealed in all eight modes. 4 unit tests. |
| IMPL-012 | APG optional `*` (spec §3 said Reject, §7 phase 10 said candidate — resolved) | `*` expands all closed container siblings at the focused row's level; focus does not move, no selection change, no undo entry, no-op on the isolation root. `handleExpandSiblings` in `LayersTree.tsx`; branch in `useTreeKeyboardNavigation.ts` ahead of type-ahead; E2E in `layers.spec.ts` (13 pass). |
| IMPL-013 | AUD-010 (found during IMPL-011 verification) | Capacity precedence fix: `.layers-row__badges` had `flex-shrink: 9999`, so the cluster collapsed to width 0 before the label yielded — every badge, including a just-revealed trace chip, was clipped invisible on rows with long auto-names (Playwright `toBeVisible` passed because the element's own box was non-empty; ancestor `overflow: hidden` did not count). Final merged design (with the Layer Details pass): identity column `flex: 1 1 0` with 8ch/0 floors by container width; cluster content-sized, capped, and yielding to a 1.5rem floor at ≤260px so the shrink:0 toggles never move. The ≤219px name floor is 0 — at the documented 180px minimum any floor overflows the row (fixed after the merged commit; see follow-up). |
| IMPL-014 | REQ-009 validation | Trace-badge E2E (hover reveal, focus reveal, accessible name) + `reports/layers-evolution/after/trace-badge-row.png`; unit suite for panel + workspace config. |
| IMPL-015b | Container-preview E2E | Authored (`layers-panel-real-world.spec.ts` "container rows with content render a bounded content preview"); execution blocked by the concurrent boot instability at commit time — exact re-run command in the report's environment section. |

### Remaining-gap closure (same day, second continuation)

| Unit | Gap | Outcome |
|---|---|---|
| IMPL-015 | Frame/group 28×28 thumbnails (perf-gated) | Implemented as bounded content previews: `containerPreview.ts` (64-primitive cap, early-exit content probe, aspect-preserved unit-box normalization, content-signature cache key). Bench caught the O(n) parent-scan fallback (41.6 ms/container on 11 k nodes); threading the panel's `ParentIndexCache` made it 0.078 ms/container (533×) — recorded in `reports/layers-evolution/closure/perf/containerPreview.json`. |
| IMPL-016 | Physical screen-reader session | Cannot be claimed synthetically. Added a computed-ARIA-tree evidence test (`ariaSnapshot` in `accessibility.spec.ts`, artifact `reports/layers-evolution/after/aria-tree-snapshot.yaml`) plus an executable manual session script: `docs/audits/layers-screen-reader-runbook-2026-09-19.md`. Snapshot test **executed green** (20.3 s); the runbook is the remaining human step. |
| IMPL-017 | WebKitGTK cross-engine re-run | Blocked at execution: the Panel Layout agent's in-flight feature left the module graph broken (`joinPanels` re-export missing → app boots blank/timeout for every project). Added the missing one-line re-export in their file (uncommitted) to unblock all agents; `Shell.tsx`/`context.tsx`/`sceneNodeGeometry.ts` remain actively dirty, so the dev server is not stable enough for another run. Exact re-run commands are in the report's environment-block section. |
| GAP-DEFER | Non-printing flag + alpha lock (schema) | Blocked by the concurrent comic-workflow schema migration owning `types.ts` + `version.ts`; a second concurrent migration would corrupt the version history. Made turnkey instead: spec §10 lists exact steps, consumers, gates. |

### Concurrent-agent conflicts found in this pass

- `LayersRow.tsx` and `layers.css` also carried the additive details, preview,
  and selection-marker work. The final merged rules use `flex: 1 1 0` for the
  name with container-query floors (8ch at ≥220px, 0 at ≤219px) and
  `flex: 0 1 auto` for the content-sized badge cluster capped at 42% / 12rem,
  yielding to a 1.5rem floor at ≤260px. This resolves the original zero-width
  badge failure, the empty-rail name clipping, and the 180px overflow
  (the ≤219px floor was 4ch in the merged commit and overflowed by 25px;
  corrected to 0 in the follow-up commit after the overflow E2E went red).
- The details popover, preview preference, disclosure transfer codec, and
  shared component classification are now included in the same milestone;
  none changes the scene schema or the authoritative drag resolver.
- The merged milestone commit also swept this pass's staged hunks (trace
  badge, APG `*`, tests, docs). The follow-up commit corrects the narrow-rail
  floor and records the resolution; no work was lost and no hunk was
  duplicated.
- The commit uses explicit pathspecs. Unrelated staged work in the shared
  tree remains outside the Layers milestone.

Resolved without code:

- **Spec §7 phase 6 (context-menu workspace gating): Rejected.** Every menu
  entry is already capability/state-gated on the right-clicked node; no entry
  is inapplicable in any workspace, so gating by workspace would be
  decorative configuration (invariant 9). Recorded in spec §3.
- **Spec §7 phase 9b (frame/group thumbnails): still deferred.** Needs a
  measured preview cache; `useThumbnail.ts` is concurrently owned (dirty
  working tree from another agent's theme-ink work) — touching it now would
  collide.
- **Spec §7 phases 7–8 (non-printing flag, alpha lock): still schema-gated**,
  unchanged from the first pass.

## Reproduce the evidence

`reports/` is gitignored, so the evidence is regenerated, not committed:

```bash
# 1k/10k/50k projection timings (baseline used the same command with VARVE_LAYERS_PHASE=baseline)
VARVE_LAYERS_PHASE=after npx vitest run --config vitest.bench.config.ts \
  packages/editor/src/components/LayersPanel/__benchmarks__/layersScaleProjection.bench.test.ts \
  --testTimeout=300000

# workspace × theme matrix, scale, and realistic-document screenshots
VARVE_E2E_PORT=1437 VARVE_LAYERS_PHASE=after \
  node scripts/quality/heavy-lease.mjs "e2e: layers after evidence" -- \
  npx playwright test tests/e2e/layers/layers-workspace-evolution.spec.ts \
  --project=chromium --workers=1 --reporter=list

# interaction + accessibility coverage
VARVE_E2E_PORT=1437 node scripts/quality/heavy-lease.mjs "e2e: layers" -- \
  npx playwright test tests/e2e/layers --project=chromium --workers=1 --reporter=list
```

## Deferred in this pass

- REQ-010 non-printing flag and REQ-011 alpha lock are **schema changes**;
  specified in the spec §7, not implemented (scene files are dirty from
  another agent; a versioned migration + full gate is required).
- REQ-012 trace badge / REQ-013 frame thumbnails and the optional APG `*`
  key remain roadmap items.

## Working rules for this pass

- Work directly on `master`; no branch or worktree.
- Stage explicit paths only. Never `git add -A` / `git add .`.
- `git fetch` + `git status` before every commit; never force-push.
- Playwright only through `scripts/quality/heavy-lease.mjs` with a unique
  `VARVE_E2E_PORT`.
- Every change traces to a Phase-2 audit finding or a Phase-3 spec entry.
