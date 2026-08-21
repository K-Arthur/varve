# Product screenshot pipeline

Marketing and documentation screenshots of the Varve application are
generated — never hand-copied — by driving the real editor into
deterministic states.

## Commands

| Command | What it does |
|---|---|
| `pnpm screenshots:product` | Capture every scene into `docs/screenshots/product/`, sync a copy into `apps/website/public/screenshots/`, and rewrite `apps/website/src/data/screenshot-manifest.json` |
| `pnpm screenshots:og` | Render the 1200x630 social-card image from `scripts/screenshots/og-template.html` into `apps/website/public/og-image.png` |
| `pnpm screenshots:workflow` | Record a 10-20s deterministic editing workflow as WebM (+ optional MP4 via ffmpeg) |
| `pnpm screenshots:website` | Build the website and validate the manifest (fails on broken/missing references) |
| `pnpm screenshots:update` | Capture + OG + workflow + build + strict validation (fails if any scene cannot be captured) |

Targeted capture: `pnpm screenshots:product -- --scenes workspace,vector`
Strict mode: `pnpm screenshots:product -- --strict` (exit non-zero on any skip)

Every run prints `this run: N scene(s) attempted` and fails when `N` is zero.
The manifest totals printed beside it describe stored state, not the run — a
run that captured nothing still reports a manifest full of captured scenes,
so the per-run tally is the line to read.

## Source of truth

- **Canonical captures:** `docs/screenshots/product/*.png` — consumed by
  GitHub Markdown and repository docs.
- **Website copies:** `apps/website/public/screenshots/*.png` — synced by
  the capture script; never committed by hand.
- **Manifest:** `apps/website/src/data/screenshot-manifest.json` — the only
  place alt text, captions, themes and validation state live. The website
  renders screenshots from the manifest, so a missing capture degrades to a
  clear placeholder instead of a stale image.

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
but the bundled Depth-Anything model is INT8 and is deliberately catalogued as
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
6. Copies both to `apps/website/public/screenshots/` for the website.

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
- Without `ffmpeg` the untrimmed WebM ships with a warning and no MP4 is
  produced — the cut then opens on the application's cold start.

### Where the video can actually be embedded

The website can embed `workflow.webm` / `workflow.mp4` directly, because it
serves them itself.

**The repository README cannot.** GitHub strips `<video>` elements from
rendered Markdown, and a `src` pointing at a file in the repository will not
play — GitHub only plays video served from `githubusercontent.com`. Getting
that URL is a manual, owner-only step: drag the file into a GitHub web editor
(README, issue, release, or discussion), which uploads it and returns a
`githubusercontent.com` link to paste in. That link is what the README would
have to reference, so it cannot be generated by this pipeline.

Until then the README uses still screenshots, which render everywhere with no
upload step and no motion-accessibility caveats.

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
- fixed viewport 1440x900 at DPR 1 with reduced motion;
- waits on fonts/canvas/settle rather than fixed sleeps;
- mouse parked off-canvas before capture (no hover ambiguity);
- no text-edit carets, no playhead animation, no notifications.

## Validation

`node scripts/screenshots/validate.mjs [--strict]` checks:

- every captured manifest entry has a real, non-empty PNG with sane dimensions;
- manifest dimensions match the files;
- skipped entries carry a reason;
- every `/screenshots/` reference in docs/README/website sources resolves to a
  captured entry (no stale paths, no orphan files);
- individual PNG file size stays under 2 MB (warn at 1 MB);
- total captured PNG set stays under 10 MB (warn at 5 MB);
- no orphan PNGs in `public/screenshots/` or `docs/screenshots/product/`;
- workflow video files (`.webm`, `.mp4`) pass budget checks (warn 5 MB, fail 10 MB)
  and exist in both output directories when present.

A Vitest mirror runs in `pnpm test:website` (`src/test/screenshots.test.ts`).
