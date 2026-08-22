# Release Readiness Audit (2026-08-03)

**Audit date:** 2026-08-03
**Audited commit:** `23e04b75` (branch `master`)
**Auditor role:** release engineering / distribution
**Scope:** production build, packaging, signing, distribution, update, website, supply chain, licensing

> **Status: historical snapshot.** This audit describes the repository state at
> the audited commit. The "one blocker remains" paragraph in §0 (RB-6/RB-7 —
> the packaged app not reaching its UI) was resolved after this audit; the
> scorecard in §8 records both as **Fixed**, and `CHANGELOG.md` 0.1.0
> (2026-08-04) documents the fixes. Do not treat this document as current
> release guidance — use `docs/release/README.md` and the checklists.

> Every finding below cites a file and, where useful, a line or symbol. Claims made by
> existing repository documentation were **re-verified against current code** rather than
> taken at face value; where a document was stale, that is called out.

---

## 0. Headline answer

**Can the repository produce genuine production builds today?**
The *release* path now works: all three Linux formats build, artifacts are renamed,
checksummed, manifested, SBOM'd and verified, and a draft-then-approve pipeline exists.
Every release blocker found in the original audit has been fixed.

**One blocker remains, and it is not a release-engineering one: the packaged
application does not reach its UI.** A watchdog proved React never mounts in the
packaged WebView, even though the same `dist/` renders perfectly in Chromium.
Until that is resolved there is nothing worth releasing. See RB-6 and RB-7.

**The original headline finding** — builds not being reproducible between this
workstation and CI, with the CI artifact being the broken one — is fixed: no
bundled asset is LFS-tracked any more, so both produce the same thing.

---

## 1. Release blockers (RB) — must fix before any external distribution

### RB-1 — CI ships 133-byte Git LFS pointer files in place of AI models `CRITICAL` — FIXED

`.gitattributes:1` tracks `*.onnx` through Git LFS:

```
*.onnx filter=lfs diff=lfs merge=lfs -text
```

Three models are stored as LFS objects (`git lfs ls-files -s`):

| File | Pointer size on disk | Real size |
|---|---|---|
| `apps/desktop/public/models/font-classify.onnx` | 133 B | **64 MB** |
| `apps/desktop/public/models/ddcolor-tiny.onnx` | 134 B | **220 MB** |
| `apps/desktop/public/models/ddcolor.onnx` | 134 B | **980 MB** |

No workflow in `.github/workflows/` sets `lfs: true` on `actions/checkout`, and
`actions/checkout` defaults to **not** fetching LFS content. Therefore every CI-built
installer contains a 133-byte text file where a model should be:

```
version https://git-lfs.github.com/spec/v1
oid sha256:44aa3d46804aa55b7841a0eb6dcc9bb72badd6d01645e5c7448a70525655b7b6
size 64057660
```

`apps/desktop/public/models/manifest.json` marks `font-classify` as `"bundled": true`, so the
app expects a real model at `/models/font-classify.onnx`. Nothing in the codebase detects a
pointer file, so the failure surfaces at runtime as an ONNX parse error, not a clear message.

**Second-order defect (reproducibility):** the same `just package-linux` command produces
*radically* different artifacts depending on whether the operator has ever run `git lfs pull`.
With LFS content present, `ddcolor.onnx` (980 MB) sits in `apps/desktop/public/`, and Vite copies
everything in `public/` into `dist/` verbatim — so the installer would balloon by roughly 1.2 GB.
`ddcolor` and `ddcolor-tiny` are marked `"bundled": false` in the manifest yet are physically
staged in `public/`, which is the one directory whose contents *always* ship.

**Fixed.** All three LFS models moved out of `public/` to `models-source/` and made
runtime-downloadable with pinned checksums (see RB-1b), and
`scripts/release/check-bundled-assets.mjs` fails the build if any file under
`models/` begins with the LFS pointer magic. Because no bundled model is
LFS-tracked any more, **CI does not need Git LFS at all** — the 10 GB/month
bandwidth constraint is gone rather than rationed.

### RB-2 — The release job can never run `CRITICAL`

`.github/workflows/publish.yml:213` — the `release` job declares
`needs: [bundle, aur-validate]`. The `aur-validate` job (line 168) does:

```yaml
chown -R builder:builder dist/aur
...
cd dist/aur/strata-desktop
```

`dist/aur/` **does not exist in the repository**, and `dist` is gitignored
(`.gitignore:12`). `aur-validate` therefore fails at the `chown` step on every run, and because
`release` needs it, **no GitHub Release is ever created** — the workflow burns a full
three-OS bundle matrix and then stops.

