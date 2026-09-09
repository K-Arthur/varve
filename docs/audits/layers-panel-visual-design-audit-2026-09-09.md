# Layers panel visual design audit — 2026-09-09

Status: implemented on `master`

This is a focused visual-design follow-up to the Layers organization audit.
It covers the editor Layers rail and the matching marketing page only. It does
not change the scene model, layer commands, hierarchy semantics, or specialist
Inspector ownership.

## Baseline diagnosis

The real Chromium baseline was captured with five seeded layers and a two-row
selection at the default desktop viewport. The Layers section showed three
presentation problems:

1. The nested `.layers-panel` declared `height: 100%` while it lived below the
   minimap, Design Canvas navigator, and other left-rail surfaces. Its tree and
   bulk toolbar therefore extended below the containing rail. The toolbar was
   technically rendered but clipped from the visible panel.
2. The title, search field, count, and header actions read as separate pieces.
   The title was an all-caps strip with a strong teal top rule, while the count
   sat below the search field and consumed tree space even when no filter was
   active.
3. Rows combined selection, type, color, and action affordances in a narrow
   line. The underlying semantics were sound, but the visual treatment used
   several competing boxes and made the bulk action state easy to miss.

Baseline artifact:
`test-results/run-67914-1466/layers-layers-panel-visual-bfd3d-lated-multi-selection-panel-chromium/layers-panel-populated.png`.

## Direction

The implementation keeps Varve's work-first density and uses a quiet structure
with stronger current-state signals:

- the Layers section is a flex remainder of its owning rail;
- the header is a compact title/count group with action controls in a single
  consistent slot;
- the filter is a bordered, opaque control surface, and its advanced-filter
  control is visibly active only when opened or filtering;
- the tree remains the primary content surface, with a bounded minimum that
  yields space to contextual actions;
- selection remains teal and theme-aware, while type icons lose their extra
  resting box so the type rail and row state do not compete;
- the bulk toolbar owns the bottom edge of the tree and wraps into a count row
  plus horizontally scrollable action row in narrow rails.

## Delivered changes

| Area | Implementation | Result |
|---|---|---|
| Panel sizing | `LayersPanel` now uses `flex: 1 1 0` and `min-height: 0` instead of claiming `height: 100%`. | Nested Layers content stays inside the left rail. |
| Header | Added a title/count group; removed the decorative top strip; standardized header and detach control sizing. | The document context is readable before the actions. |
| Filter | Added an active visual state and removed the inactive duplicate count line; shortened the placeholder to `Filter layers…`. | Search reads as one control and only reports `n of m` when filtering. |
| Tree and rows | Added a bounded tree floor, quiet tree surface, small row separation, transparent resting type-button surface, and slightly clearer action hit areas. | Hierarchy remains dense without every affordance becoming a card. |
| Bulk actions | Added an opaque raised surface, explicit top boundary, and narrow-container wrap/scroll behavior. | Multi-selection actions remain visible and attached to the tree. |
| Marketing | Updated `/features/layers` with the same “quiet structure, strong state” explanation and a matching filter/count treatment in its illustration. | Product claims and product UI use the same visual vocabulary. |

## Access and behavior retained

The tree remains an APG `tree`/`treeitem` surface. Existing selection,
keyboard focus, disclosure, visibility, lock, solo, rename, effect-stack,
context-menu, drag-and-drop, filter, and Inspector deep-link behavior are
unchanged. The added count is presentation-only; the existing semantic
searchbox and live filtered result count remain the source of truth.

## Visual evidence

The deterministic scenario is
`tests/e2e/layers/layers-panel-visual.spec.ts`. It seeds five real layers,
selects two through the real pointer path, checks that the bulk toolbar's
bounding box ends inside the owning left rail, and captures three theme states:

- `test-results/run-75462-1469/layers-layers-panel-visual-bfd3d-lated-multi-selection-panel-chromium/layers-panel-populated-light.png`
- `test-results/run-75462-1469/layers-layers-panel-visual-bfd3d-lated-multi-selection-panel-chromium/layers-panel-populated-dark.png`
- `test-results/run-75462-1469/layers-layers-panel-visual-bfd3d-lated-multi-selection-panel-chromium/layers-panel-populated-high-contrast.png`

Those three images were opened and reviewed directly. The light and dark
states keep the selected rows prominent without a saturated full-row card; the
high-contrast state retains its stronger system yellow selection treatment.
The bulk bar is visible in all three states. The first post-change run failed
the new geometry assertion as expected, proving the baseline clipping defect;
the rerun passed after the flex sizing correction.

The final post-change capture was also reviewed directly:

