# ARM64 support audit — 2026-08-13

This is the baseline for the first-class AArch64 work. It records what the
repository actually supported before the release-target registry and the
remaining vertical slices are completed. A target being present in the
registry does not, by itself, mean that its release gate has passed.

## Evidence used

- Rust lists `aarch64-unknown-linux-gnu`, `aarch64-pc-windows-msvc`, and
  `aarch64-apple-darwin` as supported targets.
- Tauri 2 documents explicit `--target` builds, Windows ARM64 MSVC tooling,
  and native ARM64 executables inside an x86 NSIS bootstrapper.
- Tauri's AppImage documentation says its current linuxdeploy path cannot
  cross-compile ARM AppImages. Linux ARM64 packaging therefore requires a
  native ARM64 runner.
- ONNX Runtime 1.27.1 publishes official CPU archives for Linux aarch64,
  macOS arm64, Windows arm64, and Windows x64. The release fetcher verifies
  the archive checksum before extraction.

## Initial capability matrix

| Target | Source/runtime | Packaging | Release CI | Status at audit |
| --- | --- | --- | --- | --- |
| Linux x86_64 | Rust/native desktop path and x64 ONNX Runtime staged | AppImage, DEB, RPM | Ubuntu 22.04 native runner | Supported and release-tested |
| Linux aarch64 | Rust target available; ONNX Runtime asset available; native inference not yet runtime-tested here | AppImage, DEB, RPM intended | Native `ubuntu-22.04-arm` target registered; workflow integration pending | Supported by upstream/tooling, not yet release-validated |
| Windows x86_64 | Rust/native desktop path and x64 ONNX Runtime staged | NSIS | Native Windows runner | Supported and release-tested |
| Windows aarch64 | Rust target and official ONNX Runtime asset now mapped; native inference not yet runtime-tested here | Native ARM64 app in NSIS distribution path intended | Native `windows-11-arm` target registered; workflow integration pending | Supported by upstream/tooling, not yet release-validated |
| macOS aarch64 | Existing native Apple Silicon path and arm64 ONNX Runtime staged | DMG | Native `macos-latest` runner | Supported and release-tested |
| macOS x86_64 | No CPU-only ONNX Runtime asset in the pinned release mapping | Not published | Not in release target registry | Unsupported / deliberately not advertised |

## Architecture-sensitive findings

### Already architecture-aware

- `scripts/fetch-onnxruntime.mjs` stages libraries under an OS/architecture
  directory and verifies pinned archive checksums before extraction.
- The Rust loader resolves the same `os-arch` resource key using
  `std::env::consts`, and the release SBOM includes the platform-specific
  library hash when a platform scope is supplied.
- Artifact collection already emits architecture-bearing filenames and
  manifest fields.
- Linux release builds use Ubuntu 22.04 to preserve the documented glibc floor;
  ARM AppImage must keep a native runner rather than switching to emulation.
- macOS is intentionally Apple Silicon-only rather than a misleading partial
  universal binary.

### Gaps found

- Architecture aliases were converted independently in fetch, pruning,
  collection, and website/release validation scripts.
- Windows ARM64 was absent from the ONNX Runtime staging table even though the
  pinned upstream release publishes `onnxruntime-win-arm64-1.27.1.zip`.
- The release matrix only built Linux x86_64, Windows x86_64, and macOS ARM64.
- Release integrity checked platform SBOM coverage by OS, which is insufficient
  when two architectures of one OS are published.
- Website download copy still described Linux and Windows requirements as
  x86-only and the FAQ explicitly said Linux/Windows ARM was unavailable.
- Native AI diagnostics currently return a boolean; a later slice should expose
  architecture and native/WASM state for support diagnostics without adding an
  architecture setting to the editor.

## Canonical model introduced by the first slice

`scripts/release/targets.mjs` is now the release tooling authority:

- canonical architectures are `x86_64` and `aarch64`;
- Node `x64`/`arm64`, Debian `amd64`/`arm64`, RPM `x86_64`/`aarch64`, Windows
  `x64`/`ARM64`, and Rust target triples are boundary representations;
- ARM32 (`armv7`, `armhf`) is rejected rather than treated as ARM64;
- every target records its runner, Rust target, package formats, native runtime
  key, update target, release filename architecture, and release readiness.

The new ARM targets remain `releaseReady: false` until native packaging,
artifact inspection, runtime smoke, signing/SBOM, and website gates are wired
and actually executed. This prevents the registry from overstating support.

## References

- [Rust platform support](https://doc.rust-lang.org/rustc/platform-support.html)
- [Tauri Windows installer and ARM guidance](https://v2.tauri.app/distribute/windows-installer/)
- [Tauri AppImage guidance](https://v2.tauri.app/distribute/appimage/)
- [GitHub-hosted ARM64 runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)
- [ONNX Runtime 1.27.1 release](https://github.com/microsoft/onnxruntime/releases/tag/v1.27.1)
