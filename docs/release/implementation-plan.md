# Strata — Prioritised Release Implementation Plan

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
| ⬜ **P0-10** | **Reconcile the model bundling contradiction** | `apps/desktop/public/models/manifest.json`, `packages/engine/src/inference/modelCatalog.ts`, `public/models/*.onnx` | P0-3 | `check-bundled-assets.mjs` passes | **High** | 3 h | No |
| ⬜ **P0-11** | **First green CI release build** | `.github/workflows/release.yml` | P0-10 | `workflow_dispatch` with `platforms: linux` produces a draft | Med | 2–4 h | Actions minutes |
| ⬜ **P0-12** | **Install-test the CI AppImage on a clean non-Arch VM** | — | P0-11 | Alpha checklist "Install verification" section | **High** | 3 h | No |

### P0-10 in detail — the one genuine blocker left

The two model catalogs disagree about roughly 1.2 GB of installer payload:

| Model | `manifest.json` | `modelCatalog.ts` | On disk | Real size |
|---|---|---|---|---|
| `ddcolor` | `bundled: false` | `bundled: true`, `acquisition.kind: 'bundled'`, `remoteUrl: ''` | LFS pointer | 980 MB |
| `ddcolor-tiny` | `bundled: false` | `bundled: true` | LFS pointer | 220 MB |
| `font-classify` | `bundled: true` | `bundled: false` | LFS pointer | 64 MB |

Whichever way it resolves, three things are currently true and cannot all stay
true: the engine expects `ddcolor` locally with **no remote fallback**; the file
is a pointer, so colorization cannot work; and if anyone runs `git lfs pull`
before building, the installer gains ~1.2 GB.

This is a **product decision, not a release-engineering one**, so it is left
open deliberately rather than resolved by guess. The options:

- **(a) Ship colorization.** Installer grows by ~1.2 GB. Flatly incompatible
  with the 4 GB RAM target and a reasonable download. Not recommended.
- **(b) Make the ddcolor models runtime-downloadable.** Set
  `acquisition.kind` to a download, give them real `remoteUrl` + `sha256`,
  and remove them from `public/`. Colorization becomes an opt-in download.
  **Recommended.**
- **(c) Cut colorization from v1.** Remove both models and gate the feature.
  Smallest installer, least work, honest.

`font-classify` is simpler: it is genuinely bundled and only 64 MB, so set
`bundled: true` in both places and fetch it in CI (already wired).

---

## P1 — blocks a public beta

| # | Task | Files | Depends on | Verification | Risk | Effort | Money |
|---|---|---|---|---|---|---|---|
| ⬜ P1-1 | Trim `ort-wasm` to the variants actually used (93 MB → est. 15–25 MB) | `scripts/copy-onnx-wasm.mjs`, `vite.config.ts` | — | Installer size drops; AI features still work | Med | 4 h | No |
| ⬜ P1-2 | Code-split the 10.1 MB main chunk | `apps/desktop/vite.config.ts` | — | No chunk over ~2 MB; startup measured on 4 GB RAM | Med | 6 h | No |
| ⬜ P1-3 | Windows build in CI + smoke test in a VM | `release.yml` | P0-11 | NSIS installs per-user and launches | **High** | 1–2 d | Actions minutes |
| ⬜ P1-4 | Linux MIME XML so `.strata` actually associates | `apps/desktop/src-tauri/linux/`, `tauri.conf.json` | — | Double-click opens a document on GNOME and KDE | Med | 3 h | No |
| ⬜ P1-5 | Verify `fileAssociations` on each OS | — | P1-3, P1-4 | Beta checklist | Med | 3 h | No |
| ⬜ P1-6 | Ubuntu LTS + Fedora VM test pass | — | P0-11 | Both launch, save, export, print-dialog opens | **High** | 1 d | No |
| ⬜ P1-7 | X11/XWayland pass (dev is Wayland-only) | — | — | Window, DnD, clipboard, HiDPI all behave | Med | 4 h | No |
| ⬜ P1-8 | Make the perf-budget test contention-proof | `packages/editor/src/**` | — | No flaky failure under parallel load | Low | 2 h | No |
| ⬜ P1-9 | Configure the `release-publish` environment + reviewer | GitHub settings | P0-11 | Publish job actually pauses | Low | 15 min | No |
| ⬜ P1-10 | Dependency/vulnerability scanning in CI | `.github/workflows/` | — | `cargo audit` + `pnpm audit` run and report | Low | 3 h | No |
| ⬜ P1-11 | Decide repository visibility | — | — | If public: Actions become free and `NOTICE` becomes accurate | Low | — | **Saves** money |

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
| ⬜ P3-1 | AUR `strata-desktop-bin` | ~1 h once an AppImage is published; cannot exist before |
| ⬜ P3-2 | Flathub submission | Best long-term Linux channel; weeks of review + sandbox work for printing and fonts |
| ⬜ P3-3 | Tauri updater, signed manifests, channels | Only after P2-4 — see `update-strategy.md` |
| ⬜ P3-4 | Crash reporting | Requires explicit opt-in consent UX first |
| ⬜ P3-5 | Linux ARM64 / Windows ARM64 | Only with hardware to test on |
| ⬜ P3-6 | Payment infrastructure | Merchant-of-record (Paddle/Lemon Squeezy) to avoid solo tax registration |
| ⬜ P3-7 | Provenance attestations for release artifacts | Free on public repos via `actions/attest-build-provenance` |

---

## Critical path to a first alpha

```
P0-10 (reconcile models)  →  P0-11 (green CI build)  →  P0-12 (VM install test)  →  alpha
```

Three tasks. None costs money. Roughly **1–2 days** of focused work, and P0-10 is
a decision more than an implementation.
