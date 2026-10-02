# Product screenshot pipeline

Marketing and documentation screenshots of the Varve application are
generated — never hand-copied — by driving the real editor into
deterministic states.

## Commands

| Command | What it does |
|---|---|
| `pnpm screenshots:product` | Capture every scene into `docs/screenshots/product/`, sync a copy into `apps/website/public/screenshots/`, and rewrite `apps/website/src/data/screenshot-manifest.json` |
| `node scripts/screenshots/product.mjs --normalize` | Re-derive the manifest's *measurable* metadata (dimensions, hashes, kind, crop, viewport) from the already-published files without recapturing anything |
| `pnpm screenshots:og` | Render the 1200x630 social-card image from `scripts/screenshots/og-template.html` into `apps/website/public/og-image.png` |
| `pnpm screenshots:workflow` | Record a 10-20s deterministic editing workflow as WebM (+ optional MP4 via ffmpeg) |
| `pnpm screenshots:website` | Build the website and validate the manifest (fails on broken/missing references) |
| `pnpm screenshots:update` | Capture + OG + workflow + build + strict validation (fails if any scene cannot be captured) |
| `node scripts/screenshots/sync-plugin-scenes.mjs <e2e-output-dir>` | Sync visually reviewed plugin-manager captures from a completed E2E run and update only the four plugin scenes in the manifest |

Targeted capture: `pnpm screenshots:product -- --scenes workspace,vector`
Strict mode: `pnpm screenshots:product -- --strict` (exit non-zero on any skip)

`--normalize` exists because a metadata change should not re-shoot every image:
screenshots are dependency-aware evidence, so adding a `kind` field re-measures
the files rather than churning 34 committed binaries. It refuses to write a
`capturedAt` or `lastValidatedAgainst` for a scene it did not capture, and marks
such records `provenanceUnknown: true` instead of backfilling a guessed date or
revision. Legacy records therefore stay visibly unverified until they are
recaptured.

To inspect captures before changing published screenshots, use a review directory:

```bash
pnpm screenshots:product -- --scenes typography,typography-panel,font-toolbar,font-browser --strict --review-dir reports/font-capture-review
# Inspect each PNG, then sync exactly the approved scenes:
pnpm screenshots:product -- --scenes typography,typography-panel,font-toolbar,font-browser --review-dir reports/font-capture-review --sync-reviewed
```

Review captures do not change website images or its manifest. Sync checks each
capture's recorded SHA-256 and preserves all other scene entries. It does not
rerun the editor or approve an image automatically.

The reusable-pattern workflow is scene `patterns`, produced exclusively by
`tests/e2e/canvas/pattern-document-alignment.spec.ts`. It creates a real pattern
fill, changes its alignment through the Inspector, and verifies the resulting
canvas pixels. Capture through that spec, inspect its PNG, then import and
promote the isolated producer output:

```sh
VARVE_E2E_PORT=1492 VARVE_E2E_OUTPUT_DIR=pattern-release-review node scripts/quality/heavy-lease.mjs "e2e: pattern capture" -- pnpm exec playwright test tests/e2e/canvas/pattern-document-alignment.spec.ts --project=chromium --workers=1 --update-snapshots=none
node scripts/screenshots/product.mjs --normalize --source-scenes-dir test-results/pattern-release-review --scenes patterns --review-dir reports/pattern-review
node scripts/screenshots/product.mjs --scenes patterns --review-dir reports/pattern-review --sync-reviewed
```

The plugin scenes come from the real editor state driven by
`tests/e2e/plugins/local-manager.spec.ts`. After running the spec and opening
`plugin-inspector.png`, `plugin-manager-pinned.png`,
`plugin-review-dark-1024.png`, and `plugin-rename-preview.png` for visual review,
sync those exact captures with:

```sh
node scripts/screenshots/sync-plugin-scenes.mjs test-results/<run-directory>
```

The sync step requires exactly one file for each scene, validates PNG
dimensions and size, copies the approved bytes to both canonical directories,
and refreshes each scene's hash and validation revision. It does not capture a
page or make a visual decision.

Every run prints `this run: N scene(s) attempted` and fails when `N` is zero.
The manifest totals printed beside it describe stored state, not the run — a
run that captured nothing still reports a manifest full of captured scenes,
so the per-run tally is the line to read.

