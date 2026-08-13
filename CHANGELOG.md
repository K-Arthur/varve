# Changelog

All notable changes to Varve are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and Varve uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

**This file is the source of release notes.** `scripts/release/release-notes.mjs` extracts the
`## [version]` section for the tag being built, and `.github/workflows/release.yml` refuses to
build a tag that has no matching section. Write for someone deciding whether to install the
update, not for someone reading the commit log.

## [Unreleased]

### Added

- **Experimental asset similarity** — the Intelligence panel now separates
  image-to-image Similar search from Near duplicates. Similarity uses the
  existing local SigLIP ONNX worker path; near-duplicate ranking keeps exact
  identity and perceptual fingerprints separate. The current workflow is
  document-local, capped at 30 image candidates, and does not provide
  text-to-image search or automatic deletion. See
  `docs/architecture/semantic-asset-similarity.md`.
- **Image palette extraction** — select one image and open Appearance → Palette
  to generate a deterministic local palette in perceptual Oklab, review
  generated harmonies and WCAG 2.1 contrast pairs, copy HEX values, and save
  extracted colours as document swatches or colour variables. Analysis is
  bounded, cancellable, worker-backed when available, and does not upload
  image pixels or add derived analysis data to the document schema.

## [0.1.1] - 2026-08-11

The second public release of Varve, published a few days after 0.1.0 with
the first round of fixes and the release system itself hardened. Still alpha:
treat it as something to try, not something to trust with work you cannot
afford to lose.

Fixes a Linux packaging defect in 0.1.0: the AppImage bundled WebKit/GTK
libraries from the ubuntu-22.04 build baseline, and on distributions with a
newer Mesa/EGL stack (Arch, CachyOS, Fedora) the bundled WebKitWebProcess
fails EGL display creation. The web process aborts while the window stays
open — a white screen. The release now prunes the bundled libraries from
the AppImage payload, so it uses the host's WebKit/GTK (the same libraries
the .deb depends on) and renders everywhere the deb/rpm already did.

### Fixed

- AppImage white screen on modern Mesa/EGL hosts: the bundled WebKit/GTK
  closure (built on the ubuntu-22.04 baseline) fails EGL display creation on
  newer Mesa stacks. `scripts/release/prune-appimage-bundled-libs.mjs` now
  strips `usr/lib` from the AppImage payload during the release build — the
  binary resolves everything from the host, verified on a CachyOS host where
  the released AppImage aborted and the pruned one rendered correctly. The
  AppImage now requires system WebKitGTK (libwebkit2gtk-4.1) like the .deb;
  the download page documents this instead of promising "runs on any Linux".
  (The earlier in-app `WEBKIT_DISABLE_DMABUF_RENDERER=1` workaround was kept
  but is not sufficient on its own: the EGL failure precedes renderer
  selection.)
- The release launch smoke can no longer pass on a blank window: it fails on
  the EGL/abort signature in the app output and requires a live
  `WebKitWebProcess`.
- The release draft job could never create a draft (v0.1.1 rehearsal): the
  `files` glob used a negated `!dist/release/RELEASE_NOTES.md` pattern, which
  `softprops/action-gh-release`'s npm-glob matching treats as matching nothing,
  so `fail_on_unmatched_files: true` aborted the job. `RELEASE_NOTES.md` is now
  staged outside the globbed directory and the `files` list is a single
  positive pattern; `scripts/validate-workflows.mjs` rejects any future
  reintroduction of the negated pattern or a `body_path` inside the glob.
- Release hardening inherited from the 0.1.0 rehearsal: frontend built before
  desktop compilation, Git LFS fetched on every checkout (bundled models are
  LFS-tracked), LFS-pointer guard fixed for Windows paths, per-platform SBOMs
  generated and validated, `SHA256SUMS.txt` generated last over the complete
  upload set, draft assets re-downloaded and re-hashed before publication,
  native runner smokes for Windows and macOS, and a container install-test
  for the Linux packages.

### Added

- **Code-signing pipeline (certificate-ready)** — the release system now
  enforces a fail-closed signing policy: a `signing-preflight` job validates
  Apple/Azure credentials before any build starts, Windows installers are
  signed through Azure Artifact Signing via Tauri's `signCommand`, macOS
  builds are Developer ID signed, notarized and stapled via the App Store
  Connect API, and every artifact is verified on its actual bytes
  (`verify-windows-signature.ps1`, `verify-macos-signature.sh`) before
  checksums, GitHub artifact attestation, and the draft release. Signedness in
  release metadata derives only from those verification reports — a stable
  release never silently ships unsigned. See `docs/release/signing-decision-record.md`
  for the strategy, `docs/release/code-signing-setup.md` for the human
  acquisition checklist. No certificates are owned yet; until they are,
  releases are unsigned and honestly labelled.

- **Image Trace (native raster-to-vector)** — trace a selected image into
  editable vector artwork with presets (crisp logo, pixel-art sprite,
  centerline sketch and more), live preview, and a result estimate. Desktop
  builds run the native Rust engine on a background thread with progress and
  cancellation; web builds fall back to bounded TypeScript providers with
  honest capability gating (centerline is native-only). Modes: black-and-white
  outline (threshold, despeckle, holes), grayscale, limited color (perceptual
  Oklab palette), pixel art (hard pixel boundaries, nearest-neighbor
  scaling), and centerline (stroked skeletons). Traces insert as one undoable
  group beside the source; Edit Trace (context menus) re-opens with the
  stored settings and replaces the result in place. Entry points: Object
  menu, canvas/layers context menus, command palette (Ctrl+Alt+Shift+T),
  Inspector, and QuickBar. See `docs/architecture/image-trace-system.md`.
