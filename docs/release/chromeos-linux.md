# Varve on ChromeOS (Linux development environment)

**Route:** ARM64 or x86_64 Linux application inside ChromeOS's sandboxed
Debian environment, launched from the ChromeOS Launcher or Terminal. This is
**not** the native Chrome browser tab and not an Android or Play Store app.

**Status:** Experimental (Tier 3). The package metadata, checksums,
architecture, dependency closure, and install/update/uninstall commands below
were verified against the published **v0.2.1** ARM64 artifacts on 2026-09-12.
A GUI run on a physical Chromebook (including the Lenovo Chromebook Duet
11M889) has **not** happened yet, so rendering quality, input latency, fonts,
and suspend/resume remain unverified. See the
[Stage 5 audit](../audits/chromeos-stage5-linux-arm64-2026-09-12.md) and the
[platform support matrix](platform-support-matrix.md).

> Prefer the `.deb` on ChromeOS. It is the format the Linux environment is
> built for. Do not download the x86_64 build on an ARM Chromebook (or vice
> versa); `uname -m` tells you which one you have.

## 1. Before you start

### Confirm Linux is available

1. At the bottom right, select the time, then **Settings**.
2. Select **About ChromeOS** then **Developers**.
3. Next to "Linux development environment", select **Set up** if it is not
   already enabled. ChromeOS takes ten minutes or more to install the
   environment the first time.

If the option is missing or disabled, the device does not support Linux or a
work/school administrator has turned it off. Ask the administrator; there is
no supported bypass and this project does not provide one.

### Sizing

Measured against v0.2.1: the ARM64 `.deb` is **49.0 MB** and installs
**~85 MB** of application files (`Installed-Size: 84933` KiB), plus the
system WebKitGTK/GTK dependency closure. On a modeled arm64 Debian 12 root the
closure is 287 packages; allow **~1 GB** for the install and keep the Linux
environment's free space above **2 GB** before installing, more if you plan to
keep projects, recovery records, and optional AI models inside Linux. The
large optional models (up to ~1 GB each) download on demand and are not part
of the package. If the setup flow offers a disk-size choice, choose 10 GB or
more.

Installed RAM is not what one application gets: on an 8 GB Chromebook the
Linux VM, native Chrome, and Android all share memory. Varve's adaptive
performance profile reduces render scale, caching, image decode, and effects
quality when frame times slip, and falls back to Canvas2D (no WebGPU
required), so constrained devices degrade rather than fail.

### Know which artifact you want (current release: v0.2.1)

| File | Size | Use on ChromeOS |
|---|---|---|
| `Varve-0.2.1-linux-aarch64.deb` | 49.0 MB | **Recommended** on ARM64 devices (Kompanio 838, MediaTek, Snapdragon Chromebooks) |
| `Varve-0.2.1-linux-x86_64.deb` | 49.9 MB | Only for Intel/AMD Chromebooks |
| `Varve-0.2.1-linux-aarch64.AppImage` | 40.5 MB | Alternate; see the AppImage caveat below |
| `Varve-0.2.1-linux-x86_64.rpm` | 49.9 MB | Not used by ChromeOS (Debian environment) |

Check your architecture first:

```bash
uname -m          # expect aarch64 on ARM Chromebooks, x86_64 on Intel/AMD
dpkg --print-architecture   # expect arm64 or amd64
cat /etc/os-release         # Debian version of the Linux environment
```

**AppImage caveat (v0.2.1):** the published AppImages were pruned of their
bundled libraries but also lost Tauri's resource directory, so the bundled
native ONNX Runtime is missing; native AI features fall back to the slower
web/raster paths. The fix is on `master` and ships in the next release
(`scripts/release/prune-appimage-bundled-libs.mjs`). If you use an AppImage:
it needs FUSE2, and since the bundled libraries are removed it also needs the
host WebKitGTK stack. On a FUSE-less container, run it with
`--appimage-extract-and-run`. The `.deb` does not have either caveat.

## 2. Download and verify

Download the `.deb` and the checksum file from the same GitHub release:

```bash
mkdir -p ~/Downloads/varve && cd ~/Downloads/varve
curl -fLO https://github.com/K-Arthur/varve/releases/download/v0.2.1/Varve-0.2.1-linux-aarch64.deb
curl -fLO https://github.com/K-Arthur/varve/releases/download/v0.2.1/SHA256SUMS.txt
sha256sum -c --ignore-missing SHA256SUMS.txt
```

Expected result:

```text
Varve-0.2.1-linux-aarch64.deb: OK
```

