# Varve — Prioritised Release Implementation Plan

**Date:** 2026-08-04
**Status key:** ✅ done in this pass · ⬜ outstanding

Priorities are defined by what they unblock, not by effort:

- **P0** — blocks any external testing at all
- **P1** — blocks a public beta
- **P2** — blocks a stable release
- **P3** — post-launch

---

## P0 — blocks any external testing

| # | Task | Files | Depends on | Verification | Risk | Effort | Costs money |
|---|---|---|---|---|---|---|---|
| ✅ P0-1 | Retire `publish.yml`; its release job could never run | `.github/workflows/publish.yml` (removed), `release.yml` | — | `release.yml` is the only tag-triggered workflow | Low | 1 h | No |
| ✅ P0-2 | Version single-sourcing + tag/version CI gate | `scripts/release/version.mjs`, `release.yml` | — | `version.mjs verify v0.1.0` fails on mismatch | Low | 2 h | No |
| ✅ P0-3 | LFS-pointer guard + model catalog cross-check | `scripts/release/check-bundled-assets.mjs` | — | Currently fails, correctly, on 3 real defects | Low | 2 h | No |
| ✅ P0-4 | Checksums, release manifest, artifact verification | `scripts/release/{collect-artifacts,merge-manifests,verify-artifacts}.mjs` | P0-2 | Dry-run passed end-to-end | Low | 3 h | No |
| ✅ P0-5 | SBOM generation | `scripts/release/generate-sbom.mjs` | — | 1,324 components emitted | Low | 2 h | No |
| ✅ P0-6 | Draft-then-approve release pipeline | `.github/workflows/release.yml` | P0-1…P0-5 | Workflow validates; pins verified | Med | 4 h | No |
| ✅ P0-7 | Fix AppImage build (`NO_STRIP=1`) | `justfile`, `release.yml` | — | AppImage bundles instead of failing | Low | 1 h | No |
| ✅ P0-8 | Honest download page from generated manifest | `apps/website/src/pages/download.astro`, `src/data/release-manifest.json` | P0-4 | Renders "no release yet"; no invented data | Low | 3 h | No |
| ✅ P0-9 | Working website URLs; analytics off by default | `astro.config.mjs`, `Layout.astro`, `sitemap.xml.ts` | — | Builds correctly for Pages and custom domain | Low | 2 h | No |
| ✅ P0-10 | Reconcile the model bundling contradiction — resolved as runtime-download | `manifest.json`, `modelCatalog.ts`, `models-source/` | P0-3 | `check-bundled-assets.mjs` passes | High | 3 h | No |
| ✅ P0-13 | Fix CSP blocking 14 of 18 model downloads | `tauri.conf.json` | — | Every redirect target now allowed | **Critical** | 1 h | No |
| ✅ P0-14 | Remove the splash screen dead end | `tauri.conf.json`, `lib.rs`, `index.html`, `App.tsx` | — | Main window visible from start; boot errors rendered on screen | **High** | 3 h | No |
| ⬜ **P0-11** | **First green CI release build** | `.github/workflows/release.yml` | P0-10 | `workflow_dispatch` with `platforms: linux` produces a draft | Med | 2–4 h | Actions minutes |
| ⬜ **P0-12** | **Install-test the CI AppImage on a clean non-Arch VM** | — | P0-11 | Alpha checklist "Install verification" section | **High** | 3 h | No |

### P0-10 — RESOLVED as runtime download

All three contested models now download on demand, so every feature keeps
working and the installer stays small:

| Model | Was (manifest / catalog) | Now | Hosted |
|---|---|---|---|
| `ddcolor` 980 MB | `false` / `true` | `remote`, SHA-256 pinned | `models-v1` GitHub release |
| `ddcolor-tiny` 220 MB | `false` / `true` | `remote`, SHA-256 pinned | `models-v1` GitHub release |
| `font-classify` 64 MB | `true` / `false` | `remote`, SHA-256 pinned | HuggingFace (upstream) |

Checksums came from the Git LFS object ids, which *are* the SHA-256 of the file
content — nothing had to be recomputed or trusted.

The three files moved from `apps/desktop/public/models/` to `models-source/`.
Anything under `public/` is copied into `dist/` and embedded in the binary,
which is how a 980 MB model came to sit one `git lfs pull` away from every
installer.

Consequences beyond the fix itself:

- installer stays ~74 MB;
- every model download is SHA-256-verified on both the Rust and the JS path;
- **CI no longer needs Git LFS at all**, so the 10 GB/month LFS bandwidth
  constraint disappears rather than being rationed.

`scripts/release/publish-model-assets.mjs` uploads the two DDColor files to the
`models-v1` tag, verifying each against its pinned checksum first and refusing
to overwrite a published asset (clients pin those hashes).

**Remaining maintainer action:** run that script once, or colorization will
correctly report its model as unavailable.

### P0-13 — RESOLVED: CSP blocked 14 of 18 model downloads

Found by tracing a download end to end rather than reading configuration.
`connect-src` allowed `github.com` and `huggingface.co`, but both redirect:

```
huggingface.co/.../resolve/main/model.onnx -> us.aws.cdn.hf.co
github.com/.../releases/download/...       -> release-assets.githubusercontent.com
```

CSP is enforced against **every URL in a redirect chain**, so most optional
models could not be fetched at all. Only the four background-removal models
worked, because those route through the Rust IPC command (reqwest, not
CSP-bound). Lens Blur, AI Denoise, Select Subject, line art, colorization, OCR,
inpainting and frame interpolation were all affected.

Fixed by allowing `https://*.githubusercontent.com`, `https://*.huggingface.co`
and `https://*.hf.co` in both the production and dev CSP blocks.

### P0-14 — RESOLVED: the splash screen is gone