`just aur-validate` (`justfile`) has the same defect via the Docker volume mount.

The AUR PKGBUILDs are specified only as an unimplemented code block in
`docs/plans/archived/session-04-packaging.md:110` — that plan was never executed.

**Remediation:** remove the hard `aur-validate` dependency from `release` (AUR is a
post-release publishing step, not a release gate), and defer AUR packaging until there is a
published AppImage for `strata-desktop-bin` to point at. Blocks: **alpha**.

### RB-3 — Version is `0.0.0` everywhere and nothing enforces tag agreement `HIGH`

| File | Field | Value |
|---|---|---|
| `package.json:3` | `version` | `0.0.0` |
| `Cargo.toml` (`[workspace.package]`) | `version` | `0.0.0` |
| `apps/desktop/src-tauri/Cargo.toml:3` | `version` | `0.0.0` |
| `apps/desktop/src-tauri/tauri.conf.json:4` | `version` | `0.0.0` |
| `apps/website/public/releases.json` | `latest.version` | `0.0.0` |

`publish.yml` triggers on `v[0-9]+.[0-9]+.[0-9]+` tags but never compares the tag to the
application version. Tagging `v0.1.0` today produces installers that identify themselves as
`0.0.0`, a `Strata Desktop_0.0.0_amd64.deb` filename, and an About dialog showing `0.0.0`.
Upgrade logic in every package manager (deb/rpm/MSI) depends on a monotonic version; shipping
`0.0.0` twice makes upgrades undefined.

**Remediation:** single-source the version and add a CI gate that fails when tag ≠ manifest
version. Implemented in this work — see §6. Blocks: **alpha**.

### RB-1b — The two model catalogs contradict each other `CRITICAL` — FIXED

Discovered while building the guard for RB-1. Two independent sources describe
what ships, and they disagree about roughly **1.2 GB** of installer payload:

| Model | `apps/desktop/public/models/manifest.json` | `packages/engine/src/inference/modelCatalog.ts` | On disk | Real size |
|---|---|---|---|---|
| `ddcolor` | `bundled: false` | `bundled: true`, `acquisition.kind: 'bundled'`, `remoteUrl: ''` | LFS pointer | 980 MB |
| `ddcolor-tiny` | `bundled: false` | `bundled: true` | LFS pointer | 220 MB |
| `font-classify` | `bundled: true` | `bundled: false` | LFS pointer | 64 MB |

Three things are currently true and cannot all remain true: the engine expects
`ddcolor` at `/models/ddcolor.onnx` with **no remote fallback**
(`modelCatalog.ts:610` — `remoteUrl: ''`); the file is a pointer, so colorization
cannot work at all; and if anyone runs `git lfs pull` before building, the
installer silently gains ~1.2 GB.

Which of the two catalogs "wins" depends on which code path reads first, so the
behaviour is not even consistent within one build.

**Fixed.** All three are now `acquisition.kind: 'remote'` in both catalogs, with
SHA-256 values recovered from the Git LFS object ids (which *are* the content
hash). DDColor is hosted on a dedicated `models-v1` GitHub release
(`scripts/release/publish-model-assets.mjs`); `font-classify` uses its existing
upstream. Colorization and font identification keep working, the installer stays
~74 MB, and `check-bundled-assets.mjs` fails on any future disagreement.

### RB-5 — CSP blocked 14 of 18 optional model downloads `CRITICAL` — FIXED

Found by tracing a download end to end instead of reading configuration.
`apps/desktop/src-tauri/tauri.conf.json` `connect-src` allowed `github.com` and
`huggingface.co`, but neither serves the payload itself:

```
huggingface.co/.../resolve/main/model.onnx -> us.aws.cdn.hf.co
github.com/.../releases/download/...       -> release-assets.githubusercontent.com
```

CSP is enforced against **every URL in a redirect chain**, so the fetch died at
the redirect. Verified with `curl -sIL` against both hosts.

Only the four background-removal models worked, because
`packages/engine/src/backgroundRemoval/modelLoader.ts` routes those through the
Rust IPC command `download_background_removal_model` (reqwest, not CSP-bound).
Everything reached via `packages/engine/src/inference/core/DownloadManager.ts` —
Lens Blur, AI Denoise, Select Subject, line art, colorization, OCR, inpainting,
frame interpolation — used `fetch()` and failed.

**Fixed** by allowing `https://*.githubusercontent.com`,
`https://*.huggingface.co` and `https://*.hf.co` in both CSP blocks.

