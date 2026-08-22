# Workflow capture pipeline

Seven deterministic videos, each demonstrating one Varve workflow through the
real application. They are separate clips on purpose: the website, README,
docs and launch material all want a single capability at a time, not one long
screencast.

This sits alongside `scripts/screenshots/`, which captures still product
screenshots and the single short `workflow.webm` embedded on the product page.
That pipeline is unchanged; this one reuses its determinism contract and adds
verification of the delivered file.

## Commands

```bash
pnpm capture:workflow <slug>                       # record one workflow
pnpm capture:group interaction                     # record a group
pnpm capture:all                                   # record all seven
pnpm capture:encode                                # encode verified WebM masters to MP4
pnpm capture:verify                                # verify canonical media without recording
```

Every run picks its own port (`14000 + pid % 900`) and its own scratch
directory unless `VARVE_CAPTURE_PORT` says otherwise, and starts its own Vite
rather than attaching to one it did not launch — several agents work in this
checkout at once, and an HMR update from someone else's edit resets the
editor mid-recording.

## The clips

| Slug | Workflow | Target length |
|---|---|---|
| `auto-layout` | Music-player playlist auto-layout | 18–28s |
| `component-variants` | Transit-ticket component variants | 20–30s |
| `prototype-interaction` | Travel-booking prototype flow | 18–28s |
| `smart-animate` | Expanding weather card | 15–24s |
| `motion-timeline` | Kinetic editorial title card | 22–32s |
| `export-react` | Pricing-plan Design → React | 18–28s |
| `light-dark-ui` | Same editorial project in light/dark UI | 12–18s |

Each produces, in `docs/screenshots/workflows/`:

```
<slug>.webm            VP9
<slug>.mp4             H.264, yuv420p, +faststart
<slug>-poster.png      first frame of the delivered cut
<slug>.capture.json    manifest: commit, fixture, durations, assertions, verification
```

Website copies land in `apps/website/public/screenshots/workflows/`. That
subdirectory matters: `scripts/screenshots/validate.mjs` treats any loose PNG
directly in `public/screenshots/` as an orphan.

## Product truth

Every recorded action goes through the real UI. Nothing is staged: no mocked
result is injected, no state is set behind the application's back to simulate
a command that is not there, and no clip is trimmed around a failure.

Fixtures may establish a starting document — that is setup, not the
capability — but the thing being demonstrated always happens on camera through
the production path. Where a workflow needs artwork, the clip either opens a
committed fixture through File > Open or draws the artwork before the cut
begins, and says which in its manifest.

Each `sequence` returns the list of product assertions it verified, and those
are written into the manifest. They are real assertions: the run fails if the
tracer produces no path nodes, if moving an anchor does not change the render,
if an axis slider does not span the range the font declares.

## Determinism

- fixed 1440×900 viewport at DPR 1, reduced motion, light scheme;
- a fresh browser context per capture, with first-run state seeded so the
  onboarding checklist and tips never float over the canvas;
- the dev server's module graph is warmed before recording, so a cold Vite
  transform is not recorded and then trimmed;
- the trim point is measured at runtime from context creation to the moment
  the sequence calls `begin()`, so it tracks real load time rather than a
  hardcoded guess;
- waits are on `document.fonts.ready` and two animation frames, not sleeps;
  the deliberate pauses that remain are for the viewer's comprehension, after
  state has already converged;
- the pointer is parked off-canvas before consequential frames.

Canvas coordinates are **fractions of the drawing area**, never window pixels.
The content canvas is what the panels leave behind — 832×778 inside a
1440×900 window at the time of writing — and a pen gesture that lands outside
it draws nothing while failing no assertion until the very end.

Node-edit anchors are read from `NodeEditOverlay`'s SVG rather than assumed:
selecting a layer reveals and zooms to it, so the coordinates a shape was
drawn at are not where its anchors sit once node editing opens.

## Verification

Playwright exiting zero is not evidence. For every delivered clip the harness:

1. probes codec, dimensions, frame rate, duration and size with `ffprobe`;
2. extracts frames at start, 25%, 50%, 75% and the last meaningful frame into
   `docs/screenshots/workflows/frames/`;
3. screens each frame's mean luma for black and blank output;
4. fails the capture if any page error was raised during recording.

Findings are printed and written into the manifest, and a clip with findings
exits non-zero. The extracted frames are there to be looked at — the automated
screen catches black and blank frames, not a tooltip covering the subject or a
panel clipped at the wrong width.

## Fixtures

`scripts/capture/fixtures/` holds committed assets. Bitmaps are generated from
committed SVG sources by `generate.mjs`, which rasterises through Chromium —
already a dependency here — so the bytes do not depend on whether the machine
happens to have rsvg or ImageMagick.

The botanical illustration is flat colour with clean edges on purpose:
tracing a photograph produces hundreds of overlapping paths and a complexity
warning, which demonstrates the tracer's failure mode rather than its purpose.
