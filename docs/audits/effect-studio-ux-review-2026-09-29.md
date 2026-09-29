# Effect Studio UX review

**Date:** 2026-09-29
**Scope:** Effect Studio dialog, bounded preview, responsive behavior, and the
public feature page.
**Evidence limit:** External complaints below are individual reports and
discussion, not evidence that a problem is widespread.

## Repository findings

The Effect Studio dialog used a 768 × 576 canonical preview and a three-column
preview/gallery/stack layout. At tablet widths the CSS put preview and stack
side by side and the gallery below, while DOM order put the stack before the
gallery. Narrow layouts stacked those same elements in a different order again.
The result made keyboard traversal diverge from what a reader saw, and the
three areas competed for width near the layout breakpoint.

The gallery's **Saved** filter represented device-local favorites, while
**Looks** were ordered recipes stored in the document. Raw creative operators
were available under a generic disclosure. Those different persistence scopes
were not apparent where people browse. The preview correctly used the
canonical renderer and exposed Fit, 100%, 200%, and a shared before/after
divider, but there was no optional higher-resolution check for inspecting
fine detail after the live render settled.

## Public complaint evidence

- An [Affinity Photo community report about the Pixelate filter](https://forum.affinity.serif.com/index.php?%2Ftopic%2F230891-pixelate-filter-changes-output-after-clicking-apply%2F=)
  describes visible color changes between the live filter preview and the
  applied result. The post does not identify zoom as the cause,
  so this is treated as a general preview/output mismatch, not evidence about
  a specific zoom level. It supports using the same renderer for live and
  settled checks and keeping the canvas as the final appearance reference.
- In a [G’MIC preview zoom discussion](https://discuss.pixls.us/t/preview-locked-at-19-87-and-some-odd-spellings/8730),
  a user reports preview zoom controls locked at a small scale. A maintainer
  says zoom was restricted by default because zoom changes made some complex
  filter previews inaccurate. This shows the trade-off between inspection zoom
  and a trustworthy comparison: Varve keeps Fit, 1:1, and 2:1 explicit, applies
  one display transform to both sides, and does not let display zoom change the
  rendered effect.
- An [Adobe Photoshop Export As bug report](https://community.adobe.com/bug-reports-699/p-export-as-window-glitches-photoshop-beta-version-27-9-1629542)
  describes preview pixelation/cropping and a dialog size that did not persist.
  Adobe later said a fix was available in 27.10; subsequent users in the same
  thread still reported pixelation. This is one discussion thread with mixed
  follow-up reports, not an independent prevalence sample. Effect Studio is
  not a resizable export window, so persisted custom dialog dimensions do not
  directly apply. The relevant cases here are cropping and constrained
  viewports: keep the dialog within the screen, use one scrollable narrow
  layout, and keep Fit bounded to the available preview stage.

These reports are design evidence only. Varve has no usage data that would
support a prevalence estimate or a claim that these complaints are common.

## Changes and product boundary

- Keep the 768 × 576 canonical renderer for responsive live feedback.
- Add an explicit, optional settled proof using the same renderer and matched
  selection bounds, fitting small sources to the 1536 × 1152 profile. Actual
  output can be smaller to preserve the source aspect ratio. A stale setting or target invalidates the
  proof; obsolete renders are canceled. A failed or provisional proof leaves
  the live preview available, and Apply remains independent of the check.
- Keep the canvas and export as full-resolution appearance references. The
  proof is still a bounded editing preview and is not stored in the document.
- Place preview, gallery, and stack/settings in the same DOM, keyboard, and
  visual order. Use three columns on wide screens, preview/gallery with a
  full-width stack below on medium screens, and one scrollable column on
  narrow screens. Keep coarse-pointer controls at 44 px.
- The unfiltered gallery is taller than a tablet or phone viewport, which can leave stack
  controls far below the fold. A sticky three-button compact-layout rail jumps to Preview,
  Treatments, or the active Stack/settings target. It keeps one dialog scroll
  owner instead of introducing a nested scroller; while a treatment is open for
  tuning, the last button targets those controls. Each jump scrolls the destination
  below the rail before moving keyboard focus, so the rail does not cover the section
  heading. The browser check asserts that clearance on phone widths.
- Name device-local Favorites, document-scoped Looks, and Advanced individual
  effects distinctly at their point of use.
- Keep Document Looks with the treatment browser so device and document
  persistence are explained beside the items being browsed. Keep applied
  treatment tuning, ordering, and removal in the dedicated stack/settings
  inspector; leave raw one-off operators collapsed in the browser's advanced
  section.
- Update the feature page to show reviewed desktop and mobile screenshots and
  to describe the live preview, optional 2× check, and full-resolution limits
  accurately.

The fixed responsive dialog does not remember a user-resized window size
because it has no resize affordance. This review does not add persisted window
dimensions; the cited size-persistence complaint refers to a different export
window interaction.

## Validation record

Reviewed screenshots are archived under
[`docs/screenshots/effect-studio-ux-review-2026-09-29/`](../screenshots/effect-studio-ux-review-2026-09-29/README.md).
The responsive matrix covers 1440 × 900, 1024 × 768, 768 × 1024, 390 × 844,
and 320 × 844 in light and dark themes. The visual comparison, multi-treatment
stack reachability, and phone section-jump flows are exercised with real
Chromium interactions. The feature-page captures use the same reviewed
desktop and phone states. A reduced CSS viewport stands in for browser zoom
only if actual zoom cannot be exercised; no actual browser-zoom run is claimed.

Completed checks:

- The isolated `pnpm verify:plan --staged` selected 52 Effect Studio files,
  reported no full-suite escalation, and warned that the shared thumbnail
  contract expands the dependency closure to 84% of test files (1,977/2,353).
- `pnpm verify:affected --staged` passed touched formatting, lint, emoji,
  radius, docs, and inspector CSS, then stopped at the token usage scan. All 303
  token contrast pairs pass across three themes; the usage scan flagged an
  unrelated `--name` example in `packages/codegen/src/tailwind.ts:685`, outside
  this change. `pnpm audit:docs` is clean (1,121 docs, 732 links, 178 ADRs).
- `pnpm audit:spacing` passes. `pnpm audit:sizing` reports two new control-size
  declarations (`height` and `min-height`) in the separate
  `Presentation/presentationNavigator.css` surface. Neither file is part of
  this Effect Studio change.
- `pnpm audit:inspector-css` passes its enforced rules; its non-blocking debt
  inventory includes eight raw line-height and 14 grid-column declarations in
  Effect Studio CSS. `pnpm typecheck:e2e` and the seven focused unit files pass
  (93 tests). Shared and engine typechecks passed; editor typecheck reports
  unrelated errors in `CurveEditor.test.tsx` and `exportService.test.ts`.
- `pnpm --filter @varve/website build` completed all 114 routes with zero
  Astro errors, warnings, or hints. The Effect Studio website Playwright run
  passed four checks (feature-page and guide/index on both site bases), and
  desktop/mobile page screenshots were visually reviewed.
- The focused narrow-screen navigation test passes, including the check that
  its destination sits below the sticky rail. After reviewing and refreshing
  the compact-launcher screenshot, the final leased Effect Studio and portrait
  touch Playwright run passed all 16 tests. The touch helper dismisses the phone
  Layers drawer with Escape before opening the inspector.

The planner did not escalate to `pnpm verify:full`. Rust workspace tests and
the full visual suite were skipped because no Rust/native or global rendering
surface changed. No actual browser-zoom run is claimed.