Worth recording: both download paths *do* verify SHA-256 (Rust via `sha2`, JS
via `crypto.subtle`), and all 18 downloadable models are pinned. The guard in
`scripts/release/check-bundled-assets.mjs` now fails the build if a model gains
a `remoteUrl` without a checksum, or over plain HTTP.

### RB-6 — The splash screen was a startup dead end `CRITICAL` — FIXED

Reported from the packaged AppImage: it launches and sits on the splash forever.

`main` was configured `visible: false` and revealed only when the frontend
invoked `close_splashscreen` — from `App.tsx`'s `handleHomeReady`, i.e. *after*
Home's data finished loading. Anything that stopped that path completing left an
unclosable native window with no error, no logs, and nothing for a user to
report. `useStartup`'s existing stuck-startup timeout could not help: it only
changes React state inside the window that is still hidden.

A Rust watchdog was added first and worked — it fired exactly as designed:

```
[strata] Frontend did not signal readiness within 10000ms — revealing the
         main window anyway so the startup error is visible.
```

That also proved a second, deeper defect: a reveal-on-mount effect never fired
either, so **React does not mount at all in the packaged WebView**. The frontend
itself is healthy — serving the built `dist` in Chromium renders Home with full
navigation, zero console errors, and a working New-document dialog.

**Fixed** by removing the native splash entirely. `main` is now `visible: true`,
the branded boot screen lives in `index.html` inside it, and inline error
handlers there render a readable, selectable error if the bundle throws or never
renders. `StartupLoader` takes over once React mounts.

The mount failure itself is tracked separately — the splash was hiding it, not
causing it.

### RB-8 — The documented Linux baseline was unachievable `HIGH` — FIXED

Measured with `just verify-packages`, which installs the built `.deb` into a
clean `ubuntu:22.04` container:

```
glibc available on Ubuntu 22.04 : 2.35
glibc required by the binary    : GLIBC_2.39
/usr/bin/strata-desktop: /lib/x86_64-linux-gnu/libc.so.6:
    version `GLIBC_2.39' not found (required by /usr/bin/strata-desktop)
```

Two things came out of this that the earlier, assumption-based version of this
audit got wrong:

1. **The floor is 2.39, not 2.44.** A binary inherits the highest glibc symbol
   version it actually references, not the build host's full version. The
   original text implied the latter.
2. **`ubuntu-latest` would not have fixed it.** That runner is Ubuntu 24.04,
   which is glibc 2.39 — the identical floor. Every Linux artifact `release.yml`
   produced would have excluded Ubuntu 22.04 LTS, Debian 12 and Fedora 38 while
   the platform matrix advertised 22.04 support.

**Fixed** by pinning the Linux bundle job to the `ubuntu-22.04` runner, which
sets the floor at glibc 2.35.

The `.deb` itself installs cleanly on 22.04 with every declared dependency
resolving from Ubuntu's own repositories, and uninstalls cleanly — so the
`depends` list in `tauri.conf.json` is correct. Only the glibc floor was wrong.

### RB-4 — No checksums, no release manifest, no SBOM `HIGH`

`publish.yml` uploads bundles straight to a draft release. There is no SHA-256 generation, no
manifest, no SBOM, and no post-upload verification against the files actually attached.

The website already promises otherwise:
- `apps/website/src/pages/download.astro:158` — "SHA256 checksums will be available for all downloads"
- `apps/website/src/pages/about/security.astro:39` — "SHA256 checksums for all build artifacts"

`apps/website/public/releases.json` `integrity.checksums` is `false`, so the site is at least
internally honest, but the two prose claims are forward-looking promises on a page a user reads
*while deciding whether to trust a download*. Blocks: **alpha**.

---

## 2. High-severity findings (not alpha blockers, but beta blockers)

### H-1 — Website is configured for a domain that is not owned, and loads paid analytics

`apps/website/astro.config.mjs:7` sets `site: 'https://strata.design'` with `base: '/'`.
Deployed to GitHub Pages for a project repo the real URL is
`https://k-arthur.github.io/Strata/`, so with `base: '/'` **every absolute asset path 404s**
and every canonical URL, sitemap entry, and `og:url` points at a domain that does not resolve.

`apps/website/src/layouts/Layout.astro:40` unconditionally loads Plausible Analytics:

```html
<script is:inline defer data-domain="strata.design" src="https://plausible.io/js/script.js"></script>
```

