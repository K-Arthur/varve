# Varve backport to bindgen 0.71.1

The source and BSD-3-Clause license come from the published crate archive:

- Upstream: <https://github.com/rust-lang/rust-bindgen>
- Source revision: `af7fd38d5e80514406fb6a8bba2d407d252c30b9`
- Archive SHA-256: `5f58bf3d7db68cfbac37cfc485a8d711e87e064c3d0fe0435b92f7a407f9d6b3`
- Upstream fix: <https://github.com/rust-lang/rust-bindgen/pull/3278>
- Fix revision: `2e7bbcfdbb487100f58d682a39dda3583fbde517`

The only production source change is the upstream `Type::declaration()` fix
in `clang.rs`: follow the declaration cursor to its definition when one is
available. Clang 22 changed the AST behavior, causing the old code to emit
one-byte forward declarations even when a full definition was available. On
Clang 23, Varve's helper failed the generated `_IO_FILE` layout assertion
because the C size was 216 bytes and the generated Rust type was one byte.

The fix shipped in bindgen 0.72.1. diffusion-rs-sys 0.1.20 still requires
bindgen 0.71, so this backport keeps that build API and the pinned native runtime
unchanged. Layout checks remain enabled. All other upstream Rust source and
the original manifest are preserved; the normalized manifest additionally
declares an independent workspace and the focused `clang_layout` test.

The regressions generate bindings for C forward declarations, the upstream
nested C++ class case, and Linux stdio. Each generated Rust file is compiled
with its actual layout assertions enabled. Run from the repository root:

```sh
node scripts/quality/heavy-lease.mjs "bindgen Clang layout regression" -- \
  cargo test --manifest-path vendor/bindgen/Cargo.toml --test clang_layout
```

The independent test lock and target directory are ignored. The production
resolution remains in root `Cargo.lock`. Remove this patch when the native
binding dependency supports bindgen 0.72.1 or a newer fixed version.
