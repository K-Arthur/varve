# Font storage collection evidence — 2026-09-14

## Finding

The native storage writer already identified TrueType and OpenType collections
and wrote them as `font.ttc` or `font.otc`. The restart read path only accepted
`ttf`, `otf`, `woff`, and `woff2`, so a stored collection artifact could be
reported as unavailable even though its metadata and bytes were present.

## Change

Commit `6a9dd9121` adds `ttc` and `otc` to the native file resolver and adds a
regression test that creates each collection extension, resolves it through the
same helper used after restart, and removes the fixture. The test does not
pretend that a two-member collection has been fully imported; member parsing,
picker selection, and reopen rendering remain open in acceptance scenario 5.

## Verification

```text
cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml -- apps/desktop/src-tauri/src/font_storage.rs
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib font_storage::tests -- --nocapture
```

Result: 7 tests passed. The command emitted only pre-existing unused-variable
warnings in the desktop crate.

The repository planner still sees the concurrent 336-file working tree and
requires the full gate; `pnpm verify:affected` therefore stops at the explicit
escalation before running tiers. `pnpm audit:docs`, `pnpm audit:emoji`, and
`pnpm audit:tokens` pass on the resulting tree.

## Remaining proof

Linux Tauri/WebKitGTK still needs an end-to-end import of a real multi-member
TTC/OTC, selection of a non-zero member, restart, and exact rendering/export
check. Windows WebView2 and macOS WKWebView remain platform-owned checks.
