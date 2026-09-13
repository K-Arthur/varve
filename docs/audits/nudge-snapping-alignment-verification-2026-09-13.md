# Precision placement verification record

**Access date:** 2026-09-13  
**Branch:** `master`  
**Runtime:** Linux x86-64, Chromium, 1280 x 800 CSS px, software-rendered canvas  
**Scope:** exact nudging, pointer snapping, multi-selection movement, alignment,
distribution, feedback, persistence, and the marketing workflow.

This record supplements the research and integration matrix in
[`nudge-snapping-alignment-research-2026-09-13.md`](./nudge-snapping-alignment-research-2026-09-13.md).
It records observed results from the current checkout, not claims about
untested native or physical-device runtimes.

## Newly verified workflow

The real Chromium workflow in
`tests/e2e/canvas/snap-after-move.spec.ts` seeds three rectangles, disables the
document-grid snap channel, selects two movers through the Layers tree, and
drags the selection on the canvas. The stationary target is at `x = 250`; the
primary mover starts at `x = 160` and the secondary at `x = 320`.

The run passed with HMR disabled on an isolated port:

```text
VARVE_E2E_PORT=1572 VARVE_DISABLE_HMR=1 pnpm exec playwright test \
  tests/e2e/canvas/snap-after-move.spec.ts --project=chromium \
  --grep "multi-selection" --reporter=list
1 passed (33.1s; Playwright wall time 1.3m)
```

The post-gesture Inspector values were `primary x = 250` and `secondary
x = 410`. Both movers therefore received the same `+90` document-space
displacement, while the primary's left edge matched the target exactly. The
during-state capture showed the vertical target guide and the corrected
selection boundary. The test also keeps document-grid snapping disabled so an
8-unit grid cannot mask the object-edge result; grid snap remains a separate
explicit operation.

The same run exposed a real interaction defect before the repair: the
informational multi-select micro-hint sat above the artwork with
`pointer-events: auto`. A drag beginning in its text selected browser text or
failed to enter `SelectTool`. `MicroHint.css` now lets pointer input pass
through the informational surface while keeping its dismiss button interactive.

## Earlier verified workflows retained

The focused evidence already committed on `master` covers:

- fractional and large keyboard nudges, idle-tool canvas focus, one undo entry
  for a repeated nudge, and authoritative full-redraw hash equality;
- moved and newly created snap targets, plus save/reopen followed by snapping to
  the persisted target;
- page/frame/key-object alignment, fixed-gap preview/cancel/commit, unequal-size
  equal-gap distribution, and explicit Tidy Up controls;
- proportional edge snapping with exact accessible geometry (`aria-valuetext`)
  while the compact visible field remains formatted for readability;
- the Precision Placement documentation and Precision Editing marketing pages
  under `apps/website`, including ghpages and custom-domain browser checks.

The numeric assertions and visual captures are intentionally separate: the
Inspector proves document geometry, while before/during/after screenshots prove
focus, guide visibility, reference presentation, and final rendering.

## Remaining boundaries

These are not presented as complete until their own evidence exists:

- physical Chromebook touch/stylus and Linux WebKitGTK/Tauri GUI runs;
- geometry snap guides during resize handles and geometry-aware rotation
  targets;
- dense 10k--50k-object indexed interaction timings on the Chromebook or ARM;
- native filesystem save/export placement checks beyond the browser
  save/reopen path;
- menu/shortcut alignment surfaces beyond the verified Inspector page/frame
  path; the Inspector remains the documented complete reference-selection UI.

The public research record includes failure reports about distant Smart Guide
targets, fractional residual errors, inconsistent snapping, and missing
distance feedback. Varve's implemented responses are scoped candidates,
identity-bearing snap locks, unrounded canonical coordinates, raw-intent
hysteresis, post-command feedback, and numeric alternatives; those responses
are not claims that every external product version has the same defect.
