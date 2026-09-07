# App-wide drag-and-drop repair record — 2026-09-06

Status: scoped implementation complete; platform and extended-matrix validation
remain explicitly tracked below. This record is the source of truth for what
was inspected, repaired, measured, and still needs a real browser or native
run. It does not treat an unexecuted matrix row as passed.

## Scope and ownership

The repair is deliberately split by semantic owner:

| Route | Payload and operation | Owner | Current evidence |
| --- | --- | --- | --- |
| Layers → Layers | reorder, reparent, unnest, mask-aware clip | `useLayersDnD` + layer resolver + editor document transaction | 89 focused unit tests; 12 invariant + 16 companion Chromium pointer tests pass |
| Layers → Canvas | move canonical roots to the active Design Canvas or Print Page | `DnDShell` + world-space placement plan + editor transaction | Placement-plan tests; Chromium and Firefox pointer/spacing/visual checks pass |
| Canvas → Canvas | move, duplicate-drag, snapping, adoption/layout | canvas tool pipeline | Existing tool ownership retained; not changed by this repair slice |
| Canvas → Layers | no generic drop route found | explicit arrange/reparent commands | Unsupported as a drag route; no accidental route added |
| Page navigator | horizontal page reorder | shared `Sortable` + page command | Existing component/unit coverage; browser route not run in this pass |
| Home files/projects | grid reorder and project move | shared `Sortable` + platform file store | Home real-pointer reorder passes; async persistence remains outside document undo |
| Object Filters | vertical stack reorder | shared `Sortable` + selected-node transaction | Real-pointer reorder passes; 39 shared/UI-focused unit tests pass |
| Effect stack | copy/replace or append effects onto a destination layer | specialized effect-stack transfer | 4 Chromium pointer/context-menu tests pass; inspected hover baselines refreshed |
| Paints, icons, components | copy/insert external payload into an eligible canvas | HTML5 payload + editor insertion command | Kept separate from layer movement; payload validation remains in owner |
| External files | import artwork into the canvas | HTML5 `DataTransfer` or native Tauri path event → ImportService | Unit/import coverage; native GUI coverage remains platform-dependent |
| Detached windows | panel transfer proposal | broker/command paths | No global HTML drag claim; ADR-0141 limitations remain in force |

Resize handles, sliders, curve points, text selection, marquee, drawing,
timeline scrubbing, camera navigation, and panel resizing were classified as
pointer editing or layout gestures, not sortable operations.

## Defect ledger

