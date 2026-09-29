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

## Results after the fixes

| # | Fix | Evidence |
|---|---|---|
| A1 | Document-identity readiness replaces the fixed sleep | `product.mjs` `openDemoDocument`; a review capture of `workspace` and `layers` succeeded with the identity check active, and the failure path names the document it was still showing |
| A2 | Atomic writes + manifest compare-and-swap | `product.mjs` `writeFileAtomicSync` + the digest re-check before writing; `--sync-reviewed` additionally verifies the published manifest digest recorded at review time |
| A3 | Manifest-only consumption; source-asset registry | `apps/website/src/test/screenshots.test.ts` fails on a literal screenshot path outside `lib/screenshot.ts` (and the workflow video); `settings.astro` and `design-tokens.astro` now read the manifest |
| A4/A5 | Per-kind fit policy; no forced crop window | `apps/website/tests/e2e/screenshot-delivery.spec.ts`: 8/8 pass, asserting that each scene keeps its own aspect ratio at 360/390/768/1280/1440 and is never displayed wider than its intrinsic width |
| A6 | Visitor-safe fallback | delivery spec asserts no page contains `pnpm screenshots:`; the placeholder now points at the feature pages and docs |
| A7 | Real provenance | manifest schema 2 with `sourceRevision`, `sourceDigest`, `captureTool`, per-scene `capturedAt`/`lastValidatedAgainst`; pre-fix state was a permanent `null` (recorded in P1's manifest dump) |
| A8 | Decode-level validation | `scripts/screenshots/lib/image-analysis.mjs` + 8 unit tests (truncated file, byte flip, uniform blank, non-PNG); `validate.mjs` now reports `0 violation(s)` where the baseline reported 2 |
| A9 | Debug artifacts off the publish path | debug frames go to `reports/screenshot-debug/`; the validator warns on any `debug-*` left in a screenshots directory (the concurrent run's leftover is still present and is reported, not deleted) |
| A10 | (deferred, documented) responsive derivatives | `lib/screenshot.ts` emits `srcset`/`sizes` when variants exist and the validator checks them; no generation step ships (no `sharp`; `public/` is copied as-is). Measured: PNG set 6.57 MB against a 5 MB warn threshold |
| A11 | `source` scenes must name a real producer | `validate.mjs` and the Vitest mirror both fail when `source` points at a path that does not exist |

### Reproduced-and-fixed framing defect (A4's root cause)

The `layers` crop was re-measured. Before, it framed a "Design Canvases"
section above the layer list and showed three layer rows with one partially
visible badge. After, `clipFrom` measures the panel header through the layer
tree: all ten layers, the selected `Disc` row carrying its blend badge, and the
tinted bands carrying `88%`/`90%`/`92%` opacity badges — which is what the
caption claims. Verified by direct inspection of
`reports/shot-check/layers-light.png` at 1:1.

### Cross-owner findings (reported, not modified)

| Finding | Evidence | Why it is not fixed here |
|---|---|---|
| Three references to screenshots that do not exist | `pages/features/effect-studio.astro:48,58` and `pages/features/strokes.astro:87` name files present in neither output directory | Both files are mid-edit by other tasks; the assets have no producer in the repository. `validate.mjs` now reports them as `WARN uncommitted reference…` and will fail them once committed |
| Published captures predate concurrent UI changes | A `workspace-light` capture taken at 02:41 today shows a "Filter layers…" input in the layers panel; a `workspace-dark` capture taken at 09:55 shows a "Layers | Slides" segmented control. The published files were committed 2026-09-20 | Recapturing the set while another task edits the panel would produce a mixed-generation set. The manifest marks those records `provenanceUnknown: true`; a coordinated reviewed recapture is the follow-up |
| `demoDocuments.test.ts` fixture staleness (4 failures) | `packages/scene/src/documentCodec.ts`, `document.ts`, `canonical.ts` are uncommitted-modified by another task | Regenerating fixtures is an explicit, reviewed action belonging to the codec change, not to this task |
| Website raw font-size ceiling (349 > 344) | Every `font-size` this task added is a `var(--type-*)` token (verified by grep) | The five extra declarations come from other tasks' stylesheets |
| "Move" text renders clipped at the top of the Layers and Inspector panels in every full-window capture | Visible in `workspace-light.png`, `workspace-dark.png` and `tablet-workspace-light.png` | Application UI, not capture automation. Out of this task's scope; recorded because the pipeline must not paper over it and a reviewer should see it |

## Independent of the pipeline (verified, not assumed)
- `node scripts/screenshots/validate.mjs` — **exit 0**, `0 violation(s)`
  (baseline: exit 1, 2 violations).
- `pnpm exec vitest run apps/website/src/test/image-analysis…` — 8/8.
- `pnpm exec vitest run apps/website/src/test/screenshots.test.ts` — 10/10.
- `pnpm exec vitest run apps/website/src/test` for this task's three suites —
  24/24 (`imageAnalysis`, `screenshotLib`, `screenshots`).
- `npx playwright test … screenshot-delivery.spec.ts --project=custom-domain`
  — 8/8 against the production build.
- `pnpm --filter @varve/website build` — 114 pages built.
- `astro check` — 0 errors, 0 warnings, 0 hints.
- `pnpm audit:tokens` — 303 contrast pairs pass, token usage clean.
- `pnpm audit:docs` — clean.
- Process teardown: after a capture run, `ss -ltnp` shows nothing listening on
  the capture port and no `vite --port 1430` process remains (previously a Vite
  server outlived every run).

## Scene/consumer coverage: separate from the pipeline (content design)

The scene set is broad but weighted toward full application frames. Scene-level
gaps belong in the scene registry (`SCENES` in `product.mjs`), not here: the
`object-selection`, `asset-search` and `asset-similarity` scenes remain
explicitly blocked by model/index prerequisites, and `image-tools` shows their
entry points rather than implying the operations succeed. Two placements were
corrected because a page claimed more than its capture showed: the
`design-tokens` page's alt described "page labels and ruler guides" that the
`layout` scene does not contain (replaced by the manifest alt), and the
`layers` caption claimed blend/opacity badges that the stale crop had cut away
(re-measured, then verified by inspection).
