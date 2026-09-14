# Smart selection — repair, completion, and verification (2026-09-13)

Task: diagnose, repair, complete, extend, and verify Varve's smart-selection
infrastructure on `master` while several agents shared the working tree.
Research ledger: `docs/quality/smart-selection-research-2026-09-13.md`.
Ownership record: `docs/agents/smart-selection-2026-09-13-ownership.md`.

## Verified root causes

1. **Output asymmetry (correctness).** `useSam2Segmentation` reused the
   reviewed candidate only for `Apply as mask`. `Use as selection` fell
   through to a full encode/decode, so it could commit a different mask than
   the preview and was slower. Fixed by one reviewed-candidate path for both
   outputs that pins the candidate index, revalidates the decoded source
   fingerprint, and refuses an all-zero candidate.
2. **No per-prompt correction (usability).** The tool could only pop the last
   prompt with Backspace. Tap-to-remove was added with a CSS-pixel tolerance
   (WCAG 2.5.7 single-pointer alternative).
3. **Luminance ignored alpha (correctness).** `areaSelectionFromImageLuminance`
   selected hidden RGB of fully transparent pixels. Coverage is now
   `luma × alpha`, matching colour-range selection.
4. **False Magic Wand success (honesty).** Subtract/intersect with no base
   selection announced a created selection while the result was null. It now
   explains that a selection is needed first.
5. **Dead foreground selector (gap).** `foregroundSelect.ts` had tests but no
   consumer and no export. It is now a bounded estimator with an explicit
   ranking policy, a subpath export, UI wiring, and unit + E2E coverage.
6. **Subject proposals erased on apply (defect found by E2E).** Applying the
   first proposal switches the Inspector to pixel-selection scope, remounting
   `SelectionSourcesPanel`; component state lost the candidate list. Proposals
   and their target identity now live in a small external store.
7. **Misleading prompt controls (UX).** "Clear prompts" and "Cancel" were two
   identical buttons; the legend now documents tap/Backspace removal and that
   clearing also clears the preview, and Cancel only appears while processing.

## Implemented outcomes

- Reviewed candidate is the only thing either output commits; candidate
  cycling during a pending commit cannot swap the mask.
- Tap a marker to remove that prompt; the Inspector shows a deterministic
  prompt count.
- Scores are announced and labelled by provenance: `model score` vs
  `heuristic score`; never "confidence" for predicted quality.
- Automatic **Select subject** (Selection Sources): model-free, offline,
  bounded to a 1024 px analysis plane, candidates from border and centre
  floods, ranked `0.55 coverage + 0.25 centrality + 0.20 edge alignment`.
  Top proposal applies immediately; alternatives and "All subjects" remain
  one click away; empty results are reported, never invented.
- Help articles for Object Selection and Magic Wand; selection docs and the
  website Object Selection page describe only verified behavior.

## Commits

