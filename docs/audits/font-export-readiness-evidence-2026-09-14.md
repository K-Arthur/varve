# Font export readiness evidence — 2026-09-14

Export readiness now checks exact identity before starting browser font loads.
When a family has identity-aware registry entries, the requested
`sha256:<digest>:<member>` key must be present. A different same-family artifact
fails immediately with an actionable exact-face error; family-only legacy
entries retain their compatibility path.

## Validation

Commands:

```text
pnpm exec biome check packages/engine/src/fontRegistry.ts packages/engine/src/fontRegistry.test.ts packages/engine/src/fontRegistry.exportReadiness.test.ts
pnpm exec vitest run packages/engine/src/fontRegistry.exportReadiness.test.ts packages/engine/src/fontRegistry.test.ts --config vitest.config.ts --pool=threads --maxWorkers=1 --reporter=dot
```

Result: **3 files passed Biome; 2 test files and 52 tests passed**. The jsdom
readiness tests cover rejection of a wrong artifact, rejection when the browser
reports the requested sample is not ready, and successful loading of a
registered collection member with the requested weight, style, and text.

This does not certify native PDF per-face embedding, subsetting, outlining, or
the full render/export geometry oracle; those remain partial in acceptance row
20.
