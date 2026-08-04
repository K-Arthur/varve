# Changelog

All notable changes to Strata are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and Strata uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

**This file is the source of release notes.** `scripts/release/release-notes.mjs` extracts the
`## [version]` section for the tag being built, and `.github/workflows/release.yml` refuses to
build a tag that has no matching section. Write for someone deciding whether to install the
update, not for someone reading the commit log.

## [Unreleased]

### Added

- Release engineering foundation: version single-sourcing, artifact collection with predictable
  names, SHA-256 checksum manifests, CycloneDX SBOM generation, and a draft-then-approve
  release pipeline (`scripts/release/`, `.github/workflows/release.yml`).
- Build-time guard that fails when a bundled AI model is a Git LFS pointer rather than real
  weights (`scripts/release/check-bundled-assets.mjs`).

### Fixed

- The release workflow could never publish: its release job depended on an AUR validation job
  that referenced a `dist/aur` directory which does not exist and is gitignored.

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
