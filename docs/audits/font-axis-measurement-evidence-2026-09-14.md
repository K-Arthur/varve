# Font axis and measurement evidence — 2026-09-14

This checkpoint addresses a rendering defect found during the September 14
font audit: the shared Canvas advance backend put variable axes in its cache
key, but did not apply those axes to the measurement context. A `wght` or
custom-axis edit could therefore reuse a value that was keyed as different
while wrapping and geometry remained unchanged. The canonical rich-text
snapshot also left its feature and variation identity empty for rich runs.

## Implementation

Commit `17030e9b8` makes the shared measurement boundary authoritative for the
settings it can express:

- `@varve/shared` now couples `variableAxes.wght` to the Canvas font weight,
  applies `font-feature-settings` and non-weight `font-variation-settings` when
  the runtime exposes those properties, and resets unsupported optional
properties to `normal`.
- Axis keys are sorted and finite-tag validated before entering the advance
  cache. Feature maps remain part of the cache key, so a feature change cannot
  reuse a previous advance.
- `layoutRichTextSnapshot` derives stable feature and variation keys from
  defaults and every rich run, while preserving caller-provided identity
  additions. The resulting `TextLayoutIdentity` now changes when a rich run's
  axis or feature map changes.
- The implementation remains capability honest: WebKitGTK and older embedded
  contexts that omit optional Canvas properties retain the parsed-face/SVG or
  native shaping fallback boundary; this change does not claim HarfBuzz is
  already the browser paint backend.

The shared barrel exports only the three new measurement helpers needed by the
engine (`applyTextMeasureTypography`, `buildTextMeasureFontString`, and
`variationSettingsKey`). No remote font fetch is introduced by measurement.

## Focused validation

The focused run passed 103 tests across shared geometry, Canvas measurement, and
canonical paragraph layout. The added assertions cover:

- `wght` changing the Canvas shorthand while a custom `wdth` axis is assigned
  to `fontVariationSettings`;
- explicit `liga: false` reaching `fontFeatureSettings`;
- equivalent axis objects producing one stable key despite insertion order;
- rich-run axis and feature values being present in the layout snapshot identity;
- cache invalidation and existing fallback geometry behavior.

Commands:

```sh
pnpm exec biome check \
  packages/shared/src/textMeasure.ts \
  packages/shared/src/textMeasure.test.ts \
  packages/engine/src/canvasTextMeasurer.ts \
  packages/engine/src/canvasTextMeasurer.test.ts \
  packages/engine/src/richTextLayout.ts \
  packages/engine/src/text/paragraphLayout.test.ts

pnpm exec vitest run \
  packages/shared/src/textMeasure.test.ts \
  packages/engine/src/canvasTextMeasurer.test.ts \
  packages/shared/src/textGeometry.test.ts \
  packages/engine/src/text/paragraphLayout.test.ts \
  --pool=threads --maxWorkers=1 --reporter=dot

pnpm --filter @varve/shared typecheck
pnpm --filter @varve/engine typecheck
```

Biome and the focused tests passed. Shared typecheck passed. Engine typecheck
reported only pre-existing concurrent diagnostics in
`contentAwareFill/quickCleanup.test.ts` and `lut/*.test.ts`; none point to the
changed files. The repository planner saw 315 concurrent changed files,
escalated to the full gate, and `pnpm verify:affected` stopped at that required
escalation. The explicit full gate reached architecture/typecheck and stopped
on the unrelated `contentAwareFill/index.ts → quickCleanup.ts →
generativeEdit/types.ts` cycle plus the existing engine test diagnostics.

## Limits and next executable checks

This milestone makes browser measurement and snapshot identity consistent; it
does not close the acceptance scenarios that require real font bytes. The next
checks remain a real variable-font corpus through HarfBuzz/native shaping,
main-thread/worker glyph and pixel oracle, exact instance export/clipboard and
reopen, and WebKitGTK/Windows/macOS platform evidence. The optional Canvas
properties are still runtime capabilities, not legal or license assertions.
## Exact-face follow-up

Commit `670d2bc17` carries the primitive `fontReference` into runs that do not
override it and combines the exact face key with `textMeasureRevision()` in
`TextLayoutIdentity.fontRevision`. A stored snapshot therefore cannot survive
a project/system face replacement or a fallback-to-ready transition merely
because its family name and source text are unchanged. The paragraph-layout
suite adds coverage for the inherited `sha256:` face key and measurement
revision.
