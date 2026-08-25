# Changelog

All notable changes to Varve are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and Varve uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

**This file is the source of release notes.** `scripts/release/release-notes.mjs` extracts the
`## [version]` section for the tag being built, and `.github/workflows/release.yml` refuses to
build a tag that has no matching section. Write for someone deciding whether to install the
update, not for someone reading the commit log.

## [Unreleased]

## [0.2.1] - 2026-08-24

### Added

- **Image Enhance** — batch enhancement processes every image in a
  multi-selection in one run, with combined tile progress, per-image
  announcements ("Enhancing image 2 of 3…"), immediate cancellation, and
  a failure summary instead of stopping silently mid-queue. A validated
  Real-ESRGAN Anime x4 (6B) ONNX model (checksum-pinned download) now
  backs Illustration mode, restoring preview/apply parity for that mode.
  Deblur strength is user-controllable, the dialog reports real
  per-stage progress while restoration runs, and output stays
  non-destructive with a quality policy (faithful/balanced) choice.
- **Canonical export resolution model** — export scale decisions are now
  computed by one shared resolution engine in `@varve/scene`
  (`export/resolution`, documented in
  `docs/architecture/export-resolution.md`), and batch export exposes
  explicit resolution controls.
- **Text on Path becomes reachable** — the engine could always place type
  along a path, but nothing in the UI ever set the required fields.
  Object ▸ Text on Path now attaches a selected text layer to a selected
  shape, and a Text on Path inspector section exposes the start offset
  and which side of the curve the glyphs sit on.
- **Linux download guidance** — the website download page adds a
  distro-family picker table, grouped install commands, expanded
  Arch/CachyOS troubleshooting, and per-format system requirements, and
  now recommends the AppImage as the primary Linux format.
- **Verified workflow recordings** — a deterministic capture pipeline
  (`scripts/capture/`) records real interactions against seeded demo
  documents, verifies them frame-by-frame, and publishes the resulting
  workflow videos to the website product page.
- **Selection tools** — a pixel-lasso area-selection tool, a quick-mask
  paint tool, and image-derived selections join rectangle/ellipse
  marquee selection. Selections can be transformed, refined (feather,
  contract/expand, smooth), and saved for reuse across a session, with
  a dedicated panel for managing saved selections and reviewing where
  the current selection came from.
- **Layer States** — layers gain a Solo View toggle and per-layer
  visibility state that survives independently of the old show/hide
  toggle, with an effects badge and layer context menu to manage them.
- **Perspective tool** — an interactive four-corner perspective
  transform with a live overlay, correct Canvas2D and SVG-export
  rendering, and its own Inspector section.
- **Smart Filters and adjustment layers** — a non-destructive filter
  stack can be applied per-object, with menu and command-palette
  entries and an object filter stack that respects layer-level bypass.
- **Shadow/Highlight adjustment**, Levels/Curves editors backed by real
  histogram data, and general adjustment-layer normalization fixes.
- **Crop and transform** — named crop aspect ratios, crop guides,
  straighten, repeat-transform, and a rebuilt Image Resize dialog.
- **Find Similar** — natural-language and image-based asset search in
  the Intelligence panel, backed by a local DINOv2 embedding pipeline.
- **Warp tool** is now reachable from the Design toolbar and its `W`
  keyboard shortcut; it previously existed but had no way to activate
  it.
- **Accessibility** — a full audit pass across the editor (focus order,
  ARIA roles/labels, keyboard reachability), plus a specific fix
  reversing Tab order so it flows from the layers panel into the canvas
  instead of skipping it.

### Changed

- Git LFS is no longer used anywhere in the repository (bandwidth budget
  exhausted): all media is committed directly and CI no longer fetches
  LFS objects.
- The stable updater feed now signs Linux AppImage and Windows NSIS
  artifacts for both x86_64 and ARM64, generates the macOS `.app.tar.gz`
  target when a signed bundle exists, and verifies signatures
  cryptographically before publication; the v0.2.0 feed was re-signed
  and republished under these targets.
