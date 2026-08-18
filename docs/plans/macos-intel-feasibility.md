# macOS Intel (x86_64) Feasibility — Decision Record

**Date:** 2026-08-18
**Status:** DECISION RECORDED — DO NOT SHIP INTEL YET
**Supersedes:** the "Intel — Tier 3, or omit" row in
`docs/release/platform-support-matrix.md` (this document is the reason that
row is now "Not supported").

## Decision

**DO NOT SHIP INTEL YET.** No `macos-x86_64` release matrix entry, no DMG
target, no download-page listing. The existing single-macOS-target design
(`macos-aarch64` only) stays.

Short, stable reason for user-facing surfaces (FAQ wording, updated
2026-08-18):

> There is no Intel macOS build: Varve's on-device AI runs on the ONNX
> Runtime, whose upstream discontinued macOS Intel binaries in February 2026,
> and Apple has ended new Intel macOS support. An Intel build would depend on
> a frozen, bug-fixed-forever runtime on a platform its own vendors have
> retired — a deliberate dependency constraint, not an oversight.

## Audit

### 1. Rust/Tauri x86_64 target — viable, not the blocker

- `x86_64-apple-darwin` is a Rust tier-1 target; Tauri 2 supports
  `--target x86_64-apple-darwin` with `dmg` bundling.
- All native crates are pure Rust or bundle their own C sources
  (`varve-trace`, `varve-print`, `varve-sync`/rusqlite, `varve-colour`
  (tintbox), `varve-effects`, `varve-engine`, `varve-bridge`). No
  platform-arch-specific C toolchain dependency.
- `ort` is `load-dynamic` only (`apps/desktop/src-tauri/Cargo.toml` `ai`
  feature) — no compile-time linkage to ONNX Runtime on any platform.
- The runtime loader already resolves the staging dir by
  `{os}-{arch}` (`apps/desktop/src-tauri/src/lib.rs:2796-2822`), so a staged
  `onnxruntime-libs/macos-x86_64/libonnxruntime.dylib` would be found with no
  Rust changes.

### 2. GitHub Actions runner/toolchain — time-boxed to August 2027