- **New Design experience** — the New File dialog is now "New design": an editable
  document name (untitled defaults with collision-free numbering), three starting
  points (Empty document / Start with a frame / Template), searchable frame presets
  with favorites and recents, custom frame sizes with unit conversion and aspect
  lock, and collapsed Advanced settings (print intent reveals CMYK, DPI, and bleed
  automatically). Presets create an *initial frame* on an unbounded document — the
  document itself never carries a size.
- **Canonical document creation service** (`createNewDocument` in `@varve/scene`) —
  every creation path (home New button, empty state, File → New, Ctrl+N, command
  palette, template, frame preset) now funnels through one typed request that
  atomically produces a fully initialized document (schema version, name, optional
  initial frame, color config, undo state).
- **`.varve` native format** — new saves default to `filename.varve`; legacy
  `.strata` documents still open through the same versioned migration pipeline.
  File → Save writes disk-opened documents back to their original path
  (Figma/Photoshop behavior). `application/x-varve` registered alongside the legacy
  `application/x-strata` MIME on Linux/Windows/macOS file associations.
- **Responsive workspace navigation** — the editor top bar now fits the document
  title, workspace tabs, and controls without overlap at any width: priority-ordered
  workspace tabs with a "More" overflow menu, active workspace always visible, title
  truncating with an ellipsis.
- **Complete Varve identity** — app mark now renders on the home toolbar, About
  dialog, custom title bar (with a graceful fallback), favicons, and the generated
  icon pipeline emits `varve-icon.svg`; remaining user-visible "Strata" strings
  (LUT export headers, AI diagnostics, window title defaults) renamed.

### Changed

- The New Design dialog fits within 1280×720 viewports: sticky header and footer,
  internally scrollable body, viewport-capped height (also fixes the modal overlay
  that could intercept clicks when closed).
- Import of native-format files preserves the original document JSON and display
  name instead of inserting a blank placeholder.

### Fixed

- The closed `<dialog>` could remain visible and intercept pointer events (a
  `display: flex` override of the UA's `dialog:not([open])` rule) — now scoped to
  `[open]`.
- Stale `strata-*` selectors across the E2E suite refreshed to the `varve-*` classes.
- The colour WASM fallback referenced a build artifact that no longer exists
  (`/wasm/strata_colour_bg.wasm` → `varve_colour_bg.wasm`).
- The release gate ran desktop cargo tests before the frontend existed, which
  `tauri::generate_context!()` hard-fails on — the frontend is built first now,
  and a workflow validator rejects any edit that moves desktop compilation
  ahead of it again.
- The release draft job generated no final `SHA256SUMS.txt` for the merged
  multi-platform set — it is now generated last (over installers, manifest and
  SBOMs) and the draft's uploaded bytes are downloaded and re-hashed before a
  human can publish.
- The SBOM generator still identified the application as Strata (tool vendor,
  component name, purl, one `strata:` property) — it now emits Varve identity
  and platform-scoped SBOMs with a structural validator.
- `website-deploy.yml` held an unnecessary `actions: write` permission and had
  no `release: published` trigger, so the download page could not rebuild from
  a newly published release.

### Distribution hardening

- One canonical URL system (`apps/website/src/lib/siteUrl.ts`): every internal
  link, asset, canonical URL, OG image, sitemap entry and robots location is
  derived from `SITE_URL`/`SITE_BASE`, so the site builds identically as the
  `/varve` GitHub Pages project site and as a root custom domain.
- The download page is release-driven: on `release: published` the site is
  rebuilt from the exact published assets via an explicit channel policy
  (latest published stable, else latest published prerelease; drafts never
  appear) with manifest/checksum verification — an unverifiable release fails
  the deployment rather than inventing data.
- Per-platform and combined CycloneDX 1.5 SBOMs ship with the release and are
  covered by `SHA256SUMS.txt`.
- Post-deployment smoke check: homepage, download, docs, sitemap, robots,
  favicon, 404 and the `/varve` canonical prefix are verified against the live
  URL with bounded retries after every Pages deploy.
- Download page accessibility: tablist semantics with arrow-key navigation,
  copy-to-clipboard checksums with announcements, `aria-current` navigation
  state, explicit unverified-release state.

## [0.1.0] - 2026-08-09

The first public release of Varve, and an alpha in the honest sense: it has been
built and run, but it has not been lived with. Treat it as something to try, not
something to trust with work you cannot afford to lose.

### Platform support

Varve is published for the platforms it can actually stand behind, and labelled
where it cannot.

| Platform | Status | What that means |
|---|---|---|
| Linux x86-64 (AppImage, `.deb`, `.rpm`) | **Supported** | Built, installed into clean Ubuntu 22.04 and Fedora 38 containers, and launched. Bugs get triaged. |
| Windows 10/11 x86-64 (NSIS) | **Experimental** | Built in CI and published with the v0.1.0 release (2026-08-09) after the draft passed the runner smoke pass (install, launch, uninstall on a real Windows runner). Still no systematic on-hardware testing — expect rough edges. |
| macOS (ARM64 DMG) | **Experimental** | Built in CI (aarch64 only; no Intel ONNX Runtime dylib) and published with the v0.1.0 release after the runner smoke pass (mount, launch, unmount on a real macOS runner). Still no systematic on-hardware testing — expect rough edges. |

"Built" means the release pipeline produced the package; it does not mean the
application was systematically exercised on that platform. The draft-release
smoke pass (mount, launch, uninstall on real runners) is the gate between
"built" and "published"; both Windows and macOS assets shipped through it.

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

Documents use the `.varve` extension (the `application/x-varve` MIME type). Files
saved by earlier pre-release builds with the `.strata` extension remain openable
through the same versioned document-migration pipeline, and Save As still offers
`.strata` for compatibility.

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