- Release version stamping also updates AUR packaging metadata and
  AppStream metainfo.
- ONNX Runtime failures report the platform-specific remedy instead of a
  generic message, and the runtime library is staged before every
  desktop build path.

### Fixed

- **Variable fonts apply their axes** — `fvar` parsing matches how
  OpenType actually stores the table, the selected `wght` value reaches
  the Canvas2D painter on every text path, variation settings survive
  onto the painted shape, and the variable-axis panel is reachable
  without scrolling the inspector sideways.
- **Pixel-art scaling at non-power-of-two sizes** — EPX/HQx/xBR no longer
  splice a nearest-neighbor remainder into the middle of the algorithm at
  scales like 3x; the 2x passes stay intact.
- **Timeline drag** preserves keyframe progress during the drag gesture.
- Prototype, codegen, variants, and timeline workflows were repaired
  where editor action registration had broken them, and text-on-path
  actions see live selection state.
- **Image Enhance reliability** — tiled inference routes to the right
  capability, tiled recomposition memory is bounded, edge tiles produce
  correct output dimensions, stale previews clear when the operation
  changes, stale-result errors surface to the UI instead of returning
  silently, and the Auto analysis no longer produces NaN JPEG-blockiness
  scores. Compression-artifact removal remains unavailable by design:
  the dialog says so rather than degrading another model.
- **Visual constraint editor** — the Constraints inspector section
  rendered a passive preview even though the interactive pin-control
  component already existed; it's now wired up and usable. Its
  horizontal/vertical/center-stretch pin targets previously overlapped
  in the same hit area so only the last one was clickable — they're
  now separate targets.
- **Drawing a frame around an existing image** no longer requires the
  image to be fully inside the frame before it's adopted — the
  original center-hit-or-≥50%-overlap rule is restored.
- **Multi-page documents** — objects created on any page after the
  first had the page's canvas placement applied twice, landing (and
  hit-testing) in the wrong position; fitting or viewing a non-first
  page also ignored its actual placement and always fit at world
  origin. Both are fixed.
- **Mockup creation** selected a placeholder ID instead of the frame
  node it had actually just created, so the Inspector's mockup section
  never appeared after applying a mockup to a source image.
- **Imported LUTs** (`.cube`) were applied at zero opacity, so an
  imported LUT adjustment never visibly did anything until manually
  adjusted.
- **Icon library** — inserting an icon and immediately switching to
  the Downloaded filter could miss the icon just inserted, due to a
  cache-refresh race; the panel now reflects an insert immediately.
- **Typing or pasting large amounts of text** could crash the editor
  with a React "maximum update depth exceeded" error in the text tool;
  rapid keystrokes are now coalesced into bounded updates, while blur,
  Escape, and IME completion still flush immediately.
- **Cross-artboard drag** reparenting and its undo/redo now land at the
  precise expected position.
- **Edge auto-pan** while dragging near a canvas boundary moved content
  in the opposite of the intended direction; the pan direction is
  corrected.
- **Help ▸ Getting Started** did nothing when clicked; it now opens
  onboarding.
- **Responsive floating toolbar** — tools that don't fit the current
  window width (including Table) now live in an accessible "More
  tools" overflow menu instead of being unreachable.
- **Crop tool history** — committing a crop without changing anything
  no longer pushes an undo step, so Undo after an untouched crop
  correctly reverts the prior action instead of the no-op crop.
- **Depth Blur** now renders through the native/WASM engine path — the
  effect existed only in the Canvas2D/JS layer, so the native scene
  representation didn't recognize it and every use silently took the
  slower fallback path.
- **Background removal (INT8/fast mode)** — the small-download and
  low-memory variant of the U²-Net Light model produced a near-blank
  mask; a runtime safety check already kept it from ever being served,
  so this never reached a shipped build, but the fast/small-download
  option is now actually usable instead of silently falling back to the
  full-precision model.