The published SHA-256 for this file is
`04a52411bf0a2b3ab9cc368b3d17c554b88cb17d179b3ecc784d3eb5bfe9b890`. A
checksum proves the file matches the published release data; it does **not**
prove who built it. Linux artifacts are unsigned (no platform code-signing
certificate), and they ship with `SHA256SUMS.txt`, a CycloneDX SBOM, and
GitHub build provenance. Prefer the project's GitHub release page as the
download source, and treat mirrored copies as untrusted.

Folders shared with Linux appear under `/mnt/chromeos`. To move the file in:
right-click the folder in the Files app and choose **Share with Linux**, or
copy files into **Linux files** in the Files app. Linux files stored in the
container are **not** in My files and are deleted if the Linux environment is
removed; keep project documents in a shared My files/Drive folder instead.

## 3. Install (system modification)

`sudo apt install ./file.deb` resolves the declared dependencies from the
Debian repositories and runs the package scripts. Do not use `dpkg -i` alone
(it does not fetch dependencies), and do not use forced installs
(`--force-all`, `--force-depends`).

```bash
sudo apt update
sudo apt install ./Varve-0.2.1-linux-aarch64.deb
```

Verified for the current artifact:

| Check | Result |
|---|---|
| Package name / version / arch | `varve` / `0.2.1` / `arm64` |
| Declared dependencies | WebKitGTK 4.1, GTK3, GLib, libsoup3, librsvg2, OpenSSL, gdk-pixbuf, cairo, pango, fontconfig (all present in Debian 12/13) |
| glibc symbol floor | `GLIBC_2.35` (Debian 12 has 2.36, Debian 13 has 2.41) |
| Binary | `/usr/bin/varve-desktop`, ELF 64-bit ARM aarch64, not stripped |
| Desktop entry / MIME / icons | `/usr/share/applications/Varve.desktop`, `dev.varve.desktop.xml` (`application/x-varve`, legacy `application/x-strata`), hicolor icons |
| Bundled native AI runtime | `/usr/lib/Varve/onnxruntime-libs/linux-aarch64/libonnxruntime.so` |

If dependency resolution fails, the Linux environment's Debian release is
older than Varve supports (glibc below 2.35 / a pre-`bookworm` container) or
the sources are misconfigured. Update the container's packages first
(`sudo apt update && sudo apt dist-upgrade`), then retry. Do not add random
third-party repositories.

## 4. First launch and your first project

Open the Launcher (Search key) and choose **Varve**, or run:

```bash
varve-desktop
```

Then:

1. Create a new document or open the bundled sample poster from
   `varve.studio` (`/samples/varve-poster.varve`).
2. Draw something and save with **Ctrl+S**. In the save dialog, navigate to a
   **shared** folder (for example `My files` or a folder shared with Linux
   under `/mnt/chromeos/...`) so the project survives container removal.
3. Reopen the saved file and confirm it loads.
4. Optional smoke checks: `File > Export` a PNG/PDF, and launch Varve twice
   with two `.varve` files selected in Files to confirm multiple-file launch
   (`Exec=varve-desktop %F`).

## 5. ChromeOS file boundaries (verified behavior)

| Location | Where it lives | Visible to Linux | Survives Linux removal |
|---|---|---|---|
| **Linux files** (Files app) | Inside the Linux container | Yes | **No** |
| My files / Downloads / Drive | ChromeOS host | Only after **Share with Linux**, then under `/mnt/chromeos` | Yes (host-backed) |
| Google Drive | ChromeOS host | Only via a shared folder; no automatic sync | Yes (cloud) |

- Sharing is explicit and per-folder; the container does not see the host
  filesystem by default (Chromium OS containers documentation).
- Drive-backed files are streamed, not always local; offline access is not
  guaranteed for files you never pinned.
- All Linux apps share one sandbox; anything shared with Linux is available
  to every Linux app.

## 6. Updates

There is **no apt repository for Varve**. Installing the `.deb` does not
subscribe you to future releases, and `apt upgrade` will not update Varve.
To update manually:

```bash
cd ~/Downloads/varve
curl -fLO https://github.com/K-Arthur/varve/releases/download/<NEW_TAG>/Varve-<NEW_VERSION>-linux-aarch64.deb
curl -fLO https://github.com/K-Arthur/varve/releases/download/<NEW_TAG>/SHA256SUMS.txt
sha256sum -c --ignore-missing SHA256SUMS.txt
sudo apt install ./Varve-<NEW_VERSION>-linux-aarch64.deb
```

