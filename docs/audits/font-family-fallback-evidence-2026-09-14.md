# Font family-row fallback evidence — 2026-09-14

## Finding

The compact and contextual typography controls expose two different choices:

- selecting an expanded face applies an exact artifact/member reference;
- selecting a family row asks for a family-level fallback.

Previously, selecting the visible family again was treated as a no-op. When the
current text carried an unavailable exact artifact or stale variation axes, the
old identity therefore remained attached even though the user had chosen the
family row. That could make the resolver report the same missing face after an
apparently successful replacement.

## Repair

`fontFamilyChanges` now accepts the current exact reference and variation axes.
It preserves the old no-op behavior for an ordinary family-only node, but when
the current node carries identity or axes it emits an explicit family-level
change that clears `fontReference` and `variableAxes`. The floating text bar and
contextual control bar pass those fields through. The expanded-face path still
uses `onSelectFace`, so an exact selection retains its artifact/member identity.

## Assertions

- `fontWeight.test.ts` covers the distinction between an ordinary same-family
  no-op and an explicit same-family fallback with identity/axes.
- `FloatingTextBar.test.tsx` asserts that choosing the current family row emits
  the clearing change in one toolbar update.

The implementation is intentionally local to the typography command adapter;
it does not infer an exact identity from a family name and does not initiate a
download. The same adapter now supplies effective run values to the floating
and contextual bars: mixed family/weight/size selections display `Mixed` rather
than pretending that the first run represents the whole selection, while a
collapsed caret honors pending insertion formatting. The controls remain
actionable and route the next choice through the existing range command.

The remaining end-to-end proof for native restart and real corrupt artifact
recovery is tracked in the acceptance matrix.

## Browser evidence

Focused component checks passed 61 tests across the typography command,
FontSelector, floating toolbar, and contextual bar suites. The browser checks
also passed all six scenarios:

```text
CI=1 TMPDIR=/home/kevina/varve-tmp VARVE_E2E_PORT=1748 VARVE_E2E_WORKERS=1 VARVE_DISABLE_HMR=1 VARVE_E2E_OUTPUT_DIR=font-toolbar-mixed-20260914 npx playwright test tests/e2e/canvas/font-toolbar-visual.spec.ts tests/e2e/canvas/typography-editing.spec.ts --project=chromium --reporter=list --timeout=180000
```

The inspected captures include the light open menu and dark narrow toolbar at
`test-results/font-toolbar-mixed-20260914/`. The toolbar remains aligned with
the shared compact controls, the menu stays inside the viewport, and selected
rows retain readable contrast at DPR 1, 2, and 3.
