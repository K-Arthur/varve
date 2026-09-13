# Native font removal journal evidence — 2026-09-13

Native font storage now keeps an atomic removal journal beside the
hash-addressed face directories. Exact removal records
`sha256:<artifact>:<member>` and removes a matching pre-v2 family directory
when its metadata proves the same face. Family removal records a normalized
family tombstone as well, so an old family-addressed directory cannot return
from a later list or family-only load. An explicit import clears the relevant
face and family tombstones. Exact-face lookup still remains separate from the
family compatibility path.

The journal is read by list, family lookup, exact lookup, and storage-usage
reporting. Writes use the same temporary-file replacement helper as font bytes
and metadata, so an interrupted write leaves the previous journal intact.

## Focused native validation

The six `font_storage::tests` tests passed. The desktop build script requires a
release helper resource that is not present in this shared checkout, so the
focused command supplied an ignored placeholder only for the build step and
removed it immediately afterward:

```text
touch target/release/varve-generative-helper-font-storage-test
export PATH="$HOME/.cargo/bin:$PATH"
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib font_storage::tests -- --nocapture
rm -f target/release/varve-generative-helper-font-storage-test
```

Result: **6 passed**, including canonical identity, legacy compatibility,
case-insensitive family tombstone keys, metadata identity normalization, and
exact tombstone filtering. `rustfmt --edition 2021 --check
apps/desktop/src-tauri/src/font_storage.rs` also passed. Windows WebView2,
macOS WKWebView, native restart, and OS-refresh evidence remain platform
checks outside this Linux run.
