# Illustration vector-texture export handoff — 2026-09-29

Owner: primary integration agent for the illustration/concept-art request.
Branch: `master` (user-requested).

## Reproduction and boundary

The real editor flow can now create a raster Shading child clipped to a vector
shape's live alpha. Chromium showed the stroke stopping at the vector contour,
and undo/redo plus save/reopen retained the artwork. Exporting the containing
group as SVG preserved the vector rectangle but emitted an empty live-matte
group, dropping the clipped raster texture.

`packages/editor/src/export/compositor.ts` is also used by the active renderer
workstream. This integration takes only the narrow export-capability decision:
scene-node matte groups are rasterized for SVG/PDF at the smallest required
group boundary, leaving surrounding supported vector nodes editable. It does
not change renderer replay, worker messages, pixel reuse, or raster formats.
The file already has opposing staged and unstaged changes in the shared
checkout, so commits must use an isolated index and include only the current
working-tree change against `HEAD`; the main index is not to be rewritten.

Owned regression coverage:

- `packages/editor/src/export/liveMatteExportBoundary.test.ts` — select the
  masked group as the flatten boundary for SVG/PDF while retaining its vector
  sibling as native output.
- `tests/e2e/paint/clipped-vector-texture.spec.ts` — exercise the real canvas,
  clip edge, independent undo/redo, save/reopen, and actual SVG/PDF downloads.

## Result

The first export exposed a serializer defect: the clipped group PNG had
correct pixels but was emitted at `(0, 0)` with a generic 200×160 crop, outside
the SVG's world-coordinate view box. Raster fallback view-box bounds also
ignored the embedded image. The compositor now computes transformed raster
layer bounds, includes mask source dependencies when rendering the boundary,
and gives scene-node matte fallbacks a parent-relative placement transform.
SVG bounds include the fallback image. Supported contour siblings remain
native. Browser PDF keeps the appearance by rasterizing the selected subtree.

The leased Chromium run passed the editor clip boundary, undo/redo, save/reopen,
and SVG/PDF download flow. The downloaded SVG was rendered with
`rsvg-convert`; the PDF was rendered with `pdftoppm`; both were opened and
visually inspected. SVG retained a `<rect>` contour and embedded the paint
island as a `<image>`. One interim repeat stopped before editor startup because
a shared `Menubar.tsx` edit raised `ZoomInput is not defined`; the later full
affected-plan app E2E passed after the shared checkout recovered. Linux
Tauri/WebKitGTK, native/PDF-X exports, ancestor transforms, and stylus input
remain unqualified.

## Final validation and visual evidence

After the shared checkout recovered, the affected-plan Chromium E2E passed in
129 seconds. The fresh SVG uses `viewBox="422.5 128 274 234"`; both its
`rsvg-convert` render and the downloaded PDF's `pdftoppm` render were inspected
at native resolution. `pdfimages -list` confirms the browser PDF contains one
275 × 234 RGB image and soft mask, so this path preserves appearance through a
raster fallback rather than preserving editable vectors in PDF.

The website Strokes E2E passed on both GH Pages and custom-domain bases. It
checked desktop and mobile widths, light/dark themes, accessibility copy, and
the new screenshot's decoded image dimensions. Its full-page captures were
visually inspected; the new figure appears on the page in both output bases.
The marketed proof image is the inspected editor capture at
`apps/website/public/screenshots/illustration-vector-clipped-texture.png`.

The staged affected plan was run through Tier 1's app E2E successfully, then
stopped at the website package unit lane. Eight unrelated shared-worktree
failures were reported: stale demo `.varve` fixtures after the document format
advanced to 2.31, two unmanifested effect-studio screenshots, and a raw
font-size count of 349 against the existing ceiling of 344. Those files and
surfaces are outside this slice's staged ownership. Later affected typecheck,
website-wide E2E, import, and export lanes therefore did not run in that
invocation. The two-base Strokes website E2E and both website builds passed
separately. A prior editor typecheck also found unrelated `CurveEditor.test.tsx`
typing errors; Linux Tauri/WebKitGTK remains unqualified.

### Agent Validation Report

Changed scope: clipped paint layer action and resolver, SVG/PDF flatten
boundary and placement bounds, focused tests, Paint help and architecture
guidance, capability/research ledgers, Strokes marketing and its real app
capture.

Validation plan: `pnpm verify:plan --staged` selected Tier 0 format/lint/docs,
emoji and radius audits; E2E typecheck; five exact unit tests; clipped-texture
Chromium E2E; affected editor/help/website package tests and typechecks; website
unit/E2E; and import/export E2Es. Full-suite escalation: no.

Commands actually run: `pnpm verify:plan --staged`; staged
`pnpm verify:affected --staged`; the leased two-project Strokes website Playwright
test; `pnpm --filter @varve/website build`; `pnpm build:website:pages`;
`pnpm typecheck:e2e`; `pnpm --filter @varve/codegen typecheck`;
`pnpm --filter @varve/editor typecheck`; `pnpm audit:docs`;
`pnpm audit:emoji`; `pnpm audit:radius`; `pnpm audit:tokens`;
`rsvg-convert`; `pdftoppm`; and `pdfimages -list`.

Passed: Tier 0 format/lint/docs/emoji/radius; E2E typecheck; five exact unit
tests (100 focused assertions across the compositor, matte boundary, paint
layer, toolbar action and SVG placement); app clipped-vector save/reopen,
undo/redo and SVG/PDF export E2E; Strokes GH Pages/custom-domain E2E (2/2);
website builds (114 pages each); codegen typecheck; SVG/PDF visual inspection.

`pnpm audit:tokens` passed all 324 contrast pairs in light, dark, and
high-contrast themes, then failed its usage scan on one dynamic Tailwind
reference, `packages/codegen/src/tailwind.ts:685` (`bg-[var(--name)]`). That
CodeGen generator is outside this slice's staged ownership.

Skipped as unrelated or after fail-fast: whole website unit package had the
eight failures described above; later website/editor/help/desktop typechecks,
website-wide E2E and import/export E2Es did not run in the affected invocation.
The direct editor typecheck had existing `CurveEditor.test.tsx` type errors.
Full Rust, full Playwright and full repository suite were not selected.

Escalations: none. Full suite run: no.
