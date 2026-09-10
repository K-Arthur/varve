# Page export selection

Varve has two different export families:

- node/frame/slice exports produce an object-oriented asset from scene nodes;
- page exports produce ordered publishing units from `Document.pages`.

An ordinary design frame is not a page merely because it has width and height.
Conversely, a page is not reduced to a frame when the user exports it: trim,
bleed, numbering, parent/master projection, exclusion, and spread membership
remain page concerns.

## Selection pipeline

```text
ExportTarget + print settings + page context
  → resolveExportPageSelection
  → ordered page ids + logical page/spread units + issues
  → ExportJobSpec.pageIds/pageUnits
  → renderer/native encoder
```

The resolver is pure and uses the document's page array as canonical output
order. It accepts explicit page ids, all pages from a document target, the
active/selected page context through range expressions, and numeric or
display-label ranges. A range filters the target scope; it does not replace an
explicit `page` or `pages` target with an unrelated page.

`excludeFromExport` is applied after target and range resolution. This makes an
exclusion observable and prevents a Pages-panel filter, workspace mode, or
missing thumbnail from changing output. A target may explicitly opt into an
excluded page with `includeExcludedPages: true`.

When `print.spreads` is enabled, selected pages are grouped by the persisted
custom spread topology or the deterministic facing-page projection. A reader
spread is atomic: an excluded or missing member causes that spread unit to be
omitted and an issue to be surfaced. This avoids generating a visually
misleading half-spread.

## Deliberate boundary

`ExportPageUnit` is a logical contract, not a promise that every encoder can
consume it today. The current editor legacy batch path still exports node jobs,
and the native PDF bridge remains single-page. The next export slice must map
these units to per-page PDF assembly, separate files, or an explicit package
according to the user's output choice. It must preserve each page's size and
boxes rather than using the first page's dimensions for the entire document.
