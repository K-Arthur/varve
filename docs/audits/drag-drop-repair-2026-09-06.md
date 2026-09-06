# App-wide drag-and-drop repair record — 2026-09-06

Status: implementation and validation in progress. This record is the source
of truth for what was inspected, repaired, measured, and still needs a real
browser or native run. It does not treat an unexecuted matrix row as passed.

## Scope and ownership

The repair is deliberately split by semantic owner:

| Route | Payload and operation | Owner | Current evidence |
| --- | --- | --- | --- |
| Layers → Layers | reorder, reparent, unnest, mask-aware clip | `useLayersDnD` + layer resolver + editor document transaction | Resolver/move-plan tests; real-pointer suites exist and are pending this pass |
| Layers → Canvas | move canonical roots to the active Design Canvas or Print Page | `DnDShell` + world-space placement plan + editor transaction | Placement-plan tests; real-pointer visual route pending |
| Canvas → Canvas | move, duplicate-drag, snapping, adoption/layout | canvas tool pipeline | Existing tool ownership retained; not changed by this repair slice |
| Canvas → Layers | no generic drop route found | explicit arrange/reparent commands | Unsupported as a drag route; no accidental route added |
| Page navigator | horizontal page reorder | shared `Sortable` + page command | Existing component/unit coverage; browser matrix pending |
| Home files/projects | grid reorder and project move | shared `Sortable` + platform file store | Existing Home coverage; async persistence remains outside document undo |
| Object Filters | vertical stack reorder | shared `Sortable` + selected-node transaction | Existing component coverage; browser matrix pending |
| Effect stack | copy/replace or append effects onto a destination layer | specialized effect-stack transfer | Kept separate from sorting; existing transfer tests remain authoritative |
| Paints, icons, components | copy/insert external payload into an eligible canvas | HTML5 payload + editor insertion command | Kept separate from layer movement; payload validation remains in owner |
| External files | import artwork into the canvas | HTML5 `DataTransfer` or native Tauri path event → ImportService | Unit/import coverage; native GUI coverage remains platform-dependent |
| Detached windows | panel transfer proposal | broker/command paths | No global HTML drag claim; ADR-0141 limitations remain in force |

Resize handles, sliders, curve points, text selection, marquee, drawing,
timeline scrubbing, camera navigation, and panel resizing were classified as
pointer editing or layout gestures, not sortable operations.

## Defect ledger

| ID | Finding and source evidence | Repair status | Verification status |
| --- | --- | --- | --- |
| A | Layer resolver accepted a vertically aligned pointer without an X surface check. | Fixed: resolver requires tree X and Y containment. | Unit regression added; real-pointer crossing pending |
| B | Layers → Canvas assigned the same cursor origin to every selected root. | Fixed: one world delta preserves each root's relative origin and transform. | Placement-plan unit tests pass; visual E2E pending |
| C | Canvas commit could return without terminating the Layers source session. | Fixed: canvas success, rejection, missing surface, and failure paths cancel source cleanup. | Source inspection and checkpoint tests pass; browser cleanup route pending |
| D | Layer hit testing mixed direct client coordinates with library-delta reconstruction. | Fixed for Layers: live window pointer coordinates are authoritative; dnd-kit events are ticks only. | Focused tests pass; auto-scroll browser route pending |
| E | Shell collision, tree resolution, and canvas selection could disagree about ownership. | Fixed for layer handoff: scoped canvas ref plus actual pointer containment; `over` is not authoritative. | Source inspection; adjacent-panel E2E pending |
| F | Auto-expand timer was keyed only by “a timer exists”, not target/session. | Fixed: target changes cancel/rearm and stale sessions cannot expand. | Source inspection; rapid-hover browser route pending |
| G | Virtualizer/panel geometry needed an explicit current source and X bounds. | Fixed in code: direct virtualizer measurements and viewport bounds; visual layout matrix pending. | Typecheck/focused tests pass; screenshots pending |
| H | Live selection could change the layer-to-canvas payload during a gesture and include descendants twice. | Fixed: canonical roots are snapshotted at pickup, de-duplicated, and paint-ordered. | Unit tests pass; real multi-selection drag pending |
| I | End-only state could retain an insertion anchor after rows or parents changed. | Fixed: release takes the final resolver sample and revalidates target parent/lock/cycle state. | Unit tests pass; mutation-during-drag route pending |
| J | `useLayersDnD` copied all virtualizer measurements on every pointer sample. | Fixed: resolver reads the virtualizer measurement array directly; no O(N) copy per sample. | Typecheck and resolver tests pass; large-tree measurement pending |
| K | Tauri file drops are window-level, so a native drop over a sidebar could be consumed by CanvasArea. | Fixed: known logical position must be inside the receiving canvas; unknown/outside drops are rejected. Descendant `dragleave` no longer clears HTML5 previews. | Unit tests pass; packaged native drop pending |
| L | Terminal paths needed idempotent timer/listener/preview cleanup. | Fixed for the Layers/canvas handoff: session invalidation, click-trap cleanup, source cancellation, and unmount cleanup were tightened. | Checkpoint tests pass; Escape, blur, capture-loss, and unmount browser routes pending |

## Implementation commits

- `3f58edb78` — `fix(dnd): harden layer and canvas handoff`
- `8b79a903f` — `fix(dnd): scope native file drops to their canvas`
- `c84874ba2` — `perf(dnd): reuse virtualizer geometry during layer drags`

All three commits were created directly on `master`. Unrelated dirty changes
in the website, effects catalog, editor inspector, UI icons, and menu E2E work
were kept out of these commits.

## Validation ledger

Passed so far:

- `pnpm exec vitest run packages/editor/src/components/LayersPanel/layerDropResolver.test.ts packages/editor/src/components/LayersPanel/dragMove.test.ts packages/editor/src/components/LayersPanel/useFlatTree.test.ts packages/editor/src/components/Shell/layerCanvasDrop.test.ts --pool=threads --maxWorkers=1` — 89 tests.
- `pnpm exec vitest run packages/editor/src/dropUtils.test.ts --pool=threads --maxWorkers=1` — 17 tests.
- `pnpm --filter @varve/editor typecheck`.
- Commit checkpoints for each repair commit: staged Biome, emoji, health,
  impact, secret, contact, boundary, and selected Vitest checks passed.

The required impact planner was run. The dirty worktree’s affected gate was
not fully green because an unrelated pre-existing edit in
`tests/e2e/home/context-menu.spec.ts` is not Biome-formatted; the repair files
themselves pass Biome. The planner selected no full-suite escalation.

Not yet passed at the time of this record:

- Chromium real-pointer Layers reorder/reparent, cross-surface handoff, and
  visual screenshot inspection.
- Firefox/WebKit focused interaction checks.
- Tauri packaged/native file-drop GUI validation and mixed-DPI verification.
- Large-tree performance measurement and the full release matrix.

## Remaining acceptance matrix

The next validation pass must record independent evidence for single and
multi-layer reorder, ancestor/descendant selection, empty and collapsed
containers, locked/cyclic targets, filtered trees, stationary auto-scroll,
horizontal surface exit, rapid auto-expand changes, panel resize during drag,
boundary release, Layers → Canvas spacing/transformed-parent placement,
successful-drop follow-up interaction, undo/redo, and screenshot inspection
while the pointer is still down. Native and detached-window claims remain
platform-specific and must stay labelled accordingly.
