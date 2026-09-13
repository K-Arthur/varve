# Native font storage evidence — 2026-09-13

The native font store writes new artifacts under a hash of the canonical
`sha256:<artifact>:<member>` face key. A family-only load is retained for
pre-v2 records, but it must not guess when more than one hash-addressed face
has the same display family. The compatibility resolver now returns an
actionable error in that case: callers must request the exact face key. A
single matching hash directory remains readable during migration, and an
existing legacy family directory keeps its historical precedence.

This closes the silent first-match path identified in the typography audit.
Exact-face removal already accepts the same portable key, so removing one
same-family artifact cannot remove its siblings.

Focused validation from the standalone Tauri workspace:

```text
rustfmt --edition 2021 --check apps/desktop/src-tauri/src/font_storage.rs
cargo test -p varve-desktop font_storage --lib -- --nocapture
```

The focused native suite passed **4/4** (`cargo test` also compiled the
standalone desktop workspace). The suite covers canonical single/member keys,
digest mismatch rejection, legacy/unique compatibility lookup, and ambiguous
family lookup. The build emitted pre-existing `unused_mut` warnings in the
Tauri build script and `lib.rs`; no font-storage warning was introduced.

Linux owns this evidence. Windows WebView2 and macOS WKWebView still need
their native restart and OS-font refresh runs; those platform checks remain
pending in the acceptance matrix.
