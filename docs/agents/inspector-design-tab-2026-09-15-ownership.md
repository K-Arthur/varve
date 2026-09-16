# Inspector Design tab review — ownership and handoff (2026-09-15)

**Task:** review and repair the Inspector **Design tab** (all its sections and
components) on `master`, with real-world documents, measured evidence,
progressive commits, docs and website alignment, and visual validation.
**Branch/worktree:** `master` / `/home/kevina/CodingProjects/varve` (per the
task instruction; no branch or worktree created).
**Base HEAD at start:** `67a07d697`.
**Research/evidence ledger:** `docs/research/inspector-design-tab-review-2026-09-15.md`.
**Rendered audit spec:** `tests/e2e/inspector/design-tab-audit.spec.ts`.

## Why this record exists

The working tree contains many other writers' uncommitted changes. This record
names the paths this task owns so a later integration pass can tell them apart.

## Owned paths (this task)

| Path | Change |
|---|---|
| `packages/editor/src/components/Inspector/sections/BooleanSection.tsx` | Shared `Select` + `Button`; token-styled Pathfinder rows |
| `packages/editor/src/components/Inspector/sections/PositionSizeSection.tsx` | Focusable, named, 24px proportion-lock checkbox |
| `packages/editor/src/components/Inspector/controls/NumberField.tsx` | `labelWrap` option |
| `packages/editor/src/components/Inspector/controls/rangeValueControl.css` | Unit stays beside the value; value token |
| `packages/editor/src/components/Inspector/sections/ImagePlacementSection.tsx` | Label wrap for "Image scale" |
| `packages/editor/src/components/Inspector/sections/ImageCropSection.tsx` | Label wrap for Trim/Expand padding |
| `packages/editor/src/components/Inspector/sections/LayoutSection.tsx` | Label wrap for grid Col/Row placement; `Add layout guide` compact target |
| `packages/editor/src/components/Inspector/panels/DocumentPanel.tsx` | Wrap the two Snapping labels the larger type scale newly clipped |
| `packages/editor/src/components/AdjustmentLayer/adjustment.css` | `.insp-btn` primitive moved out (comment left) |
| `packages/editor/src/components/Inspector/sectionRegistry.ts` | `IMAGE_SELECTION_ORDER` in `resolveSectionOrder` |
| `packages/editor/src/components/Inspector/inspector.css` | Checkbox exclusion list, proportion-lock focus ring, Pathfinder block, inspector type-scale tokens, label-wrap `anywhere`, `.insp-btn` primitive + compact target |
| `packages/editor/src/components/Inspector/PropertiesPanel.test.tsx` | Pathfinder test against the real Select interaction |
| `packages/editor/src/components/Inspector/__tests__/sectionRegistry.test.ts` | Image contextual-order coverage |
| `tests/e2e/inspector/design-tab-audit.spec.ts` | New real-world Design tab audit |
| `tests/e2e/inspector/quick-properties.spec.ts` | One-line locator scope: the selection-following context bar now also exposes a "Fill colour" swatch, so the unscoped role query was ambiguous. Test-only disambiguation; the assertion is unchanged in intent. |
| `packages/help/src/content/panels.ts` | Inspector help copy matches the real tab names and behaviors |
| `apps/website/src/pages/docs/getting-started/first-project.astro` | Image-selection section order documented |
| This record + the research ledger | |

No other writer had these files modified at task start; no shared hunks had to
be split. `inspector.css` and `sectionRegistry.ts` are the shared surfaces
another writer is most likely to touch next — the additions are appended in
named blocks so they can be moved without re-deriving intent.

## Commits (progressive, on master)

| SHA | Subject |
|---|---|
| `0006e66fb` | `fix(inspector): repair Design tab control semantics and layout` |
| `58668422c` | `feat(inspector): lead image sections for image selections` |
| (this commit) | `feat(inspector): raise the Design tab type floor and document the review` |

## Validation actually run

