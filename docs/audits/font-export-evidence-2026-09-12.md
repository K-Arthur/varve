# Font export evidence — 2026-09-12

This entry records the exact-face package export slice. It covers request and
manifest identity; it does not certify every export surface or a native package
round trip.

## Implemented behavior

- `collectFontData` accepts either a family request or a request carrying an
  exact `fontReference`.
- Exact requests resolve a hash-addressed artifact and collection member, or a
  bundled registry entry with the same face key. They never fall back to a
  different family artifact when the requested face is unavailable.
- Package collection includes exact references from plain text nodes and rich
  text runs. Two faces with the same family name remain separate manifest
  entries and receive distinct bundle paths when verified bytes are available.
- Embedding status is resolved against the requested face when the catalog can
  identify it. The manifest still reports unavailable bytes honestly.

## Focused validation

Commands run:

```text
pnpm exec vitest run packages/engine/src/font/fontDataCollector.test.ts --config vitest.config.ts --pool=threads --maxWorkers=1 --reporter=dot
pnpm exec vitest run packages/editor/src/packageExport.test.ts --config vitest.config.ts --pool=threads --maxWorkers=1 --reporter=dot
pnpm exec biome check packages/engine/src/font/fontDataCollector.ts packages/engine/src/font/fontDataCollector.test.ts packages/engine/src/font/index.ts packages/editor/src/packageExport.ts packages/editor/src/packageExport.test.ts
pnpm audit:docs
```

Results: exact bundled member selection **2/2**, package export **4/4**,
Biome, and the documentation audit passed.

The bundled-member test uses a mocked registry URL and verifies that member
selection is exact. It does not claim a real licensed font download or native
filesystem round trip.

## Integration boundary

The package exporter now preserves exact identity in its own manifest and data
collector. The concurrent `Shell/ExportLayer.tsx` worktree is still being
integrated by its owner, so the legacy local catalog adapter there remains an
open follow-up. A package-level export certification should be rerun after that
adapter is updated and the native export path is quiet.
