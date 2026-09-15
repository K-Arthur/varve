# Exact-face export evidence — 2026-09-13

This checkpoint covers the package-export boundary added to the typography
system. The exporter now refuses to invent a face for family-only legacy text,
and exact requests are admitted only when the original artifact bytes match
their SHA-256 reference.

## Focused run

The combined engine/editor test run completed on `master` at
`370bd2c0bf26086be2f237651b11ce2831844028`:

```text
./node_modules/.bin/vitest run packages/engine/src/font/fontDataCollector.test.ts packages/editor/src/packageExport.test.ts --config vitest.config.ts --reporter=dot
```

Result: **2 files passed, 8 tests passed**. The assertions cover exact
collection-member URL selection, modified-byte rejection, legacy family-only
manifest recovery, raster/generative package assets, and same-family exact
face separation.

The website validation for the matching documentation changes also completed:

```text
pnpm build:website
```

Result: **100 pages built**, with zero Astro/type errors. The typography
workflow ran against both base-path configurations and desktop/dark/narrow
scenes: **14 tests passed**.
