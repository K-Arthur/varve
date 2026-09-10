# Varve update-system audit — 2026-08-13

This is the baseline audit for the consent-first in-app update work. It records
what existed before the updater implementation so release and security claims
remain evidence-based.

## Capability matrix before implementation

| Area | Current evidence | Classification | Consequence |
|---|---|---|---|
| Tauri runtime | `tauri` 2.11.5 in `apps/desktop/src-tauri/Cargo.lock` | implemented and usable | Native integration point is available |
| Tauri updater plugin | No `tauri-plugin-updater` dependency or plugin registration | missing | Must be added deliberately with least-privilege capability |
| Tauri process/relaunch plugin | No process plugin; native lifecycle has guarded exit commands | partially implemented | Reuse lifecycle safety; add relaunch only after install approval |
| Updater public/private key | No updater key or public key in the repository/CI | missing | Stable updater artifacts must fail closed until protected credentials exist |
| Update endpoint/feed | No updater endpoint; release manifest is a website/download manifest | release-only | Add a Tauri-compatible feed without treating the website manifest as updater metadata |
| Release channels | `release.yml` derives stable/prerelease channel from the tag | implemented and usable | Feed generation must preserve channel isolation |
| Release artifact verification | `verify-release-trust.mjs`, platform signature reports, checksums and SBOM gates | implemented and usable | Updater trust is an additional gate, not a replacement |
| Linux baseline | Linux bundle runner is Ubuntu 22.04; AppImage/deb/rpm are produced | implemented and usable | Preserve glibc 2.35 floor and distinguish package authority |
| Windows packaging | NSIS is the release target; Azure signing path is scaffolded/gated | partially implemented | Updater may use Tauri NSIS artifacts only after platform signing policy passes |
| macOS packaging | aarch64 DMG target and notarization path are release-scaffolded | partially implemented | DMG is distribution; installed `.app` is the update subject |
| Settings persistence | `packages/editor/src/settings.ts`, localStorage migration/defaults | implemented and usable | Add versioned update preferences with unknown/disabled defaults |
| First-run/onboarding | Welcome/onboarding components exist | implemented and usable | Consent UI should integrate with existing onboarding surface |
| Unsaved-work protection | `TerminationCoordinator` handles application `restart`/`quit-application` | implemented and usable | Update install/relaunch must request this canonical path |
| Multi-window ownership | Main document lifecycle is native-guarded; auxiliary windows own no documents | partially implemented | Update transaction must be process-scoped and not per React mount |
| CSP | Tauri CSP has explicit `connect-src` origins | implemented and usable | Add only the configured release endpoint origin |
| Update telemetry | Desktop analytics is separately consent-gated | implemented and usable | Update checks must not add identifiers or piggyback analytics consent |

## Package and update-authority matrix

The runtime decision is package authority, not operating system. The updater
must derive this from runtime/build metadata and capability checks; it must not
infer AppImage from `linux` alone or from an arbitrary filename.

| Platform / architecture | Package | Authority | Initial product behavior |
|---|---|---|---|
| Linux x86_64 | AppImage | `SelfManaged` only when running from a supported writable AppImage | Tauri updater self-update; otherwise notification/manual guidance |
| Linux x86_64 | deb | `PackageManagerManaged` | Notify and link to the release/package mechanism; never overwrite installed files |
| Linux x86_64 | rpm | `PackageManagerManaged` | Notify and link to the release/package mechanism; never overwrite installed files |
| Linux aarch64 | none published | `Unsupported` | No update offer |
| Windows x86_64 | NSIS | `SelfManaged` after supported install/update capability checks | Tauri NSIS updater; user-approved install and visible progress |
| macOS aarch64 | installed `.app` from DMG | `SelfManaged` only for a writable installed app | Tauri tarball updater; never replace a mounted/read-only DMG |
| macOS aarch64 | mounted DMG / translocated or non-writable app | `ManualOnly` | Explain that Varve must be copied/installed first |
| Flatpak, Snap, stores | external/store managed | `StoreManaged` | Reserved authority values; no self-installer |
| Development/test/web builds | development | `DevelopmentBuild` | No production update checks or install controls |

## Trust boundaries and threat decisions

1. The frontend may request `check`, `download`, `install`, `defer`, and
   `skip-version` through a coordinator. It never supplies an executable path
   or invokes a shell/process command for installation.
2. Tauri updater signatures authenticate update bytes against the public key
   embedded in the installed build. Windows Authenticode, Apple Developer ID/
   notarization, and any AppImage/GPG signature remain separate release trust
   layers.
3. Signature failure, malformed metadata, channel mismatch, architecture
   mismatch, downgrade, and package-authority mismatch fail closed. There is no
   “continue anyway” path for cryptographic failures.
4. The current valid installation remains the recovery authority until the
   updater has downloaded and verified the replacement and the platform updater
   reports installation success.
5. Update checks send only the version, target, architecture, and selected
   channel required by the updater endpoint. No account, document, project,
   machine identifier, or analytics event is required.
6. Automatic checks are consent-gated and throttled. Manual checks are a direct
   user action and remain available even when background checks are disabled.

## Official Tauri v2 facts used by the design

The current official Tauri updater documentation (checked 2026-08-13) states:

- `createUpdaterArtifacts: true` produces the v2 update artifacts: AppImage +
  `.sig`, macOS `.app.tar.gz` + `.sig`, and Windows installer + `.sig`.
- The configured public key is embedded content, not a file path; production
  updater endpoints require HTTPS.
- Static feed entries use `version`, optional notes/date, and per-target
  `platforms[OS-ARCH].url` plus the **contents** of the generated signature.
- Tauri exposes separate `check`, `download`, and `install` operations, and its
  Windows `passive` install mode provides visible progress while allowing the
  installer to request elevation.

Sources: [Tauri updater documentation](https://v2.tauri.app/plugin/updater/),
[Tauri process plugin reference](https://v2.tauri.app/reference/javascript/process/).

## Explicit preconditions for enabling production self-update

- A dedicated updater key has been generated and is stored outside the
  repository, with protected-release-only CI access and tested offline backups.
- The public key is committed only after it is verified against the protected
  private key.
- The release workflow generates updater artifacts before upload, verifies each
  `.sig` against the actual bytes, and refuses to produce updater metadata when
  a required signature or platform trust report is absent.
- Old-to-new packaged acceptance tests have run for each supported self-managed
  package, including an AppImage vertical slice.
- Document migration compatibility is checked before enabling automatic install
  for a release containing a persistent schema migration.