Externally produced scenes require a receipt written by their owning spec at
the capture itself. `captureProducerScreenshot` records the actual browser,
viewport, DPR, theme, source revision and source digest alongside the PNG in
isolated `test-results/` output. It refuses a source change during the shot.
Import checks the owning spec, dimensions and SHA-256 against that receipt;
it never substitutes the import-time HEAD. A repeated capture with identical
pixels can therefore acquire fresh evidence without rewriting its image bytes.

Run the owning workflows from the committed product source with one worker and
the heavy-task lease, then inspect the PNGs before importing an explicit list:

```sh
VARVE_E2E_PORT=1492 VARVE_E2E_OUTPUT_DIR=release-product-producers node scripts/quality/heavy-lease.mjs "e2e: product screenshot producers" -- pnpm exec playwright test tests/e2e/canvas/comic-lettering.spec.ts tests/e2e/canvas/pattern-document-alignment.spec.ts tests/e2e/settings/performance-guidance.visual.spec.ts tests/e2e/inspector/token-binding-runtime.spec.ts tests/e2e/workspace/effect-studio.spec.ts tests/e2e/canvas/raster-magic-wand.spec.ts tests/e2e/paint/clipped-vector-texture.spec.ts tests/e2e/canvas/concept-art-references.spec.ts tests/e2e/plugins/local-manager.spec.ts tests/e2e/effects/tonal-workflows.spec.ts --project=chromium --workers=1 --update-snapshots=none
node scripts/screenshots/product.mjs --normalize --source-scenes-dir test-results/release-product-producers --scenes performance-settings,design-tokens-contrast --review-dir reports/producer-review
# Inspect the selected review PNGs, then promote only those scenes:
node scripts/screenshots/product.mjs --scenes performance-settings,design-tokens-contrast --review-dir reports/producer-review --sync-reviewed
```

`source-scenes.mjs` is the complete scene-to-producer/filename map, including
plugins and tonal workflows. Compatibility plugin/tonal sync commands use
this same schema-2, receipt-checked import path and accept reviewed captures
beneath `test-results/`. Patterns has one producer, so its review cannot be overwritten by a second
workflow copying older published bytes.

## Source of truth

- **Canonical captures:** `docs/screenshots/product/*.png` — consumed by
  GitHub Markdown and repository docs.
- **Website copies:** `apps/website/public/screenshots/*.png` — synced by
  the capture script; never committed by hand.
- **Manifest:** `apps/website/src/data/screenshot-manifest.json` — the only
  place alt text, captions, themes and validation state live. The website
  renders screenshots from the manifest, so a missing capture degrades to a
  clear placeholder instead of a stale image.

## Provenance (manifest schema 2)

Every run records what it was, independently of the volatile run clock:

| Field | Meaning |
|---|---|
| `sourceRevision` | exact `git rev-parse HEAD` at capture time |
| `sourceDigest` | sha256 of the revision plus the uncommitted status/diff of the paths that decide what a capture looks like (`scripts/screenshots`, `packages/editor/src`, `packages/scene/src`, `packages/engine/src`, `packages/shared/src`, `packages/compositor/src`, `apps/desktop/src`) |
| `sourceDirty` | whether those paths had uncommitted changes |
| `captureTool` / `provenance.runtime` | Playwright + Chromium version, and whether this was a capture or a metadata-only `--normalize` |
| per scene `capturedAt`, `lastValidatedAgainst` | written only by a run that actually captured the scene |
| per scene `provenanceUnknown` | this record was normalised, not captured — its date and revision are unknown, not filled in |

`generatedAt` is volatile and is never used as content identity; content
identity is the per-scene `sha256`, which contains no timestamp.

## Non-destructive by default

- Captures and the manifest are written with temp-file + rename, so a website
  build or another process never observes a half-written image or manifest.
- The manifest is read once at the start of a run and re-checked before it is
  written. If another writer changed it in the meantime, the run **refuses to
  overwrite it** rather than silently discarding their scenes.
- A failed scene deletes only its own previous output; it never leaves a stale
  image behind for the site to keep serving.
