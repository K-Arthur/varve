# Tonal workflows ownership — 2026-09-28

Owner: channels, curves, relative white balance, split toning and sharpening.
Worktree: `/home/kevina/CodingProjects/varve`, branch `master`.
Starting HEAD: `d51f52e40`. Unrelated staged/unstaged work is preserved.

## Owned surfaces

- Engine: scalar adjustment evaluators, `filters.ts`, FilterIR lowering,
  filter identity and compositor dispatch, output sharpening.
- Scene: adjustment normalization only; existing codecs/resources remain the
  persistence authority. New fields must survive normalization and IR.
- Editor: existing AdjustmentEditor, CurveEditor and their thin child editors.
  No changes to Shell, CanvasArea, context, workspace docks or retouch tools.
- Tests: focused numerical tests and a separate tonal-workflows browser spec.
- Browser PDF: a thin raster writer helper and its exact import/caller hunks
  in `SpecPanel/export.ts`. Another owner's bitmap-dimension cache repair and
  export test edits are preserved separately; commits must use a partial index.
- Docs: tonal-adjustments architecture, this research/evidence ledger, and the
  website color-effects page/user guide. No publishing or pushing.
- Screenshot pipeline: `sync-tonal-scenes.mjs`, the `tonal-curves` and
  `tonal-split-tone` manifest entries, and their two canonical PNG pairs only.
  The shared manifest uses a partial index; other scene metadata, captures,
  staged changes and the product generator remain with their existing owners.

Before editing an existing file, inspect its status/diff again. Commits use an
isolated Git index and explicit owned paths so unrelated staged changes cannot
enter a milestone commit. Shared schema edits are sequential. No subagents
have been dispatched.

The starting worktree contains unrelated edits to GPU rendering, navigation,
workspace docks, retouch, themes, website screenshots and validation tooling.
The default initial plan escalates because of those changes. Scope-specific
plans use an isolated index; existing failures are reported separately from
the owned changes. Full certification remains subject to the actual gate.

## Ordered delivery

Research/input contracts → numerical identity/domain repairs → channels and
curves → relative white balance and split toning → editing/output sharpening
integration → persistence/export/browser visuals → measurements and docs.

Native Linux, browser/demo and physical hardware evidence must be named
separately. No physical ChromeOS, pen, macOS or Windows evidence is implied by
a Chromium run. Research and validation results are recorded in
[the audit](../audits/tonal-workflows-2026-09-28.md).
