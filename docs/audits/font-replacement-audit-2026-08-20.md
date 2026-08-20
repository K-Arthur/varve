# Font Replacement Audit — 2026-08-20

## Finding

Varve already had a substantial font catalog, resolver, provider/storage
layer, and document `fontManifest`. The missing product behavior was at the
document/editor boundary: the resolver ignored rich-text-only references, the
dialog mutated only top-level text properties, and save/load could discard the
reason a substitute had been chosen.

## Implemented behavior

- Missing families are detected in node-level text, rich-text runs, and text
  styles with case-insensitive family matching.
- Candidates are ranked as PostScript identity, family/style, compatibility
  mapping, then script/category fallback. The UI labels the match quality.
- One replacement applies across every matching node, rich-text run, and text
  style in one undo transaction.
- The original family and chosen replacement are retained in
  `Document.fontManifest.replacements`; the substituted entry is marked with
  `status: substituted` and `substituteFor`.
- Saving rebuilds the manifest from current document usage while retaining
  replacement history. Opening a document re-resolves the actual replacement
  family and never silently rewrites text back to an available original.
- The dialog remains quiet for clean documents and appears only when a new
  unresolved-family set is detected. Escape, visible close, focus restoration,
  and keyboard tab wrapping are supported.

## Conversion matrix

| Concern | Existing system | Current result | Limitation |
| --- | --- | --- | --- |
| Top-level text font | `TextNode.fontFamily` | Updated natively | Metrics may reflow |
| Rich-text run font | `RichText.paragraphs[].runs[].format.fontFamily` | Updated natively | Full complex-script shaping parity is separate |
| Text styles | `Document.styles` text styles | Updated natively | Style consumers must still resolve the style normally |
| Candidate selection | `FontCatalog` + `FontResolver` | Ranked and labeled | Unknown families may receive a category fallback |
| Provenance | `Document.fontManifest` | Preserved across save/reopen | Explicit restore-to-original UI is future work |
| Undo | Editor transaction API | One Replace All undo entry | Full workspace validation remains separately gated |
| Missing font UX | Existing shell controller/dialog | Accessible review and bulk action | Issue-to-layer location is future work |

## Validation

Commands run for this slice:

```text
pnpm exec vitest run packages/editor/src/components/FontBrowser/MissingFontDialog.test.tsx packages/engine/src/font/fontResolver.test.ts packages/engine/src/font/fontManifest.test.ts packages/engine/src/font/fontPersistence.test.ts
npx playwright test tests/e2e/canvas/figma-import.spec.ts --project=chromium --grep "missing rich-text" --reporter=list
pnpm --filter @varve/editor typecheck
pnpm --filter @varve/engine typecheck
```

The focused font tests passed (48 tests including the dialog). The browser
workflow passed and a screenshot was inspected from the actual editor surface.
The engine/editor typecheck commands were clean for the changed code; the
workspace typecheck is currently blocked by an unrelated existing analytics
schema mismatch in `packages/shared/src/analytics/schema.ts` and other dirty
tree errors documented in the final validation report.

## Product promise

Varve does not pretend that a substitute is the original font. It keeps text
editable, makes the choice visible, preserves the original reference for
recovery, and warns that wrapping and export metrics may change. This is the
appropriate local-first behavior for imported design files when the original
font cannot be resolved on the current device.