- Direct unit suites: `sectionRegistry.test.ts` (68 passed in the commit
  checkpoint), `PropertiesPanel.test.tsx`, `PositionSizeSection.test.tsx`,
  `controls.test.tsx`, `NumberField.test.tsx`, `LayoutSection.test.tsx` (47
  passed together), `helpContent.test.ts` (21 passed).
- `tsc` for `@varve/editor`: **no errors in any file this task touched**;
  pre-existing errors remain in other writers' in-flight files
  (`workspace/layoutVariants.ts`, `tools/snapping.ts`,
  `tools/__tests__/SelectTool.test.ts`; at one point `Export/ExportDialog.tsx`
  carried an undefined `nestedOverlayRef` during a concurrent edit).
- Biome format/lint on every staged file (pre-commit gate).
- Playwright `tests/e2e/inspector/design-tab-audit.spec.ts` — real-world
  document (frame, drawn rect, live text, imported photograph), every section
  expanded. Final measured results at 1440x900:
  - labels 12px / values 13px on all four node kinds; no row overflow; no
    control under the 24x24 target minimum;
  - image selection order: Position & Size, Corner Radius, **Image Placement,
    Crop & Bounds, Trim to Subject, Protect Faces, Expand Bounds**, then the
    generic appearance sections (Resolution/Perspective stay in the tail);
  - truncated labels: none except the cross-task `Estimate quality`;
  - typed X edit survives leaving and re-selecting the layer (document
    round-trip);
  - Constrain proportions: keyboard focus ring present and 24x24 target,
    Space toggles it.
- Inspector visual baselines regenerated under the final CSS and reviewed:
  `ownership.spec.ts` (6), `quick-properties.spec.ts` (1),
  `tool-context.spec.ts` (1).
- `pnpm audit:docs` / `audit:emoji` / `audit:tokens` clean.
- Run with isolated `VARVE_E2E_PORT` under the heavy-task lease.

Deferred to integration/candidate CI per the validation economy: full browser
E2E matrix, full Vitest, Cargo workspaces, native desktop GUI, packaging.

## Continuation pass (2026-09-16)

A follow-up review of the same Design-tab surfaces shipped as commits
`318e9e786`, `e4cd0d5b3`, and `dcaa823a5`, with the ledger in
`docs/research/inspector-design-tab-followup-2026-09-16.md`. Additional owned
paths in that pass: `AlignDistributeBar.tsx` (+ test), `MaskSection.tsx` (+
test), `PositionSizeSection.tsx`, `CornerRadiusSection.tsx` (+ test),
`FillSection.tsx`, `ImagePlacementSection.tsx`, `SelectionColorsSection.tsx`
(+ test), `sectionRegistry.ts` (image-placement order), `inspector.css`, and
extended coverage in `tests/e2e/inspector/design-tab-audit.spec.ts`.
Marketing screenshot regeneration remains deferred for the same reason as the
2026-09-15 pass (the shared tree carries other writers' uncommitted UI).

## Remaining / not claimed

- Undo anomaly after a typed X edit on a multi-node document: see the research
  ledger Section 5 for the exact repro; needs the history/transaction owner.
- `Estimate quality` label truncation in `SelectionSourcesPanel.tsx` (other
  task's file).
- `tool-context.spec.ts` is red from the in-flight `presetRegistry.ts` rewrite
  (iPhone presets removed there while HEAD still contains them).
- Marketing screenshot scenes that include the Inspector
  (`layout`, `typography-panel`, plus `workspace`, `workspace-dark`, `layers`,
  `palette-inspector`, `image-tools`, `print-production`, `workspaces`) were
  not regenerated: the shared tree currently carries other writers'
  uncommitted UI (a new context-bar swatch etc.), so committing captures now
  would ship unreviewed foreign UI in marketing art. Exact follow-up:
  `pnpm screenshots:product -- --review-dir /tmp/opencode/inspector-shots --scenes layout,typography-panel --strict`,
  review, then `--sync-reviewed` with the same scenes.
- Caption/hint text outside labels/values/headers still uses `--font-size-2xs`.
- Font-size increases are a legibility judgment with reviewed baselines, not a
  WCAG conformance claim; narrow-rail and touch/pen behavior for the changed
  controls were not exercised.
