# Adjustments, effects, and filters repair evidence

Status: in progress. This is an evidence ledger, not a completion claim.

## Checkout and boundaries

Started on `master` at `bbe203d2721a132c46bfc0f2598a8c9387ee3b0c`.
Existing uncommitted background-removal and persistent-history work (including
its tests and first-project website documentation) is preserved and excluded
from this task's commits. All work remains on master.

## Milestones

1. Audit and deterministic reproductions: in progress.
2. Shared compositing and parameter repairs: in progress.
3. Existing adjustment quality and frontend state: pending.
4. Four distinct additions, with complete frontend/export coverage: pending.
5. Performance, compatibility, export and multimodal final validation: pending.

## Confirmed findings

| Finding | Evidence before repair | Repair and verification status |
| --- | --- | --- |
| Normal partial filter strength deposits duplicate source coverage | `filterStrength.test.ts`: neutral brightness, source alpha 128, strength 0.25 produces alpha 144; strength 0.5 produces 160. Half inversion yields RGB 110/118/126 instead of 128/128/128. | Replace source-over with premultiplied interpolation for normal filter strength. Seven numerical tests pass; Chromium inspector, Undo/Redo and downloaded PNG checks pass. |
| Alpha-changing filter loses intended strength behavior | Opacity value 0 at strength 0.5 leaves alpha 128 rather than 64. | Same replacement mix preserves alpha-changing semantics; numerical test passes. |
| Contract prose promises all kernels preserve alpha | `effectContract.ts` blanket statement contradicts opacity and spatial blur. | Contract prose repaired; per-operation metadata remains under investigation. |
| Registry metadata guesses semantics from parameter names | `effectRegistry.ts`: every `value` gets -100..100; arbitrary numeric arrays of length >=3 become colours; any radius implies expanded bounds; partial GPU becomes boolean true. | Confirmed source-level metadata defects; consumer/runtime impact still under investigation. |

The normal-strength repair changes previously incorrect appearance on
semitransparent inputs at partial strength. Stable IDs and stored values are
unchanged; opaque normal-filter output is unchanged within Canvas rounding.
Artistic filter blend modes retain their established source-over semantics
pending a separate compatibility decision. This is not a global layer-blend
change. Zero strength bypasses evaluation. The software mix reuses its evaluated
buffer; the Canvas path uses weighted additive premultiplied compositing without
readback.

## Active paths inspected

Object Filters (`SmartFiltersSection`) stores ordered `smartFilters` with stable
IDs; `adjustmentsToFilters` converts visible known entries to FilterIR. Replay
isolates objects needing software filtering or partial strength, calls
`applyFilterWithCompositing`, and applies object opacity when composing the
result. `exportRasterizedSubtree` calls the same filter compositor. This confirms
production use of the repaired compositor; each consumer still needs runtime
verification. Effect Studio stores recipes in that same stack; Image Tuning and
backdrop adjustment surfaces have intentionally different eligibility.

Candidate searches found no registered directional blur, mosaic, bilateral
surface smoothing, or contour primitive. Related code (bloom directional streaks
and background-removal Sobel analysis) is not an independently editable object
filter. Candidate selection remains provisional until the catalog audit is done.

## References