Installing over the previous version preserves documents and settings (the
package manager replaces application files only). If an upgrade fails midway,
re-run `sudo apt install ./<file>.deb`; if apt reports a broken state, run
`sudo apt --fix-broken install` and retry. Rollback means installing an older
`.deb`, and only works for documents saved by a version whose file schema is
still compatible — the `.varve` format is still evolving, so back up before
rolling back. The website's [Updates guide](https://varve.studio/docs/updates)
covers the in-app updater, which applies to other platforms.

## 7. Uninstall, and the data decision

Uninstalling the package is separate from deleting your work:

```bash
sudo apt remove varve        # removes the app; documents and settings stay
```

Application data lives under `~/.local/share/dev.varve.desktop/` and
`~/.config/dev.varve.desktop/` inside the Linux container, and any documents
stored in the container home are deleted if you remove the Linux environment.
If — and only if — you also want the app's own settings and recovery records
gone, confirm the directories first and delete them explicitly:

```bash
ls -la ~/.local/share/dev.varve.desktop ~/.config/dev.varve.desktop 2>/dev/null
rm -rf ~/.local/share/dev.varve.desktop ~/.config/dev.varve.desktop
```

Do not delete `~`, `~/Downloads`, `/mnt/chromeos`, or shared folders as
"cleanup": those hold user documents. Removing the Linux environment itself
(Settings → About ChromeOS → Developers → Linux development environment →
Remove) deletes **all** files held inside Linux — back them up first with the
ChromeOS **Back up and restore** flow (Settings → Advanced → Developers →
Linux → Back up and restore), which produces a `.tini` backup. Browser/PWA
data is separate from Linux app data and is not affected by these steps.

## 8. What is expected to work, and what is not yet verified

Documented ChromeOS limitations (Google, current support pages; see the
audit's research ledger for dates):

- No camera, no non-Android USB devices, and **no hardware acceleration,
  including GPU and video decode** in the Linux environment. Chromium's
  developer documentation separately describes accelerated graphics as a
  Crostini feature, so the exact state is version-dependent; treat GPU
  acceleration as unavailable and expect software rendering. The NPU (MediaTek
  NPU 650) is not exposed to browsers or the Linux container and is not used
  by Varve.
- No IME support in the Linux environment; keyboard layouts are the
  container's own. Function keys, the trackpad, and standard Latin layouts
  work; pen and touch arrive as pointer events via Sommelier and are not yet
  verified with Varve.
- Printing depends on CUPS inside the container, which is commonly absent;
  Varve's Linux print bridge reports the printer list it can see. Export a PDF
  from the **Export** dialog and print it from ChromeOS instead.
- Fonts are fontconfig's view of the container, not the host's. Install a font
  inside Linux (`~/.local/share/fonts`, then `fc-cache -f`) if a document
  needs a face the container lacks; do not assume host fonts appear.
- The container is suspended when idle and processes do not survive logout;
  save before closing the Chromebook. Suspend/resume behavior for an open
  document is unverified.

Every claim above that depends on hardware is marked unverified because no
physical Chromebook run has been recorded. The smallest next verification
step is the hardware checklist in the Stage 5 audit, starting with
`uname -m`, `cat /etc/os-release`, a first editable frame, and a save/reopen
cycle.

## 9. Troubleshooting

- **`apt` says the package architecture is wrong**: you downloaded the wrong
  file. Check `uname -m` and re-download.
- **`GLIBC_2.3x not found` or unmet dependencies**: the container is older
  than the supported baseline. `sudo apt update && sudo apt dist-upgrade`,
  retry, and report the container's `cat /etc/os-release`.
- **The window is blank**: first confirm a WebKit web process is alive
  (`pgrep -af WebKitWebProcess`). If it is missing, the WebKit renderer failed
  — run `varve-desktop` from Terminal and capture the error. A per-launch
  diagnostic for renderer problems is
  `WEBKIT_DISABLE_DMABUF_RENDERER=1 varve-desktop`; it is a workaround, not a
  fix, so unset it after testing and report whether it helped. Never disable
  system security features.
- **Missing launcher icon**: launch once from Terminal, then check the
  Launcher again; the desktop entry is `Varve.desktop` with
  `StartupWMClass=dev.varve.desktop`.
- **Cannot find a saved project**: it may be inside the container home rather
  than a shared folder. In the Files app, "Linux files" shows container
  storage; shared host folders are under `/mnt/chromeos`.
- **Still stuck?**: [troubleshooting guide](https://varve.studio/support/troubleshooting)
  and [known issues](https://varve.studio/support/known-issues).
