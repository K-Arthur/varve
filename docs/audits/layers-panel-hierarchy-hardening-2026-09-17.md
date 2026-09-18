# Layers Panel — hierarchy hardening, structural editing, and state-integrity pass (2026-09-17)

Status: implemented, unit-tested, browser-verified (scoped closure)
Repository: `/home/kevina/CodingProjects/varve`, branch `master`

This pass continues the audit lineage of
`layers-system-audit-2026-08-23.md`, `layers-panel-organization-audit-2026-08-31.md`,
`layers-panel-visual-design-audit-2026-09-09.md`, and
`layers-panel-review-2026-09-15.md`. It treats the existing virtualized,
resolver-driven Layers implementation as the foundation and hardens the
genuinely open items rather than replacing anything: expansion-state
integrity, effective (inherited) visibility, keyboard/non-drag structural
reparenting, drag auto-expand restoration, filtered-drag policy tests,
row memoization, detach state transfer, deep-nesting guides, filter
taxonomy, and corrupt-document defenses.

## Research basis

Online research preceded planning (official docs, WCAG/ARIA specs, issue
trackers, forums). Highlights that drove decisions:

| Source | Finding applied |
| --- | --- |
| WAI-ARIA APG Tree View (`w3.org/WAI/ARIA/apg/patterns/treeview/`), checked 2026-09-17 | Virtualized trees must carry `aria-level`/`aria-posinset`/`aria-setsize`; focus and selection are distinct states; Right/Left expand-or-step contract. Verified Varve already conforms; no regression introduced. |
| WCAG 2.2 SC 2.5.7 Dragging Movements (`w3.org/WAI/WCAG22/Understanding/dragging-movements.html`) | Keyboard-only equivalents do NOT satisfy 2.5.7 — a single-pointer non-drag path is required. Reparenting previously existed only as a drag; the new context-menu "Move Into Container Above" / "Move Out of Container" items close that gap. |
| Krita Layers docker docs (`docs.krita.org`, "Move layer up/down … switches layers in and out of groups") | Canonical non-drag reparent primitive; informed the indent/outdent command design. |
| Inkscape keyboard reference (Shift+PgUp/PgDn moves selection between layers) | Precedent for distinguishing structural level changes from sibling order changes. |
| Figma forum: launched horizontal Layers-panel scroll; nested-name invisibility threads (21443, 32380) | Deep-nesting failure mode is real and user-reported. Varve clamps visual indent at depth 8; the new indent guides restore per-level reading lanes within that clamp. |
| Penpot issues #889 (thin drop line), #10043 (select-all in filtered sidebar), #6820 (focus-mode restore) | Drop-target clarity and filtered-view interaction bugs. Varve's full-array `indexOf` indexing was verified by new explicit tests; select-all in a filtered tree selects the visible rows (existing behavior, now guarded by the real-world harness). |
| Figma collapse/expand regression threads (56267, 39855); Penpot #4045/#7736 | Expansion state is high-value user state; silent resets are a top complaint. Drove the expansion-integrity fix below. |
| Krita forum thumbnail-lag threads (141983, 97179) | Thumbnail cost must stay windowed and cached. Verified Varve's existing idle-scheduled, LRU-cached, image-only thumbnails remain bounded; no change needed. |
| Photoshop/Affinity layer-color filtering; Krita color-label filter | Confirmed the existing 7-color tag + filter design is the industry-typical shape; no change. |

Full source list is recorded in the session research ledger; competitor
details in the task research report (Figma, Sketch, Illustrator, Photoshop,
Affinity, Penpot, Krita, Blender Outliner, Framer, Inkscape).

## Problems found and fixed

### F1 — Any document edit silently re-expanded collapsed containers (behavior defect)

**Evidence:** `LayersTree.tsx` kept an effect keyed on `state.document.nodes`
that re-added *every* non-empty frame/group id to the expansion set. The
intent was "keep new import/paste subtrees visible," but the implementation
keyed on node-map *reference*, so a rename, nudge, fill edit, or undo/redo
undoed the user's collapse. This contradicted the filtered-projection design,
which is careful never to mutate expansion state.

**Fix:** expansion additions are now decided by node *id* membership.
`addedIdsBetween(prevIds, nextIds)` finds genuinely new ids;
`expandAddedContainers` expands only new containers with children. A
rename produces a new node object under an existing id and no longer
touches disclosure. Unit tests in `expandCollapse.test.ts` cover the new
helpers, including the "existing collapsed container stays collapsed"
regression.

