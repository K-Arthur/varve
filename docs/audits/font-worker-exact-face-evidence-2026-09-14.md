# Worker exact-face adoption evidence — 2026-09-14

## Finding

The render worker previously acknowledged only adopted family names. That was
enough to stop fallback for a family, but it could not distinguish two
same-family artifacts or collection members. A worker could therefore be
admitted after loading the wrong member.

## Change

Worker font adoption now returns both adopted families and adopted portable face
keys (`sha256:<artifact>:<member>`). The host exposes a synchronous
`unavailableFontFaceKeys` set, and the shared admission predicate checks node,
style, rich-run, and story references before either pruning or dispatch. The
family-only path remains available for legacy documents without a reference.

## Verification

```text
pnpm exec biome check --write packages/editor/src/render/workerFonts.ts packages/editor/src/render/renderWorker.ts packages/editor/src/render/workerHost.ts packages/editor/src/render/workerFonts.faceIdentity.test.ts packages/editor/src/render/workerHost.fonts.test.ts
pnpm exec vitest run packages/editor/src/render/workerFonts.test.ts packages/editor/src/render/workerFonts.faceIdentity.test.ts packages/editor/src/render/workerHost.fonts.test.ts --pool=threads --maxWorkers=1 --reporter=dot
```

The focused suite passed: 3 files, 25 tests. The editor typecheck still has
unrelated shared-tree failures; the changed worker file was repaired after the
first typecheck reported an optional-reference narrowing error.

The real-byte worker pixel oracle and native WebKit/Windows/macOS evidence are
still pending. This record therefore proves the admission contract and exact
acknowledgment, not cross-realm pixel parity certification.
