# Font export preflight evidence — 2026-09-14

## Finding

Vector PDF export previously collected font bytes by family after readiness
checks. That allowed an exact authored face to be replaced by the first stored
or bundled file with the same family name. The native PDF wire remains
family-addressed, so a rich text node containing two exact artifacts could also
embed one file and report success.

## Change

Export font requests now carry the authored `fontReference` from the scene node
and each rich-text run. The collector receives those exact requests, verifies
the original artifact hash, and the export preflight blocks an unavailable
exact face with a repairable error. It also blocks multiple exact artifacts
under one family until the native PDF contract can select each face separately;
the caller can choose an explicit outline or raster route instead. Legacy
family-only requests remain compatible and are not upgraded to an invented
portable identity.

`awaitExportsReady` now rejects after its five-second deadline instead of
silently allowing a fallback-face export to succeed. Its de-duplicating cache
key includes the exact face reference, weight, and style.

## Evidence

Commands run:

```text
pnpm exec biome check --write packages/engine/src/fontRegistry.ts packages/editor/src/components/SpecPanel/export.ts packages/editor/src/components/SpecPanel/export.test.ts
pnpm exec vitest run packages/editor/src/components/SpecPanel/export.test.ts --pool=threads --maxWorkers=1 --reporter=dot
pnpm exec vitest run packages/engine/src/fontRegistry.test.ts packages/editor/src/components/SpecPanel/export.test.ts --pool=threads --maxWorkers=1 --reporter=dot
```

Results:

- 25 export tests passed.
- 73 combined registry/export tests passed.
- Focused preflight assertions cover missing exact bytes, two same-family
  artifacts, and a valid exact plus legacy family-only request.

## Limits

The package manifest already writes each exact face under a hash/member path.
The native PDF `fonts` tuple still has a family-only wire shape, so this change
intentionally refuses ambiguous same-family exact exports instead of claiming
per-run embedding. A follow-up native print contract must carry face keys and
collection indices through embedding, outlining, and rich-run lookup. Browser
raster export remains the explicit alternative and uses the canonical live
render path.