Plausible is a **paid** service. This is a recurring cost (~USD $9/mo entry tier) providing
zero value before launch, it is hardcoded rather than opt-in, and it is pointed at a domain
that does not exist so it would not report anything anyway. The privacy policy
(`about/privacy.astro:14`) already describes Plausible as active, which would be inaccurate
either way. Blocks: **beta**.

### H-2 — `download.astro` ignores `releases.json` entirely

`apps/website/public/releases.json` is a 130-line hand-maintained file describing versions,
per-platform artifacts and sizes. `apps/website/src/pages/download.astro` **never imports or
reads it** — every download control is a hardcoded `<a href=".../releases">Get it on GitHub</a>`
(lines 38, 47, 56, 94, 123, 132). The only consumer of `releases.json` is
`apps/website/src/test/releases.test.ts`, which asserts that hand-written data is well-formed.

Consequences: the advertised sizes (`~200 MB`, `~250 MB`, …) are guesses that were never
measured; `platforms.linux.x86_64.aur.command` advertises `yay -S strata-desktop`, a package
that **does not exist** (see RB-2); and the site claims macOS and Windows availability although
neither has ever been built. This is exactly the "fragile manual duplication" a generated
manifest must replace. Blocks: **beta**.

### H-3 — macOS universal build ships an ARM-only inference library

`publish.yml:104` builds `--target universal-apple-darwin`, and
`apps/desktop/src-tauri/tauri.conf.json:110` bundles `onnxruntime-libs/**/*` as a resource.
`scripts/fetch-onnxruntime.mjs` `PLATFORMS` has no `macos-x86_64` entry — its own comment says:

> Not bundled: macOS Intel (osx-x64 has no CPU-only asset in this release line)

So a "universal" DMG contains a universal Rust binary plus an **arm64-only**
`libonnxruntime.dylib`. On Intel Macs the native AI path silently degrades to the WASM/heuristic
fallback. That is a *survivable* degradation (the code is written for it — `native_ai_ready()`
reports unavailable), but shipping a binary advertised as universal whose accelerated path only
works on half the target hardware needs to be stated, not discovered. Blocks: **beta** (as a
documentation/claim accuracy issue).

### H-0 — AppImage bundling fails outright on Arch/CachyOS `HIGH` — FIXED

`pnpm tauri build --bundles appimage` failed on this machine with only:

```
failed to bundle project: `failed to run linuxdeploy`
```

Tauri surfaces no cause. Invoking linuxdeploy directly against the staged AppDir
gives the real one, for every bundled system library:

