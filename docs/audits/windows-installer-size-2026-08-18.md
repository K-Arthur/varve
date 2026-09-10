# Windows Installer Size Investigation — 2026-08-18

Mission: explain the Windows installer's size **from actual packaged bytes**,
then optimize only where the evidence supports a safe improvement. This audit
measures the released v0.1.2 artifact (the bytes users actually downloaded),
evaluates strategies against the supported toolchain, and records the two
accepted optimisations plus the new size regression gate.

## 1. Methodology

The released `Varve-0.1.2-windows-x86_64.exe` (263,742,332 bytes) and
`Varve-0.1.2-windows-aarch64.exe` (236,738,619 bytes) were downloaded from the
GitHub release and decomposed with 7-Zip (`7z l -slt`), which reads the NSIS
solid-LZMA archive. The embedded `varve-desktop.exe` was inspected with
7-Zip's PE parser (`7z l` tables), byte scans for embedded-asset markers, and
Tauri 2.11's bundler/embed source
(`tauri-utils-2.9.3/src/assets.rs` — embedded frontend assets are
**brotli-compressed** into the binary). Frontend `dist/` was rebuilt locally
and each directory compressed with brotli (`-q 9`) to estimate the embedded
cost of each asset group.

Checksums of the downloaded installers match the published
`SHA256SUMS.txt` (x64
`b2405f5a…`, aarch64 `f4310ad2…`).

## 2. Byte breakdown — Windows x86_64 (v0.1.2, actual bytes)

| Component | Uncompressed | Compressed (in installer) | Share of task |
|---|---|---|---|
| `$TEMP/MicrosoftEdgeWebView2RuntimeInstaller.exe` — Microsoft Evergreen **WebView2 standalone installer** (Tauri `offlineInstaller` mode; EdgeUpdate payload confirmed by `SOFTWARE\Microsoft\EdgeUpdate` manifest) | 212,668,624 (202.8 MB) | ~202 MB (already-compressed; LZMA gains ~nothing) | **76.9%** |
| `varve-desktop.exe` — Rust binary (21.8 MB code) + brotli-embedded frontend `dist/` (see §4) | 66,729,984 (63.6 MB) | ~63 MB | 23.9% |
| `onnxruntime-libs/windows-x86_64/onnxruntime.dll` — ONNX Runtime 1.27.1 CPU-only | 15,383,864 (14.7 MB) | ~14 MB | 5.5% |
| `uninstall.exe` + NSIS plugins/stub (System, nsDialogs, nsis_tauri_utils, StartMenu; headers 75.7 KB + stub 52.7 KB) | ~115 KB | ~0.1 MB | <0.1% |
| **Payload total** | 294,878,602 (281.2 MB) | 263,689,592 | 100% |

Installer filesystem overhead: 263,742,332 − 263,689,592 = ~52 KB. NSIS
compression is already solid LZMA (`Method = LZMA:23`, `Solid = +`); there is
no exposed compression knob in the Tauri NSIS config and no worthwhile gain
from a custom template.

**ARM64 (v0.1.2):** 236,738,619 compressed. WebView2 standalone 187,318,480
(178.7 MB), `varve-desktop.exe` 61,881,344, `onnxruntime.dll` 15,497,568. The
44 MB x64/ARM64 delta is ~25 MB smaller ARM64 WebView2 standalone + ~5 MB
smaller ARM64 app binary + ~0.1 MB larger ARM64 onnxruntime.

## 3. Cross-platform comparison and trend

| Release | Windows x64 | macOS ARM64 | Linux .deb | Linux AppImage |
|---|---|---|---|---|
| v0.1.0 | 259.0 MB | 56.2 MB | 56.7 MB | 132.0 MB |
| v0.1.1 | 259.9 MB | 57.3 MB | 58.0 MB | 48.6 MB |
| v0.1.2 | 263.7 MB | 58.5 MB | 59.2 MB | 49.8 MB |

macOS and Linux use the OS webview (WKWebView / WebKitGTK), so their
installers stay ≈ 50–60 MB. **The entire Windows premium is the embedded
WebView2 runtime** — there is no Windows-native duplicate of the system
webview. Microsoft's standalone installer size is outside Varve's control and
is trending up (Tauri's docs quote "~127 MB"; the actual 2026 payload is
202.8 MB). Windows locale/localization is scoped to en-US; no debug symbols,
source maps (`sourcemap: !!process.env.TAURI_DEBUG` → none in release) or
test/dev files were found in the artifact.

## 4. Frontend embedded dist (varve-desktop.exe) — measured at current master