| ID | Finding and source evidence | Repair status | Verification status |
| --- | --- | --- | --- |
| A | Layer resolver accepted a vertically aligned pointer without an X surface check. | Fixed: resolver requires tree X and Y containment. | Unit regression plus held-pointer Layers→Canvas crossing pass in Chromium/Firefox |
| B | Layers → Canvas assigned the same cursor origin to every selected root. | Fixed: one world delta preserves each root's relative origin and transform. | Placement-plan units plus independent accessibility-position spacing assertion pass |
| C | Canvas commit could return without terminating the Layers source session. | Fixed: canvas success, rejection, missing surface, and failure paths cancel source cleanup. | Held-pointer handoff and post-release overlay/indicator cleanup pass in Chromium/Firefox |
| D | Layer hit testing mixed direct client coordinates with library-delta reconstruction. | Fixed for Layers: live window pointer coordinates are authoritative; dnd-kit events are ticks only. | Invariant suite and stationary-pointer auto-scroll pass in Chromium |
| E | Shell collision, tree resolution, and canvas selection could disagree about ownership. | Fixed for layer handoff: scoped canvas ref plus actual pointer containment; `over` is not authoritative. | Handoff test proves canvas ownership while held and no Layers indicator; Chromium/Firefox pass |
| F | Auto-expand timer was keyed only by “a timer exists”, not target/session. | Fixed: target changes cancel/rearm and stale sessions cannot expand. | Source inspection and lifecycle guards pass; rapid-hover browser route not separately run |
| G | Virtualizer/panel geometry needed an explicit current source and X bounds. | Fixed in code: direct virtualizer measurements and viewport bounds. | Chromium virtualized auto-scroll passes; handoff/effect-stack screenshots inspected |
| H | Live selection could change the layer-to-canvas payload during a gesture and include descendants twice. | Fixed: canonical roots are snapshotted at pickup, de-duplicated, and paint-ordered. | Canonicalization units plus real multi-selection handoff/spacing test pass |
| I | End-only state could retain an insertion anchor after rows or parents changed. | Fixed: release takes the final resolver sample and revalidates target parent/lock/cycle state. | 12-test preview/commit invariant suite passes; mutation-during-drag race not separately run |
| J | `useLayersDnD` copied all virtualizer measurements on every pointer sample. | Fixed: resolver reads the virtualizer measurement array directly; no O(N) copy per sample. | Typecheck and resolver tests pass; dedicated 1k/10k benchmark not run |
| K | Tauri file drops are window-level, so a native drop over a sidebar could be consumed by CanvasArea. | Fixed: known logical position must be inside the receiving canvas; unknown/outside drops are rejected. Descendant `dragleave` no longer clears HTML5 previews. | 17 drop-utils tests pass; packaged native drop not run on this host |
| L | Terminal paths needed idempotent timer/listener/preview cleanup. | Fixed for the Layers/canvas handoff: session invalidation, click-trap cleanup, source cancellation, and unmount cleanup were tightened. | Escape, no-op, successful-drop selection, and browser cleanup routes pass; blur/capture-loss/unmount not separately run |
| M | The documented row-level drag surface was implemented as a handle-only listener, so dragging a layer name selected text instead of activating DnD. | Fixed: the sortable listener now sits on the row; structural controls stop pointer activation locally and the row advertises a grab cursor. | Regression reproduces before the fix and passes after it; 19 Chromium Layers DnD tests pass |

## Implementation commits

- `3f58edb78` — `fix(dnd): harden layer and canvas handoff`
- `8b79a903f` — `fix(dnd): scope native file drops to their canvas`
- `c84874ba2` — `perf(dnd): reuse virtualizer geometry during layer drags`
- `15d08c78d` — `fix(dnd): validate transparent-root layer targets`
- `04ab9f89d` — `fix(dnd): preserve container drop targets`
- `c6a38004d` — `test(dnd): assert canvas handoff spacing`
- `c715d9362` — `docs(dnd): record repair contract and coverage`
- `65b3d05c2` — `feat(website): explain reliable layer movement`
- `fa58653d5` — `test(website): cover layers feature page`
- `e3375fdaf` — `test(dnd): refresh effect stack hover baselines`
- `89a29c0db` — `fix(website): use semantic drag surface tokens`
- `7e30d1792` — `docs(dnd): close browser validation ledger`
- `43974cb93` — `fix(dnd): allow dragging from layer rows`

All repair, test, documentation, and website commits above were created
directly on `master`. Unrelated dirty changes
in the website, effects catalog, editor inspector, UI icons, and menu E2E work
were kept out of these commits.

## Validation ledger

Passed so far:

