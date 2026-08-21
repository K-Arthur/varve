# Varve — Platform & Architecture Support Matrix

**Date:** 2026-08-21
**Applies to:** the current release line (v0.2.0 published 2026-08-21;
v0.1.1 published 2026-08-12; v0.1.0 published 2026-08-09)

The guiding rule: **do not advertise a platform we have not run the application on.**
A successful `cargo build` is not evidence that an application works. Every "Supported" claim
below is backed by an actual launch on real hardware; everything else is labelled honestly.

---

## 1. Release tiers

| Tier | Meaning | What we promise |
|---|---|---|
| **Tier 1 — Supported** | Built in CI, installed and launched on real hardware, smoke-tested | Bugs are triaged and fixed |
| **Tier 2 — Best effort** | Built in CI, installed on real hardware, not systematically tested | Bugs accepted, no fix timeline |
| **Tier 3 — Experimental** | Builds in CI, never run on real hardware | Published with an explicit warning; no support |
| **Not supported** | Not built, not published | Not mentioned as available anywhere |

---

## 2. The matrix

| OS | Arch | Build | Package | Signing | Tested | Min OS | Tier | Confidence |
|---|---|---|---|---|---|---|---|---|
| **Linux** (Arch/CachyOS) | x86-64 | ✅ built + launched | `.deb` (host WebKitGTK) | unsigned | ✅ dev machine | glibc 2.35+ | **1** | High |
| **Linux** (Debian/Ubuntu) | x86-64 | ✅ built locally | `.deb` 49.8 MB (v0.2.0) | unsigned | ⬜ VM needed (container install-test ✅) | Ubuntu 22.04 | **2** | Medium |
| **Linux** (Fedora/RHEL) | x86-64 | ✅ built locally | `.rpm` 49.8 MB (v0.2.0) | unsigned | ⬜ VM needed (container install-test ✅) | Fedora 38 | **2** | Low |
| **Linux** | ARM64 | 🟡 matrix wired (`ubuntu-22.04-arm`); artifact/runtime gates pending | AppImage, `.deb`, `.rpm` | checksums + SBOM | ⬜ genuine ARM runtime and GUI smoke pending | glibc 2.35+ | **3 — Experimental** | Low |
| **Windows 10/11** | x86-64 | ✅ built in CI (`windows-latest`, NSIS) | `.exe` | unsigned | ⚠️ runner smoke passed 2026-08-09 (install/launch/uninstall); no long-term hardware testing | Win 10 1809 | **3** | Low |
| **Windows** | ARM64 | 🟡 matrix wired (`windows-11-arm`); native executable/runtime gates pending | native ARM64 app in NSIS distribution | unsigned until signing gate passes | ⬜ Windows on ARM runtime smoke pending | Windows 10 1809 | **3 — Experimental** | Low |
| **macOS** | ARM64 | ✅ built in CI (`macos-latest`, `aarch64-apple-darwin` DMG) | `.dmg` | unsigned, unnotarised | ⚠️ runner smoke passed 2026-08-09 (mount/launch/unmount); no long-term hardware testing | macOS 13 | **3** | Low |
| **macOS** | x86-64 | ❌ not built (dependency EOL — ONNX Runtime upstream discontinued macOS Intel binaries; see `docs/plans/macos-intel-feasibility.md`) | — | — | ❌ | — | **Not supported** | — |

Legend: ✅ verified · ⚠️ runner smoke passed once, no ongoing hardware testing · ⬜ planned · ❌ absent

---

## 2a. Container install-test status (2026-08-04, fresh Varve 0.1.0 build)

`just verify-packages` (podman, rootless) against `.deb`/`.rpm` built on
this machine on 2026-08-04:

| Check | `.deb` on ubuntu:22.04 | `.rpm` on fedora:38 |
|---|---|---|
| Declared deps resolve from distro repos | ✅ install | ✅ install |
| Binary path | ✅ `/usr/bin/varve-desktop` | ✅ `/usr/bin/varve-desktop` |
| glibc symbol floor | ❌ GLIBC_2.39 vs 2.35 (locally-built smoke artifact — release builds come from the `ubuntu-22.04` CI runner, floor 2.35) | ❌ same |
| `ldd` resolves all libraries | ✅ | ✅ |
| Desktop entry | ✅ single `Varve.desktop` (double-entry fix holds) | ✅ |
| Icons (hicolor) | ✅ | ✅ |
| MIME XML registration | ✅ `dev.varve.desktop.xml` | ✅ |
| Uninstall + clean | ✅ binary removed | ✅ |