- `macos-13` (the classic Intel runner) was retired **2025-12-08**
  (actions/runner-images#13046).
- The replacement, `macos-15-intel` (macOS 15 on real Intel hardware), is
  available but **retires in August 2027** (actions/runner-images#13045) —
  the *last* x86_64 macOS image GitHub Actions will ever provide. After that
  date there is no Intel macOS runner of any kind.
- Today (2026-08-18) the runway is **~12 months**.

### 3. ONNX Runtime dylib — the hard blocker (upstream EOL)

Verified against microsoft/onnxruntime release assets:

| ORT release | Published | `onnxruntime-osx-x86_64-*.tgz` |
|---|---|---|
| 1.21.0 | 2025-04 | yes |
| 1.22.0 | 2025-05-10 | yes |
| **1.23.0** | **2025-09-26** | **yes — LAST Intel line** |
| 1.24.0 | — | no (no release assets found under this tag) |
| 1.24.1 | 2026-02-06 | **no** — announcement: *"x86_64 binaries for macOS/iOS are no longer provided and minimum macOS is raised to 14.0"* |
| 1.25.0+ / 1.27.x (Varve's pinned line) | — | no |

Varve currently pins `ORT_VERSION = 1.27.1`
(`scripts/fetch-onnxruntime.mjs`). The last Intel-capable release, 1.23.0,
is **a frozen artifact: no bug fixes, no security patches, ever**. The
universal2 packages stopped containing an x86_64 slice at the same point, so
a "universal" DMG cannot rescue the platform either (this confirms audit
H-3's split-DMG design decision).

**Crate compatibility:** `ort 2.0.0-rc.13` (pinned) targets ORT 1.28 but its
`load-dynamic` version gate is a *floor* (loaded library minor >= 17 —
`~/.cargo/registry/.../ort-2.0.0-rc.13/src/lib.rs:149`). ORT 1.23.0 would
pass that check. The ort crate is therefore **not** the blocker; upstream
EOL and the bug below are.

### 4. Known macOS crash bug in the only usable Intel line

microsoft/onnxruntime#24579 — since 1.21.x, ONNX Runtime on macOS can abort
at process exit (`libc++abi: terminating with uncaught exception ... mutex
lock failed: Invalid argument`). Maintainers' verdict for the atexit path:
*"no fix we can provide"*. The fix (PR #25134 "Leak logger mutex") landed
**after** the 1.23.0 branch — the last line with an Intel asset **predates
the fix**. An Intel build would ship a native library that can crash when
the app quits.

### 5. macOS floor mismatch

- ORT macOS packages require **macOS >= 13.3** since 1.21.
- Varve's `tauri.conf.json` sets `minimumSystemVersion: "13.0"`.
- On macOS 13.0–13.2 Intel Macs the dylib would fail to load → silent
  degradation to WASM. Bumping the app minimum to 13.3 would be a product
  change for *all* macOS users, made solely to serve Intel.

### 6. Platform end-of-life (Apple)

- macOS 26 Tahoe (2026) is the **final macOS to support any Intel Mac**
  (only 4 models: 2019 16" MacBook Pro, 2020 13" MBP/4TB, 2020 27" iMac,
  2019 Mac Pro).
- macOS 27 Golden Gate (fall 2026) requires Apple Silicon.
- macOS 15 Sequoia security updates end ~fall 2027.
- Combined with the Aug 2027 runner retirement: a new Intel release target
  would carry a **~12–14 month support runway** from day one, on a platform
  whose OS vendor is drawing it down.

### 7. Feature degradation without ORT

Shipping Intel without a bundled dylib is the graceful path the app already
supports (`native_ai_ready` reports unavailable → WASM/heuristic fallbacks),
but it is *not* free: WASM BiRefNet background removal can crash with
`std::bad_alloc` on GPU-less hosts
(`docs/audits/background-removal-wasm-memory-hardening-2026-07-18.md`) — the
exact failure the native bundle was introduced to prevent — and Intel Macs
skew old/GPU-less. Super-resolution would fall back to bicubic.

### 8. Signing/notarization — not a blocker

Developer ID + notarization + stapling for an x86_64 DMG uses the identical
existing pipeline and credentials; notarytool accepts Intel binaries. The
per-arch manifest/SBOM/verification scripts are already arch-parameterized
(`verify-binary-architecture.mjs` handles the Mach-O x86_64 cputype
`0x01000007`).

### 9. Universal-binary feasibility

App-binary `lipo` is feasible, but the bundle needs a universal2 ORT dylib
with an x86_64 slice — last exists at 1.23.0, same frozen-line problem.
Universal remains out; per-arch DMGs remain the correct shape.

## Test matrix (honest record)

| Check | Result | Evidence |
|---|---|---|
| Rust/Tauri target feasibility | Static ✅ | Tier-1 target; tauri-cli `--target` path exists |
| Loader picks up `macos-x86_64` staging | Static ✅ | `lib.rs:2796-2822` keyed on `{os}-{arch}` |
| Arch verification supports Mach-O x86_64 | Static ✅ | `verify-binary-architecture.mjs` cputype table |
| ORT crate accepts a 1.2x Intel dylib | Static ✅ | floor check `>= 1.17` in ort rc.13 |
| ORT 1.23.0 asset exists & is the last | Verified ✅ | GitHub release assets (2026-08-18) |
| Upstream discontinued Intel | Verified ✅ | ORT 1.24.1 release notes (2026-02-06) |
| CI runner availability | Verified ⚠️ | `macos-15-intel`, retires Aug 2027 |
| compile/link (`x86_64-apple-darwin`) | **Not run** | Requires macOS SDK + a macOS host; not cross-buildable from the Linux dev machine |
| DMG generation / launch smoke | **Not run** | Requires a `macos-15-intel` CI rehearsal, which the decision gate forbids adding ("no matrix entry unless the full dependency/release path works") |
| Editor boot / open-save on Intel | **Not run** | No Intel Mac hardware in the project |

A compile-only result is not "supported" — and even a green `macos-15-intel`
rehearsal would not change this decision, because the ORT dependency is
permanently frozen at a buggy, EOL line.

## Blockers backlog (what would change the decision)

- **B1 — ONNX Runtime upstream EOL.** No macOS x86_64 binaries beyond 1.23.0;
  Varve's pinned line (1.27.1) has no Intel asset. Options were weighed:
  self-building ORT for macOS x64 (rejected: permanent fork, no upstream
  fixes, security maintenance, diverges from the release line on every bump);
  shipping without ORT (rejected for now: reintroduces the documented WASM
  `bad_alloc` risk on the GPU-less machines Intel Macs often are).
- **B2 — Known macOS exit-crash bug in 1.23.0** (#24579), fixed only after
  the Intel line was discontinued.
- **B3 — macOS floor mismatch:** ORT needs 13.3+, app minimum is 13.0.
- **B4 — Platform EOL:** `macos-15-intel` retires Aug 2027; macOS 27 (fall
  2026) drops Intel; security updates end ~fall 2027. ~12-month runway.
- **B5 — No validation hardware:** the project has no Mac hardware; macOS is
  Experimental (tier 3) even on Apple Silicon.
- **B6 — Version-divergence cost:** a second, permanently pinned ORT per
  release would double fetch/checksum/SBOM/prune/feed surface for a frozen
  platform.

## Re-entry criteria

Re-run this feasibility study when any of:

1. A real demand signal exists (users asking on GitHub/support), AND
2. An Intel Mac (or Macs) becomes available for validation, AND
3. Either ONNX Runtime restores Intel assets, or a maintainer explicitly
   accepts the no-native-AI degradation contract.

Re-evaluate no later than **Q2 2027** — before the August 2027
`macos-15-intel` retirement closes the CI door permanently.

## Implementation

No code, CI, or release changes made. Documentation updated:

- `docs/release/platform-support-matrix.md` — macOS x86-64 row and decisions
  now cite the dependency EOL instead of the outdated "no Intel dylib".
- `scripts/fetch-onnxruntime.mjs` — comment updated to the precise upstream
  fact (last Intel line 1.23.0, dropped at 1.24.1).
- `apps/website/src/pages/support/faq.astro` — stable user-facing reason.

## Manual hardware/signing needs (if the decision ever flips)

- One Intel Mac (or `macos-15-intel` runner rehearsal) for compile/link +
  DMG + launch smoke before any matrix entry.
- No new signing credentials: existing Developer ID + notarization secrets
  cover x86_64 DMGs.
- Retire the target before Aug 2027 with a last-supported-version policy.