The main window started hidden and was revealed only when the frontend invoked
`close_splashscreen` after Home's data had loaded. Anything that stopped that
path completing left an unclosable splash with no error, no logs and nothing to
report — which is what a packaged build did.

A watchdog was tried first and worked, but it also proved the frontend never
mounts at all in the packaged WebView, so the splash was hiding a second bug as
well as being one.

The native splash window is **removed**. `main` is `visible: true`, so the
branded boot screen in `index.html` is what the user sees, and inline error
handlers there replace it with a readable, selectable error if the bundle throws
or never renders. `StartupLoader` then takes over with progress, a timeout and a
retry button. This removes the failure class instead of adding a timeout to it.

---

## P1 — blocks a public beta

| # | Task | Files | Depends on | Verification | Risk | Effort | Money |
|---|---|---|---|---|---|---|---|
| ⬜ P1-1 | Trim `ort-wasm` to the variants actually used (93 MB → est. 15–25 MB) | `scripts/copy-onnx-wasm.mjs`, `vite.config.ts` | — | Installer size drops; AI features still work | Med | 4 h | No |
| ⬜ P1-2 | Code-split the 10.1 MB main chunk | `apps/desktop/vite.config.ts` | — | No chunk over ~2 MB; startup measured on 4 GB RAM | Med | 6 h | No |
| ⬜ P1-3 | Windows build in CI + smoke test in a VM | `release.yml` | P0-11 | NSIS installs per-user and launches | **High** | 1–2 d | Actions minutes |
| ✅ P1-4 | Linux MIME XML so `.strata` actually associates | `linux/dev.varve.desktop.xml`, `tauri.conf.json` | — | Installed to `/usr/share/mime/packages/` by deb and rpm | Med | 3 h | No |
| ⬜ P1-5 | Verify `fileAssociations` on each OS | — | P1-3, P1-4 | Beta checklist | Med | 3 h | No |
| ⬜ P1-6 | Ubuntu LTS + Fedora VM test pass | — | P0-11 | Both launch, save, export, print-dialog opens | **High** | 1 d | No |
| ⬜ P1-7 | X11/XWayland pass (dev is Wayland-only) | — | — | Window, DnD, clipboard, HiDPI all behave | Med | 4 h | No |
| ⬜ P1-8 | Make the perf-budget test contention-proof | `packages/editor/src/**` | — | No flaky failure under parallel load | Low | 2 h | No |
| ⬜ P1-9 | Configure the `release-publish` environment + reviewer | GitHub settings | P0-11 | Publish job actually pauses | Low | 15 min | No |
| ⬜ P1-10 | Dependency/vulnerability scanning in CI | `.github/workflows/` | — | `cargo audit` + `pnpm audit` run and report | Low | 3 h | No |
| ✅ P1-11 | Repository visibility | — | — | Public since 2026-08-04, after a full-history secret audit. Actions free; `NOTICE` now accurate | Low | — | **Saved** money |

---

## P2 — blocks a stable release

| # | Task | Depends on | Risk | Effort | Money |
|---|---|---|---|---|---|
| ⬜ P2-1 | Microsoft Store enrolment (Individual vs Company decision) + MSIX packaging | P1-3 | High | 2–3 d | **$0** |
| ⬜ P2-2 | Acquire a Mac; launch and validate on real hardware | — | High | — | **~$500–800** |
| ⬜ P2-3 | Apple Developer Program, Developer ID signing, notarisation, stapling | P2-2 | High | 1 d | **~CAD $157/yr** |
| ⬜ P2-4 | Upgrade/downgrade/migration testing on all supported OSes | P1-3, P1-6 | High | 1 w | No |
| ⬜ P2-5 | Narrow IPC path scope from the whole home directory to a documents root | — | Med | 4 h | No |
| ⬜ P2-6 | Domain purchase + DNS + `SITE_URL` switch | — | Low | 2 h | **~CAD $24/yr** |
| ⬜ P2-7 | Retain debug symbols for crash triage | — | Low | 3 h | No |

---

## P3 — post-launch

| # | Task | Notes |
|---|---|---|
| 🟡 P3-1 | AUR `varve-desktop-bin` | PKGBUILD written and parses under `makepkg` (`packaging/aur/`); needs the real SHA-256 from a published `SHA256SUMS.txt` before submission |
| ⬜ P3-2 | Flathub submission | Best long-term Linux channel; weeks of review + sandbox work for printing and fonts |
| ⬜ P3-3 | Tauri updater, signed manifests, channels | Only after P2-4 — see `update-strategy.md` |
| ⬜ P3-4 | Crash reporting | Requires explicit opt-in consent UX first |
| ⬜ P3-5 | Linux ARM64 / Windows ARM64 | Only with hardware to test on |
| ⬜ P3-6 | Payment infrastructure | Merchant-of-record (Paddle/Lemon Squeezy) to avoid solo tax registration |
| ⬜ P3-7 | Provenance attestations for release artifacts | Free on public repos via `actions/attest-build-provenance` |

---

## Critical path to the first release

```
P0-11 (green CI build)  →  P0-12 (VM install test)  →  alpha
```

P0-10, P0-13 and P0-14 are done. The two remaining P0 items both need something
this workstation does not have:

- **P0-11** needs GitHub Actions minutes. `act` is installed but requires Docker
  or Podman, neither of which is present, so the workflow cannot be exercised
  locally. Trigger `release.yml` via `workflow_dispatch` with
  `platforms: linux`.
- **P0-12** needs a non-Arch VM. No `qemu`, `libvirt`, `docker` or `distrobox`
  on this machine. It must not be skipped: a package built here links against
  glibc 2.44 and cannot run on the Ubuntu 22.04 baseline, so **only the CI
  artifact is worth testing**.

Everything else on the critical path is complete.