- Diagnostic frames from a failing run (`VARVE_SHOT_DEBUG=1`) are written to
  `reports/screenshot-debug/`, never next to published captures. A `debug-*.png`
  appearing in a screenshots directory is stale local state and is reported by
  the validator.
- The dev server is terminated as a process group. Killing only the `pnpm` pid
  used to leave a Vite server listening on the capture port after every run.

## Readiness

A capture is taken when the application says it is ready, not after a sleep:

1. **Document identity.** `openDemoDocument` waits for the editor's own
   screen-reader heading (`<file> — Varve`) to name the fixture it just opened.
   The previous implementation slept 1500 ms and then asserted generic chrome
   that is visible regardless of which document loaded, so a rejected or failed
   load could be captured as the intended document.
2. **Fonts.** Every font family referenced by the fixture's text nodes is read
   from the committed document and required to be loaded before the shot, so a
   substituted face fails the scene. Late loads are waited for, not assumed.
3. **Canvas stability.** The canvas region is sampled until two consecutive
   frames are byte-identical (bounded), then the mouse is parked and sampling
   repeats. Two `requestAnimationFrame` ticks alone prove nothing about a
   pipeline that commits a worker bitmap later.
4. **Not blank.** The captured bytes are decoded; a valid-but-uniform frame is
   rejected before it can be published.

`--strict` turns any skip into a non-zero exit. The run prints its own tally
(`attempted`, `captured`, `failed-to-capture`, `opted out`) separately from the
manifest totals, because a run that captured nothing still leaves a manifest
full of previously-captured scenes.

## Cropping and framing

Two mechanisms, in order of preference:

- **Measured** (`clipFrom`): a scene names real containers (`selector`, and
  optionally `top`/`bottom`) and the crop window is measured from them after
  the document, fonts and selection have settled. The `layers` scene uses this;
  its previous fixed window started framing a "Design Canvases" block that was
  added above the layer list.
- **Fixed** (`clip` in `CROP`): used only where the region genuinely is fixed
  geometry (the canvas column, the inspector column, the timeline strip).

Either way the clip is recorded in the manifest, validated to fit the viewport
it was taken from, and matched against the captured file's dimensions. Each
scene also records a `kind`:

| kind | meaning | website fit policy |
|---|---|---|
| `full` | whole application frame | fills the column at its own ratio |
| `detail` | crop of one region | fills the column at its own ratio |
| `panel` | narrow column (inspector, layers) | capped at its intrinsic pixel width, never upscaled |
| `wide` | short full-width strip (timeline) | fills the column at its own ratio |

The website derives its fit policy from `kind`. It previously applied one
`aspect-ratio: 4/3; object-fit: cover` to every detail crop, which cut a
portrait layer-panel crop down to a landscape window — the image no longer
contained the rows its caption described, and nothing failed.

## Demo documents

The captures open **real Varve documents**, authored in
`scripts/screenshots/demo-document.ts` with the same `@varve/scene` factories
the application uses, and loaded through the application's own File > Open
input. Nothing is mocked or staged: the editor renders these documents exactly
as it renders a user's own work.

Encoded copies live in `scripts/screenshots/fixtures/*.varve` so the capture
script (plain Node) can read them without a TypeScript loader. They are
regenerated with:

```bash
UPDATE_DEMO_DOCS=1 pnpm test:website
```

`apps/website/src/test/demoDocuments.test.ts` re-encodes every document and
fails if a fixture is stale, so the committed bytes can never drift from the
generator or the document codec.

Scripting mouse drags was the previous approach; it produced a single flat
rectangle and depended on tool timing. Authoring the document instead gives a
seeded composition that exercises gradients, strokes, Bézier geometry, blend
modes and a real type hierarchy.

## Scenes

