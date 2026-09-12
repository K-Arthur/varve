# Font catalog bridge evidence — 2026-09-12

This entry records the editor integration that removes family-level placeholder
catalogs from persistence, missing-font recovery, and package export.

Implementation commit: `2b7d98ff9812fae38a5b4e9e47468580dabb3456`.
The follow-up browser virtualization evidence is `4144143d8e5fb352ef2b8b757f98f761562bd44d`.

## Boundary repaired

`createFontCatalogFromRegistry` in `packages/engine/src/font/fontBridge.ts` is
now the adapter for editor services that need a `FontCatalog`. It projects each
registered face, not just the first face in a family. Canonical
`sha256:<digest>:<member>` keys remain canonical identities; entries without a
verified artifact retain a clearly non-canonical `registry:` identity. Known
registry metadata, PostScript names, collection members, variable axes,
embedding policy, and source location are retained when available.

`usePersistence` and `MissingFontController` use this adapter. A save or
missing-font replacement therefore sees the same face set as the picker and
cannot silently collapse two faces that share a family name. The package export
caller is currently overlapped by an unrelated staged `ExportLayer` change;
its adapter switch is kept as the next isolated export slice rather than
mixing concurrent work into this commit.

The full browser consumes the same registry projection for its face expansion
and virtualizes family rows with a measured overscan range. This keeps the
catalog responsive at the large sizes required by the manager without making
the compact picker or the persistence paths own a second catalog model.

## Focused evidence

```text
./node_modules/.bin/vitest run packages/engine/src/font/fontBridge.test.ts --config vitest.config.ts --reporter=verbose
./node_modules/.bin/tsc -p packages/engine/tsconfig.json --noEmit
./node_modules/.bin/biome check packages/engine/src/font/fontBridge.ts packages/engine/src/font/fontBridge.test.ts packages/engine/src/font/index.ts packages/editor/src/context/usePersistence.ts packages/editor/src/components/Shell/ExportLayer.tsx packages/editor/src/components/FontBrowser/MissingFontController.tsx
```

The bridge test covers two exact faces from the same family, metadata and axis
preservation, and two family-only legacy entries that must not acquire a
portable hash. The focused test passed 2/2, engine typecheck passed, and Biome
reported no findings. The editor typecheck remains coupled to unrelated
concurrent changes; its existing diagnostics are recorded in the frontend
evidence log.