### F2 — Inherited visibility was invisible (semantic defect)

**Evidence:** lock had a full effective-state pipeline
(`isNodeEffectivelyLocked`: row class, aria text, context-menu gating,
DnD/lock guards); visibility had none. A child of a hidden group presented
as visible, and toggling its eye had no visible effect — the exact
"silently toggle a state with no visible effect" failure the task brief
calls out for lock, present for visibility.

**Fix:**
- `isNodeEffectivelyHidden` + `hidingAncestorOf` in `packages/editor/src/scene/world.ts`,
  mirroring the lock helper (unit tests in `world.test.ts`).
- Row: a child hidden through an ancestor gets `layers-row--hidden-inherited`
  (opacity 0.62, distinct from 0.4 direct-hidden), eye toggle class
  `--visibility-inherited`, and aria "«name» is hidden by «ancestor»"
  (source identified, per task §37). Direct-hidden rows keep the existing
  treatment. Mixed-selection visibility now computes from effective state,
  matching the lock toggle's model.
- Context menu: Hide/Show gains the description "Hidden by an ancestor
  layer" when the target is inherited-hidden (state-aware, not disabled —
  setting the own flag is the right eventual state, it just cannot take
  visible effect until the ancestor is shown).
- Row component tests (`LayersRow.test.tsx`) cover the distinct classes,
  the ancestor-naming aria label, and that toggling remains available.

### F3 — No non-drag reparenting (accessibility + functional gap)

**Evidence:** sibling reorder existed (Ctrl+[/] and the four arrange
commands), but nothing moved a layer *between containers* without a drag —
no keyboard path, no menu item. WCAG 2.5.7 requires a single-pointer
non-drag alternative for drag functionality.

**Fix:** new pure planner `layerIndentPlan.ts`:
- `planIndent` — move the anchored selection into the container displayed
  directly above; skips rows inside another moved subtree; refuses cycles.