| Scene | Theme | Crop | Captures |
|---|---|---|---|
| `workspace` | light | full | Poster document, headline selected, inspector populated |
| `workspace-dark` | dark | full | Same document, dark theme |
| `vector` | light | canvas | Path in node-edit mode — anchors and Bézier handles |
| `typography` | light | canvas | Type specimen: display, character set, subhead, body |
| `typography-panel` | light | inspector | Font family, weight, size, line height, tracking |
| `font-toolbar` | light | full | Compact text toolbar with font picker open |
| `font-browser` | light | full | Family browser with editable local specimen |
| `layers` | light | layers | Named layers with blend-mode and opacity badges |
| `layout` | light | full | Two-page editorial spread |
| `motion` | dark | timeline | Timeline panel with a real position keyframe |
| `palette-inspector` | light | full | Palette Inspector open on a real imported photo |
| `enhance-dialog-auto` | light | full | Enhance dialog, Auto mode, on a real degraded photo |
| `export` | light | full | Advanced export dialog: destination, filename template, formats |
| `print-production` | light | full | Bleed guides on canvas and the Page Print inspector |
| `vectorize` | light | full | Vectorize dialog in colour mode on an imported photo |
| `effects` | light | full | Effects inspector with a real drop shadow added to a shape |
| `image-tools` | light | inspectorTall | Enhance, Vectorize, Object Selection, Background Removal, Depth Blur |
| `workspaces` | light | full | Print workspace active — Masters, Pages, and Spreads panels |
| `workspace-shared-workflows` | light | 936×900 compact | Design with Logo project controls and shared Code output beside the same poster document |

Detail scenes are cropped **at capture time** (`clip`), because the website
shows them at roughly a third of the page width where a scaled-down full
window is an unreadable smear.

### Model-dependent scenes

`background-removal` and `depth-blur` run real on-device inference. They need
their model files present in `apps/desktop/public/models/`, which the dev
server serves at `/models/<filename>`. That directory is gitignored, so the
models are a **local prerequisite, not a committed asset** — a checkout
without them skips these two scenes with a reason rather than failing.

`apps/desktop/public/models/manifest.json` is the source of truth: each entry
carries the `filename`, the `localPath` the loader requests, and a pinned
`sha256`. Stage a model by copying it in and verifying that checksum. Never
serve a file whose hash does not match the manifest — the pinned hash is the
only provenance guarantee these binaries have.

The capture browser enables the Vulkan path for renderer/WebGPU diagnostics,
but the optional Depth-Anything model is INT8 and is deliberately catalogued as
CPU/WASM-only. Inference therefore still takes **minutes rather than seconds**
on this path. Each scene allows up to fifteen minutes before giving up; that
ceiling exists to catch a genuinely stuck run, not to bound normal work.

Still without a scene:

| Feature page | Blocked on |
|---|---|
| `object-selection` | SAM2 encoder — the only local copy fails the manifest checksum, so it is not served |
| `asset-search` | an embedding index built over a document's assets |
| `asset-similarity` | the same index |

The `image-tools` scene covers the **entry points** for these — the inspector
sections a user opens to reach them — which is capturable without a model and
honest about what it shows. `local-first` has no single panel that depicts it;
its evidence is the absence of an account, not a screen.

`SCENES` in `product.mjs` is the source of truth for what exists. A newly
added scene seeds its own manifest entry, and an entry whose scene has been
removed is pruned along with its files on the next full run — so the manifest
stays a generated view rather than something to hand-edit.

Scenes that cannot be produced are recorded as `skipped` with a reason, and
any previous output file is **deleted** — never silently replaced by an older
screenshot. The motion scene authors a real position keyframe through the
application's keyboard shortcut before capture, so the timeline screenshot
does not claim more than the fixture actually demonstrates.

Two scenes have non-obvious preconditions worth keeping in mind when editing
them:

- **`print-production`** needs bleed guides toggled on (`Ctrl+Shift+2`).
  `bleedGuidesVisible` defaults to `false`, and `CanvasOverlays` only mounts
  `PagePrintOverlays` while it is on — so setting bleed values without the
  toggle renders nothing at all. The scene also places its rectangle
  numerically so the artwork crosses the trim edge, because a bleed guide
  around artwork that stops short of the trim does not show what bleed is for.
- **`vectorize`** switches to colour mode. The dialog opens on the B&W "crisp
  black logo" preset, which is right for line art and wrong for a photograph —
  it traces the fixture into hundreds of paths and raises a complexity warning.

The `palette-inspector` and `enhance-dialog-auto` scenes are the two
exceptions to "committed document fixtures rather than scripted drawing"
below: palette extraction and enhance analysis only mean something against
real photographic content, which can't be authored as vector shapes the way
the other demo documents are. Both import a real, rights-cleared photo
through the application's own image-import input (`#file-import-input`) —
see `fixtures/PROVENANCE.md` for its source, license, and the deterministic
transform used to produce the degraded variant `enhance-dialog-auto` needs to
show a real recommendation instead of "no restoration needed."

