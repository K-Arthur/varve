# Exact face render-boundary evidence — 2026-09-13

## Finding

The scene model already carries `fontReference` for a font artifact and
collection member. The scene-to-engine adapter previously omitted that field
from the engine node and text primitive. Rich-text runs therefore reached the
engine without their exact face identity, so downstream rendering and cache
layers could only see the family name.

## Change

The engine typography IR now carries the optional reference on:

- the engine text node;
- the text primitive used by Canvas2D replay; and
- each rich-text character format.

Legacy family-only documents remain valid because the field is optional.

## Verification

The focused regression file
`packages/editor/src/render/sceneToEngine.fontReference.test.ts` verifies both
node/primitive propagation and rich-text run propagation:

```text
pnpm exec biome check packages/engine/src/types.ts packages/editor/src/render/sceneToEngine.ts packages/editor/src/render/sceneToEngine.fontReference.test.ts
pnpm exec vitest run packages/editor/src/render/sceneToEngine.fontReference.test.ts --pool=threads --maxWorkers=1
```

Both commands passed (2 tests). This is a boundary fix, not a claim that all
runtime renderers now select the referenced bytes. Canvas alias selection,
native face handles, worker exact-face adoption, and pixel-oracle evidence
remain tracked work.
