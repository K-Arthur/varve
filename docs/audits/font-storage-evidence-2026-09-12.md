# Font storage and lifecycle evidence — 2026-09-12

This milestone repairs the browser and native storage seams without claiming
the complete document-font lifecycle. It landed as
[`775ebc647e14976b07dfa56b04a81fc420bdbd4c`](https://github.com/varve-app/varve/commit/775ebc647e14976b07dfa56b04a81fc420bdbd4c),
after the frontend face-discovery commit
[`9e0959af6c2ebd7c25953acb733183dd985a860e`](https://github.com/varve-app/varve/commit/9e0959af6c2ebd7c25953acb733183dd985a860e)
and the embedding-policy commit
[`bb5ba7b37f958fdf78932621ac5c5461ad30d038`](https://github.com/varve-app/varve/commit/bb5ba7b37f958fdf78932621ac5c5461ad30d038).

## Behavior covered

- IndexedDB version 2 creates artifact blobs, face metadata, migration-journal,
  tombstone, and quarantine stores. An atomic write stores the exact face and
  increments a shared artifact reference count.
- Every write recomputes SHA-256 and rejects a supplied digest that differs from
  the original bytes. Every read rechecks the digest; changed records are
  quarantined and removed from the usable catalog. Cross-realm byte buffers and
  malformed legacy values are handled without aborting restoration.
- `getStoredFontByIdentity` and `removeStoredFontByIdentity` use
  `sha256:<artifact>:<member>` and do not fall back to family names. The legacy
  family lookup remains only for compatibility. Removal reads first and then
  mutates, so a browser transaction cannot auto-commit between awaited reads.
- Native Tauri storage writes hash-addressed face directories, accepts old
  family directories while migrating, verifies sidecar digests on load/list,
  validates identity-only IPC requests, removes all compatibility matches for a
  family request, and returns camelCase metadata to the frontend.

## Validation

Implementation was validated on master after the embedding-policy commits.

```text
./node_modules/.bin/vitest run packages/editor/src/components/FontBrowser/fontStorage.test.ts --config vitest.config.ts --reporter=verbose
./node_modules/.bin/tsc -p packages/engine/tsconfig.json --noEmit
./node_modules/.bin/tsc -p packages/editor/tsconfig.json --noEmit
rustfmt --edition 2021 --check apps/desktop/src-tauri/src/font_storage.rs
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml --lib
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib font_storage::tests
```

Results: browser storage **7/7 tests passed**; the engine typecheck passed; the
native storage module was rustfmt-clean, its focused Rust tests passed **2/2**,
and the desktop library compiled. The editor typecheck was run but is currently
blocked by eight unrelated concurrent edits (`Menubar` `explicitAnchor`,
`createActionHandlers` fixtures, AI status, shortcut IDs, PositionSizeSection
fixture, `StorageSettingsTab` cache typing, and `WorkspaceTabs` layout); the
exact diagnostics are preserved in the agent run output. Cargo reported only
pre-existing warnings in unrelated desktop code. The repository
`verify:affected --staged` process was already running against concurrent master
work; its unrelated editor collection failures remain in
`reports/font-lifecycle-2026-09-11/frontend-affected.log` and are not hidden.

No native GUI or Windows/macOS run was available in this Linux session. A
fresh Tauri storage round-trip, migration restart, permission denial, and
document-scoped lifetime capture remain required before the related acceptance
rows can close.