## Workflow video

A deterministic workflow video (10-20 seconds) demonstrates a real editing
flow — opening a document, selecting a shape, editing Bézier handles, and
opening the export dialog. The video is recorded by Playwright's built-in
video recording (`recordVideo` option) against the same seeded demo documents
used for screenshots.

### Recording

```bash
pnpm screenshots:workflow    # record + transcode to WebM/MP4
pnpm screenshots:workflow -- --no-mp4  # skip ffmpeg transcode
```

The script (`scripts/screenshots/workflow.mjs`):

1. Launches the dev server and opens the editor (same as `screenshots:product`);
2. Loads the poster demo document and fits it — this is the setup, and it is
   trimmed off the delivered cut;
3. Records a scripted sequence: select the headline → select the `Contour`
   path → enter node edit mode → exit → select the page → open the export
   dialog → close → fit-all;
4. Writes the trimmed WebM to `docs/screenshots/product/workflow.webm`;
5. Writes a trimmed MP4 alongside it via `ffmpeg` when available;
6. Extracts the first frame of the delivered cut as `workflow-poster.png`
   (poster for the website embed and the reduced-motion still);
7. Copies all outputs to `apps/website/public/screenshots/` for the website.

Node editing is demonstrated on the poster's `Contour` layer because it is an
actual Bézier path. Driving the same sequence through a text layer moves the
headline instead of editing nodes, which is not what the mode does.

### Trimming

The application's cold start (splash, file browser, New-document dialog) is
recorded but cut. The trim point is **measured at runtime** — the script marks
the moment the document is loaded and fitted, and trims to that offset — so it
tracks real load time on the machine doing the recording instead of a
hardcoded guess that silently rots.

Trimming re-encodes rather than stream-copies, so the cut lands on the exact
frame rather than the nearest keyframe.

### Budget

- Target: 10-20 seconds, under 5 MB (WebM), under 10 MB (MP4).
- The recorder **fails** above 20 seconds and warns below 10, so a sequence
  that grows gets re-cut rather than shipped long.
- The validation script warns at 5 MB and fails at 10 MB for any single
  video asset.
- Without `ffmpeg` the untrimmed WebM ships with a warning, no MP4 and no
  poster are produced — the cut then opens on the application's cold start,
  and the website embed falls back to its first loaded frame.

### Where the video is embedded

