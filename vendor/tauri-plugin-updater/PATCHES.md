# Varve patch to tauri-plugin-updater 2.13.1

The source and license files come from the published crate archive:

- Upstream: <https://github.com/tauri-apps/plugins-workspace>
- Source revision: `e51128438011755f9e7277bad29b8c0978cf281c`
- Archive SHA-256: `3cb0b2ea3e85ca287990d3859a29cc5cb18024240fd78f62e027fb7963670f18`
- License: Apache-2.0 OR MIT, with both upstream license files retained.

The only production change is the Windows-only `zip` requirement, from
`4` to `9`. No published `tauri-plugin-updater` crate currently contains
this upgrade: 2.13.1, 2.13.3, 2.14.0, and 3.0.0-alpha.3 all still declare
`zip = "4"`. Upstream committed the same pin change in
<https://github.com/tauri-apps/plugins-workspace/commit/ba98bfadc4c868c9a7e1a226c83af528e1f11b89>
(`#3698`) after 2.14.0; that revision is not on crates.io yet. Rust
source is unchanged. The package remains at its real upstream version.

`zip` 9.0.0 and later fix:

- [RUSTSEC-2026-0367](https://rustsec.org/advisories/RUSTSEC-2026-0367.html)
  (SUID/SGID bits preserved during extract)
- [RUSTSEC-2026-0368](https://rustsec.org/advisories/RUSTSEC-2026-0368.html)
  (symlink targets outside the destination)
- [RUSTSEC-2026-0369](https://rustsec.org/advisories/RUSTSEC-2026-0369.html)
  (Unix permissions applied through unconfined symlinks)

`ZipArchive::extract` is the Windows zip-update path. Linux AppImage
install uses `tar`/`flate2` behind the same feature flag and does not
link `zip`. The original manifests remain in `Cargo.toml.orig` plus this
one-line pin change. Remove this vendor patch when a supported upstream
release depends on `zip >= 9`.