- `test-results/run-155024-1476/layers-layers-panel-visual-bfd3d-lated-multi-selection-panel-chromium/layers-panel-populated-light.png`
- `test-results/run-155024-1476/layers-layers-panel-visual-bfd3d-lated-multi-selection-panel-chromium/layers-panel-populated-dark.png`
- `test-results/run-155024-1476/layers-layers-panel-visual-bfd3d-lated-multi-selection-panel-chromium/layers-panel-populated-high-contrast.png`

The matching marketing-page capture was reviewed at:
`test-results/layers-feature-Layers-feat-39ce0-d-stays-within-the-viewport-custom-domain/layers-feature-light.png`.

## Remaining design debt

- The outer left rail still contains minimap and surface-navigation owners
  above Layers. Their shared composition is intentionally outside this slice.
- Rows with many specialist badges can still become information-dense at very
  narrow widths. A future progressive-disclosure pass should preserve all
  current labels while moving lower-frequency detail into a row popover or
  Inspector deep link. **Partially addressed below** — the failure mode where
  this pushed essential controls off-screen entirely is fixed; the polish
  question of how the badges themselves look when clipped is still open.
- The visual evidence is Linux Chromium only. Tauri/WebKitGTK, physical touch
  hardware, and native assistive-technology walkthroughs remain separate
  validation work.

## Follow-up audit — row overflow at extreme density (same day)

A second pass re-audited this same surface specifically to check the two
caveats above, rather than assume "could become dense" was the full story.
Both turned out to be reproducible defects, not just theoretical risk:

1. **Visibility/lock/solo toggles were reachable off-screen.** Every badge in
   a row (`layers-row__badge`, `layers-row__mask-badge`,
   `EffectStackTransferBadge` for effects/filters, the sync/variant/instance/
   adjustment/scope badges, the motion dot, the keyframe badge) was
   `flex-shrink: 0` inside a row that never wraps. A layer that is simply a
   treated hero image — a color tag, a non-default blend mode with reduced
   opacity, one Layer Effect, one Object Filter, and a mask — is an ordinary
   real combination, not a stress test. At the Layers panel's own documented
   minimum width (180px, `PANEL_LIMITS.layers.min` in
   `PanelResizeHandle.tsx`), that combination pushed the toggles roughly
   139px past the panel's right edge, where the tree's `overflow-x: hidden`
   clipped them entirely — the layer could no longer be hidden, locked, or
   soloed from the panel at all.
2. **Indentation was unbounded.** `LayersRow`'s `paddingLeft` grows with raw
   hierarchy depth with no ceiling. Real files — imported PSD/Figma documents
   especially — regularly nest 10+ levels deep; at the same 180px minimum
   width, indentation alone could consume the row before the type icon, name,
   or toggles ever got space to lay out.

### Fixes

- Every secondary badge is now wrapped in one `.layers-row__badges` flex item
  with a very high shrink factor (`flex: 0 9999 auto`) and its own
  `overflow: hidden`. It gives up its own width — clipping its own badges —
  before the always-needed toggles are displaced. The row name keeps normal
  shrink priority ahead of it, so the common case (few or no badges) is
  visually unchanged.
- Visual indent now caps at 8 levels (`MAX_VISUAL_INDENT_DEPTH` in
  `LayersRow.tsx`). `aria-level` and every structural/drag/reparent behavior
  still use the real, uncapped depth — only how far a deep row visually
  indents changes.

### Verification

`tests/e2e/layers/layers-row-badge-overflow.spec.ts` seeds a rectangle,
decorates it directly through `EditorContext.updateNode` with a color tag,
blend mode + reduced opacity, one Layer Effect, one Object Filter, and a
mask, drives the panel to its minimum width via the resize splitter's `Home`
key (the APG window-splitter pattern's documented min-jump), and asserts the
visibility/lock/solo toggles stay inside the panel's own bounding box.
Confirmed failing pre-fix (toggle right edge at 318.95px against a ~181px
panel — reverting only these two files reproduces the failure even with the
rest of the working tree unchanged) and passing post-fix.
`packages/editor/src/components/LayersPanel/LayersRow.test.tsx` (29 tests),
the full `LayersPanel` suite (320 tests), and the pre-existing
`layers-panel-overflow.spec.ts` and `layers-panel-visual.spec.ts` e2e specs
all still pass unchanged.

### Residual limitation

At the same minimum width with this full badge combination, the row name
itself still degrades to a single truncated character before badges are the
limiting factor — the row's fixed-cost chrome (drag handle, selection
checkbox, disclosure, type icon, three toggles) alone approaches the space
budget before any name or badge width exists. The existing name tooltip
(`Tooltip label={node.name} truncationOnly`) still surfaces the full name on
hover, so the layer stays identifiable, but a further pass that moves some
of this fixed chrome (e.g. the selection checkbox, which reserves its width
even while invisible at rest) out of the row's default layout, or moves
badges into a row popover as this audit's original note above proposed,
would still improve the worst case. Not attempted here, to keep this fix
narrowly scoped to restoring control reachability rather than redesigning
row anatomy.

