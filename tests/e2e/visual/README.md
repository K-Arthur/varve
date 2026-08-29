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
   `window.__renderFixture(items, width, height)` and the fixed-time motion
   variant. Image sources are decoded through the real `ImageCache` before the
   frame is painted, so an image fixture cannot accidentally snapshot a loading
   placeholder.
2. `tests/e2e/visual/fixtures.ts` — the fixture corpus (`RenderItem[]` scenes).
3. `tests/e2e/visual/replay.spec.ts` — for each fixture, navigates to the harness page, calls
   `__renderFixture`, and asserts `toHaveScreenshot()` against a stored baseline with a
   per-fixture `maxDiffPixels` tolerance. Chromium 1x, 2x, and 3x projects are
   all part of the default visual gate; the DPR label is derived from the
   project name so each tier has its own reviewed baseline.
4. On failure, `scripts/build-visual-diff-manifest.mjs` collects baseline/current/diff PNGs into
   `visual-diff-report/` + a `manifest.json`. CI uploads this directory as an artifact.
5. `tests/e2e/visual/review.html` — static page, no server, no build step. Point it at a
   downloaded `visual-diff-report/manifest.json` (or a local one after running the script
   yourself) to see every failing fixture with baseline/current/diff side by side, zoom-and-pan
   per pane, and an "Accept" button that reveals the exact `--update-snapshots` command to run
   locally (a static page can't write files for you — this is the honest version of "accept").

## Scope: coverage boundaries

This harness tests `replayIr` (the primitive-painting layer). The companion
`tests/e2e/canvas/visual-compositing.spec.ts` mounts the actual editor and
covers the `CanvasArea.tsx`/`replaySubtreeToCtx` orchestration layer: nested
group isolation, container compositing, and clip-mask output. Keeping those
two layers separate makes a failing image identify the renderer or the scene
orchestration that changed.

**Shipped replay fixtures**: multiple node types (rect/circle/ellipse/text),
multilingual text covering RTL, script fallback, combining marks, ligatures,
and ZWJ emoji, opacity, four blend modes, translated/rotated linear and radial
gradients, angular/conic and diamond gradients, image fill fill/fit/crop/tile
and transform variants, CSS and software adjustment filters including a LUT,
all line caps, joined/dashed strokes, a fixed-time motion/bound-property
sample, and a 1,500-item pathological scene.

**Shipped editor-compositing coverage**: nested groups with group opacity and
isolation, real clip-mask raster output, and a canvas/layers snapshot of the
resulting user-visible state. Existing interaction specs continue to cover
mask editing, feather/density/invert, persistence, and adjustment targeting.

**Runtime coverage**: Chromium 1x/2x/3x is the default gate. A GPU-backed
Chromium visual project has a separate snapshot namespace and is available via
`pnpm e2e:visual:gpu`; Firefox and WebKit replay projects have separate
snapshot namespaces via `pnpm e2e:visual:cross-runtime`. Playwright snapshot
names include the runtime and host platform, so Linux, macOS, and Windows
baselines cannot overwrite one another. New platform baselines must be
generated and reviewed on that platform before enabling that platform as a
required gate.

## Font pinning

The fixture corpus uses `sans-serif` for text, including the multilingual fixture. This resolves
to the runner's default sans font and script fallback fonts, so font availability differs between
CI and dev machines. The Linux CI image is the canonical text-rendering environment; cross-platform
projects intentionally keep platform-specific baselines rather than hiding font changes behind a
large pixel tolerance. A future font-bundle change should update the multilingual fixture and its
platform baselines as one reviewed change.

## Running locally

```bash
pnpm e2e:visual
pnpm e2e:visual:gpu                 # separate GPU/driver snapshot namespace
pnpm e2e:visual:cross-runtime        # Firefox + WebKit replay projects
node scripts/build-visual-diff-manifest.mjs   # only needed after a failure, to build the review report
# then open tests/e2e/visual/review.html directly in a browser and point it at visual-diff-report/manifest.json
```

To accept new baselines after an intentional rendering change:
```bash
pnpm exec playwright test tests/e2e/visual/replay.spec.ts --project=chromium-visual-1x --project=chromium-visual-2x --project=chromium-visual-3x --update-snapshots
```