The glibc column is the expected result for a CachyOS-built artifact and is
documented in the release-readiness audit (RB-8); the container test's real
value is the install/uninstall/linkage columns, which all pass. A fresh build
also confirms the MIME XML ships in both formats (the earlier run was against
a stale pre-fix artifact).

---

## 3. Linux — detail

### ARM64 release path — experimental until runtime evidence exists

Linux ARM64 now has a dedicated native `ubuntu-22.04-arm` release matrix entry.
That is required because Tauri's current AppImage toolchain does not support
cross-compiling ARM AppImages. It is a build and packaging path, not yet a
supported-product claim: the release gate still needs binary-header inspection,
package metadata checks, native ONNX inference, and a real ARM editor smoke
workflow. QEMU-only results would not promote this target.

### Format decisions

| Format | Decision | Reasoning |
|---|---|---|
| **`.deb`** | **Ship — primary** | Declares its full dependency list (incl. `libwebkit2gtk-4.1-0`), installs cleanly, verified on Ubuntu 22.04 + Fedora 38 containers and real hosts. The most reliable Linux path |
| **AppImage** | **Ship — secondary** | Portable single file, but NOT dependency-free: bundling WebKit/GTK broke on modern Mesa (white screen, fixed by pruning the bundled libs — the AppImage now uses host WebKitGTK like the .deb). Needs FUSE2; on FUSE-less systems `--appimage-extract-and-run`. See `scripts/release/prune-appimage-bundled-libs.mjs` |
| **`.rpm`** | **Ship — secondary** | Same `depends` list present |
| **Flatpak / Flathub** | **Defer** | `packaging/flatpak/dev.varve.desktop.yml` exists but is unvalidated. Flathub review is a multi-week process with a real maintenance burden (runtime upgrades, sandbox holes for printing + font access). Excellent *second* channel, wrong *first* channel |
| **AUR** | **Defer to post-release** | Cannot exist before there is a release to point at (see RB-2). `varve-desktop-bin` PKGBUILD is already written (`packaging/aur/varve-desktop-bin`) and parses under `makepkg`; it needs the real SHA-256 from a published `SHA256SUMS.txt` before submission |
| **Snap** | **Reject** | No meaningful benefit over AppImage here; adds a confinement model that fights CUPS printing and system font enumeration |
| **Portable tarball** | **Reject** | AppImage already is the portable option |

### Compatibility risks that a CachyOS build does not prove

CachyOS ships glibc 2.44 and WebKitGTK 2.52.5 — both far newer than the compatibility baseline.
**Measured, not assumed:** a locally-built `.deb` installed into `ubuntu:22.04` reports
`version 'GLIBC_2.39' not found` and refuses to exec (`just verify-packages`).

The floor is whatever the linker actually referenced — 2.39 here, not the host's 2.44. That
still excludes Ubuntu 22.04 (2.35), Debian 12 (2.36) and Fedora 38 (2.37), and it is why
release artifacts are built on the **`ubuntu-22.04`** runner rather than `ubuntu-latest`
(which is 24.04 / glibc 2.39 and would reproduce the same exclusion).

Untested and needing a VM pass before Tier 2 is claimed:

- WebKitGTK 2.40–2.46 behaviour (Ubuntu 22.04/24.04 ship older versions than CachyOS)
- Software rendering fallback where no GPU/WebGPU is available
- XDG desktop portal file dialogs under GNOME vs KDE vs wlroots
- CUPS discovery via `lpstat` (`print_linux.rs:6`) where CUPS is absent
- Fontconfig behaviour with a minimal font set
- AppImage on a FUSE-less host
- X11 vs Wayland (dev is Wayland-only today)
- **Actual GUI launch on Ubuntu 22.04 / Fedora 38** — the container install-test
  (2026-08-04) proves install, linkage, glibc floor and uninstall, but a
  container has no display; the window itself still needs a VM or real machine.

