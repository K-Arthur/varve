# Linux Packaging

Varve ships as multiple Linux distribution formats. This directory contains
the packaging infrastructure for each channel.

## Directory structure

```
packaging/
  aur/
    varve-desktop-bin/        # AUR binary package (from upstream .deb)
      PKGBUILD
      .SRCINFO
  flatpak/
    dev.varve.desktop.yml     # Flatpak manifest (Flathub-ready)
    cargo-sources.json        # Vendored Rust crate sources (regenerate per release)
    pnpm-sources.json         # Vendored pnpm package sources (regenerate per release)
    dev.varve.desktop.desktop # Desktop entry for the sandbox
    dev.varve.desktop.metainfo.xml  # AppStream metainfo for the sandbox
```

## AUR — varve-desktop-bin

Binary package that extracts the upstream .deb release. Includes ONNX Runtime
for native AI features (background removal, image upscaling).

### Release update procedure

```bash
# 1. Update pkgver in PKGBUILD
# 2. Get the sha256 from the published SHA256SUMS.txt
sha256=$(curl -sL https://github.com/K-Arthur/varve/releases/download/v$VERSION/SHA256SUMS.txt \
  | grep 'linux-x86_64.deb' | awk '{print $1}')
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

Complete Flatpak manifest using GNOME Platform 50 (includes webkit2gtk-4.1,
GTK3, libsoup3). Builds entirely offline with vendored Cargo and pnpm sources.

### Building locally

```bash
# Install the runtime + SDK
flatpak install flathub org.gnome.Platform//50 org.gnome.Sdk//50
flatpak install flathub org.freedesktop.Sdk.Extension.rust-stable//25.08
flatpak install flathub org.freedesktop.Sdk.Extension.node22//25.08

# Build
cd packaging/flatpak
flatpak-builder --force-clean build-dir dev.varve.desktop.yml

# Install
flatpak-builder --user --install --force-clean build-dir dev.varve.desktop.yml

# Run
flatpak run dev.varve.desktop
```

### Regenerating source manifests

When Cargo.lock or pnpm-lock.yaml changes (e.g., after a dependency update):

```bash
# Regenerate Cargo sources
flatpak-builder-tools/cargo/flatpak-cargo-generator.py \
  apps/desktop/src-tauri/Cargo.lock \
  -o packaging/flatpak/cargo-sources.json

# Regenerate pnpm sources
flatpak-builder-tools/node/flatpak_node_generator pnpm \
  packaging/flatpak/pnpm-sources.json \
  pnpm-lock.yaml
```

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
| Primary Arch package? | **Binary** (`varve-desktop-bin`) from upstream .deb |
| Separate source package? | No — single `-bin` package avoids duplicate/maintenance burden |
| AppImage extraction? | Replaced with .deb extraction (complete payload incl. ONNX) |
| AUR name | `varve-desktop-bin` (matches executable name, no conflicts) |
| AppStream metadata outside Flatpak? | Yes — installed by deb/rpm/AppImage and the AUR package |
| Flatpak offline build? | Yes — Cargo + pnpm vendored via generated source manifests |
| ONNX in Flatpak? | Bundled from .deb (MIT-licensed, prebuilt from Microsoft) |
| aarch64 support? | Upstream ships aarch64 AppImage/deb/rpm; AUR currently x86_64 only |
| Tauri updater in package-manager builds? | Disabled — `package-manager-managed` / `store-managed` authorities |
