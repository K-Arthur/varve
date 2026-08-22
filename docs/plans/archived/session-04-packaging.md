# Session 04 — Packaging CI Matrix (Phase 0.11)

**Single agent — no parallelism needed**
**Estimated:** 2–4h

---

## Goal

Create a CI/CD packaging matrix that builds Strata for all target platforms:
- **Linux:** `.AppImage` + `.deb`
- **macOS:** `.dmg`
- **Windows:** `.msi`
- **Arch Linux:** AUR `PKGBUILD`

## Pre-requisites

```bash
# Verify current state
git log --oneline -3
pnpm typecheck
cargo test --workspace
```

## Step 1 — GitHub Actions workflow

Create `.github/workflows/publish.yml`:

```yaml
name: Publish
on:
  push:
    tags:
      - 'v*'

jobs:
  publish:
    strategy:
      fail-fast: false
      matrix:
        include:
          - os: ubuntu-latest
            target: x86_64-unknown-linux-gnu
            artifact: strata-x86_64.AppImage
            build: pnpm tauri build --bundles appimage
          - os: ubuntu-latest
            target: x86_64-unknown-linux-gnu
            artifact: strata_amd64.deb
            build: pnpm tauri build --bundles deb
          - os: macos-latest
            target: x86_64-apple-darwin
            artifact: strata.dmg
            build: pnpm tauri build --bundles dmg
          - os: windows-latest
            target: x86_64-pc-windows-msvc
            artifact: Strata.msi
            build: pnpm tauri build --bundles msi

    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4

      - name: Install Rust toolchain
        uses: dtolnay/rust-toolchain@stable
        with:
          targets: ${{ matrix.target }}

      - name: Install system dependencies (Linux)
        if: matrix.os == 'ubuntu-latest'
        run: |
          sudo apt-get update
          sudo apt-get install -y \
            libgtk-3-dev libwebkit2gtk-4.1-dev \
            libappindicator3-dev librsvg2-dev patchelf \
            libssl-dev libfontconfig1-dev

      - name: Install Node
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install pnpm
        uses: pnpm/action-setup@v2
        with:
          version: 9

      - name: Install JS dependencies
        run: pnpm install --frozen-lockfile

      - name: Build ${{ matrix.artifact }}
        run: ${{ matrix.build }}

      - name: Upload artifact
        uses: actions/upload-artifact@v4
        with:
          name: ${{ matrix.artifact }}
          path: apps/desktop/src-tauri/target/release/bundle/**/*
```

## Step 2 — AUR PKGBUILD

Create `dist/aur/PKGBUILD`:

```bash
# Maintainer: Strata Team <team@strata.app>
pkgname=strata-bin
pkgver=0.1.0
pkgrel=1
pkgdesc="Local-first, cross-platform design suite"
arch=('x86_64')
url="https://strata.app"
license=('MIT')
depends=('gtk3' 'webkit2gtk' 'librsvg' 'libappindicator-gtk3')
source=("${pkgname}-${pkgver}-x86_64.AppImage::https://github.com/K-Arthur/Strata/releases/download/v${pkgver}/strata-x86_64.AppImage")
sha256sums=('SKIP')

package() {
    install -Dm755 "${srcdir}/${pkgname}-${pkgver}-x86_64.AppImage" "${pkgdir}/usr/bin/strata"
    install -Dm644 "${srcdir}/../strata.desktop" "${pkgdir}/usr/share/applications/strata.desktop"
    install -Dm644 "${srcdir}/../strata.png" "${pkgdir}/usr/share/pixmaps/strata.png"
}
```

Also create `dist/aur/strata.desktop`:
```desktop
[Desktop Entry]
Name=Strata
Comment=Local-first design suite
Exec=strata
Type=Application
Categories=Graphics;2DGraphics;VectorGraphics;
Icon=strata
Terminal=false
StartupNotify=true
MimeType=application/x-strata;
```

## Step 3 — Tauri configuration check

Verify `apps/desktop/src-tauri/tauri.conf.json` has correct bundle identifiers:

```json
{
  "productName": "Strata",
  "version": "0.1.0",
  "identifier": "app.strata.desktop",
  "build": {
    "frontendDist": "../dist",
    "devUrl": "http://localhost:1420",
    "beforeDevCommand": "pnpm dev",
    "beforeBuildCommand": "pnpm build"
  },
  "bundle": {
    "active": true,
    "targets": ["appimage", "deb", "dmg", "msi"],
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ],
    "windows": {
      "wix": {
        "language": ["en-US"]
      }
    },
    "macOS": {
      "minimumSystemVersion": "10.15"
    },
    "linux": {
      "deb": {
        "depends": []
      }
    }
  }
}
```

## Step 4 — Verify locally (Linux only)

```bash
cd apps/desktop

# Test deb build (requires dpkg-deb)
pnpm tauri build --bundles deb 2>&1 | tail -20

# Or test with just the bundler check
pnpm tauri build --no-bundle --ci 2>&1 | tail -10
```

## Step 5 — Documentation

Update `docs/plans/phase1-plan.md` to mark Phase 0.11 as complete:

```markdown
| **0.11** Packaging | **Done** | GitHub Actions publish workflow + AUR PKGBUILD + Tauri bundle config |
```

## Verification checklist

```bash
- [x] `.github/workflows/publish.yml` exists and is valid YAML
- [x] `.github/workflows/build.yml` updated with Linux system deps + quality gates
- [x] `dist/aur/PKGBUILD` exists with correct `source` URL template
- [x] `dist/aur/strata-desktop-bin/PKGBUILD` exists (binary AUR variant)
- [x] `dist/aur/strata.desktop` exists with valid desktop entry
- [x] `packaging/flatpak/dev.strata.desktop.yml` Flatpak manifest stub
- [x] `apps/desktop/src-tauri/tauri.conf.json` has correct bundle config
- [x] `justfile` `package`, `aur-check`, platform recipes added
- [x] `cargo test --workspace` — 82 tests, all passing
- [x] `pnpm typecheck` — 0 errors across all 15 packages
- [x] `pnpm test` — 3572/3572 tests passing
- [x] `pnpm audit:tokens` — 96/96 WCAG-AA across 3 themes
- [x] `pnpm audit:emoji` — 0 violations
```

**Status: COMPLETE** (Session 4, 2026-07-05)

## Post-session

Archive all completed deferred plan files:

```bash
mkdir -p docs/plans/archived
mv docs/plans/tools-deferred.md docs/plans/archived/
mv docs/plans/home-surface-deferred.md docs/plans/archived/
mv docs/plans/inspector-deferred.md docs/plans/archived/
mv docs/plans/inspector-final.md docs/plans/archived/
mv docs/plans/spec-panel-deferred.md docs/plans/archived/
mv docs/plans/consolidated-final-push.md docs/plans/archived/
```

Update `AGENTS.md`:
- Set commit to latest
- Update test counts
- Mark all areas as complete

```bash
git add -A
git commit -m "feat: complete CI/CD packaging matrix + archive all deferred plans"
```