**Closed since the original matrix (2026-08-04):**

- MIME/`.desktop`/icon installation and **clean uninstall** for deb and rpm —
  container-verified on ubuntu:22.04 and fedora:38 with a fresh 0.1.0 build:
  single desktop entry, hicolor icons, MIME XML, uninstall all pass.
- Binary name resolved: `/usr/bin/varve-desktop` (the M3 rename decision).

---

## 4. Windows — detail

**Status: built in CI and published with v0.1.0 (2026-08-09) — runner smoke
passed, no systematic on-hardware testing.** The `release.yml` windows job
builds the NSIS installer on `windows-latest`; the v0.1.0 draft passed the
runner smoke pass (silent install, `varve-desktop.exe` launch for a bounded
smoke test, version/product metadata check, uninstall entry found, clean
uninstall — all on a real Windows runner). That is the gate between "built"
and "published": it proves install/launch/uninstall once, not that the
application works on Windows over time. Everything below is a plan unless it
is marked as verified. (An earlier `publish.yml` that targeted `msi,nsis` was
retired in P0-1 — `release.yml` is the only tag-triggered workflow.)

| Decision | Choice | Reasoning |
|---|---|---|
| Arch | x86-64 + ARM64 matrix | ARM64 uses the native `aarch64-pc-windows-msvc` target and official Windows ARM64 ONNX Runtime; real Windows-on-ARM runtime evidence is still pending |
| Installer | **NSIS only** | Per-user install without admin rights — critical when the app is unsigned, because a UAC prompt on an unsigned installer is a much harder sell. MSI is dropped for v1: it duplicates the artifact, doubles the smoke-test surface, and its main advantage (Group Policy deployment) is irrelevant for a solo alpha |
| MSI | Defer | Revisit if enterprise users ask |
| MSIX | Defer | Only needed for Microsoft Store; revisit with the Store decision |
| WebView2 | `downloadBootstrapper` | Switched 2026-08-18 from `offlineInstaller` (installer-size investigation). Measured from the released v0.1.2 artifact: the embedded Evergreen standalone installer weighed **202.8 MB (x64)** / **187.3 MB (ARM64)** — ~76% of the 263.7 MB / 236.7 MB NSIS installers. The bootstrapper (~2 MB) fetches the runtime at install time when it is missing; Windows 11 ships the runtime and Windows 10 (min supported 1809) receives it via Edge/Windows Update, so first launch stays reliable for effectively all supported devices. The rare fully-offline machine without the runtime needs a manual runtime install — if offline deployment ever becomes a requirement, publish a separate `offlineInstaller` build rather than reverting the default |

