# Microsoft Store (MSIX)

Varve can ship on the Microsoft Store as an MSIX starting with a Store build of
the current published Windows app. Tauri 2 does not emit MSIX; this repository
stages the Windows release binary and packs it with `makeappx` (Windows SDK) or
`winapp pack`.

This document is the human Partner Center path. CI never creates a Store
account, never publishes a listing, and never attaches an MSIX to the GitHub
Release.

## What is signed, and what is not

- **Microsoft Store-installed copies** are re-signed by Microsoft after Store
  certification. That is the free signed Windows install route.
- **Direct GitHub `.exe` downloads stay unsigned** unless a separate
  Authenticode pipeline is configured. A Store listing does not sign those
  NSIS installers, and it does not change published 0.5.0 GitHub Release
  assets.

## Build any release tag, including v0.5.0

The `Microsoft Store MSIX` workflow (`msix.yml`) is independent of
`release.yml`. Dispatch it with `tag` set to any existing release tag
(`v0.5.0` works). An empty `tag` input packages the latest published GitHub
release. Tag-push events also run it for that tag.

The job checks out the **tagged application source** and overlays current
packaging scripts from the workflow SHA. It uploads MSIX / MSIXBundle
**workflow artifacts only**. It does not draft, edit, or replace GitHub
Release assets.

Store builds set `VARVE_UPDATER_MODE=manual-only` so the in-app updater is
off. Microsoft Store owns updates for Store installs. NSIS builds are
unchanged.

## Identity values Kevin must copy from Partner Center

Do not invent these. They are empty in `packaging/msix/identity.json` until
filled.

| Partner Center field | Repository variable | Notes |
|---|---|---|
| Identity **Name** | `VARVE_STORE_PACKAGE_NAME` | Assigned after the name **Varve** is reserved |
| Identity **Publisher** | `VARVE_STORE_PUBLISHER_CN` | `CN=…` from the account / product identity page |
| **Publisher display name** | `VARVE_STORE_PUBLISHER_DISPLAY_NAME` | Intended value: **Varve** |

Whether an **individual** developer account can use `Varve` as
`PublisherDisplayName` must be checked in Partner Center. Microsoft may
require the verified legal name instead. Confirm before the first
submission; do not assume the reserved app name is allowed as the publisher
display string.

Until those variables are set, CI packs a test identity
(`Varve.Desktop.CI` / `CN=Varve CI Test`) that is **not** Store-submittable.

## Partner Center steps (human only)

1. Create a **free individual** Microsoft developer account. Complete ID
   verification when Partner Center asks for it.
2. Open Apps and games → **New product** → **MSIX or PWA app** (not the EXE/MSI
   storefront-link product). Reserve the name **Varve**.
3. On the product identity page, copy **Name** and **Publisher** (`CN=…`) into
   the GitHub repository variables above. Recheck `PublisherDisplayName`.
4. Complete the **age rating** questionnaire. Varve is a design tool; answer
   from the shipping product, not from guesses about future features.
5. Set the privacy policy URL to
   `https://varve.studio/about/privacy/`. Store listings require a privacy
   policy.
6. Upload the unsigned MSIX or MSIXBundle from the workflow artifact (x64 and
   arm64, or the bundle). Microsoft signs the Store package.
7. Do not enable in-app updates for the Store package. The Store build already
   disables them.

## Listing copy

Lead with what Varve offers. Do not name competitors. Do not use a personal
name. Keep it short and searchable.

**Suggested title:** Varve

**Suggested short description:** Local-first design suite for vector, layout,
type, photo, motion, and print.

**Suggested description:**

Varve is a local-first design suite for vector illustration, interface layout,
typography, photo editing, motion, prototyping, and print production. Work
stays on the machine. Optional on-device AI features (trace, enhance, subject
isolation, and related tools) run locally after the user installs a verified
model; they are not required and they do not send documents to a cloud
service. Open `.varve` documents and legacy `.strata` files. Updates for this
listing come from Microsoft Store.

**Category:** Photo & video, or Productivity → design.

**Notes for the listing form:**

- Price: free
- Privacy policy: `https://varve.studio/about/privacy/`
- AI features are optional and on-device
- Windows 10 version 1809 or later / Windows 11
- Architectures: x64 and ARM64

## Package contract

- File associations: `.varve` and legacy `.strata`
- Icons: existing master icon pipeline (`StoreLogo` and Square* assets under
  `apps/desktop/src-tauri/icons/`)
- Restricted capability: `runFullTrust` only (required for a Win32 Tauri app)
- Do not declare `broadFileSystemAccess`

## Risks to check on the first submission

- **ARM64 packaging.** The ARM64 job uses the same native `windows-11-arm`
  Clang/MSVC setup as the NSIS release. If that runner or toolchain drifts,
  only the ARM64 MSIX fails; x64 still uploads.
- **ONNX Runtime DLLs inside MSIX.** Native inference libraries are staged
  next to the exe. WACK may flag unsigned native binaries inside the package.
  Microsoft re-signs the package, not necessarily every inner DLL. Keep the
  architecture prune step so an x64 package never carries ARM64 ONNX, and the
  reverse.
- **File pickers under MSIX.** The app is full-trust Win32. The packaged
  AppData tree is virtualized. File-dialog picks should still work; arbitrary
  paths and write-back to install location can differ from NSIS. Verify Open,
  Save, and model downloads on a Store or sideload install before submitting.
- **WebView2.** The MSIX does not bundle the Evergreen installer. Windows 10/11
  machines used for Store installs are expected to have WebView2. Call that
  out if certification asks.
- **Publisher display name on an individual account.** Confirm in Partner
  Center before printing "Varve" on the listing as publisher.

## Local pack (Windows)

```powershell
# After a Store-flagged Tauri build:
node scripts/release/msix/stage.mjs `
  --release-dir apps/desktop/src-tauri/target/x86_64-pc-windows-msvc/release `
  --output-dir dist/msix/x86_64/layout `
  --version 0.5.0 `
  --architecture x86_64
./scripts/release/msix/pack.ps1 `
  -LayoutDir dist/msix/x86_64/layout `
  -OutputMsix dist/msix/Varve-0.5.0-windows-x86_64.msix `
  -SignMode unsigned
```

`winapp pack` is also valid when the [WinApp CLI](https://learn.microsoft.com/en-us/windows/apps/dev-tools/winapp-cli/guides/tauri)
is installed. CI prefers `makeappx` from the Windows SDK because GitHub-hosted
Windows runners already have it.
