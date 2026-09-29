# Screenshot pipeline defect audit — 2026-09-29

Prioritised matrix for the producer-to-consumer chain. **Source inspection is
labelled as such**; only items marked *reproduced* were executed.

Ranking follows the task's stated order: false success, missing/wrong imagery,
privacy leakage, and destructive synchronization come before polish.

## Reproduced on the shared checkout (before any fix)

| # | Command / action | Observed |
|---|---|---|
| P1 | `node scripts/screenshots/validate.mjs` | **exit 1**, `FAIL orphan file in public/screenshots: performance-settings-dark.png`, `FAIL orphan file in docs/screenshots/product: debug-workspace-shared-workflows.png`, plus `WARN captured PNG set is 6.34 MB total (warn threshold 5 MB)`. The published gate is red on `master`. |
| P2 | `grep -rn performance-settings` | `apps/website/src/pages/docs/settings.astro:178` renders `/screenshots/performance-settings-dark.png` via a **hardcoded path**, bypassing the manifest. No canonical copy exists in `docs/screenshots/product/`. |
| P3 | `git status --short` at start | `debug-workspace-shared-workflows.png` is an **untracked** artifact in `docs/screenshots/product/` written by a concurrent `VARVE_SHOT_DEBUG` run — a debug dump landing in the canonical published directory. |
| P4 | `du -sh apps/website/public/screenshots` | 61 MB total, of which 54 MB is the separately-validated `workflows/` media. The manifest PNG set is 6.34 MB and already above its 5 MB warn threshold. |

## Prioritised matrix

| # | Scene / consumer | Expected claim | Implementation | Observed issue | Root cause | Smallest fix | Acceptance evidence |
|---|---|---|---|---|---|---|---|
| A1 | every scene (`openDemoDocument`) | "the intended document is on screen" | `setInputFiles` → `waitForTimeout(1500)` → assert `.editor-shell` + `.editor-canvas` visible | A failed or rejected document load still passes: the shell and canvas are visible from the *previous* document, and the sleep only makes the wrong state likelier to be captured | Readiness asserted on generic chrome that exists regardless of which document loaded; fixed sleep as primary correctness mechanism | Assert the editor's own document heading (`h1.sr-only` = `<file> — Varve`) and a bounded canvas-stability wait | `product.mjs` readiness helpers; failure-injection check in §"Validation results" |
| A2 | capture run | "a captured scene is a new capture" | `manifest` read once at start, written once at end | A concurrent manifest write (several agents share this checkout) is silently overwritten — a lost update | No compare-and-swap against the reviewed revision; non-atomic manifest and image writes | Record the manifest digest at start, re-check before writing, refuse on change; write files and manifest via temp+rename | `product.mjs` concurrency guard; `validate.mjs` provenance checks |
| A3 | all captures | "every published PNG is owned by the manifest" | `generatedExtras` hardcodes two filenames; orphan check globs only `*.png` at the top level | P1/P2: an asset with no manifest entry is served to visitors and only surfaces as a validator failure | Two hand-maintained exemption lists instead of one registry; a hand-copied asset was never routed through the pipeline | One documented source-asset registry (producer spec + reason); register `performance-settings-dark.png` and consume it through the manifest | `validate.mjs` + `screenshots.test.ts` + `settings.astro` consumer change |
| A4 | `ProductShowcase` detail row | "each crop shows one thing" | `.showcase-detail img { aspect-ratio: 4/3; object-fit: cover }` for **every** detail scene | The `layers` crop is 288x380 (portrait) and the tablet crop is 1200x750; forcing both into a 4:3 `cover` window crops away the very rows/regions their captions describe | One generic `object-fit: cover` + fixed ratio applied to crops with unrelated intrinsic aspects | Per-placement fit policy derived from real capture geometry (a `kind` recorded by the pipeline), `contain` for detail crops | Visual inspection at 390/768/1280/1440 + crop/fit spec |
| A5 | `FeatureVisual` | "panels are not upscaled past 1:1" | `img[width='320'] { max-width: 320px }` — a magic intrinsic-width attribute selector | Any future 320-wide scene that is *not* a panel crop inherits the rule; a 336-wide panel crop silently loses it | Layout decided from a numeric attribute instead of declared scene kind | Same `kind`-driven policy as A4 | As A4 |
| A6 | `ProductShowcase` fallback | "missing images degrade clearly" | placeholder renders `Run pnpm screenshots:product to produce them` | A developer capture command is shown to **visitors** on a production build | Diagnostics authored into the visitor-facing fallback | Visitor-safe fallback sentence + build/review diagnostic | Website spec asserting fallback copy |
| A7 | all captures | "provenance is recorded" | `entry.lastValidatedAgainst = null` always; no source revision captured | The stored revision field is permanently null, so nothing ties an image to the code it depicts | Field written without a value | Record `sourceRevision`/`sourceDirty`/`sourceDigest` and populate `lastValidatedAgainst` | `validate.mjs` provenance assertions |
| A8 | `validate.mjs` | "the file is a real PNG" | signature + IHDR read only | A truncated or byte-corrupted PNG that keeps its dimensions and byte length passes; the video docs copy is compared by **length only** | Cheap header sniff treated as decode; `length !==` used as an equality proxy | Real chunk walk (CRC32 + zlib inflate) and a uniform/blank heuristic; byte equality for video copies | `image-analysis.mjs` unit tests + `validate.mjs` |
| A9 | debug artifacts (P3) | "diagnostics never reach published directories" | `page.screenshot({ path: join(OUT_DIR, ...) })` under `VARVE_SHOT_DEBUG` | A debug dump lands in `docs/screenshots/product/`, the canonical published directory, whenever a run fails with debug on | Debug output path derived from the publish path | Write diagnostics under `reports/screenshot-debug/`; validator surfaces any stray `debug-*` in published dirs | `product.mjs` + validator |
| A10 | responsive delivery (source-inspected) | "visitors download an appropriate size" | every screenshot is a full-size PNG in `public/`, served as-is | Astro does not optimize `public/`; `sharp` is absent, so `<Image>`/`<Picture>` cannot be used without adding a dependency; no `srcset` exists | No derivative step and no responsive markup | Pipeline-generated WebP derivatives + manifest variants + explicit `<picture>` consumption | Manifest variant validation + website `currentSrc`/transfer check |
| A11 | `lastValidatedAgainst` / pruning (source-inspected) | "a removed scene disappears" | prune loop preserves any entry with `source` | Correct for E2E-produced scenes, but the `source` field was undocumented in the validator, so an E2E asset could drift with no check | Exemption without a guard | Validator requires `source` scenes to declare an existing producer path | `validate.mjs` |

## Separate from Varve (content design, not a pipeline defect)

The scene set is broad but weighted toward full application frames. Scene-level
gaps are tracked in the scene registry (`SCENES` in `product.mjs`) rather than
here: the `object-selection`, `asset-search` and `asset-similarity` scenes
remain explicitly blocked (model/index prerequisites), and `image-tools` shows
their entry points rather than implying the operations succeed.
