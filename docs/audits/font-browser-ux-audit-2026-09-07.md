# Font browser UX audit — 2026-09-07

## Scope

This audit covers the full font browser opened from Typography, the semantic
catalog search used by that browser, the missing-font recovery entry point, and
the Fonts inspector panel. The review used the supplied screenshots, the
current implementation, focused unit tests, and a Chromium run at both the
default and compact modal sizes.

## Evidence-led findings

| Finding | Evidence | Resolution |
| --- | --- | --- |
| A plain family query could show unrelated families | `FontSemanticCatalog.search('gothic')` returned zero-score records to fill the result limit after the real matches | Plain lexical queries now discard records with no lexical match; structured semantic queries retain their ranked behavior and unknown-term explanations |
| The selected family displaced the results list | The detail content was rendered below the catalog in one height-constrained flow, so the screenshot showed the list clipped above the detail panel | Results and inspection are independent scrolling panes in a responsive two-pane workspace |
| Selecting an installed family applied it immediately | `FontBrowser` called `onSelect` during row selection, which closed the Typography dialog | Row selection is inspection-only; `Use font` is the explicit document action |
| Downloadable families were difficult to evaluate | The old row exposed only descriptors and `Install` | The inspection pane includes a custom specimen, source, license, styles, weights, scripts, tags, reasons, recommendations, and install/use actions |
| The modal did not start at its primary task | The dialog's first focusable control was the close button | The dialog opts into first-control focus and marks the search input as the autofocus target |
| Narrow and themed surfaces needed direct validation | The supplied modal was narrow and only showed the light treatment | Shared tokens, explicit high-contrast/forced-colors rules, stacked compact layout, and real-browser screenshots now cover light, dark, and high contrast |

## Research used

The interaction model was compared against current font-browsing products and
documented behavior rather than inferred from the screenshots:

- [Figma — Browse and apply fonts](https://help.figma.com/hc/en-us/articles/360041308034-Browse-and-apply-fonts)
  documents name search, source/category filters, and previewing a font on the
  selected text.
- [Google Fonts — Reimagining Google Fonts](https://design.google/library/reimagining-google-fonts)
  demonstrates editable specimens, scale/color controls, pairings, and
  typography/designer context.
- [Adobe Fonts search](https://fonts.adobe.com/search) demonstrates browsing by
  meaningful tags such as friendly, rounded, geometric, and blackletter.
- [Adobe Illustrator 2026 Font Browser](https://community.adobe.com/announcements-651/meet-the-new-font-browser-in-illustrator-2026-817848)
  documents keyword/theme search, source quick filters, language and
  classification filters, and hover actions for similar/favorite workflows.

Varve intentionally adapts these patterns to its local-first boundary: the
runtime catalog is shipped locally, installation is explicit and
version-pinned, and a catalog preview never pretends that a font is loaded.

## Implemented contract

- **Search:** `gothic` is a family/style lexical query and returns only matching
  records. Queries with semantic roles, preferences, coverage, similarity, or
  numeric constraints continue through the explainable semantic ranker.
- **Discovery:** source tabs and semantic refinement remain available without
  requiring a provider request. Result ordering preserves semantic relevance
  while the unfiltered catalog remains alphabetic.
- **Inspection:** selecting a row updates the selected family without closing
  the modal or mutating the document. The live specimen uses the actual family
  only when that family is installed; otherwise the UI labels it preview-only.
- **Actions:** `Install font` owns the download boundary. `Use font` is the only
  action that invokes the parent document update callback.
- **Accessibility:** source controls use tab semantics, the search has an
  explicit accessible name and initial focus, actions have family-specific
  labels, and selected rows expose `aria-pressed`.
- **Themes and layout:** colors, borders, focus rings, spacing, and typography
  use shared tokens. The workspace stacks at compact widths, with independent
  list/detail scrolling and forced-colors handling.

## Validation

- `pnpm exec vitest run packages/engine/src/font/semantic/semanticQuery.test.ts packages/engine/src/font/semantic/semanticSearch.test.ts packages/editor/src/components/FontBrowser/FontBrowser.test.tsx packages/editor/src/components/FontBrowser/FontSelector.test.tsx`
- `VARVE_E2E_PORT=1421 npx playwright test tests/e2e/canvas/font-selector.spec.ts --project=chromium --reporter=list`
- `VARVE_E2E_PORT=1424 npx playwright test tests/e2e/canvas/font-selector.spec.ts --project=chromium --grep "keeps the browser" --reporter=list`

The full font selector E2E file passed after the assertion correction. The
compact run passed all three theme screenshots and verified that the browser
had no horizontal or vertical overflow at the compact viewport.