### Second finding — header title/actions overlap during Solo at minimum width

The same audit pass checked the panel header under the same minimum-width
condition and found a related, separate defect: the header's title/count
group and its action-button row (settings, auto-reveal, collapse-all,
detach, plus a conditional "Exit Solo" text-and-icon button) never shrank or
wrapped. "Exit Solo" is the one action-row item that carries a text label,
not just an icon — with it present, the action row's own natural width can
alone exceed the panel's 180px minimum. `.layers-panel__title` had no
overflow containment, so instead of clipping, the word "Layers" rendered
past its allotted box and visually overlapped the first icon button — a
plainly broken, not just tight, composition.

Fixed by giving `.layers-panel__title` standard ellipsis truncation and
adding a container query (matching the bulk bar's own established pattern in
this file) that wraps the header onto two rows once the rail narrows past
340px, so the action row gets its own line instead of colliding with the
title. `tests/e2e/layers/layers-header-solo-overflow.spec.ts` solos a node
via `EditorContext.setNodeSolo`, drives the panel to minimum width, and
asserts the title's box and the first action button's box are disjoint, and
that every header action (including Exit Solo and the detach button) stays
within the panel's own bounds. Confirmed failing pre-fix (title and first
icon overlapping) and passing post-fix, with the rest of the suite above
(320 unit tests, the other three layers e2e specs) unaffected.

Two unrelated e2e failures were observed while validating this pass —
`layer-workflows.spec.ts`'s "narrow panel usability" test (reproduces
identically with these two files reverted to `HEAD`, so it is caused by
other in-progress, uncommitted work elsewhere in this shared working tree,
not by this change) and its "soloing a node dims..." canvas-hash test (fails
only inside the full sequential suite, passes in isolation — consistent with
this machine's known contention under concurrent load). Neither was
introduced by, or fixed by, this pass.

## Validation record

Changed scope: Layers panel CSS/markup, Layers panel unit/E2E coverage, the
Layers architecture audit, and `/features/layers` marketing copy/illustration.

Passed:

- `pnpm verify:plan` — no full-suite escalation; Rust and full visual suites
  were deliberately skipped as unrelated.
- `pnpm exec vitest run packages/editor/src/components/LayersPanel --exclude '**/__benchmarks__/**' --reporter=dot` — 26 files, 320 tests.
- `VARVE_E2E_PORT=1476 pnpm exec playwright test tests/e2e/layers/layers-panel-visual.spec.ts --project=chromium --reporter=list` — 1 visual scenario.
- `VARVE_E2E_PORT=1475 pnpm exec playwright test tests/e2e/layers/layers.spec.ts --project=chromium --grep "colour labels" --reporter=list` — 1 scenario across three themes.
- `pnpm --filter @varve/website typecheck` — 0 errors, 0 warnings, 5 existing hints.
- `pnpm build:website` and `pnpm build:website:pages` — 81 pages built by each command.
- `VARVE_WEBSITE_E2E_PORT=4327 VARVE_WEBSITE_E2E_PORT_ROOT=4328 pnpm exec playwright test -c playwright.website.config.ts apps/website/tests/e2e/layers-feature.spec.ts --project=ghpages --project=custom-domain --reporter=list` — 2 scenarios.
- `pnpm audit:docs`, `pnpm audit:emoji`, and `pnpm audit:tokens` — clean; all 153 token pairs pass across three themes.
- `pnpm exec biome check tests/e2e/layers/layers.spec.ts` and `git diff --check` — clean.

The initial combined Layers browser command (`VARVE_E2E_PORT=1470` with
`axe.spec.ts`, `layers.spec.ts`, and `layers-panel-visual.spec.ts`) reached 9
passing scenarios, then exposed a transition-timing failure in the existing
colour-label assertion. The focused follow-up above passed after making that
assertion wait for the settled computed color.

The repository-wide `pnpm verify:affected` plan was not allowed to reach the
Layers checks because the already-dirty worktree stopped Tier 0 on unrelated
Biome formatting in `apps/website/tests/e2e/visibility.spec.ts`; the affected
editor typecheck likewise reported unrelated arrangement-test diagnostics.
Those files were left untouched. No full suite was run.