| Commit | Scope |
| --- | --- |
| `137aa6d72` | Research ledger + ownership plan |
| `4f5535710` | Reviewed-candidate commit path for both outputs + hook tests |
| `58115776e` | Tap-to-remove prompts, honest prompt controls, prompt count |
| `f264cbd29` | Architecture docs for reviewed commits + subject proposals |
| `1856d0618` | Luminance alpha weighting, wand false-success fix |
| `836f5c1fd` | Engine subject proposals + Selection Sources wiring |
| `b4e91b2e6` | Help articles |
| `4853c73d8` | Real-UI prompt removal + subject specs |
| `679457345` | Proposal store across Inspector remounts |
| `7254f7d0d` | Website copy (plus stopped writer's refinement copy) |

## Real-model acquisition, hosting, and gates (2026-09-14)

- Acquired the pinned upstream pair from the Apache-2.0 export and verified
  both checksums; the graph repair reproduced the pinned repaired checksum and
  size exactly (134,261,247 B at `b4cfd6c8…`).
- Published the verified upstream pair on the `varve-models-v2` GitHub
  release as an archival mirror (`gh release download` + `sha256sum -c`).
- Confirmed GitHub release assets are not CORS-enabled (ledger F9), so the
  runtime source stays the CORS-enabled upstream host and the manifest/catalog
  URLs are unchanged; this is a verified platform constraint, not a missing
  downloader.
- Updated `object-selection-real-model.spec.ts` to assert the current score
  wording, select the imported layer deterministically, and verify the
  reviewed-candidate Use as selection output. The full gate passes on a fresh
  profile (install through the app downloader → cold 27 s → cycling →
  apply/undo/redo → warm 3 s → selection 1 s); screenshots inspected.
- Added the gated corpus runner
  (`packages/engine/src/segmentation/quality/realModelParity.test.ts`) and ran
  it: mean default-candidate IoU 0.654, mean best-candidate 0.720, with the
  measured table and category interpretation in
  `docs/quality/object-selection-parity.md`. The provisional flat-mean gate
  was not relaxed to pass; weak categories are proposed for maintainer review.

## Validation actually run

| Command | Result |
| --- | --- |
| `vitest run` on 9 changed test files (engine selection, editor hook/tool/panel/section, help) | 107 passed |
| `pnpm --filter @varve/editor typecheck` (selection files) | no errors in changed files |
| `pnpm --filter @varve/engine typecheck` (changed files) | no errors |
| `pnpm typecheck:e2e` | pass |
| `pnpm audit:emoji`, `pnpm audit:docs` | clean |
| Playwright, frozen private build, `VARVE_E2E_PORT` avoided: 5/5 pass — 3 object-selection specs and 2 select-subject specs (`1.2 min`) | pass |
| Real-model integration gate (fresh profile, install through the app downloader, COOP/COEP dev server) | **pass**: cold 27 s at 88%, 3 candidates, apply/undo/redo, warm 3 s, selection 1 s |
| Real-model corpus runner (ort-node, 10 fixtures) | ran; mean IoU 0.654, best-candidate 0.720 — recorded in `docs/quality/object-selection-parity.md` with review categories |

The E2E run used a private production build
(`vite build --outDir dist-selection-verify`) served by `vite preview` and a
local config, because the shared dev server reloads mid-test while other
agents save files. The first dev-server attempt failed on exactly such
reloads (app back on Home); those failures were environmental, and the frozen
rerun is the recorded evidence.

## Visual evidence (inspected, not just attached)

Archived in `docs/screenshots/selection/2026-09-14/`:

- `select-subject-contour.png` — the proposal contour traces the red circle
  exactly; sampled pixels show the subject interior unchanged, a 1 px
  selection outline on the boundary, and unselected background outside.
- `one-prompt-after-removal.png` — after tapping the first of two markers,
  exactly one include marker remains (the second white dot is the node
  transform handle); the Inspector prompt count read `1 prompt`.
- `low-memory-refusal.png` — the 2 GB-device path shows the typed
  out-of-memory message and keeps the canvas usable.

A pixel scan of the subject screenshot confirmed the outline ring
(`[255,253,253]`) on the circle boundary with subject `[214,46,52]` inside and
background `[238,242,246]` outside.

## Performance notes

- The estimator analyzes a plane capped at 1024 px on the long edge
  (≤ ~1M px, a few MB of working planes), hard-capping low-memory cost; it
  runs on the calling thread and finished within the 10 s E2E assertion
  budget on this machine.
- No isolated micro-benchmark was run for the estimator; the corpus-quality
  and latency gates in `docs/quality/object-selection-parity.md` remain the
  recorded procedure. Measurements during this task were taken while several
  agents were building, and are marked contaminated.

## Remaining limitations and unverified items

- Real-model SAM2 integration and the corpus are measured above
  (`docs/quality/object-selection-parity.md`); the provisional flat-mean gate
  was not met and the four weak categories are proposed as documented review
  categories decided by the maintainer.
- WebKitGTK/Tauri, physical pen, and touch hardware: unverified.
- Prompt markers support tap-to-remove and drag-to-move; Backspace/Delete still
  removes the last staged prompt.
- The lasso-as-region-hint adapter for the prompted model is not implemented;
  a lasso is never silently converted to a bounding box.
- Iterative low-resolution mask input is not exposed by the pinned decoder
  export; it stays a documented contract from the upstream predictor.
- Quick Mask state remains unwired (pre-existing; out of scope here).
- Layer/object targeting fixes found by the audit (ancestor locked/hidden
  inheritance in point hit-testing, frame `clipContent` in hit-testing,
  unreachable Select Similar commands) are recorded but not changed in this
  task; they belong to the hit-test owner.

## Follow-up baseline review (2026-09-14)

The source-backed recheck found one implementation/documentation mismatch that
is in this workstream's owned prompt tool: the research ledger and website
described a click-first-corner/click-second-corner box path, but the live tool
only recognized a drag as a box and interpreted every click as a point. The
Inspector also exposed Shift-click as the only polarity affordance and had no
visible output-combination control. These were treated as correctness and
accessibility gaps, not cosmetic copy issues.

The follow-up implementation therefore adds an explicit Point / Box hint mode,
visible Include / Exclude prompt polarity, and Replace / Add / Subtract /
Intersect output intent. Dragging remains available; in Box hint mode two taps
create the same XYXY prompt without requiring a held pointer. A box remains a
model hint rather than a hard output clip.

## Agent Validation Report

```text
Changed scope: packages/engine/src/areaSelectionImage.ts,
  packages/engine/src/intelligence/foregroundSelect.ts, engine package.json
  subpath, packages/editor/src/context/useSam2Segmentation.ts,
  packages/editor/src/tools/{Sam2SegmentationTool,MagicWandTool}.ts,
  packages/editor/src/components/Inspector/{SelectionSourcesPanel,
  subjectProposalStore}, BackgroundRemovalSection, packages/help tools,
  e2e specs, selection docs and website pages.
Validation plan: focused suites were selected manually because the shared
  working tree carries several agents' uncommitted work; the planner cannot
  isolate this task's closure from that tree.
Commands actually run: the vitest batch, per-package typechecks, audit:emoji,
  audit:docs, typecheck:e2e, and the frozen-build Playwright run above.
Passed: 107 unit tests; 5 Playwright specs; audits clean; typechecks clean.
Skipped as unrelated: full Vitest/Cargo workspace, full Playwright matrix,
  benchmarks, model-quality corpus, packaging/signing (concurrent tree and
  missing encoder artifact).
Escalations: none.
Full suite run: no. Reason: not triggered by the task's localized scope; the
release gates remain with their owners.
```

## Follow-up implementation and validation (2026-09-14)

The follow-up slice was completed on `master` in progressively scoped commits:

| Commit | Verified outcome |
| --- | --- |
| `53eba6ad2` | Re-opened the primary sources and user-failure evidence, and recorded the documentation mismatch. |
| `41652870c` | Added explicit Point / Box hint modes, reverse-safe box normalization, and two-tap box prompting. |
| `cd5ba8d38` | Added visible prompt polarity and Replace / Add / Subtract / Intersect output controls, with the existing selection algebra. |
| `86795d314` | Updated the Object Selection help and feature pages without promising semantic recognition or cloud processing. |
| `d827fdedd` | Bounded the embedding cache by the runtime safe budget and added verified encoder/decoder artifact identity to its key. |
| `308108a66` | Added tap-to-remove and drag-to-move prompt markers, with cancellation restoration and real-UI coverage. |
| `33c491ca4` | Clarified that a reviewed preview can become either a selection or a mask. |

### Current validation record

```text
Changed scope: Object Selection prompt tool, Inspector controls, segmentation
  cache identity/budget, Object Selection E2E tests, selection architecture and
  quality docs, and website feature/help pages.
Validation plan: pnpm verify:plan selected the full affected closure because
  the shared master worktree contained 307 changed files across editor, engine,
  scene, shared, desktop, website, and Rust crates; FULL-SUITE ESCALATION: YES.
Commands actually run: pnpm verify:plan; pnpm verify:affected; pnpm
  verify:full with VARVE_FULL_GATE_REASON; focused Vitest suites; pnpm
  typecheck:e2e; pnpm audit:tokens; pnpm audit:docs; pnpm audit:emoji; node
  scripts/audit-architecture.mjs --ci; pnpm --filter @varve/website build;
  targeted Playwright Object Selection runs; pnpm bench (stopped after the
  unrelated history benchmark had already taken 259 seconds).
Passed: 33 focused prompt/segmentation/selection tests; 36 focused Inspector
  tests; typecheck:e2e in the commit checkpoints; token audit (153/153 across
  three themes); docs and emoji audits; website Astro check and static build
  (104 pages); prior final-slice browser runs for box prompting, low-memory
  refusal, prompt removal, and marker movement; scoped diff check.
Skipped as unrelated: the remaining affected closure after the full gate
  stopped at concurrent engine failures; WebKitGTK/Tauri, physical touch and
  stylus hardware, and the real-model corpus were not rerun in this slice.
Escalations: the full gate was started as required, then stopped at concurrent
  failures: an unallowlisted engine contentAwareFill cycle and existing engine
  test type errors in quickCleanup/lut. A final dev-server browser rerun also
  could not reach the app because concurrent font changes left the Vite graph
  without getFontRegistry; earlier frozen/focused browser runs passed and the
  failure is outside the selection-owned files.
Full suite run: yes, pnpm verify:full was started because the planner
  escalated; it did not complete successfully for the concurrent failures
  above. No selection-owned file was changed to mask those failures.
```

The inspected visual evidence includes the two-tap draft-box canvas, a
low-memory real-photo refusal with the canvas intact, a one-marker prompt
state, and a moved-marker state with both the moved and stable markers visible.
The real-model corpus result remains the previously recorded provisional mean
IoU 0.654 / best-candidate IoU 0.720; no quality threshold was relaxed.