Tauri v2 embeds `frontendDist` **brotli-compressed** into the binary. Built
today (`pnpm build` in `apps/desktop`):

| dist/ group | raw | brotli | Notes |
|---|---|---|---|
| `ort-wasm` | 97.1 MB | 16.7 MB | full `onnxruntime-web` dist copied verbatim; only 4 files used |
| `models` | 40.2 MB | 31.5 MB | bundled ONNX models (git-tracked set ≈ 12.4 MB; see §7) |
| `assets` | 43.7 MB | 8.6 MB | JS/CSS/fonts |
| `wasm` | 2.4 MB | 0.5 MB | `@varve/engine` wasm build |
| **total** | **183 MB** | **57.3 MB** | → embedded in the 66.7 MB exe |

## 5. Stage B — strategies evaluated

| Strategy | Expected reduction | Offline reliability | First-run risk | OS support | Maintenance | Recommendation |
|---|---|---|---|---|---|---|
| **WebView2 `offlineInstaller` → `downloadBootstrapper`** | **~200 MB** (263.7 → ≈ 56–64 MB) | Runtime fetched during setup when missing (needs internet only then) | Low — Win 11 ships the runtime; Win 10 (min 1809) gets it via Edge/Windows Update | Win 10 1809+ (Varve minimum) fully covered | One config key; baseline update | **Chosen** (explicit decision, §6) |
| Keep `offlineInstaller` | 0 | Maximal | none | all | zero | Not chosen — 77% of the installer for a runtime ~always already present |
| WebView2 `EmbedBootstrapper` | ~198 MB (bootstrapper embedded, +1.8 MB) | as bootstrapper | as bootstrapper | Win 7+ | as bootstrapper | Superseded — Varve's minimum is Win 10 1809; no Win 7 need |
| WebView2 `FixedRuntime` | none (worse: +~500 MB unpacked) | best | none | limited | must re-publish CAB per runtime update | Rejected |
| WebView2 `Skip` | ~200 MB | none — app fails without system runtime | high (no install path) | Win 10/11 only | detection + messaging | Rejected for default; future optional |
| **Trim unused `onnxruntime-web` variants from `dist/ort-wasm`** | **54 MB raw dist ≈ 9.8 MB brotli in every platform's exe/installer** | none (only unused files removed; `requiredFiles` contract retained) | none | all | copy-onnx-wasm.mjs filter | **Chosen** (safe) |
| Split bundled models out of installer | ~12–39 MB | breaks offline-first (ADR-0005) | models can't load offline | all | model-workstream release pipeline | Rejected — offline-first contract; models already on-demand for non-bundled |
| Compression/NSIS settings | ~0 | — | — | — | custom NSIS template = risk, no schema knob | Rejected (already solid LZMA) |
| strip/sourcemaps/locales/dupes | 0 (already stripped, no sourcemaps, en-US only, no duplicate payload files) | — | — | — | — | Verified clean, nothing to do |

## 6. Accepted optimisation 1 — WebView2 `downloadBootstrapper`

`tauri.conf.json` `bundle.windows.webviewInstallMode`:
`{ "type": "offlineInstaller" }` → `{ "type": "downloadBootstrapper", "silent": true }`.

This was an **explicit owner decision** (2026-08-18): it trades a smaller
download for a first launch that requires internet only on the rare machine
that lacks the runtime. Windows 11 always ships the runtime; Windows 10
receives it via Edge/Windows Update. The platform-support-matrix already
recommended this for the alpha phase; the pinned `offlineInstaller` test in
`scripts/desktop/compatibility.test.mjs` was updated in the same commit.

Estimated effect at next release: ~263.7 MB → ~56–64 MB per x64 installer
(~236.7 → ~44–51 MB ARM64). Exact bytes will be measured and recorded by the
new size gate (§8).

If true offline deployment ever becomes a requirement, publish a **separate**
`offlineInstaller` build rather than reverting the default — never ship both
as interchangeable defaults.

## 7. Accepted optimisation 2 — trim `onnxruntime-web` variants

`scripts/copy-onnx-wasm.mjs` staged **every** `.wasm`/`.mjs` from
`onnxruntime-web/dist` (26 files, 97.1 MB) into `public/ort-wasm/`, which
Vite copied into `dist/` and Tauri embedded brotli-compressed. Varve only
ever resolves the four companions declared in `ortRuntimeAssets.ts` /
`requiredFiles`:

- `ort-wasm-simd-threaded.{mjs,wasm}` (13.5 MB)
- `ort-wasm-simd-threaded.jsep.{mjs,wasm}` (26.8 MB — WebGPU EP)

