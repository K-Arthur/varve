# Font project-lifecycle evidence — 2026-09-14

This evidence records the document-scoped storage slice completed on the
current `master` worktree. It does not certify the complete font acceptance
matrix.

## Contract exercised

- IndexedDB `varve-font-storage-v2` upgrades to version 3 and creates the
  `projectRefs` store.
- A project face is keyed by the original artifact/member identity and can be
  referenced by more than one document.
- Closing one document removes only its reference. The exact face and shared
  artifact remain until the final project reference closes.
- Promoting the same face to persistent storage prevents later document
  cleanup from deleting it.
- Native storage mirrors the contract in `.project-refs.json` and exposes the
  `release_document_fonts` Tauri command.
- Accepted final tab close dispatches the document identity. Dirty tabs do not
  dispatch it, and duplicate open tabs for the same document do not release
  the shared project face early.

## Evidence

| Check | Command | Result |
| --- | --- | --- |
| Browser storage, migration, shared project references, persistent promotion | `pnpm exec vitest run packages/editor/src/components/FontBrowser/fontStorage.test.ts packages/editor/src/components/FontBrowser/FontBrowser.test.tsx packages/editor/src/components/FontBrowser/FontBrowserDialog.test.tsx packages/editor/src/components/FontBrowser/MissingFontController.test.tsx --config vitest.config.ts --pool=threads --maxWorkers=1 --reporter=dot` | 4 files, 25 tests passed (90.09s) |
| Native font storage and enumeration regression | `cargo test font --lib` from `apps/desktop/src-tauri` | 11 passed, 0 failed (38.10s) |
| Changed TypeScript formatting/lint surface | `pnpm exec biome check` on the changed font storage, browser, clipboard, context, and typography files | Passed |
| Engine typecheck | `pnpm --filter @varve/engine typecheck` | Blocked only by pre-existing quick-cleanup/LUT test errors; no lifecycle errors reported |
| Editor typecheck | `pnpm --filter @varve/editor typecheck` | Blocked by the existing shared editor error set recorded in the agent report |

The native command was compiled and registered, but a real Tauri WDIO run is
still blocked by those unrelated editor type errors. Windows WebView2 and
macOS WKWebView remain pending platform runs.

## Follow-up checks

The remaining proof is a browser restart/two-document E2E that imports a real
font into two documents, closes them in both orders, and verifies exact-face
availability and artifact cleanup. The native equivalent should exercise the
same sequence through the Tauri command and inspect the on-disk reference
journal after a restart.
