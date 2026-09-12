# ChromeOS Stage 5 — Linux ARM64 compatibility, packaging, and installation

**Status:** Stage 5 evidence record. Package-level work complete and tested;
ChromeOS GUI behavior remains **unverified** — no physical Chromebook was
attached to this session.
**Research access date:** 2026-09-12
**Repository snapshot:** `d5fb60fbe` (AppImage prune fix); release evidence is
from published **v0.2.1** (2026-08-25)
**Reference device:** Lenovo Chromebook Duet 11M889, 8 GB — not present

This document freezes what was learned and measured. It separates vendor
documentation, repository behavior, executable evidence, and hypotheses. The
companion user-facing guide is [`docs/release/chromeos-linux.md`](../release/chromeos-linux.md).

## 1. Research ledger

| Question | Primary source | Publisher / date | Applicable versions | Finding and confidence | Implementation consequence | Unresolved conflict |
|---|---|---|---|---|---|---|
| How is Linux enabled, removed, and limited on ChromeOS? | [Set up Linux on your Chromebook](https://support.google.com/chromebook/answer/9145439) | Google, current page accessed 2026-09-12 | Current ChromeOS stable | Linux is off by default, enabled from Settings → About ChromeOS → Developers; managed devices may block it. Cameras, non-Android USB, hardware acceleration (GPU and video decode), and ChromeVox outside Terminal are documented as not yet supported. **High** | Route is a sandboxed Debian environment; GPU/video-decode must not be assumed. Managed-device guidance points to the administrator, never a bypass. | Chromium's developer documentation lists accelerated graphics as a Crostini feature while this page says hardware acceleration is unsupported. Treat GPU as version-dependent and unavailable. |
| How do files move between ChromeOS and Linux? | [Running Custom Containers Under ChromeOS](https://www.chromium.org/chromium-os/developer-library/guides/containers/containers-and-vms/) | Chromium OS project, accessed 2026-09-12 | Crostini current | Shared folders are explicit: right-click in Files → "Share with Linux", visible under `/mnt/chromeos`. "Linux files" exposes the container. VM/container data persists across sessions but not across environment removal, and processes die on logout. **High** | Document the share boundary and warn that container-home files are deleted with the Linux environment. Keep projects in shared host folders. | None; matches chromeos.dev and the backup page. |
| What does a ChromeOS Linux backup contain, and what does restore do? | [Back up & restore your Linux files and apps](https://support.google.com/chromebook/answer/9592813) | Google, accessed 2026-09-12 | Current ChromeOS stable | Backup creates a `.tini` file; restore warns that current Linux apps and data are deleted; backups restore only between the same architecture. **High** | User instructions require a backup before removing the environment; architecture must match. | None. |
| What does ChromeOS offer a Linux app? | [Linux on ChromeOS](https://chromeos.dev/en/linux) | Google (chromeos.dev), accessed 2026-09-12 | Current | Linux GUI apps appear in the Launcher; Files app creates shared folders; backup/restore is supported. | Launcher integration and file sharing are expected UX, not optional extras. | No display/input/suspend detail for GUI apps. |
| What does Tauri require on Debian-family systems and how is ARM64 packaged? | [Debian distribution](https://v2.tauri.app/distribute/debian/) | Tauri, page updated 2026-05-17, accessed 2026-09-12 | Tauri v2 | Build on the oldest supported base; Ubuntu 22.04 and Debian 12 provide `libwebkit2gtk-4.1-dev`; glibc is forward- not backward-compatible; Tauri documents cross-compiling for ARM64. | Release artifacts must come from the `ubuntu-22.04` / `ubuntu-22.04-arm` runners, never the dev host. | The page's "Limitations" is generic; it does not name a ChromeOS container baseline. |
| Is the AppImage dependency-free, and can ARM AppImages be cross-built? | [AppImage distribution](https://v2.tauri.app/distribute/appimage/) | Tauri, page updated 2026-05-17, accessed 2026-09-12 | Tauri v2 | `linuxdeploy` cannot cross-compile ARM AppImages; they must be built on ARM (native runner). The AppImage is not dependency-free in this project: bundled GTK/WebKit is pruned and the host must supply it. | ARM64 AppImage stays on the native ARM runner (already true in `release.yml`), and the guide names host WebKitGTK as a requirement. | None. |
| Which WebKitGTK does a target actually ship? | [Webview Versions](https://v2.tauri.app/reference/webview-versions/) plus measured Debian archives | Tauri (updated 2026-05-17) / Debian | WebKitGTK 4.1 | Tauri's Linux table is stale (Debian 11 / Ubuntu 22.04 → 2.36). Measured this session: Debian 12 arm64 has `libwebkit2gtk-4.1-0` 2.50.6; Debian 13 has 2.52.6. **High** (measured) | Use measured archive data, not the stale table, for the support floor. | The table will keep aging; the guide tells users to check their container. |
| What changed in WebKitGTK rendering recently? | [WebKitGTK 2.46.0 released](https://webkitgtk.org/2024/09/17/webkitgtk2.46.0-released.html) and [graphics improvements](https://blogs.igalia.com/carlosgc/2024/09/27/graphics-improvements-in-webkitgtk-and-wpewebkit-2-46/) | WebKitGTK project / Igalia, 2024-09 | 2.46+ | Skia replaces Cairo for 2D, GPU rendering is enabled by default, and `webkit://gpu` becomes the diagnostics entry point. **High** | Software-rendering fallback must be expected where the host GPU path is unavailable (Crostini); diagnose with traces, not assumptions. | Community reports claim `WEBKIT_DISABLE_DMABUF_RENDERER` no longer falls back to shared memory on newer WebKitGTK. Not confirmed against upstream advisories; the guide treats it as a reversible diagnostic only. |
| What is actually published for v0.2.1? | [GitHub Releases API v0.2.1](https://api.github.com/repos/K-Arthur/varve/releases) | GitHub / project, published 2026-08-25, accessed 2026-09-12 | v0.2.1 | ARM64 assets: `.deb` 49,027,190 B, AppImage 40,491,528 B, `.rpm`; checksums, SBOM and (for the AppImage) an updater `.sig` are published; release is unsigned. **High** | Every instruction uses exact asset names and the published checksum; no historical version is hardcoded into new instructions beyond the current release. | None. |
| Is the Linux ARM64 package usable on Debian 12/13? | Debian archive, resolved with `apt-get -o APT::Architecture=arm64` (this document §3) | Debian (measured 2026-09-12) | Debian 12.15, Debian 13.7, arm64 | Dependency closure resolves to `varve` on both suites: 287 packages on bookworm (glibc 2.36, WebKitGTK 2.50.6), 279 on trixie (glibc 2.41, WebKitGTK 2.52.6, `t64` packages provide the pre-transition names). **High** | Debian 12+ is the documented floor; pre-`bookworm` containers are not supported. | Resolution is a model — no ARM64 code was executed locally (no qemu). CI install tests ran on a native `ubuntu-22.04-arm` runner for v0.2.1. |

## 2. Artifact evidence (published v0.2.1, re-verified locally)

Downloaded from the v0.2.1 GitHub release and hashed. Both files match the
published `SHA256SUMS.txt` exactly:

| File | Bytes | SHA-256 | Match |
|---|---:|---|---|
| `Varve-0.2.1-linux-aarch64.deb` | 49,027,190 | `04a52411bf0a2b3ab9cc368b3d17c554b88cb17d179b3ecc784d3eb5bfe9b890` | OK |
| `Varve-0.2.1-linux-aarch64.AppImage` | 40,491,528 | `a5912c25129b5ad23a1d9959d9581dac5ab3ce9845ebd1af136a17cf91ce16ce` | OK |
| `Varve-0.2.1-linux-x86_64.AppImage` (for comparison) | 40,466,936 | `67f29114a33dd3d588c6750b03d16c814e3be6981cf04237e80dfc04d32367e5` | OK |

`.deb` control metadata (`ar x` + `tar`; `dpkg-deb` is not installed on the
CachyOS dev host):

```text
Package: varve
Version: 0.2.1
Architecture: arm64
Installed-Size: 84933
Depends: libwebkit2gtk-4.1-0, libgtk-3-0, libglib2.0-0, libsoup-3.0-0,
 librsvg2-2, libssl3, libgdk-pixbuf-2.0-0, libcairo2, libpango-1.0-0,
 libfontconfig1, libwebkit2gtk-4.1-0, libgtk-3-0
```

- The trailing duplicate `libwebkit2gtk-4.1-0, libgtk-3-0` are Tauri's
  auto-added dependencies; harmless to apt, but redundant metadata.
- No `preinst`/`postinst`/`prerm`/`postrm` scripts. 22 files total.
- `/usr/bin/varve-desktop`: ELF 64-bit ARM aarch64 PIE, interpreter
  `/lib/ld-linux-aarch64.so.1`, dynamically linked, not stripped.
- Highest referenced symbol versions: **`GLIBC_2.35`**. No `GLIBCXX_` or
  `CXXABI_` symbol requirements. `NEEDED` includes `libdbus-1.so.3` and
  `libjavascriptcoregtk-4.1.so.0` in addition to the declared GTK/WebKit
  names; the Debian 12/13 resolutions install `libdbus-1-3` and the JSC
  library through the WebKitGTK closure.
- Desktop integration: `Varve.desktop` (`Exec=varve-desktop %F`,
  `StartupWMClass=dev.varve.desktop`, MIME `application/x-varve;application/x-strata`),
  `dev.varve.desktop.xml`, AppStream metainfo, hicolor icons 16–1024 plus
  symbolic.
- Bundled native AI runtime:
  `/usr/lib/Varve/onnxruntime-libs/linux-aarch64/libonnxruntime.so`.

### AppImage audit and the resource-loss defect (found and fixed)

`unsquashfs` of the published arm64 AppImage (squashfs offset 936456) shows
160 files: `AppRun`, `AppRun.wrapped` (the aarch64 binary), one bundled
`xdg-open`, desktop/metainfo/icons, GTK schema data, and copyright files —
**no shared libraries** (intended: it uses host WebKitGTK) and, unexpectedly,
**no `usr/lib/Varve/onnxruntime-libs/...`**. The x86_64 AppImage was extracted
with `--appimage-extract` and has the same shape, so this is not ARM-specific.

Root cause: `scripts/release/prune-appimage-bundled-libs.mjs` removed the
entire `usr/lib` and `usr/lib64` trees after re-assembling the AppImage.
Tauri installs `bundle.resources` under `usr/lib/<productName>/`, so the
bundled ONNX Runtime (and any generative helper) were deleted along with the
GTK/WebKit closure. v0.2.1's AppImages therefore ship without the native ONNX
Runtime while the `.deb`/`.rpm` carry it; native AI paths fall back to the
web/raster implementations.

Fix (`d5fb60fbe`): the prune step now computes a plan that keeps
`usr/lib/<productName>` and removes only library entries, then re-extracts the
final AppImage and fails if the resource directory did not survive. Regression
test: `scripts/release/prune-appimage-bundled-libs.test.mjs` (wired into
`pnpm test:ci:tools`). This must be re-confirmed on the next release build for
both architectures.

## 3. Reproducible dependency resolution (Debian 12 and 13, arm64)

The dev host is CachyOS x86_64 (glibc 2.44); no ARM64 emulation
(`qemu-user-static` / binfmt) is installed, so ARM64 code was not executed.
Instead, the published `.deb` was resolved against arm64-only Debian indexes
in disposable `debian:12` / `debian:13` podman containers, with APT pointed
at a private root so no cross-architecture co-installation confuses the
resolver:

```bash
# debian:12 and debian:13 containers, arm64-only APT model
dpkg --add-architecture arm64
# arm64-only custom root:
apt-get -o Dir=/tmp/arm64root -o APT::Architecture=arm64 \
  -o Dir::State::status=/tmp/arm64root/var/lib/dpkg/status \
  -o Dir::Etc::sourcelist=/tmp/arm64root/etc/apt/sources.list \
  -o Dir::Etc::sourceparts=- update
apt-get -o Dir=/tmp/arm64root -o APT::Architecture=arm64 ... \
  -s install -y --no-install-recommends /tmp/pkg.deb
```

| Model | glibc | WebKitGTK resolved | Packages in closure | Result |
|---|---|---|---|---|
| Debian 12.15 (bookworm) | 2.36 | `libwebkit2gtk-4.1-0` 2.50.6 | 287 | `varve` resolves; exit 0 |
| Debian 13.7 (trixie) | 2.41 | `libwebkit2gtk-4.1-0` 2.52.6 | 279 | `varve` resolves; exit 0 |

The `t64` transition on trixie is handled by `Provides`:
`libgtk-3-0t64` provides `libgtk-3-0`, `libglib2.0-0t64` provides
`libglib2.0-0`, `libssl3t64` provides `libssl3`. A first attempt that mixed a
bookworm base with trixie arm64 sources produced a false resolver failure;
the arm64-only model above is the valid one. This is dependency-resolution
evidence only. The CI `package-smoke` job additionally installed the `.deb`
and `.rpm` in clean containers and launched the AppImage headlessly on a
native `ubuntu-22.04-arm` runner for v0.2.1 — that runner had no display, so
it proves install/linkage and web-process liveness, not the GUI.

## 4. ChromeOS route boundaries

| Route | What it is | Stage 5 status |
|---|---|---|
| Native Chrome tab (browser build) | Chromium/Blink, WASM engine, browser file APIs | Separate route; Stage 1 baseline, not re-tested here |
| Installed browser app/PWA | Same browser artifact | Separate route; Stage 1 handoff |
| **Linux ARM64 through ChromeOS Linux** | Tauri + WebKitGTK in the Crostini Debian container | This document: package/install evidence; GUI unverified |
| Android / Play Store | Android runtime | Out of scope; no artifact exists |
| Windows/macOS artifacts | Other operating systems | Not substitutes |

The `.deb` is the primary candidate because Crostini is Debian; the AppImage
is secondary (host WebKitGTK, FUSE2 or `--appimage-extract-and-run`, and the
v0.2.1 native-AI regression). Packaging is not the same as GUI support: no
artifact here proves rendering, input, or portal behavior inside Crostini.

## 5. Verified, inherited, and unverified

**Verified in this stage (executable evidence):**

- Published v0.2.1 ARM64 `.deb` and AppImage checksums match `SHA256SUMS.txt`.
- `.deb` metadata, file list, desktop/MIME/icons, bundled ONNX Runtime path,
  ELF architecture, `GLIBC_2.35` floor.
- Dependency closure resolves on Debian 12 and Debian 13 arm64 models.
- AppImage v0.2.1 lacks Tauri resources; cause identified; fix and regression
  test committed.
- The `.deb` declares no post-install scripts and no repository; update and
  uninstall semantics are package-manager operations on a manually downloaded
  file.

**Inherited from CI/matrix (not re-run here):** native ARM runner install
tests for `.deb`/`.rpm` and the headless AppImage launch smoke (v0.2.1).

**Unverified (no device):** GUI first frame, WebKitGTK rendering and
compositing under Crostini, software-rendering performance (Mali-G57 is not
exposed), touch/pen (USI Pen 2), detachable keyboard layouts and IMEs,
external display via USB-C, file-dialog and portal behavior, printing,
host-font visibility, clipboard/drag-and-drop, suspend/resume, long-session
memory, and the optional AI models on ARM64.

## 6. Minimal hardware verification checklist (Duet 11M889)

Record ChromeOS version/channel, the container's `/etc/os-release`, viewport,
DPR, free space, and free memory with every result.

1. `uname -m` → `aarch64`; `dpkg --print-architecture` → `arm64`;
   `cat /etc/os-release`; `df -h ~`; `free -h`.
2. Verify and install the exact `.deb`; confirm `which varve-desktop`,
   `apt policy varve`, Launcher entry, and icon.
3. Launch; confirm a non-blank first editable frame and that
   `pgrep -af WebKitWebProcess` shows a live web process; capture Terminal
   stderr if not.
4. Create a document, draw, save into a shared folder, close, reopen.
5. Export PNG and PDF; open both.
6. Input: trackpad drag/zoom, French/English keyboard, touch tap/drag, USI
   Pen 2 pressure and eraser, on-screen keyboard if relevant.
7. Displays: internal 1920×1200 at the device's scale, then USB-C external
   display (mirror and extend if offered), window move/resize.
8. Lifecycle: idle until the container suspends, resume, and confirm unsaved
   state recovery; close the lid and reopen; relaunch from the Launcher.
9. Fonts: `fc-list | wc -l`; open a text-heavy document and check fallback.
10. Printing: `lpstat -p` inside the container; note whether the print dialog
    sees any printer and whether PDF export is the practical path.
11. Uninstall: `sudo apt remove varve`; confirm documents remain; then (only
    on request) remove app data directories and confirm they are separate.

## 7. Research limitations

- No Chromebook was attached; every GUI and input claim is a hypothesis or a
  vendor-documented limitation, not a measurement.
- The x86_64 host cannot execute aarch64 binaries; `podman` has no binfmt
  handler registered, so install tests were resolution models rather than
  real arm64 execution. Native runner evidence exists only from the v0.2.1
  CI run recorded in the support matrix.
- Vendor pages reflect current ChromeOS UI and may change; the guide states
  the path generically rather than pinning screenshots.
- The GPU-acceleration conflict between Google's support page and Chromium's
  developer documentation is unresolved; the guide therefore avoids promising
  accelerated rendering.

## 8. Website surface validation (2026-09-12)

The user-facing guide is `https://varve.studio/docs/chromeos-linux` (website
source: `apps/website/src/pages/docs/chromeos-linux.astro`), linked from the
Linux download section, Getting Started, the docs index, and troubleshooting.
It was validated the same day:

- `pnpm build:website` and `pnpm build:website:pages` produced 85 routes each
  before the final docs-index link was added.
- Playwright e2e content spec `apps/website/tests/e2e/chromeos-linux.spec.ts`
  passed (4/4) against the Pages-base build: exact artifact filename and
  version come from the generated release manifest and are cross-checked
  against `docs/release/chromeos-linux.md`; the checksum, apt install, apt
  remove, and "Share with Linux" text are asserted; the route is in the
  sitemap.
- The SEO contract spec now includes `/docs/chromeos-linux` in its route list,
  so head metadata (title, canonical, Open Graph, JSON-LD) is covered.
- Committed visual baselines:
  `chromeos-linux-light-ghpages-linux.png` (article content, 800x3880),
  `download-linux-light-ghpages-linux.png` (Linux panel with the ChromeOS row,
  960x3863) and the refreshed `download-dark-ghpages-linux.png` (1280x6447).
  All three were inspected as images, and passed twice consecutively.
- The ChromeOS page captures use a document-coordinate clip because a bare
  fullPage capture of that route varies by 4 blank pixels between Playwright's
  repeated screenshots (measured with `scrollHeight` stable at 4886 while
  successive captures returned 4886/4890). The clip keeps the comparison on
  the article, which is stable.

Unrelated failures observed while validating (not produced by Stage 5):

- `apps/website/src/test/tokens.test.ts` fails on the current `master`:
  `pages/features/canvas.astro` uses raw `#172126`, `pages/docs/tools/grids.astro`
  uses raw `#dce7eb`, and `--surface-raised` / `--font-ui` are referenced but
  undefined. The offenders were introduced by the grid-systems website commit
  (`2f214960b`) and are outside this stage's file ownership.
- A new untracked `apps/website/src/pages/docs/browser-demo.astro` (another
  active workstream, seen at 06:30) imported `../../../lib/siteUrl` and
  `../../../layouts/Layout.astro`, which do not resolve from `src/pages/docs/`.
  It blocked a rebuild at one point; it is not part of Stage 5.