The script now stages exactly `requiredFiles`. Measured: `dist/ort-wasm`
97.1 → 40.4 MB raw (≈ 16.7 → 6.9 MB brotli in the exe). The `requiredFiles`
validation and LFS-materialization guard are unchanged.

Verified no consumer regression: every `wasmPaths` / loader reference in
`packages/engine` resolves `simd-threaded` or `simd-threaded.jsep`; the
webgl/webgpu capability checks degrade to WASM EP via the existing try/catch
fallbacks in `inferenceWorker.ts` / `worker.ts` (WebGPU session creation uses
the still-bundled jsep build).

## 8. Regression budget — installer size gate

New `scripts/release/report-installer-size.mjs` runs in the `bundle` job of
`release.yml` on Windows after artifact collection (7-Zip is preinstalled on
GitHub Windows runners):

- **Decomposes** each NSIS installer (`7z l -slt`) and classifies payload
  bytes: `webviewInstaller` / `appBinary` / `onnxRuntime` / `nsisPlugins` /
  `uninstaller`. Best-effort — if 7z is unavailable the script still reports
  size and runs the gate.
- **Warns** past `warnRatio` (1.2×) and **blocks** past `blockRatio` (1.35×)
  of the expected size in `scripts/release/installer-size-baseline.json`.
- **Override process (two levels):**
  1. *At source:* update the baseline in the same commit that intentionally
     changes installer size (e.g. a new bundled model or a WebView2 mode
     change). The baseline `note` says exactly when to do this.
  2. *Per release:* `workflow_dispatch` input `size_gate_override`
     (free-text reason) — recorded in the report, never silent.
- Emits `installer-size-report-<os>-<arch>.json` into `dist/release/`, so it
  is checksummed (`generate-final-checksums.mjs` covers the whole dir),
  verified (`verify-artifacts` / `verify-downloaded`), attested, and lands on
  the release as the historical-trend artifact alongside the per-installer
  SBOMs. Per-artifact `sizeBytes` in `release-manifest.json` remains the
  second trend source.

Baselines (post-change expected): `nsis-x86_64` 56,000,000 B;
`nsis-aarch64` 44,000,000 B — derived v0.1.2 minus WebView2 standalone
(202.8/187.3 MB; LZMA-incompressible, its installer cost ≈ its raw size)
minus ort-wasm trim (~9.8 MB) plus bootstrapper (~2 MB).

## 9. Validation run

- `node scripts/release/report-installer-size.test.mjs` — 7/7 pass
  (classification, arch derivation, mode detection, warn/block/override,
  no-baseline).
- `node scripts/release/report-installer-size.mjs` against the real v0.1.2
  installers — decomposes correctly, gate correctly **blocks** the
  pre-change artifact and honour the override.
- `copy-onnx-wasm.mjs` restaged 4/26 files; rebuilt `dist/` 176 → 122 MB.
- `scripts/validate-workflows.test.mjs` passes with the release.yml change.
- `check-bundled-assets.mjs` — see §10.

## 10. Remaining owner decisions and hazards

- **Windows minimum-version check on the bootstrapper.** Tauri's
  `downloadBootstrapper` is "not recommended on Windows 7" (Tauri docs); it
  is fine for Win 10 1809+. No code path reverts this automatically — the
  decision is documented in `platform-support-matrix.md`.
- **Local-only `depth_anything_v2_small_int8.onnx` (27 MB).** A gitignored
  `*.onnx` file is present in `apps/desktop/public/models/` on this machine
  (not committed, not in any release). `check-bundled-assets.mjs --dist`
  flags it as `bundled:false` dead weight. It must be moved out of `public/`
  or deleted before any release build runs on this machine, or it silently
  adds 27 MB to the installer. Owner: model workstream.
- Windows build/install smoke on the new bootstrapper mode should run on the
  first Windows release after this lands (a genuine `downloadBootstrapper`
  install with the runtime absent is only provable on a real Windows box).

## 11. Files changed

- `apps/desktop/src-tauri/tauri.conf.json` — WebView2 `downloadBootstrapper`
- `scripts/copy-onnx-wasm.mjs` — stage only `requiredFiles`
- `scripts/desktop/compatibility.test.mjs` — pinned mode assertion updated
- `scripts/release/report-installer-size.mjs` (+ `.test.mjs`) — new size gate
- `scripts/release/installer-size-baseline.json` — expected sizes
- `.github/workflows/release.yml` — size-gate step + `size_gate_override` input
- `package.json` — wire the size-gate test into `test:ci:tools`
- `docs/release/platform-support-matrix.md`, `docs/desktop-runtime.md`,
  `docs/release/README.md`, this audit