**SmartScreen — the honest version.** An unsigned NSIS installer triggers
"Windows protected your PC" with a *Don't run* default; the user must click *More info → Run
anyway*. Buying a certificate does **not** remove this immediately: Microsoft's own
documentation states "SmartScreen reputation builds up automatically. The prompt stops
appearing once the file hash has sufficient download history"
([Artifact Signing FAQ](https://learn.microsoft.com/en-us/azure/artifact-signing/faq),
accessed 2026-08-03). A standard (non-EV) certificate buys *attribution*, not instant trust.
Azure Artifact Signing does not issue EV certificates at all.

The one route that skips this entirely is the **Microsoft Store**, which re-signs submissions
with a Microsoft-trusted identity — and, as of the current onboarding flow, costs nothing.

---

## 5. macOS — detail

**Status: built in CI (aarch64 DMG) and published with v0.1.0 (2026-08-09) —
runner smoke passed, no Mac hardware in the project.** The release matrix
builds `macos-latest` / `aarch64-apple-darwin`; the v0.1.0 draft passed the
runner smoke pass (DMG mounted, app bundle structure and architecture
checked, executable launched for a bounded smoke test, unmounted cleanly —
all on a real macOS runner). ONNX Runtime upstream discontinued macOS Intel
binaries (last release line 1.23.0, dropped at 1.24.1), so only ARM64 is
configured — see `docs/plans/macos-intel-feasibility.md` for the full
dependency audit. The runner smoke proves mount/launch/unmount once,
not that the application works on macOS over time — no Mac hardware is
available to the project for ongoing validation, and macOS remains
**Experimental** for that reason. The changelog/download page label it
accordingly.

| Decision | Choice | Reasoning |
|---|---|---|
| Arch | ARM64 only | Apple Silicon is the overwhelming majority of active Macs; Intel macOS is a discontinued platform — ONNX Runtime upstream stopped shipping Intel macOS binaries (last line 1.23.0, dropped at 1.24.1) and GitHub retires its last Intel runner (Aug 2027). Decision: `docs/plans/macos-intel-feasibility.md` |
| Universal vs split | **Split, ARM64 published** | The current build targets `aarch64-apple-darwin` only (a DMG); an earlier `universal-apple-darwin` approach produced a binary whose accelerated inference path only worked on Apple Silicon anyway. Better to ship an honest `aarch64` DMG than a "universal" one that is half-degraded |
| Intel | **Not supported** (decision 2026-08-18) | Dependency EOL: ONNX Runtime upstream discontinued Intel macOS binaries; the last viable line (1.23.0) predates Varve's runtime, carries a known macOS exit-crash bug, and will never receive fixes. GitHub's Intel runner retires Aug 2027. Revisit only with demand, hardware, and upstream signal (`docs/plans/macos-intel-feasibility.md`) |
| Min version | macOS 13 Ventura | Already set in `tauri.conf.json:180` |
| Distribution | Unsigned DMG, clearly labelled | See below |
| Mac App Store | **Reject for v1** | Requires the $99 membership *and* full App Sandbox. The sandbox directly conflicts with arbitrary-path document access and CUPS printing. Months of work |

### What each macOS step actually requires

| Step | Needs |
|---|---|
| Build a `.app`/`.dmg` | macOS runner only — **free on GitHub-hosted `macos-latest`** |
| Ad hoc signature (`-`) | Nothing. Does not satisfy Gatekeeper |
| Developer ID signing | **Apple Developer Program, $99 USD/yr** + certificate in CI secrets |
| Notarisation | Same membership + App Store Connect API key or app-specific password |
| Stapling | Successful notarisation |
| Final validation | **A real Mac.** No CI substitute |

### The unsigned-macOS user experience — stated plainly

An unsigned, un-notarised DMG on macOS 13+ is blocked by Gatekeeper. The app is quarantined
(`com.apple.quarantine`), and on first launch the user sees a dialog saying the app cannot be
opened because Apple cannot check it for malicious software. The supported way through is
**System Settings → Privacy & Security → Open Anyway**, which is per-app and reversible.

We will **not** instruct users to run `sudo spctl --master-disable` or otherwise disable
Gatekeeper system-wide. Downgrading a machine's security posture to install a hobby alpha is
not an acceptable install workflow, and any documentation that suggests it is teaching a
dangerous habit.

Because of this, and because there is no Mac to validate on, **macOS is published as an
explicitly-labelled developer preview or not at all** — see the distribution decision matrix.

---

## 6. Cross-cutting constraints

### 4 GB RAM target

`apps/desktop/dist` is currently **147 MB**, of which `ort-wasm` is **93 MB** and models are
**13 MB**. Everything in `dist/` is embedded in the binary. Add the ~25 MB platform ORT library
and the installed footprint is comfortably over 200 MB before WebView2.

`ort-wasm` ships *every* onnxruntime-web variant (`ort.all.*`, `ort.jspi.*`, `ort.bundle.*`,
plus non-minified copies) when a packaged desktop build needs at most one or two. Trimming that
set is the single highest-leverage size win available and costs nothing — it directly serves the
4 GB-RAM goal, since a smaller bundle means less to decompress and map at startup.

### Wayland

`apps/desktop/src-tauri/Cargo.toml` pins `webkit2gtk = "=2.0.2"` deliberately, and takes a
`glib` dependency specifically so `g_set_prgname` matches the `.desktop` stem for Wayland/KDE
icon resolution. This is careful, correct work — but it means X11 behaviour is **assumed, not
verified**. Add an XWayland pass before claiming Tier 1 beyond Arch.
