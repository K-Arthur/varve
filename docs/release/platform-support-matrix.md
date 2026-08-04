# Strata — Platform & Architecture Support Matrix

**Date:** 2026-08-03
**Applies to:** the first public release (`v0.1.0-alpha`)

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
| **Linux** (Arch/CachyOS) | x86-64 | ✅ built + launched | AppImage 165 MB | unsigned | ✅ dev machine | glibc 2.35+ | **1** | High |
| **Linux** (Debian/Ubuntu) | x86-64 | ✅ built locally | `.deb` 74 MB | unsigned | ⬜ VM needed | Ubuntu 22.04 | **2** | Medium |
| **Linux** (Fedora/RHEL) | x86-64 | ✅ built locally | `.rpm` 74 MB | unsigned | ⬜ VM needed | Fedora 38 | **2** | Low |
| **Linux** | ARM64 | ❌ not built | — | — | ❌ | — | **Not supported** | — |
| **Windows 10/11** | x86-64 | ⚠️ never run | NSIS `.exe` | unsigned | ❌ no hardware | Win 10 1809 | **3** | Low |
| **Windows** | ARM64 | ❌ not built | — | — | ❌ | — | **Not supported** | — |
| **macOS** | ARM64 | ⚠️ never run | `.dmg` | unsigned | ❌ no hardware | macOS 13 | **3** | Low |
| **macOS** | x86-64 | ⚠️ never run | `.dmg` | unsigned | ❌ no hardware | macOS 13 | **3** | Very low |

Legend: ✅ verified · ⚠️ configured but never successfully executed · ⬜ planned · ❌ absent

---

## 3. Linux — detail

### Why x86-64 only

ARM64 Linux is rejected for the first release, not deferred vaguely. Concretely:
`scripts/fetch-onnxruntime.mjs` *does* define a `linux-aarch64` ORT build, so the AI path
could work — but there is no ARM64 test hardware, no ARM64 CI runner in the free tier that
also has WebKitGTK, and the WebGPU/compositor path has never been exercised on ARM Mali/Adreno.
Publishing an untested ARM64 build of a *design application* invites data-loss reports we
cannot reproduce. Revisit when there is hardware.

### Format decisions

| Format | Decision | Reasoning |
|---|---|---|
| **AppImage** | **Ship — primary** | One file, no root, works across distros. Matches "local-first" positioning. Caveat: needs FUSE2; on FUSE-less systems users need `--appimage-extract-and-run`, which must be documented |
| **`.deb`** | **Ship — secondary** | `tauri.conf.json` already carries a correct, complete `depends` list. Zero extra work |
| **`.rpm`** | **Ship — secondary** | Same. `depends` list present |
| **Flatpak / Flathub** | **Defer** | `packaging/flatpak/dev.strata.desktop.yml` exists but is unvalidated. Flathub review is a multi-week process with a real maintenance burden (runtime upgrades, sandbox holes for printing + font access). Excellent *second* channel, wrong *first* channel |
| **AUR** | **Defer to post-release** | Cannot exist before there is a release to point at (see RB-2). `strata-desktop-bin` wrapping the AppImage is ~1 h once v0.1.0 is published |
| **Snap** | **Reject** | No meaningful benefit over AppImage here; adds a confinement model that fights CUPS printing and system font enumeration |
| **Portable tarball** | **Reject** | AppImage already is the portable option |

### Compatibility risks that a CachyOS build does not prove

CachyOS ships glibc 2.44 and WebKitGTK 2.52.5 — both far newer than the compatibility baseline.
A binary linked against glibc 2.44 **will not run** on Ubuntu 22.04 (glibc 2.35). This is why
release artifacts must be built on `ubuntu-latest` in CI, never shipped from this workstation.

Untested and needing a VM pass before Tier 2 is claimed:

- WebKitGTK 2.40–2.46 behaviour (Ubuntu 22.04/24.04 ship older versions than CachyOS)
- Software rendering fallback where no GPU/WebGPU is available
- XDG desktop portal file dialogs under GNOME vs KDE vs wlroots
- CUPS discovery via `lpstat` (`print_linux.rs:6`) where CUPS is absent
- Fontconfig behaviour with a minimal font set
- MIME/`.desktop`/icon installation and **clean uninstall** for deb and rpm
- AppImage on a FUSE-less host
- X11 vs Wayland (dev is Wayland-only today)

---

## 4. Windows — detail

**Status: never built.** `publish.yml` configures `windows-latest` with `msi,nsis`, but the
workflow has never reached that job successfully (RB-2). Everything below is a plan, not a
verified result.

| Decision | Choice | Reasoning |
|---|---|---|
| Arch | x86-64 only | ARM64 Windows has no ORT bundle (`fetch-onnxruntime.mjs` comment: "low install base") and no test hardware |
| Installer | **NSIS only** | Per-user install without admin rights — critical when the app is unsigned, because a UAC prompt on an unsigned installer is a much harder sell. MSI is dropped for v1: it duplicates the artifact, doubles the smoke-test surface, and its main advantage (Group Policy deployment) is irrelevant for a solo alpha |
| MSI | Defer | Revisit if enterprise users ask |
| MSIX | Defer | Only needed for Microsoft Store; revisit with the Store decision |
| WebView2 | `offlineInstaller` — **reconsider** | Currently `tauri.conf.json:186`. Embeds the full WebView2 bootstrapper (~130 MB) into the installer. Given the artifact is already large, switch to `downloadBootstrapper` for the alpha and document the requirement. Windows 11 always has WebView2; Windows 10 usually does |

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

**Status: never built. No Mac hardware available.**

| Decision | Choice | Reasoning |
|---|---|---|
| Arch | ARM64 first | Apple Silicon is the overwhelming majority of active Macs; Intel is declining and cannot use the bundled ORT dylib anyway (H-3) |
| Universal vs split | **Split, ARM64 published** | The current `universal-apple-darwin` build produces a binary whose accelerated inference path only works on Apple Silicon. Better to ship an honest `aarch64` DMG than a "universal" one that is half-degraded |
| Intel | Tier 3, or omit | Only if someone asks and can test it |
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
