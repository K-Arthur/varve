# Concept-art reference workflow — ownership (2026-09-30)

**Task:** complete authoring, sampling, and artwork-export behavior for the
persisted concept-reference role.
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
| `docs/architecture/file-ingestion-system.md`, `docs/audits/illustration-concept-art-capability-matrix-2026-09-28.md`, and this record | Update the verified reference workflow and its limits. |

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
