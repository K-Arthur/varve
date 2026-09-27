# Plugin system hardening — ownership record (2026-09-27)

**Base:** `757e507e3b25aa6ae24220424fd815ba43cde9df` on `master`.
**Scope:** Complete and harden the local Wasm plugin API v1 on the existing
master checkout.

## Existing work to preserve

The checkout contains broad staged, unstaged, and untracked design-token,
rendering, GPU, canvas, editor, and website work. No plugin implementation,
plugin website page, SDK example, native plugin spec, or plugin system
architecture/evidence/validation document was modified at the start. Stage
and commit only files attributable to this task. Do not reset, stash, clean,
switch branches, or overwrite another task's edits.

The current plugin implementation already has a 2 MiB package cap, strict
two-entry stored ZIP parser, memory-only guest import, short-lived Worker,
host-owned UI, IndexedDB records, previewed undoable rename, permission
review, retry/update/rollback, and two Rust/Wasm examples. Keep API v1 and
the Wasm boundary; marketplace, arbitrary JS/HTML, native guest calls, network,
filesystem, additional command types, and folder watchers are out of scope.

## Evidence and priority

- The focused baseline passed 11 tests across Wasm bounds, guest review, and
  guest output contracts. A lease-protected browser baseline did not start
  because a separate active task owned the shared heavy-task lease. No lease
  was removed or reclaimed.
- Read-only audit found cross-window authorization and storage races, stale
  actions after rollback, swallowed/stale runtime failures, unrunnable
  manifests without selection access, unconditional manager success feedback,
  and a disconnected safe-mode extension toggle.
- A bounded Node v22.23.2 probe showed a rooted 32 MiB WebAssembly GC array
  can allocate while the imported linear memory remains 4 MiB. This is engine
  evidence, not WebKitGTK/WebView2/WKWebView proof. Restrict package-review
  features and keep memory claims specific to linear memory.
- The current desktop binary was built before this ownership record; verify
  its source identity before native testing.
- Current real editor and website screenshots predate the latest manager
  controls. Recapture and inspect actual UI and artwork before changing
  documented screenshots/baselines.

Research ledger: `docs/audits/plugin-system-evidence-2026-09-25.md`.
Key new evidence includes current Tauri capability documentation, firsthand
plugin discovery/cancellation reports, an acknowledged VS Code concurrent
settings-write regression, and a reported update that left recovery
unavailable. Distinguish confirmed maintainers' findings from reporter
hypotheses in the refreshed ledger.

## Edit ownership and checkpoints

This task owns `packages/editor/src/plugins/`, related plugin tests and native
fixture tests, `packages/crash/src/safeMode.ts`, the editor crash-center safe
mode integration, plugin architecture/research/validation docs, Rust sample
documentation, and the plugin feature/docs pages plus current captures.
Shared application, editor hub, schema, package index, and visual-baseline
changes must be reviewed immediately before each edit.

Planned sequential checkpoints on `master`:

1. Package Wasm feature/ABI restrictions and negative tests.
2. Transactional plugin storage, multi-window invalidation/authorization,
   rollback/failure/outcome repairs and focused integration tests.
3. Safe-mode execution gate and accessible manager recovery states.
4. SDK examples, native platform coverage, resource and document portability
   evidence, and maintained architecture/research/validation docs.
5. Marketing pages, refreshed product captures, screenshot registry, and
   desktop/mobile website validation.

Each checkpoint gets `pnpm verify:plan`, then its required affected checks,
specific browser/native/artifact checks, and an attributable path-scoped
commit. Storage and authorization changes warrant one explicit full-suite
checkpoint with its reason recorded. Use the repository's heavy-task lease
for browser/native/desktop tests and leave active leases untouched. Do not
push or publish.
