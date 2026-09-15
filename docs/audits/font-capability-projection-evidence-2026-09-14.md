# Font capability projection evidence — 2026-09-14

This slice closes the representation gap between the font catalog, document
manifest, recovery UI, and runtime readiness. It does not certify native
restart, worker-adoption, or cross-platform rendering parity.

## Contract

`packages/engine/src/font/fontCapabilities.ts` keeps these signals separate:

- catalog presence;
- stored-byte availability or corruption;
- validated-face support;
- main-thread readiness and worker adoption;
- shaping and export support;
- network state; and
- local-font, embedding, and redistribution permissions.

`diagnoseFontCapabilities` gives deterministic outcomes and next actions. A
corrupt artifact wins over an offline state, permission denial is distinct
from a missing family, and restricted embedding is distinct from local render
readiness. Catalog entries retain the projection, document manifests persist
it, and the Document Fonts panel displays a status badge for each exact face.
Unknown startup metadata remains conservative so it is not presented as a
corrupt or missing file.

## Validation

Commands:

```text
pnpm exec biome check --write packages/engine/src/font/fontCapabilities.ts packages/engine/src/font/fontCapabilities.test.ts packages/engine/src/font/fontCatalog.ts packages/engine/src/font/fontCatalog.test.ts packages/engine/src/font/fontBridge.ts packages/engine/src/font/fontManifest.ts packages/engine/src/font/fontManifest.test.ts packages/engine/src/font/fontPersistence.ts packages/editor/src/components/FontBrowser/MissingFontDialog.tsx packages/editor/src/components/FontBrowser/DocumentFontsPanel.tsx packages/editor/src/components/FontBrowser/DocumentFontsPanel.css
pnpm exec vitest run packages/engine/src/font/fontCapabilities.test.ts packages/engine/src/font/fontCatalog.test.ts packages/engine/src/font/fontManifest.test.ts packages/engine/src/font/fontBridge.test.ts packages/editor/src/components/FontBrowser/MissingFontDialog.test.tsx --config vitest.config.ts --pool=threads --maxWorkers=1 --reporter=dot
pnpm exec vitest run packages/editor/src/components/FontBrowser/DocumentFontsPanel.test.tsx packages/engine/src/font/fontCapabilities.test.ts packages/engine/src/font/fontManifest.test.ts --config vitest.config.ts --pool=threads --maxWorkers=1 --reporter=dot
```

Result: both focused runs passed (79 tests in the first run and 22 tests in
the second). The broader affected plan remains escalated because concurrent
workspace and validation-infrastructure changes are present; unrelated engine
LUT/generative-edit type failures remain recorded in the Agent Validation
Report.

## Remaining proof

The next executable checks are a real corrupt-file repair in browser storage,
permission revocation in Chromium/WebKitGTK, exact worker adoption with the
main/worker pixel oracle, and native restart after exact-face removal.