### Security

- The basic-auth-URL secret scanner no longer false-positives on JSON-LD
  structured data.

## [0.2.0] - 2026-08-20

### Added

- **Motion/prototyping P1-P3 improvements** — timeline virtualization (only
  visible tracks rendered), Lottie fill/stroke color keyframe export, motion
  path drag-to-edit on canvas, prototype `startAnimation`/`stopAnimation`
  playback wiring, prototype interaction section UI for Play/Stop animation
  actions, and prototype click-through E2E test. 413 tests pass across 31
  files.
- **Figma REST JSON import** — official Figma file JSON (REST API or plugin
  export) is now a first-class import source. A bounded source normalizer
  (`figma/source.ts`) enforces 64 MB / 100k node / 256 depth limits, then
  a semantic converter (`figma/converter.ts`) maps pages, frames, groups,
  shapes, text, Auto Layout, components/instances, variables, styles, and
  prototype interactions into native Varve document fragments with fresh
  IDs and deduplicated image assets. Opaque `.fig` binaries are rejected
  with actionable guidance. Fidelity is honest: boolean operations,
  remote image refs without embedded data, and unsupported effects are
  reported rather than silently dropped. See
  `docs/architecture/figma-import-system.md` for the full conversion
  matrix and architecture.
- **Image Enhance — Deblur and Auto/Recommended** — the Enhance workflow
  now ships a validated Deblur operation backed by a reproducible
  conversion of NAFNet-GoPro-width64 (MIT, ~138 MB fp16 ONNX, downloaded
  on demand through the model manifest with a pinned checksum; conversion
  parity is bit-exact with the trusted PyTorch reference — 98.9 dB on the
  official GoPro test subset). Deblur runs through the same shared
  native→worker provider chain as Denoise, with adaptive tiling that
  keeps tiles single-shot up to 1280 px because NAFNet's global
  receptive field makes small tiles visibly seamed. The dialog opens in
  Auto/Recommended mode: a cheap classical analysis (noise, blur, JPEG
  blockiness, resolution) proposes a restoration in human terms with a
  confidence number, and `Restore + Upscale` composes only the stages it
  needs (denoise, deblur, or deblur+upscale, always restoration before
  super-resolution).
- **Denoise fix: graph-safe padding** — the SCUNet ONNX conversion
  actually requires padded dimensions divisible by 64 (its baked
  attention reshape crashes otherwise), so 1080p and other non-64-
  multiple images failed denoise. Padding, the native spec, and the
  manifest contract were corrected (previously claimed 8).
- **Restore benchmark tooling** — `scripts/bench/restore-reference/`
  provides a deterministic degradation corpus (JPEG, Gaussian, motion
  blur recipes with fixed seeds), TS-exact ONNX reference runners, and
  contact-sheet rendering; measured results are in
  `docs/quality/image-enhancement-benchmark.md`. Compression-artifact
  removal remains unavailable by design: no model passed the
  design-content corpus (SCUNet destroys 1px line patterns; the only
  JPEG-trained NAFNet checkpoint was rejected on provenance).
- **Natural-language asset search** — the Asset Browser search field now
  combines filename, OCR, tags, and metadata with an optional local visual
  lane. Describe what you remember ("orange sunset over mountains") and
  matching local assets rank by visual content even when the file is named
  IMG_4281.jpg. Images are indexed in the background with a bounded,
  cancellable queue (deduplicated by content hash, so renames and copies
  never re-embed), search results keep match reasons, and exact filename
  queries keep their ordering guarantee. The text tower and tokenizer are
  parity-verified against the reference implementation; everything runs
  locally with no uploads. Visual search is opt-in: the SigLIP image and
  text models plus tokenizer download explicitly, verify SHA-256, and
  filename/OCR/metadata search keeps working without them. See
  `docs/architecture/asset-search-system.md` and ADR-0221.