[W3C Compositing and Blending](https://www.w3.org/TR/compositing-1/)
defines source-over coverage accumulation; mixing two states of one filter is a
separate product operation.
[Filter Effects Level 1](https://www.w3.org/TR/filter-effects-1/) is the reference
for CSS filter semantics, not a claim of measured CPU/CSS agreement.

## Validation ledger

- Initial `pnpm verify:plan`: existing editor and website changes; no full escalation.
- `pnpm exec vitest run packages/engine/src/filterStrength.test.ts`: four failures
  before repair, as detailed above.
- `pnpm exec biome check --write packages/engine/src/filterCompositor.ts packages/engine/src/filterStrength.test.ts`: passed after formatting.
- `pnpm exec vitest run packages/engine/src/filterStrength.test.ts packages/engine/src/filterCompositor.test.ts`: 43 tests passed.
- `VARVE_E2E_PORT=1437 pnpm exec playwright test tests/e2e/effects/filter-strength.spec.ts --project=chromium --reporter=list`: passed including typed strength, Undo/Redo and independent PNG alpha decoding. Initial harness attempts failed because port 1420 was occupied and transferring the entire pixel array exceeded the polling budget; sampling now occurs inside the browser.
- Opened and inspected `reports/effects-repair/strength-inspector.png` and `strength-export.png`: the cutout remains translucent, with transparent margins and no visible neutral-strength darkening.
- `pnpm exec vitest run packages/editor/src/components/Inspector/sections/SmartFiltersSection.test.tsx`: 11 passed. The new test initially used an exact accessible name missing the unit suffix; corrected to match the numeric control's full name.
- Browser console confirmed discrete stack edits bypassed persistent history. Object Filters now captures its discrete mutations in transactions, while range gestures retain one transaction. Real Undo/Redo verifies typed strength restoration.
- `pnpm verify:plan --staged` then `VARVE_E2E_PORT=1441 VARVE_TEST_WORKERS=2 pnpm verify:affected --staged` running with an isolated temporary Git index containing only task files. This leaves the shared index and master branch intact. Plan selects 83% of JS tests because of engine reverse dependencies, plus website checks; no full escalation. Format, lint, emoji, docs and E2E typecheck have passed so far.
- Regression audits and remaining affected lanes: pending.
- Full suite: not run. No release or platform certification claimed.

## Milestone checkpoint: alpha, history, and product guidance

The normal-strength and Object Filters transaction repairs have direct numerical,
component, real-inspector Undo/Redo, and independently decoded PNG evidence. They
are ready for a bounded local checkpoint, not repository certification.

The affected editor lane has reported three failures while unrelated concurrent
work modifies context and UI modules:

- ShortcutPalette Alt+Enter: repeated 15-second timeout. Narrowing this keyboard
  scenario to the named Undo command retains the actual userEvent remapping path
  and adds a target-specific assertion. Its isolated rerun passed (10.09 seconds)
  without increasing timeouts. The remaining 17 tests were excluded from this
  exact diagnostic rerun; the affected lane runs the entire spec.
- PromptDialog accessible input name: under investigation; no effect-code caller.
- EditorProvider document-consumer render count: under investigation amid concurrent
  history/context changes; no conclusion about its cause yet.

Website scope copy was reviewed in a real browser at 1280px/light and 390px/dark;
mobile document width equals viewport width. Artifacts:
`reports/effects-repair/website-scope-light.png` and
`reports/effects-repair/website-scope-mobile-dark.png`.

The candidate kernels now have ten passing numerical tests and a visually reviewed
landscape contact sheet at `reports/effects-repair/spatial/contact-sheet.png`.
They are deliberately **not counted as delivered capabilities**: FilterIR,
normalization, controls, persistence and real UI/export verification remain to do.
Kernel-only timing samples are in `spatial/kernel-timings.json`; concurrent host
load makes these exploratory, not a reliable end-user latency benchmark.

Changed scope: engine normal-strength compositor and contract prose; Object Filters
transaction ownership; one bounded shortcut validation fixture; website scope copy.
Validation plan: affected engine/editor/website plus reverse JS closure, no full escalation.
Commands actually run: exact commands in the ledger above; `pnpm audit:docs`,
`pnpm audit:emoji`, `pnpm audit:tokens` as regression rechecks.
Passed: direct compositor (43), Object Filters component (11), browser alpha/history/PNG,
website layout review; see log for continuing affected lanes.
Skipped as unrelated: Rust workspace and full visual matrix, excluded by planner.
Escalations: none for this checkpoint; affected editor failures are being isolated.
Full suite run: no.