```
ERROR: Strip call failed: strip: libzstd.so.1: unknown type [0x13] section `.relr.dyn'
```

linuxdeploy 1-alpha (git `659c9db`, built 2024-07-26) ships its own binutils
`strip`, which predates `SHT_RELR`. Every system library on a current Arch host
has a `.relr.dyn` section, so the strip step fails for all of them and
linuxdeploy aborts.

**Fixed** by setting `NO_STRIP=1` in `justfile` (`package-linux`,
`package-appimage`) and in `release.yml`'s Tauri build step. The cost is
negligible: the Varve binary is already stripped by
`[profile.release] strip = true`, and distro libraries ship stripped.

Worth noting what this *also* proves: the AppImage bundler copies **this host's**
libraries into the bundle. An AppImage built on CachyOS carries glibc 2.44 and
cannot run on the Ubuntu 22.04 baseline. Local AppImages are smoke-test
artifacts; release AppImages must come from the `ubuntu-latest` runner.

### H-0b — 73% of the Linux package's resources are foreign-OS libraries `HIGH` — FIXED

Found by inspecting an actual `.deb` rather than trusting the configuration.
`tauri.conf.json` bundles `resources: ["onnxruntime-libs/**/*"]` — an unscoped
glob over a directory that `scripts/fetch-onnxruntime.mjs` fills one
subdirectory at a time, per platform, and never cleans.

A 74 MB `.deb` built on this machine contained:

| Resource | Size | Usable on Linux? |
|---|---|---|
| `linux-x86_64/libonnxruntime.so` | 23.7 MB | yes |
| `macos-aarch64/libonnxruntime.dylib` | 38.5 MB | **no** |
| `windows-x86_64/onnxruntime.dll` | 15.4 MB | **no** |

**53.9 MB of dead weight** — more than the useful payload. A CI runner only ever
fetches its own platform, so CI builds happened to be correct; but the bundle
contents depended on what was staged rather than on what the target needs, which
is exactly the class of difference that makes a local build and a CI build
disagree.

**Fixed** by `scripts/release/prune-foreign-runtimes.mjs`, wired into every
`just package-*` recipe and into `release.yml` before the Tauri build.

### H-0c — The app installs into the application menu twice `HIGH` — FIXED

The same `.deb` shipped **two** desktop entries:

| File | `Name=` | Origin |
|---|---|---|
| `/usr/share/applications/Strata Desktop.desktop` | `Strata Desktop` | Generated by Tauri from `desktopTemplate` |
| `/usr/share/applications/dev.strata.desktop.desktop` | `Strata` | Explicit `files` mapping in `tauri.conf.json` |

Both point at the same `Exec` and `Icon`, so after installing, a user sees
Strata listed twice in their launcher under two different names.

**Fixed** by removing the redundant `files` mapping from the deb, rpm and
AppImage configurations; Tauri's generated entry is the single source.

Follow-up worth considering separately: `productName` is `"Strata Desktop"`, so
the surviving menu entry reads "Strata Desktop" rather than "Strata". Renaming
`productName` also changes the deb package name and install paths, so it is a
deliberate product decision rather than a packaging fix, and is left alone here.

### H-4 — `bundle.targets: "all"` is non-deterministic

`apps/desktop/src-tauri/tauri.conf.json:106`. `"all"` means "whatever this Tauri version's
bundler supports on this host", which changes with Tauri upgrades and host tooling. Release
artifact sets must be explicit. The workflows do override with `--bundles`, so the practical
risk is limited to local `just`/manual builds, but the config is the wrong default for a
release-bearing repo. Blocks: **beta**.

### H-5 — Private repository + three-OS bundle matrix on every push

The repository is **private** (`gh repo view` → `"visibility": "PRIVATE"`).
`.github/workflows/build.yml:5` triggers on every push to `main`/`master`/`feat/*` and every PR,
and runs a **full `tauri build --ci` release bundle on ubuntu, macos and windows**
(`build.yml:157`).

GitHub Actions on private repos consumes the account's included minutes (2,000/mo Free,
3,000/mo Pro) with **macOS billed at 10× and Windows at 2×** the Linux rate. A single
three-OS cold Tauri release build is realistically 25–40 min per runner; with the macOS
multiplier that is on the order of **400–600 billed minutes per push**. Three or four pushes
exhaust a Free account's entire monthly allowance.

This is the largest *avoidable* cash risk in the repo, and it is spending money to rebuild
release bundles on PRs that will never be released. Blocks: **beta** (cost containment).

### H-6 — `.strata` files cannot be opened by double-click on any platform

`apps/desktop/src-tauri/linux/dev.strata.desktop.installed.desktop` declares
`MimeType=application/x-strata;` and `Exec=strata-desktop %F`, but:

- no MIME XML package is installed (nothing under `/usr/share/mime/packages/`), so
  `application/x-strata` is never associated with the `.strata` extension;
- `tauri.conf.json` has **no `fileAssociations` key**, so Windows and macOS register nothing.

The document extension is `.strata` (`packages/platform/src/tauri.ts:535`). The feature is
half-wired: the desktop entry advertises it, the OS never learns about it. Blocks: **beta**.

---

## 3. Medium findings

### M-1 — `fetch-onnxruntime.mjs` extracts before it verifies

`scripts/fetch-onnxruntime.mjs` — the archive checksum is compared **after**
`extractFromTarGz`/`extractFromZip` have already run `tar`/`unzip` on the downloaded bytes and
after the extracted library has been written to `destFile`. The mismatch path does delete the
staged file and `process.exit(1)`, so a bad library is not *left* in place — but an attacker
controlling the download would get an archive extractor invoked on their bytes before any
integrity check. Verify the buffer hash first, then extract. Effort: ~15 min.

### M-2 — Bundled-model attribution is incomplete

`THIRD_PARTY_NOTICES:127-151` attributes exactly four ONNX models: `u2netp`, `u2netp-int8`,
`realesr-general-x4v3`, `realesr-general-x4v3-int8`. But `apps/desktop/dist/models/` also ships
`font-classify.onnx` (manifest: `"bundled": true`, `sourceLicense: MIT`, source
`huggingface.co/storia/font-classify-onnx`) plus the two `ddcolor` files. None of these three
appear in `THIRD_PARTY_NOTICES`. Every model in `manifest.json` also carries
`"provenanceStatus": "unverified"`.

Fixing RB-1 removes the `ddcolor` half of this problem by moving them out of `public/`.
`font-classify` genuinely ships and genuinely needs an attribution entry.

### M-3 — Broad `fs` capability and home-directory-wide IPC path scope

`apps/desktop/src-tauri/capabilities/default.json` grants `fs:allow-read` and `fs:allow-write`.
`docs/quality/tauri-command-audit.md` records `write_binary_file`, `read_dropped_file`,
`home_read_text_file` and `home_write_text_file` as **CRITICAL arbitrary file read/write**.

**Verified against current code — the doc is stale; these are fixed.** All four now route
through `resolve_user_path()` (`apps/desktop/src-tauri/src/lib.rs`, 20 call sites), which
rejects NUL bytes, rejects `.`/`..` lexically for not-yet-existing paths, canonicalises, and
requires the result to sit under the user's home directory or the temp directory.

Residual risk: the allowlist root is the **whole home directory**, so webview JS could still
reach `~/.ssh/id_rsa`. Given the webview loads only local content under a strict CSP
(`tauri.conf.json` `app.security.csp`, `object-src 'none'`, `frame-src 'none'`), this is a
defence-in-depth gap rather than a live vulnerability. Recommend narrowing to a documents
root before stable. Not an alpha blocker.

### M-4 — No updater, no update key, no channels

`tauri.conf.json` has no `plugins.updater` block and `apps/desktop/src-tauri/Cargo.toml` has no
`tauri-plugin-updater` dependency. There is no signing key, no manifest endpoint, no channel
concept.

For a first release this is the **correct** state — see `docs/release/update-strategy.md`.
Recorded here so it is a decision rather than an oversight.

### M-5 — Perf-budget unit test fails under parallel load

`pnpm test` — `benchmark — 10K nodes > computes diff for 10,000 nodes quickly (<50ms)` failed at
114.86 ms while a `cargo build` was saturating the CPU on the same machine. This is a wall-clock
budget assertion with no isolation, so it is contention-sensitive rather than a genuine
regression. It is nonetheless a **release-gate hazard**: a shared CI runner will trip it
non-deterministically. Recommend converting to a relative/statistical budget or excluding it
from the release gate.

---

## 4. What is in good shape

Worth recording, because it means the remaining work is bounded:

| Area | Evidence |
|---|---|
| Frontend production hygiene | No source maps in `apps/desktop/dist` (0 `*.map`); no `/home/kevina` absolute paths in any bundled asset; esbuild minification on (`apps/desktop/vite.config.ts` `build.minify`) |
| No dev-only code leaking | No `debug_assertions` branches, no `localhost` references, no `open_devtools` calls in `apps/desktop/src-tauri/src/*.rs` |
| Windows console suppressed | `apps/desktop/src-tauri/src/main.rs:2` — `#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]` |
| Release profile | `Cargo.toml` `[profile.release]` — `opt-level = 3`, `lto = "thin"`, `codegen-units = 1`, `strip = true` |
| CSP | Strict, explicit, `object-src 'none'`, `frame-src 'none'`, `form-action 'none'` |
| Path traversal | `resolve_user_path()` — canonicalising allowlist, with tests |
| CI action pinning | All third-party actions pinned to full commit SHAs, with `scripts/pin-github-actions.mjs` enforcing it |
| Icons | Complete hicolor set 16→1024 + scalable + symbolic, `.icns`, `.ico`, Windows Store logos |
| Linux packaging metadata | Correct `.desktop` entry, `StartupWMClass` matching the app id, explicit deb/rpm dependency lists |
| Licensing | FSL-1.1-MIT applied consistently across `LICENSE`, `NOTICE`, workspace manifests; decision recorded in `docs/licensing/review.md` |
| Model integrity | Every model in `manifest.json` carries a pinned `sha256`; ORT download is checksum-pinned |
| Typecheck / lint | `pnpm typecheck` exit 0; `pnpm lint` exit 0 (48 non-blocking warnings) |

---

## 5. Release-readiness scorecard

Severity: `C` critical · `H` high · `M` medium · `L` low
Blocks: earliest release tier the item prevents.

| # | Area | Status | Evidence | Sev | User impact | Remediation | Blocks |
|---|---|---|---|---|---|---|---|
| RB-1 | AI models in CI | **Broken** | `.gitattributes:1`; no `lfs:` in any workflow | C | Font-classification feature dead in every CI build; installer size non-deterministic by ±1.2 GB | Targeted `git lfs pull` in CI (done); pointer guard (done); reconcile catalogs (P0-10) | Alpha |
| RB-1b | Model catalogs disagree | **Fixed** | `manifest.json` vs `modelCatalog.ts` for 3 models | C | ~1.2 GB of installer contents undefined; colorization cannot work | All three now runtime-downloaded, SHA-256 pinned | Alpha |
| H-0 | AppImage on Arch | **Fixed** | linuxdeploy `strip` cannot parse `.relr.dyn` | H | No Linux package could be built locally at all | `NO_STRIP=1` in `justfile` + `release.yml` | Alpha |
| RB-2 | Release job | **Broken** | `publish.yml:213` needs `aur-validate`; `dist/aur` absent + gitignored | C | No release is ever produced; CI minutes burned for nothing | Drop AUR from release gate; defer AUR packaging | Alpha |
| RB-3 | Versioning | **Broken** | `0.0.0` in 5 manifests; no tag check in `publish.yml` | H | Installers self-identify as `0.0.0`; upgrades undefined | Single-source version + CI tag gate | Alpha |
| RB-4 | Integrity | **Fixed** | No checksum/SBOM/manifest step in `publish.yml` | H | Users cannot verify an unsigned download — the one mitigation that costs nothing | Generate + verify SHA-256, manifest, SBOM | Alpha |
| RB-5 | Model downloads | **Fixed** | CSP vs CDN redirect targets | C | 14 of 18 optional models undownloadable; 8+ AI features dead | Allow redirect hosts in CSP | Alpha |
| RB-6 | Startup | **Fixed** | `main` hidden until frontend signalled | C | App unusable — stuck on splash forever with no error | Splash removed; boot errors rendered on screen | Alpha |
| RB-7 | React mount | **Fixed** | Static import of eval-using wawoff2 in the entry chunk | C | App never reached its UI when packaged | Dynamic import; entry chunk now eval-free | Alpha |
| RB-8 | Linux glibc baseline | **Fixed** | Measured: binary needs GLIBC_2.39, Ubuntu 22.04 has 2.35 | H | Advertised 22.04 support no artifact could deliver | Build Linux artifacts on the `ubuntu-22.04` runner | Alpha |
| H-1 | Website config | **Broken** | `astro.config.mjs:7`; `Layout.astro:40` | H | Site 404s its own assets on Pages; pays for analytics pre-launch | Env-driven `site`/`base`; opt-in analytics | Beta |
| H-2 | Download page | **Stale** | `download.astro` never reads `releases.json` | H | Advertises unbuilt platforms and a non-existent AUR package | Consume generated manifest | Beta |
| H-3 | macOS universal | **Partial** | `fetch-onnxruntime.mjs` `PLATFORMS`; `publish.yml:104` | H | Intel Macs lose native AI silently | Document; or ship per-arch DMGs | Beta |
| H-4 | Bundle targets | **Fragile** | `tauri.conf.json:106` `"targets": "all"` | H | Artifact set varies with toolchain | Enumerate targets explicitly | Beta |
| H-5 | CI cost | **Resolved** | `build.yml`; repo made public 2026-08-04 | H | Free Actions allowance exhausted in ~3 pushes | Workflow split + public repo: runners now free and unmetered | Beta |
| H-6 | File associations | **Fixed** | No `fileAssociations`; no shared-mime-info XML | H | Double-clicking a `.strata` file does nothing | `fileAssociations` added; MIME XML installed by deb/rpm | Beta |
| M-1 | ORT supply chain | **Weak** | `fetch-onnxruntime.mjs` verify-after-extract | M | Extractor runs on unverified bytes | Hash buffer before extraction | Beta |
| M-2 | Model attribution | **Incomplete** | `THIRD_PARTY_NOTICES:127-151` vs `dist/models/` | M | Licence obligations unmet for a shipped artifact | Add `font-classify` entry | Beta |
| M-3 | IPC scope | **Acceptable** | `resolve_user_path()` verified fixed; home-wide root | M | Defence-in-depth gap only | Narrow to documents root | Stable |
| M-4 | Updater | **Absent** | No `plugins.updater`; no key | M | Manual updates only (intended for v1) | Deliberate — see update strategy | Stable |
| M-5 | Perf gate | **Flaky** | 114.86 ms vs 50 ms budget under load | M | Non-deterministic release-gate failures | Relative budget or exclude from gate | Beta |
| — | Signing (all OS) | **Absent** | No cert, no notarisation, no secrets | H | SmartScreen / Gatekeeper friction | Budgeted — see budget plan | Stable |
| — | Windows/macOS builds | **Unverified** | Never successfully executed | H | Unknown platform-specific failures | Run tag-gated CI once | Beta |

---

## 6. Phase 1 command results (this machine, 2026-08-03)

CachyOS Linux, kernel 7.1.5, Wayland. Node v26.4.0, pnpm 11.9.0, rustc 1.97.1,
tauri-cli 2.11.3, webkit2gtk-4.1 2.52.5, glibc 2.44.

| Command | Result | Notes |
|---|---|---|
| `pnpm install --frozen-lockfile` | **PASS** | Lockfile is consistent; no drift |
| `pnpm lint` | **PASS** | 48 warnings, 0 errors, exit 0 |
| `pnpm typecheck` | **PASS** | Exit 0 across all workspace packages + e2e tsconfig |
| `pnpm test` | **1 failure** | `computes diff for 10,000 nodes quickly (<50ms)` → 114.86 ms under parallel `cargo build` load (M-5) |
| `cargo build --release` (via Tauri) | **PASS** | 38m 47s cold; 71 MB binary |
| `pnpm tauri build --bundles appimage` | **FAILED → FIXED** | linuxdeploy `strip` cannot parse `.relr.dyn` (H-0). With `NO_STRIP=1`: **PASS**, 165 MB AppImage |
| `pnpm tauri build --bundles deb,rpm` | **PASS** | 74 MB deb, 74 MB rpm. rpm compression alone took ~10 min single-threaded |
| AppImage launch smoke test | **PASS** | Mounted, launched, stayed up 8 s with no error output (Wayland) |

### Release tooling, verified against the real artifacts

```
Strata-0.1.0-linux-x86_64.AppImage   172.6 MB   f58af3b5565851a9…
Strata-0.1.0-linux-x86_64.deb         73.9 MB   64984b3754fd01f1…
Strata-0.1.0-linux-x86_64.rpm         73.9 MB   9f7a743794fc59d4…
```

`collect-artifacts` → `verify-artifacts` → `release-notes` all pass, and an
independent `sha256sum -c SHA256SUMS.txt` reports OK for all three. SBOM
generation produces 1,324 components.

**All three Linux package formats now build, and the acceptance criterion "at
least one viable Linux package can be generated and tested" is met** — with the
standing caveat that these were built on glibc 2.44 and are therefore
smoke-test artifacts, not release candidates.

**Undocumented system dependencies discovered:** none for the Linux build on CachyOS —
`webkit2gtk-4.1`, `gtk3`, `librsvg`, `openssl`, `fontconfig` were already present. The Ubuntu
package list in `publish.yml` is complete for a clean runner. `patchelf` is required for
AppImage and is installed in `publish.yml` but **not** in the `gate` job's dependency list
(harmless — that job does not bundle).

**Build-time network downloads:** two, both in `postinstall`
(`package.json:12`): `scripts/copy-onnx-wasm.mjs` (local copy, no network) and
`scripts/fetch-onnxruntime.mjs` (downloads ~25 MB from `github.com/microsoft/onnxruntime`
releases, checksum-pinned to ORT 1.27.1). AppImage bundling additionally downloads
`linuxdeploy` tooling at build time — a network dependency of the Tauri bundler itself, not of
this repo.

**Required-but-undocumented environment variables:** none found. `VITE_BASE_URL`,
`TAURI_DEBUG` and `TAURI_PLATFORM` are all optional with sane defaults
(`apps/desktop/vite.config.ts`).

**Secrets in source:** none. Grep for tokens/keys/endpoints found no embedded credentials.
`.gitignore` excludes `.env*` (except `.env.example`) and `.act-secrets`.

---

## 7. Estimated remediation effort

| Item | Effort | Costs money? |
|---|---|---|
| RB-1 LFS / model staging | 2–3 h | No |
| RB-2 release job dependency | 15 min | No |
| RB-3 version single-sourcing + gate | 2 h | No |
| RB-4 checksums + manifest + SBOM | 3–4 h | No |
| H-1 website config | 1 h | No |
| H-2 manifest-driven download page | 2–3 h | No |
| H-3 macOS arch decision | 1 h (docs) / 3 h (split DMGs) | No |
| H-4 explicit bundle targets | 15 min | No |
| H-5 CI cost restructuring | 2 h | Saves money |
| H-6 file associations | 2–3 h + per-OS testing | No |
| M-1/M-2/M-5 | 1–2 h total | No |
| Windows/macOS first green build | Unknown — 1–2 days of CI iteration | Actions minutes |
| Signing + notarisation | 1 day | **Yes** — see budget plan |

**Total to a credible Linux alpha: roughly 2–3 focused days**, none of it requiring payment.