The website embeds `workflow.webm` / `workflow.mp4` directly on the
[product page](../../apps/website/src/pages/product.astro) ("Watch a
workflow"), because it serves them itself. The embed carries a poster frame —
`workflow-poster.png`, the first frame of the delivered cut, extracted by this
script — and swaps the video for that still under `prefers-reduced-motion`,
so no essential content is motion-only.

**The repository README still uses still screenshots.** GitHub strips
`<video>` elements from rendered Markdown, and a `src` pointing at a file in
the repository will not play — GitHub only plays video served from
`githubusercontent.com`. Getting that URL is a manual, owner-only step: drag
the file into a GitHub web editor (README, issue, release, or discussion),
which uploads it and returns a `githubusercontent.com` link to paste in. That
link cannot be generated by this pipeline.

### Accessibility

The workflow video must not convey essential information that isn't also
available in the surrounding text or screenshots. Alt text on the `<video>`
element describes the workflow shown. The website respects
`prefers-reduced-motion` and hides the video for users who prefer reduced
motion.

## Determinism

- Fresh browser context per scene (no localStorage/IndexedDB leakage);
- first-run UI (welcome dialog, onboarding checklist, "Did you know?" tips) is
  suppressed by seeding the persisted state a returning user would have —
  the application needs no screenshot mode;
- committed document fixtures rather than scripted drawing;
- framing asserted via Fit-all plus a zoom read-back, so a scene fails rather
  than shipping a mis-framed capture (note: selecting a layer reveals and
  zooms to it, so scenes select *then* fit);
- fixed 1440x900 viewport at DPR 1 with reduced motion, except scenes that
  declare their own `viewport` (the `layers` panel needs a taller window for its
  list to take its flex space; the manifest records the viewport actually used);
- waits on document identity, fonts, canvas stability and a decode check rather
  than fixed sleeps;
- mouse parked off-canvas before capture (no hover ambiguity);
- no text-edit carets, no playhead animation, no notifications.

## Validation

`node scripts/screenshots/validate.mjs [--strict] [--scenes a,b]` checks:

- the manifest schema, provenance fields, and that every scene declares
  file/alt/caption/feature/theme/kind with a known status;
- file names are bare names (no traversal, no nested path) and unique;
- every captured PNG **decodes**: every chunk CRC is verified and the image data
  is inflated (`lib/image-analysis.mjs`). A truncated file, or a byte-flipped
  file that keeps its dimensions and byte length, fails;
- a uniform/blank image is flagged (a heuristic that can reject obvious output,
  never certify good output);
- every captured PNG matches its manifest SHA-256, its recorded dimensions and
  its crop/viewport metadata, and is byte-identical to its canonical copy;
  video copies are compared byte-for-byte, not by length;
- declared `variants` exist, decode, are byte-equal across both output
  directories, and never upscale their source;
- scenes whose producer is an external E2E spec point at a file that exists;
- skipped entries carry a reason;
- every `/screenshots/` reference in docs, README and website sources resolves
  to a captured entry or a documented generated asset. The check covers plain
  attributes, Markdown image syntax, and paths inside template expressions —
  the last form is what hid three references to files that do not exist;
- individual PNG file size stays under 2 MB (warn at 1 MB);
- total captured PNG set stays under 10 MB (warn at 5 MB);
- no orphan PNG/WebP in either output directory;
- workflow video and poster budgets, and cross-directory byte equality.

A reference from a file with uncommitted changes is reported as a warning
rather than a failure: this checkout is shared and a neighbour mid-edit may be
about to add the asset. The same reference in a committed file fails, so the
commit/CI run is where a genuinely broken reference breaks.

A Vitest mirror runs in `pnpm test:website` (`src/test/screenshots.test.ts`,
`src/test/imageAnalysis.test.ts`, `src/test/screenshotLib.test.ts`), and the
browser-side delivery contract is
`apps/website/tests/e2e/screenshot-delivery.spec.ts`.

## Website consumption

Screenshots reach the site through one contract:

- `src/lib/screenshot.ts` — scene lookup, kind, fit style, `src`/`srcset`/`sizes`
  built from the manifest's measured dimensions and any generated variants.
- `ScreenshotImage.astro` — the image element (`<picture>` when variants exist).
- `ScreenshotZoom.astro` — the image plus an accessible "view full size"
  control: a real labelled button, native `<dialog>` (top-layer, inert
  background, Escape), focus returned to the trigger, and a `<noscript>` link
  fallback. It points at the already-displayed URL, so opening it transfers no
  extra bytes, and it shows the capture at its intrinsic size in a scrolling
  dialog rather than shrinking a 1440px window to a phone width.
- `FeatureVisual.astro` — a feature-page figure with the manifest caption.
- `ProductShowcase.astro` — the homepage window + detail row.

A literal `/screenshots/<file>` path in a component is therefore a test
failure (`src/test/screenshots.test.ts`): the only exceptions are
`lib/screenshot.ts` (which builds the URL) and the workflow video on
`pages/product.astro` (which is not a manifest scene).

## Known limitations

- Captures are DPR 1. Panel crops are capped at their intrinsic pixel width, so
  they are never enlarged in CSS, but a DPR 2 display resamples them. Capturing
  detail/panel scenes at DPR 2 is not implemented; it needs a `displayWidth`
  concept in the manifest before the intrinsic `width`/`height` attributes can
  stay in CSS pixels.
- No WebP/AVIF variants are generated yet. `public/` is copied as-is by Astro
  and `sharp` is not installed, so there is no build-time image service; the
  manifest already carries a `variants` contract (`lib/screenshot.ts` emits
  `srcset`/`sizes` when variants exist) and the validator already checks them,
  but the generation step itself is not written.
- Screenshots whose producer is an E2E spec (plugin manager, tonal, comic
  lettering, the settings/design-token visuals) are registered and verified by
  this pipeline but re-recorded only by their owning spec.