- **Object Selection** — select an image and use the Select Object tool
  (or the Adjustments tab) to prompt a local SAM2-Hiera-Tiny model with
  positive/negative points and drag boxes. The preview is transient until
  you apply it: candidate masks can be cycled before applying, and Apply
  creates one undoable non-destructive raster mask that survives save,
  reload, and model removal. The ~155 MB model is an explicit, checksum-
  pinned download (Apache-2.0) loaded lazily; embeddings live in a bounded
  session cache and are never written into the document. Promptable
  segmentation is not semantic subject detection and is not a perfect
  alpha matte — brush and trimap refinement remain the edge-quality tools.
- **Depth-aware effects** — a reusable, model-independent DepthMap resource
  powers non-destructive Depth Blur: pick a focus point, adjust focus range
  and blur strength, preview the depth field, or convert a depth range into a
  layer mask. Depth maps are generated on demand by a ~27 MB local model
  (Depth Anything V2 Small, Apache-2.0, SHA-256 pinned), cached per source
  revision, persisted in the document (16-bit scalar field), and rendered
  without the model, so saved documents reopen with identical results and no
  inference. The blur compositor is occlusion-aware (sharp subjects do not
  smear into blurred backgrounds) and premultiplied-alpha correct. Relative
  depth only; no metric calibration is claimed.
- **Experimental asset similarity** — the Intelligence panel now separates
  image-to-image Similar search from Near duplicates. The image lane uses a
  local DINOv2-small encoder (Apache-2.0, SHA-256 pinned, reference-vector
  parity verified against an independent runtime; selected over the SigLIP
  image encoder from a Varve-corpus evaluation — see
  `docs/audits/semantic-asset-similarity-evaluation-2026-08-13.md`).
  Near-duplicate ranking keeps exact identity and perceptual fingerprints
  separate. Computed embeddings are cached locally by content hash, so
  unchanged images never re-run inference. The current workflow is
  document-local, capped at 30 image candidates, and does not provide
  automatic deletion. See
  `docs/architecture/semantic-asset-similarity.md`.
- **Image palette extraction** — select one image and open Appearance → Palette
  to generate a deterministic local palette in perceptual Oklab, review
  generated harmonies and WCAG 2.1 contrast pairs, copy HEX values, and save
  extracted colours as document swatches or colour variables. Analysis is
  bounded, cancellable, worker-backed when available, and does not upload
  image pixels or add derived analysis data to the document schema.
- **Email workspace** (desktop) — a new workspace mode
  (Ctrl+Shift+7) for visual email authoring with a dedicated IR, HTML and
  plain-text compilers, embedded-asset packaging, URL preflight diagnostics,
  and multi-provider output. Template types, preview, and export are
  available today; rendering fidelity depends on the recipient's email
  client.
- **Browser demo** — a bounded public demo at `/try/` runs a curated sample
  poster document in WASM with honest capability messaging, stale-asset
  recovery, and a desktop CTA. See `docs/architecture/browser-demo.md`.
- **Auto-layout improvements** — drag-to-reorder children within a flex
  frame, "Add Auto Layout" command to wrap a selection, per-axis child
  sizing (width/height, fit/hug/absolute), grid hug sizing, and
  double-click a resize edge to reset that axis to Hug.
- **OS file associations** — `.varve` and `.strata` files register with
  the operating system's "Open With" on Linux, macOS, and Windows so
  double-clicking a document opens it in Varve.
- **Onboarding** — canvas empty-state shortcuts, micro-hints for new
  tools, learning preferences, and a What's New dialog that surfaces
  recent changes.
- **Workspace mode redesign** — the mode picker now uses per-mode accent
  colours, elevated depth, and improved hover states for faster switching.
- **Contact channels** — canonical contact and security surfaces in both
  the application and the website (`support@varve.studio`,
  `security@varve.studio`, GitHub Private Vulnerability Reporting).