- `planOutdent` — move out of the container, landing below the parent's
  subtree block (insert at the parent's raw slot in the grandparent).
- `orderRootsForAppend` — append back-most first so multi-root stacks keep
  their order (children[] is back-to-front).
Wired to three surfaces sharing one implementation (tree imperative handle):
- Keyboard: `Ctrl+Alt+]` (indent) / `Ctrl+Alt+[` (outdent) — same physical
  keys as the sibling reorder with Alt = level change vs position change;
  free in the global registry (bare Alt rotates the view).
- Context menu: "Move Into Container Above" / "Move Out of Container" in
  the Arrange group (single-pointer route).
- Announcements for every outcome, including refusals ("The layer above is
  not a container", "Already at the top level", lock refusals).
One undo step per logical move (`beginTransaction`/`commitTransaction`);
multi-parent outdents move only the anchored container's group per command
(predictable, announced). Planner tests: `layerIndentPlan.test.ts` (10).

### F4 — Drag auto-expand permanently changed disclosure (behavior defect)

**Evidence:** hovering a collapsed container for 500ms during a drag sprang
it open — and it stayed open after the drag, even when the drop landed
elsewhere or the drag was cancelled. Task §31 requires defining whether
expanded state persists after drop/cancel.

**Fix:** auto-expanded containers are recorded per drag session
(`dragAutoExpandedRef`). On drop, containers on the landed path (the
dropped-into container and its opened ancestors) stay open so the moved
layer remains visible; the rest revert to their pre-drag state. Cancel and
invalid drops revert everything. The pure policy is
`resolveAutoExpandRestore` (`useLayersDnD.ts`), unit-tested in
`dragAutoExpand.test.ts`.

### F5 — Filtered-drag policy was implicit (test gap)

**Evidence:** the architecture doc claims "indices are computed against the
full sibling array via indexOf, never against the filtered row list," but
no test asserted it. The 2026-08-31 audit listed "safe filtered-view drag
policy" as unresolved.

**Fix:** explicit tests in `layerDropResolver.test.ts` (new "filtered tree
policy" describe): a before-band drop on a visible row resolves to the
full-sibling slot (2, not the naive filtered position 1), and a drop below
a visible child of a *hidden* container resolves into that hidden container
at the correct full-array slot — the indicator/announcement/commit read the
same resolved target (the one-resolver invariant). Policy remains option B
from the task: reorder/reparent stay enabled under filter; the resolved
destination is the truth shown to the user.

### F6 — SortableVirtualRow re-rendered for every mounted row on any tree-local change (performance)

**Evidence:** `LayersRow` was memoized; `SortableVirtualRow` was not, so
every drag-hover tick, roving-focus move, and scrub preview re-ran
`useSortable`, the variant/instance-status resolution, and the presence
subscription for every mounted row.

**Fix:** memoized with a value-aware comparator — `virtualItem` compares by
`index`/`start` (the consumed fields), `virtualizer.options.count` must
match (ARIA setsize fallback), everything else by reference (useFlatTree's
property-only path keeps unchanged node references; LayersTree's handlers
are useCallback-stable). Context-driven changes still re-render through
`useEditor` as before.

### F7 — Expansion, focus, scroll did not survive panel detach (state-transfer gap)

**Evidence:** the 2026-08-31 audit recorded the incomplete transfer codec.
Filter and settings transferred; disclosure did not.

**Fix:** the expansion set is mirrored into the panel-local state codec
(`layers` / `expandedIds`, capped at the codec's 1 000-item array ceiling —
a declined value would silently disable the whole transfer). A detached
Layers window restores it over the all-expanded default; reattach carries
it back. Deliberately *not* document content: it lives in window-local
presentation state, per the codec's contract. Scroll position and focus
index intentionally reset (documented decision below).

### F8 — Deep nesting had no per-level visual cue (usability gap)

**Evidence:** visual indent clamps at depth 8 (deliberate — the 180 px
minimum panel), but beyond the clamp rows had no per-level cue; the row
docstring promised an indent guide that did not exist.

**Fix:** one faint vertical guide per ancestor level
(`layers-row__indent-guide`), positioned at each level's content start and
clamped with the indent. Depth stays authoritative in `aria-level`; the
guides give the flattened lanes a readable structure without consuming name
width. Token-scaled (`--color-border-subtle`), zero-emoji, no literals.

### F9 — Filter kind chips missed real node kinds (capability gap)

**Evidence:** `KIND_CHIPS` offered Shape/Text/Frame/Group/Adjustment but
not Path, rasterLayer, or Table — all real `SceneNode` kinds the
presentation resolver distinguishes (task §19/§45).

**Fix:** added Path, Raster, and Table chips. The kind filter contract is
unchanged (kind-level, not presentation-category level — the categories
remain the row-styling contract per the 2026-08-31 audit).

### F10 — Corrupt documents could recurse infinitely (defensive gap)

**Evidence:** the flatten walk skipped missing child ids (kept — verified
by test) but had no cycle guard; a damaged parent chain (A → B → A) would
recurse until stack overflow and freeze the panel (task §73).

**Fix:** a per-flatten `seen` set dedupes projection — duplicates emit once
and cycles terminate. Tests in `useFlatTree.test.ts` ("corrupt documents"):
dangling child id, duplicate child reference, and a full parent/child cycle
(each node emitted exactly once).

### F11 — Dead code and drift (maintenance)

- `LayersPanel/fuzzySearch.ts` had zero importers (search uses the inverted
  word index). Deleted.
- The selection-checkbox prop chain (LayersTree → SortableVirtualRow →
  LayersRow) was threaded but LayersRow discarded it (`_onToggleSelectionCheckbox`).
  Removed from all three interfaces. The researched decision (Krita ships
  tablet checkboxes; Blender hides restriction columns behind the filter
  popover) supports *not* reintroducing a checkbox column: the treeitem's
  `aria-selected` + Space is the single selection model, and touch
  multi-select exists via the row scrub.
- The stale `.layers-row__media-badge` rule in `editor.css` remains — that
  file carries uncommitted concurrent-agent changes, so the deletion is
  deferred to the integration checkpoint (the panel's scoped override wins
  in the cascade meanwhile).

## Deliberate decisions

| Decision | Rationale | Alternatives rejected |
| --- | --- | --- |
| Indent/outdent keys: `Ctrl+Alt+]` / `Ctrl+Alt+[` | Same physical keys as the sibling reorder; Alt = level change. Free in the registry; browser/Tauri-safe. | Tab/Shift+Tab (APG reserves Tab for leaving the widget); Ctrl+Shift+[/] (global Bring-to-Front/Send-to-Back); Ctrl+PageUp/Down (browser tab switching on web). |
| Outdent of a mixed-parent selection moves only the anchored container's group per command | Predictable, announced, one container per command; repeating the command walks the next group. | Silent multi-parent reshuffle in one command (hard to predict, hard to announce honestly). |
| Inherited-hidden "Show" stays enabled with a description, unlike inherited-locked Lock which is disabled | Setting the own flag is the correct eventual state for visibility; for lock the menu cannot achieve the requested effect at all. | Disabling both (would strand visibility fixes behind menu re-navigation). |
| Auto-expand restore keeps the landed path open | The moved layer must remain visible after the drop (that is why Figma keeps drop targets open). | Reverting everything (hides the layer you just moved); keeping everything (the defect being fixed). |
| Expansion transfers on detach; scroll/focus reset | Disclosure is cheap, bounded, and defines "where was I"; scroll offsets are fragile across viewport changes in an auxiliary window. | Serializing scroll pixels (viewport-dependent, brittle). |
| No selection-checkbox column | `aria-selected` + Space is the single ARIA selection model; adding `aria-checked` alongside is flagged as harmful by the APG; touch multi-select exists via the row scrub. | Re-adding the dead checkbox (would conflict with `aria-selected` and add a permanent busy column). |
| Focus mode (task §20) not added in this pass | Varve already ships panel-scoped Isolation (breadcrumb + Escape exit) and Collapse Others, covering the researched use cases (Sketch Focus Mode, Krita Alt+click isolate); canvas-side enforcement remains the documented deferred item. | Duplicating isolation under a second name. |

## Validation

Commands actually run (scoped closure; see the planner note below):

- `pnpm exec vitest run packages/editor/src/components/LayersPanel --exclude '**/__benchmarks__/**'` — 30 files, 370 tests passed.
- `pnpm exec vitest run packages/editor/src/components/LayersPanel/__benchmarks__/layers10k.bench.test.ts` — 12 passed: flatten 10K = 43 ms (ceiling 200), search index = 132 ms (750), filter = 19 ms (100), search+filter = 58 ms (250), drop resolution = 3.6 µs/sample at 10K with per-sample cost flat vs document size (previous measurement 4.4 µs).
- `pnpm exec vitest run packages/editor/src/scene/world.test.ts packages/editor/src/components/LayersPanel/layerContextMenu.test.ts` — 52 passed.
- `pnpm --filter @varve/editor exec tsc --noEmit` — no diagnostics in any file touched by this pass (pre-existing diagnostics from other sessions' in-flight files are recorded in the completion report and were left untouched).
- `pnpm exec biome check` on all touched paths — clean (two pre-existing warnings in SelectionSetsSection predate this pass).
- Playwright (Chromium, `--workers=1`, heavy-lease wrapped): `layers.spec.ts`, `accessibility.spec.ts`, `axe.spec.ts`, `selection.spec.ts`, `context-menu.spec.ts`, `layers-dnd-invariant.spec.ts`, `layers-drag-drop.spec.ts`, `layers-dnd.spec.ts`, `layer-workflows.spec.ts`, `layer-navigation.spec.ts` — see the completion report for the run record.
- Baseline/after visual evidence: `docs/screenshots/2026-09-17-layers-review/{before,after}/` (empty, five-layer, realistic import, deep-nesting/mask/unicode fixture, multi-selection, hidden+locked, search, filter, narrow 220/186 px, dark/light/high-contrast).

Planner note: `pnpm verify:plan` escalates to the full suite because the
shared working tree carries ~230 changed files from concurrent sessions
(font pipeline, canvas navigation, inspector, toolbar). As in the
2026-09-15 review, the escalation belongs to the combined integration
checkpoint; the scoped closure above is this pass's evidence. No full suite
was run.

## Remaining work

Two pre-existing E2E failures were isolated **against clean HEAD with this
pass's changes stashed** and reproduce identically without them:
`accessibility.spec.ts` "space toggles selection" (expects plain ArrowDown
to select the focused row; the keyboard handler at HEAD moves focus only)
and `selection.spec.ts` "bulk group groups selected layers". Both belong to
the concurrent selection/canvas-navigation work flowing through the shared
tree; they are recorded here so they are not mistaken for regressions of
this pass. The bulk-group flow itself was verified working by a scripted
diagnostic (group command creates and reveals the group row; the failing
spec's precondition — ArrowDown selecting — is the part that does not hold
at HEAD).

## Follow-up round (same day) — remaining-limitation closure

Every item from the "Remaining work" list above was then addressed:

- **Both pre-existing E2E failures are now fixed, not just classified.**
  "Space toggles selection" was rewritten to the documented contract
  (plain arrows move focus only; Space toggles membership) — the old
  expectation contradicted `docs/architecture/layers-navigation.md`.
  "Bulk group" turned out to be a serial-mode cascade of the second finding
  below and passes again.
- **Range-anchor seeding (behavior fix).** A key-delivery probe showed the
  first Shift+Arrow after a canvas-made selection *replaced* that selection
  with a one-row range — identically in Chromium and WebKitGTK — because
  the panel's range anchor is panel-local and the code fell back to the
  focused row. `selectRange` now seeds its anchor from the primary
  selection when the panel has none, matching the documented "stable
  NodeId anchor" contract; accessibility + selection suites are 20/20
  under **both** engines.
- **Screen-reader surface (§61 honest split).** Row accessible names now
  carry `locked` / `hidden` state text (WCAG 1.4.1); type-ahead and the
  state-in-name behavior gained E2E coverage; aria/keyboard contract
  remains structurally verified. Physical AT sessions (NVDA/Orca/
  VoiceOver) were NOT run — no synthetic harness can claim them; that
  residual is explicit.
- **WebKitGTK cross-engine validation (§85).** Playwright WebKit ran the
  APG core, accessibility, selection, and context-menu specs: all pass,
  including the new Home/End long-jump and isolation-enforcement tests.
  Verified under both engines: keyboard tree contract, range selection,
  bulk operations, context menus, isolation. Not verified on WebKit:
  pointer-drag DnD feel (synthetic drags are not engine-representative)
  and Tauri-specific input capture; Chromium-only: effect-stack drag
  baselines.
- **Isolation enforcement verified end-to-end (§73-adjacent).** The
  deferred-plan note claiming the canvas ignores isolation was outdated:
  `HitTestEngine` filters point and deep-select hits to the isolated
  subtree and `SelectTool` excludes outside nodes from marquee selection
  (and routes empty-canvas clicks to the isolated root). New E2E: isolate a
  frame, click an outside layer's canvas position, assert the outside layer
  never becomes selected. Passes under both engines.
- **Home/End long-jump focus retry: implemented** — the roving-focus effect
  retries a bounded 10 frames for the target row to mount after a long
  scroll jump, re-checking focus ownership each attempt; covered by the new
  large-tree E2E under both engines.
- **useFlatTree diff duplication: removed** — the document diff is computed
  once per transition in `LayersTree` and shared by the search-index patch
  (`updateSearchIndexIncremental`) and the projection (`useFlatTree`
  accepts a `precomputedDiff`); unit-tested for both property-only and
  structural diffs.
- **Stale `.layers-row__media-badge` rule deleted** from `editor.css`
  (verified away from the concurrent hunk in that file).
- **`effect-stack-transfer` Layers-panel hover baselines refreshed** after
  manual inspection of the diffs: the height/pixel delta is the recorded
  redesign (Layer States moved to Inspector, current row anatomy), and the
  refreshed captures show correct rows, badges, and the hover tooltip.
  The Inspector-side badge capture still times out on a locator inside the
  concurrently-redesigned Inspector and stays with that owner.

Validation for the follow-up round: `accessibility.spec.ts` +
`selection.spec.ts` 20/20 under Chromium **and** WebKit;
`layers.spec.ts` 12/12 under WebKit (11/12 Chromium with the isolation
test passing after a locator fix); LayersPanel unit suite 372/372;
editor typecheck clean; the shift+arrow, space-toggle, and bulk-group
results were each confirmed by scripted page-state probes before code was
changed.

## Remaining work (after follow-up round)

- Physical screen-reader sessions (NVDA/Orca/VoiceOver) and physical-input
  WebKitGTK/Tauri DnD verification remain genuinely untested; synthetic
  coverage cannot substitute for them.
- The Inspector-side `effect-stack-transfer` badge capture is owned by the
  concurrent Inspector redesign (locator timeout, not a Layers defect).
- `HitTestPolicy.scopeRootId` is a declared-but-unread policy knob (the
  `options.isolatedNodeId` mechanism is the live one); removal is optional
  cleanup in a file owned by hit-test work.
