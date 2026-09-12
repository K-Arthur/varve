# Font embedding policy evidence — 2026-09-12

This entry records the shared parser, policy, manifest, and browser-details
slice. It supersedes the open embedding-flags item in the 2026-09-09 font
audit only for the behavior listed here; exact export preflight and native
platform proof remain open.

## Implemented contract

- `fontIdentityKey` uses `sha256:<artifact digest>:<collection member>` for a
  canonical SHA-256 identity. Non-canonical legacy identities retain a
  compatibility key and cannot produce a portable `fontReference`.
- OS/2 `fsType` is decoded into a base embedding right plus independent
  `noSubsetting` and `bitmapOnly` flags. The legacy `embeddingRights` projection
  remains readable for older manifests.
- Policy evaluation blocks subsetting when `noSubsetting` is set and blocks
  live document/web embedding for bitmap-only faces. Explicitly unknown license
  provenance blocks legal operations until the source terms are verified.
- The full browser's details panel shows base permission, both technical flags,
  and license provenance so a technical declaration is not presented as a
  legal assurance.

## Validation

Baseline revision before this slice: `HEAD` at the start of implementation.

Commands run:

```text
pnpm exec biome check --write packages/engine/src/font/fontIdentity.ts packages/engine/src/font/fontParser.ts packages/engine/src/font/fontLicensePolicy.ts packages/engine/src/font/fontManifest.ts packages/engine/src/font/index.ts packages/engine/src/fontRegistry.ts packages/engine/src/font/fontLoader.ts packages/engine/src/font/fontParser.test.ts packages/engine/src/font/fontLicensePolicy.test.ts packages/editor/src/components/FontBrowser/FontLicenseDetails.tsx
pnpm exec vitest run packages/engine/src/font/fontParser.test.ts packages/engine/src/font/fontLicensePolicy.test.ts --config vitest.config.ts
pnpm --filter @varve/engine typecheck
pnpm --filter @varve/editor typecheck
pnpm exec vitest run packages/editor/src/components/FontBrowser --config vitest.config.ts
```

Results: parser and policy tests **81/81 passed**; engine and editor
typechecks passed; FontBrowser tests **21/21 passed**. The existing toolbar and
browser captures in `docs/screenshots/fonts/2026-09-11-toolbar/` were reviewed
for the compact control density before this details-panel change. A fresh
details-panel capture and native WebKitGTK run remain pending with the next
browser-manager milestone.

## Remaining scope

Exact IndexedDB/native artifact records, export preflight, document-font usage
locations, collection-face installation, and Windows/macOS platform evidence
are still open in the acceptance matrix.
