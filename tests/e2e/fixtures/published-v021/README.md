# Published 0.2.1 migration fixture

`poster-embedded.varve` retains the schema 2.21 poster committed in `v0.2.1`
at `d47cea2b9ba15e3a0d824dfc3e979eb68afe8375`, including its vector artwork,
gradient, text and original node identities. An additional synthetic image is
constructed by that release's own `makeShapeNode`, `imageFill` and
`createEmbeddedAsset` factories. No current-schema document was relabeled.

`provenance.json` records the exact original document and factory source
hashes, image hash and final fixture hash. The image has two blue and two
amber quadrants and uses no external assets. The original poster provenance
is recorded in the published screenshot generator.

Reproduce from the repository root with the published Git object available:

```sh
node tests/e2e/fixtures/published-v021/generate.mjs
```

The browser test opens the file through the real document picker and asserts
migration to the current schema, artwork and asset retention, undo/redo,
SVG/PDF output, and offline save/close/reopen. Its file adapter models the
browser File System Access API; native disk, installer and OS dialog checks
remain separate release requirements.
