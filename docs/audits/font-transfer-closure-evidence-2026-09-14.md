# Font transfer and package closure evidence — 2026-09-14

This checkpoint closes the transfer-layer implementation gap identified in the
font acceptance matrix. It is evidence for the clipboard and package parts of
scenario 19, and for the dependency portion of scenario 20. It does not claim
that every supported file format, native clipboard provider, or collaboration
transport is certified.

## Implemented boundary

- `DocumentCodec.collectNodeClosure` now carries only the font manifest entries
  used by copied text nodes and their reusable text styles. Exact artifact and
  collection-member references remain distinct; legacy family-only entries are
  retained as unresolved metadata.
- Version 2 Varve clipboard fragments carry the scoped manifest plus bounded
  font dependency records. Exact local bytes are included only when the
  original artifact is available and the recorded OpenType embedding rights
  permit inclusion. Unknown or restricted rights remain metadata-only or
  restricted. Clipboard collection never fetches a remote or bundled URL.
- Native and browser paste paths restore permitted exact bytes into the local
  hash-addressed font store and runtime registry before the fragment is
  inserted. This operation does not mark the document dirty. Invalid, missing,
  oversized, and unsupported records remain explicit diagnostics in the
  fragment instead of becoming a family-name substitution.
- Imported resource merging preserves document font manifests and keeps
  same-family faces separate by artifact hash and collection member.
- Package manifests are schema `2.0`, include the document font manifest, scan
  reusable text styles, expose identity/source/status/policy metadata, and only
  claim a bundled font after exact bytes were collected and written to the ZIP.

## Validation

Commands run:

```text
pnpm verify:plan
pnpm exec vitest run packages/scene/src/documentCodec.test.ts packages/editor/src/clipboard.test.ts packages/editor/src/packageExport.test.ts packages/editor/src/import/mergeImportedResources.test.ts --pool=threads --maxWorkers=1 --reporter=dot
pnpm exec biome check packages/editor/src/clipboard.ts packages/editor/src/clipboard.test.ts packages/editor/src/packageExport.ts packages/editor/src/packageExport.test.ts packages/editor/src/import/mergeImportedResources.ts packages/scene/src/documentCodec.ts packages/scene/src/documentCodec.test.ts
pnpm exec tsc -p packages/editor/tsconfig.json --noEmit
pnpm exec tsc -p packages/scene/tsconfig.json --noEmit
```

The focused Vitest run passed **4 files / 74 tests** after the transfer tests
were added. Biome passed on the task-owned files. The editor and scene
typechecks still report unrelated concurrent worktree errors; the task-owned
clipboard, package-export, merge, and document-codec files produced no
typecheck diagnostics. The full planner currently escalates because the shared
worktree contains workspace/toolchain and validation-infrastructure changes;
that gate remains separately documented in the Agent Validation Report.

## Remaining proof

The next executable checks are a real installed-font native clipboard round
trip, a package reopen/import test with a permitted binary, and cross-format
clipboard/import assertions for variable axes, OpenType features, and linked
stories. Live collaboration transport and Windows/macOS native evidence remain
outside the Linux checkpoint.
