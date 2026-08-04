# Changelog

All notable changes to Varve are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and Varve uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

**This file is the source of release notes.** `scripts/release/release-notes.mjs` extracts the
`## [version]` section for the tag being built, and `.github/workflows/release.yml` refuses to
build a tag that has no matching section. Write for someone deciding whether to install the
update, not for someone reading the commit log.

## [Unreleased]

## [0.1.0] - 2026-08-04

The first public release of Varve, and an alpha in the honest sense: it has been
built and run, but it has not been lived with. Treat it as something to try, not
something to trust with work you cannot afford to lose.

### Platform support

Varve is published for the platforms it can actually stand behind, and labelled
where it cannot.

| Platform | Status | What that means |
|---|---|---|
| Linux x86-64 (AppImage, `.deb`, `.rpm`) | **Supported** | Built, installed into clean Ubuntu 22.04 and Fedora 38 containers, and launched. Bugs get triaged. |
| Windows 10/11 x86-64 (NSIS) | **Experimental** | Compiles and packages in CI. **Nobody has run it on a Windows machine.** Published so it can be tested, not because it has been. |
| macOS | Not published | No Mac available to verify on. A build nobody has launched is not a release. |

The Linux minimum is glibc 2.35, which covers Ubuntu 22.04, Debian 12 and
Fedora 38 upward. The AppImage needs FUSE2; on systems without it, run with
`--appimage-extract-and-run`.

### Added

- Release engineering foundation: version single-sourcing, artifact collection with predictable
  names, SHA-256 checksum manifests, CycloneDX SBOM generation, and a draft-then-approve
  release pipeline (`scripts/release/`, `.github/workflows/release.yml`).
- Build-time guard that fails when a bundled AI model is a Git LFS pointer rather than real
  weights (`scripts/release/check-bundled-assets.mjs`).
- Optional AI models are downloaded on demand rather than bundled, each pinned to a SHA-256
  that is verified before the file is used. The installer stays around 56 MB as a result.

### Fixed

- The release workflow could never publish: its release job depended on an AUR validation job
  that referenced a `dist/aur` directory which does not exist and is gitignored.
- The packaged application did not reach its user interface. A static import of an
  `eval`-using module in the entry chunk stopped the frontend mounting inside the packaged
  WebView, and a splash screen that only closed on a signal from that frontend turned the
  failure into a window that could never be dismissed.

### About the name

The project was developed under the name **Strata** and renamed to **Varve** before
this, its first release. No Strata release was ever published, so there is nothing to
migrate from and no older version to be compatible with.

Documents use the `.strata` extension and the `application/x-strata` MIME type. That is
deliberate for now and unrelated to the rename.

---

<!--
Template for a real release. Copy this block, replace the version and date, and
delete any empty sections — an empty "### Removed" heading in release notes reads
as an oversight.

## [0.1.0] - 2026-MM-DD

### Added
### Changed
### Deprecated
### Removed
### Fixed
### Security
-->