- **Paint tools** — raster brush system with a Brush Browser (portable
  brush packages, deterministic previews) and Brush Editor (size, flow,
  hardness, spacing, scatter, texture, grain). Wet-media lifecycle
  (wet-edge blending, sample-all-layers clone), real smudge transport with
  vector-pressure support, symmetry guides, clone source markers, alpha
  lock, and mask painting on raster layers. The paint inspector wires
  presets and per-stroke settings to the worker pipeline. See
  `docs/architecture/paint-system.md`.
- **Gradient map adjustments** — a non-destructive gradient-map adjustment
  layer remaps tonal values through a user-editable colour gradient with a
  built-in preset browser. Affects vector and raster content; export
  preflight flattens to raster for SVG/PDF targets. See
  `packages/scene/src/gradientPresets.ts` for the preset model.
- **Selection improvements** — object marquee with configurable shape modes
  (rectangle, ellipse, lasso), area-aware selection commands (select all
  in area, deselect, toggle), hierarchy navigation (select parent/child),
  select-similar expansion, and indexed geometry for fast broad-phase
  overlap. Raster masks can now be bridged from area selections.

### Changed

- **Windows installer shrunk ~75%** — the NSIS installer now bootstraps
  WebView2 via the Microsoft-provided `downloadBootstrapper` instead of
  bundling it, and the bundled ORT WASM runtime was trimmed.
- **Licensing** — eight engine crates (`varve-core`, `varve-colour`,
  `varve-trace`, `varve-layout`, `varve-media`, `varve-effects`,
  `varve-upscale`, `varve-bgremove`) are now published under **MIT OR
  Apache-2.0** for ecosystem reuse and grant eligibility.
- **Brand cleanup** — remaining Strata references in export identifiers,
  wordmark SVGs, product screenshots, and website copy have been corrected
  to Varve.
- **Render resource management** — adaptive image fidelity policy and
  pressure-signal integration improve frame pacing under memory pressure.
- **Marketing website** — comparison page, feature screenshots, SEO
  metadata, download-page troubleshooting, and download funnel with
  platform recommendation.

### Fixed

- **Accessibility** — dialog touch targets, `focus-visible` outlines,
  keyboard navigation in RecoveryDialog, `aria-disabled` on inactive
  buttons, and error-boundary auto-focus.
- **Canvas performance** — `getBoundingClientRect` is now cached in the
  input-pipeline hot path instead of called on every pointer-move.
- **Layout engine** — flex bugs repaired (recursive hug sizing, per-axis
  child sizing, frame own-size reflow, grid hug sizing).
- **Motion playback** — hardened sampler and prototype runtime against
  edge cases that could stall or crash.
- **Popover and Select** — portaled custom Select no longer leaks
  outside-click closures; submenus position correctly.
- **Multi-selection** — Ctrl+drag preserves the existing selection when
  the target is already selected.
- **Panel styling** — previously unstyled surfaces (ErrorBoundary,
  AdjustmentEditor, Design Audit panels, VariablePanel headers) now
  receive consistent design-token styling.
- **Branding** — stale `.strata` references replaced with `.varve` in
  user-facing code and current-state docs; export identifiers no longer
  emit Strata names.

## [0.1.2] - 2026-08-16

This release improves editor reliability and completes the first production
resilience pass for the application, website, and release pipeline.

### Fixed

- Settings dropdowns now render above native dialogs and Export, Performance,
  Appearance, and theme changes apply immediately.
- Content-Aware Fill preview sizing and Fit, 1:1, Center, zoom, keyboard, and
  crop interactions now behave consistently.
- Palette extraction accepts a user-selected count from 3 through 32 colors.
- Browser update synchronization, Linux browser chrome detection, menubar
  navigation, and React 19 tooltip refs are hardened.
- GitHub Actions now have stronger workflow validation, concurrency controls,
  cache/log diagnostics, and failure reports.
- GitHub Pages builds use the correct `/varve/` project-site base path.

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