- `pnpm exec vitest run packages/editor/src/components/LayersPanel/layerDropResolver.test.ts packages/editor/src/components/LayersPanel/dragMove.test.ts packages/editor/src/components/LayersPanel/useFlatTree.test.ts packages/editor/src/components/Shell/layerCanvasDrop.test.ts --pool=threads --maxWorkers=1` — 89 tests.
- `pnpm exec vitest run packages/editor/src/dropUtils.test.ts --pool=threads --maxWorkers=1` — 17 tests.
- `pnpm exec vitest run packages/ui/src/components/Sortable.test.ts packages/editor/src/components/PageNav/PageNav.test.tsx packages/home/src/FileCard.test.tsx packages/editor/src/components/Inspector/sections/SmartFiltersSection.test.tsx --pool=threads --maxWorkers=1` — 39 tests.
- `pnpm --filter @varve/editor typecheck`.
- `VARVE_E2E_PORT=1429 npx playwright test tests/e2e/layers/layers-dnd-invariant.spec.ts --project=chromium --reporter=list` — 12 passed.
- `VARVE_E2E_PORT=1430 npx playwright test tests/e2e/layers/layers-drag-drop.spec.ts tests/e2e/layers/layers-dnd.spec.ts --project=chromium --reporter=list` — 16 passed.
- `VARVE_E2E_PORT=1451 npx playwright test tests/e2e/layers/layers-drag-drop.spec.ts --project=chromium --grep "handoff to the canvas" --reporter=list` — 1 passed, including independent spacing verification.
- `VARVE_E2E_PORT=1452 npx playwright test tests/e2e/layers/layers-drag-drop.spec.ts --project=firefox --grep "handoff to the canvas" --reporter=list` — 1 passed.
- `VARVE_E2E_PORT=1432 npx playwright test tests/e2e/home/sortable.spec.ts --project=chromium --reporter=list` — 1 passed.
- `VARVE_E2E_PORT=1440 npx playwright test tests/e2e/canvas/smart-filters.spec.ts --project=chromium --grep "drag handle reorders filters" --reporter=list` — 1 passed.
- `VARVE_E2E_PORT=1445 npx playwright test tests/e2e/layers/effect-stack-transfer.spec.ts --project=chromium --reporter=list` — 4 passed after the inspected baseline refresh.
- Website build/typecheck/page generation and the two-deployment Layers feature E2E — passed; full-page screenshots inspected for both deployments.
- Final `pnpm verify:affected` reached the affected editor and UI closures: editor passed with 654 files / 6,509 tests (one skipped) and typecheck passed; UI tests passed with 63 files / 607 tests, but its unrelated typecheck failed on existing errors in `Checkbox.test.tsx` and `Disclosure.stories.tsx`.
- Follow-up row-surface regression: the pre-fix name-drag E2E failed because `.drag-overlay` never activated; after `43974cb93`, the same real-pointer test passed and its held-pointer panel/page screenshots were inspected.
- Commit checkpoints for each repair commit: staged Biome, emoji, health,
  impact, secret, contact, boundary, and selected Vitest checks passed.

The required impact planner was run. The dirty worktree’s affected gate was
not fully green because unrelated existing UI type errors remain on `master`;
the repair files themselves pass Biome, typecheck, focused tests, and browser
validation. The planner selected no full-suite escalation.

Not run or blocked:

- WebKit browser launch is blocked on this host by missing Playwright system
  dependencies (`libicu74`, `libxml2`, and `libflite1`); WebKitGTK/Tauri is not
  claimed from the Firefox/Chromium runs.
- Tauri packaged/native file-drop GUI validation, detached-window transfer,
  mixed-DPI/Wayland routes, touch/pen, mutation-during-drag races, blur or
  capture-loss/unmount exits, and dedicated 1k/10k drag benchmarks.
- PageNav browser drag and the full release matrix.
- `pnpm bench` was started but interrupted after Vitest expanded into four
  checked-out worktrees and unrelated long-running history/media benchmarks;
  no drag-specific benchmark result is claimed.

## Remaining acceptance matrix

The remaining acceptance work is the platform and extended matrix listed
above: rapid auto-expand changes, panel resize during drag, boundary release,
mutation races, dedicated performance measurement, native/detached-window
routes, touch/pen, and the unavailable WebKit/WebKitGTK lane. The completed
browser evidence covers single/multi-layer reorder, reparent/unnest/root
drops, locked/cyclic targets, stationary auto-scroll, horizontal surface
handoff, Layers → Canvas spacing, successful-drop cleanup, undo/no-op behavior,
effect-stack transfer, home-grid sorting, and screenshots while the pointer
is still down.
