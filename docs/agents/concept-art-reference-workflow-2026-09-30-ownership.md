# Concept-art reference workflow — ownership (2026-09-30)

**Task:** complete authoring, sampling, and artwork-export behavior for the
persisted concept-reference role and document its public behavior.
**Owner:** illustration/concept-art integration.
**Branch:** `master` (user-requested).
**Prerequisite:** scene metadata foundation `92d82860b`.

## Owned paths

| Path | Scope |
|---|---|
| `packages/editor/src/components/Inspector/sections/FillSection.tsx` | Show reference controls only for one selected image-filled shape; write metadata through the existing undoable node update. |
| `packages/editor/src/components/Inspector/sections/ConceptArtReferenceControls.tsx` and its test | Reference role, source basename, independent sampling/export switches, and their accessible behavior. |
| `packages/editor/src/tools/artworkSampling.ts` and `__tests__/artworkSampling.test.ts` | Exclude marked references from merged Magic Wand samples unless `includeInSampling` is true; preserve the pinned source document identity and scene compositor. |
| `packages/editor/src/components/SpecPanel/export.ts` and its focused tests | Exclude marked references from image/PDF/SVG artwork exports unless `includeInExport` is true. Keep image rendering and canvas visibility unchanged. |
| `tests/e2e/canvas/concept-art-references.spec.ts` | Real editor authoring, sampling/export toggles, visibility, undo/redo, save/reopen, and inspected export evidence. |
| `packages/help/src/content/tools.ts` | Explain how concept-reference opt-in affects Magic Wand visible-artwork sampling. |
| `docs/architecture/file-ingestion-system.md`, `docs/audits/illustration-concept-art-capability-matrix-2026-09-28.md`, and this record | Update the verified reference workflow and its limits. |
| `apps/website/src/pages/features/strokes.astro`, `product.astro`, workspace/stroke/object-selection docs and the focused website spec | Describe only browser-verified reference, sampling and export behavior; validate the docs on both deploy bases. |
| `apps/website/public/screenshots/concept-art-reference-workflow.png` | Use the inspected, attributed Chromium capture from the verified editor journey. |

## Shared-file boundary

`packages/editor/src/components/SpecPanel/export.ts` has concurrent, scoped
ownership for PDF output sharpening and an existing bitmap-dimension repair.
This task may add only the reference-filter boundary at artwork export entry
points and its regression tests. Re-read its diff before editing and before
committing; use an isolated index and stage only the reference-specific hunks.
Do not include another task's staged/unstaged changes.

The earlier scene metadata ownership record keeps its original milestone
boundary. This follow-up is the editor behavior that record explicitly
required before claiming that persisted inclusion flags work.

## Contracts

- A selected ordinary image shape can be marked as a concept reference without
  changing its canvas visibility or image pixels.
- Marking stores only the sanitized source basename and defaults both inclusion
  flags to false. Sampling and export opt-ins are independent.
- A role or flag edit is one ordinary document update per user action, so the
  existing undo, persistence, and save/reopen paths remain authoritative.
- Sampling and artwork exports render a filtered document snapshot; they do
  not mutate saved nodes, layer visibility, the live canvas, or UI overlays.
- If a reference is explicitly selected as the sole export target while
  export is disabled, surface a clear refusal instead of downloading a blank
  file.

## Validation

Read `git status`, each owned path, and its current owner record before editing.
Run `pnpm verify:plan` first; select the affected closure. The editor sampling,
Inspector, and artwork export contracts require real leased Chromium coverage,
including save/reopen and decoded pixel checks. Include untouched references in
sampling/export-default tests, then enable each flag independently. Inspect
light/dark/high-contrast and narrow screenshots. Report Linux Tauri/WebKitGTK,
physical stylus, and other-device checks separately.

## Results

- `tests/e2e/canvas/concept-art-references.spec.ts`: 1/1 Chromium passed on
  isolated port 4403 under the heavy-task lease. It covers independent role,
  sampling and export toggles, unchanged live artwork when role changes,
  refusal for an excluded direct export, a decoded included PNG, undo/redo,
  save/reopen, and sampling re-selection.
- Captures in
  `test-results/illustration-concept-art-refs-20260930-r5/` were inspected in
  Light, Dark, High Contrast, 1024×768 narrow, reopened, and included-export
  states. The Light editor screenshot used on the site is attributed CC BY-SA
  4.0; the decoded 1280×853 PNG was checked.
- Focused Vitest: 5 files, 25 tests passed. `pnpm build:website` and
  `pnpm build:website:pages` passed; Astro Check reported 0 errors, warnings,
  or hints; `pnpm audit:docs` passed with 1,129 docs, 738 links, and 178 ADRs.
- The website two-base E2E initially found an absent help sentence; the copy
  was added and both site variants rebuilt. A later leased rerun passed 2/2 on
  GitHub Pages and custom-domain bases. Desktop, mobile, dark-theme, reference
  image, product, and object-selection-guide captures in
  `test-results/strokes-target-copy-Stroke-25b22-mes-widths-and-deploy-bases-*`
  were inspected; the mobile overflow and image-load checks passed.
- The focused app E2E found a selector that lost its image after toggling the
  sampling flag; the test now reselects the reference and passed. At 1024×768,
  the existing selection floating toolbar extends beyond the viewport, though
  the reference controls and other required actions remain usable.
- Linux Tauri/WebKitGTK, physical stylus, other browsers/devices and other DPI
  tiers remain unverified. Do not describe this flow as universally qualified.
