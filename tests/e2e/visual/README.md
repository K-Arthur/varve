# Visual Regression Harness

Protects `packages/engine/src/replay.ts`'s `replayIr` — the render path's primitive-painting
function — with real pixel comparison. Complements `packages/engine/src/__goldens__/drawCallSequence.test.ts`,
a faster, non-pixel structural signal for the same function (see that file's header for why both
exist).

## Why this exists instead of extending `__goldens__/goldenReplay.test.ts`

That file hashes `canvas.getImageData()` output and asserts hash stability. Verified directly in
this repo's actual jsdom setup: a real `fillRect()` followed by `getImageData()` returns an
**all-zero buffer** — jsdom's canvas does not rasterize. That test only proves calling `replayIr`
twice with the same input is deterministic; it proves nothing about what's actually drawn. This
harness uses a real browser (Playwright, already a dependency in this repo) instead.

## How it works

1. `apps/desktop/visual-harness.html` + `apps/desktop/src/visual-harness-main.ts` — a minimal
   page (not the full app) that imports `replayIr` directly and exposes
   `window.__renderFixture(items, width, height)`.
2. `tests/e2e/visual/fixtures.ts` — the fixture corpus (`RenderItem[]` scenes).
3. `tests/e2e/visual/replay.spec.ts` — for each fixture, navigates to the harness page, calls
   `__renderFixture`, and asserts `toHaveScreenshot()` against a stored baseline with a
   per-fixture `maxDiffPixels` tolerance (see `playwright.config.ts`'s `chromium-visual-1x`/`-2x`/`-3x`
   projects for DPR variants — 3x is opt-in via `VARVE_VISUAL_3X=1`, since it roughly triples
   this suite's snapshot count and CI time for the DPR tier bugs are least likely to hide in).
4. On failure, `scripts/build-visual-diff-manifest.mjs` collects baseline/current/diff PNGs into
   `visual-diff-report/` + a `manifest.json`. CI uploads this directory as an artifact.
5. `tests/e2e/visual/review.html` — static page, no server, no build step. Point it at a
   downloaded `visual-diff-report/manifest.json` (or a local one after running the script
   yourself) to see every failing fixture with baseline/current/diff side by side, zoom-and-pan
   per pane, and an "Accept" button that reveals the exact `--update-snapshots` command to run
   locally (a static page can't write files for you — this is the honest version of "accept").

## Scope: what's covered, what's deferred

This harness tests `replayIr` (the primitive-painting layer), **not** the full
`CanvasArea.tsx`/`replaySubtreeToCtx` orchestration layer above it (mask compositing, group
isolation surfaces, nested clip paths, container-surface flattening) — those decide what gets
flattened into the `RenderItem[]` this harness feeds `replayIr`, and covering them needs a
heavier harness that mounts real `CanvasArea` against a real `Document`, which is a materially
larger undertaking than this pass.

**Shipped fixtures**: multiple node types (rect/circle/ellipse/text), multilingual text covering
RTL, script fallback, combining marks, ligatures, and ZWJ emoji, opacity, 4 blend modes
(multiply/screen/difference plus normal), one linear gradient with rotation, one stroke variant
(center-aligned solid), and a 1,500-item pathological scene.

**Explicitly deferred** (not attempted — listed so a future pass knows exactly what's missing,
not left to rediscover it):
- Nested groups, masks/clipping, image fills (`paintImageFill`'s fill-rect math) — all live in
  `replaySubtreeToCtx`, out of this harness's current scope per above.
- Filters/LUTs, motion/bound-property-at-fixed-time fixtures.
- Conic and radial gradient variants, dashed/joined/capped stroke variants beyond the one
  shipped.
- 3rd DPR tier as a default (opt-in only, see above).
- GPU-vs-software and per-platform separate baselines — this harness currently has one Linux
  Chromium baseline set per fixture/DPR; font rendering and anti-aliasing differ across
  platforms, so a baseline generated on Linux CI will not match macOS/Windows local runs. If this
  harness is run cross-platform, per-platform baseline directories are needed (Playwright's
  snapshot naming already includes the platform, e.g. `-linux.png` — this repo's baselines will
  need `-darwin.png`/`-win32.png` siblings generated on those platforms before this is safe to
  gate CI on for non-Linux runners).

## Font pinning

The fixture corpus uses `sans-serif` for text, including the multilingual fixture. This resolves
to the runner's default sans font and script fallback fonts, so font availability differs between
CI and dev machines and can produce false diffs. **Not yet fixed**: embedding a specific test font
(e.g. via `@font-face` in `visual-harness.html`) and forcing text fixtures to use only that font
is the correct follow-up; the visual signal is still useful on the pinned Linux CI runner.

## Running locally

```bash
npx playwright test tests/e2e/visual/replay.spec.ts --project=chromium-visual-1x --project=chromium-visual-2x
node scripts/build-visual-diff-manifest.mjs   # only needed after a failure, to build the review report
# then open tests/e2e/visual/review.html directly in a browser and point it at visual-diff-report/manifest.json
```

To accept new baselines after an intentional rendering change:
```bash
npx playwright test tests/e2e/visual/replay.spec.ts --update-snapshots
```
