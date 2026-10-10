# Packaging

Varve v0.5.0 publishes Linux AppImage, `.deb`, and `.rpm` downloads plus
unsigned Windows NSIS installers. This directory also contains a prepared,
x86_64-only AUR package definition, an incomplete Flatpak stub, Microsoft
Store MSIX identity/layout files, and the intended winget package ID. AUR,
Flathub, winget, and the Store listing are not published channels yet.

## Directory structure

```
packaging/
  msix/
    identity.json             # Partner Center slots (empty until filled)
    Package.appxmanifest.template
    README.md
  winget/
    README.md                 # Package ID VarveStudio.Varve (not submitted)
  aur/
    varve-desktop-bin/        # prepared AUR package (extracts upstream AppImage)
      PKGBUILD
      .SRCINFO
  flatpak/
    dev.varve.desktop.yml     # incomplete Flatpak build stub; exits with failure
    cargo-sources.json        # generated Rust source inventory (not wired into stub)
    pnpm-sources.json         # generated pnpm source inventory (not wired into stub)
    dev.varve.desktop.desktop # Desktop entry for the sandbox
    dev.varve.desktop.metainfo.xml  # AppStream metainfo for the sandbox
```

## AUR — varve-desktop-bin

The local PKGBUILD extracts the upstream x86_64 AppImage. Includes ONNX Runtime
for native AI features (background removal, image upscaling).

### Release update procedure

```bash
# 1. Update pkgver in PKGBUILD
# 2. Get the sha256 from the published SHA256SUMS.txt
sha256=$(curl -sL https://github.com/K-Arthur/varve/releases/download/v$VERSION/SHA256SUMS.txt \
  | grep 'linux-x86_64.AppImage$' | awk '{print $1}')
# 3. Update sha256sums in PKGBUILD
# 4. Regenerate .SRCINFO
cd packaging/aur/varve-desktop-bin
makepkg --printsrcinfo > .SRCINFO
# 5. Validate
makepkg --verifysource
```

### AUR publishing (human required)

```bash
# Create AUR account at https://aur.archlinux.org/account/register
# Then:
git clone ssh://aur@aur.archlinux.org/varve-desktop-bin.git /tmp/varve-aur
cp PKGBUILD .SRCINFO /tmp/varve-aur/
cd /tmp/varve-aur
git add PKGBUILD .SRCINFO
git commit -m "varve-desktop-bin $VERSION"
git push
```

## Flatpak

**Status: stub; not buildable or ready for Flathub.** The manifest targets
GNOME Platform 47 but its module intentionally exits with failure. The
generated Cargo and pnpm source inventories exist, but the manifest still
contains TODOs and does not consume them. Runtime permissions, build commands,
dependency inclusion, installation, and update behavior have not been
qualified. Do not follow the sample build/install commands from older copies
of this document.

Before this can be described as a working package, a maintainer must complete
the manifest, connect the source inventories, build offline, install and run
the app in the sandbox, and test file access, printing, fonts, model payloads,
and update authority. Then follow the human-authored submission checklist in
`docs/release/linux-ecosystem-readiness.md`.

### Flathub submission

Flathub submission requires a PR to `flathub/flathub` with:
- `dev.varve.desktop.yml` (the manifest)
- `dev.varve.desktop.metainfo.xml`
- `dev.varve.desktop.desktop`
- Generated source manifests

All PR content (description, reviewer responses) must be human-authored per
Flathub policy. See `docs/release/linux-ecosystem-readiness.md` for the full
submission checklist.

## Distribution strategy decisions

| Question | Answer |
|---|---|
| Primary Arch package? | **Binary** (`varve-desktop-bin`) from the upstream x86_64 AppImage |
| Separate source package? | No — single `-bin` package avoids duplicate/maintenance burden |
| AUR source artifact? | AppImage extraction; local PKGBUILD currently targets v0.5.0 x86_64 |
| AUR name | `varve-desktop-bin` (matches executable name, no conflicts) |
| AppStream metadata outside Flatpak? | Yes — installed by deb/rpm/AppImage and the AUR package |
| Flatpak offline build? | No — the manifest remains a failing stub; source inventories are not wired in |
| ONNX in Flatpak? | Unverified — no Flatpak build has completed |
| aarch64 support? | Upstream ships aarch64 AppImage/deb/rpm; AUR currently x86_64 only |
| Tauri updater in package-manager builds? | Disabled — `package-manager-managed` / `store-managed` authorities |
