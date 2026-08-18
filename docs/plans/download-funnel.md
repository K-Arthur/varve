# Download Funnel & Cross-Platform UX

**Date:** 2026-08-18
**Status:** IMPLEMENTED
**Scope:** download page information architecture, platform recommendation,
install guidance, first-project handoff, responsive/accessibility, E2E tests

## Funnel Diagram

```
┌──────────────────────────────────────────────────────────────┐
│  VISITOR ARRIVES AT /download                                │
│  (JS-enabled? mobile? bot? privacy-reduced? unknown?)        │
└──────────────────────────────────────────────────────────────┘
                            │
              ┌─────────────┴──────────────┐
              │                            │
   ┌──────────▼──────────┐    ┌────────────▼────────────┐
   │  Desktop visitor     │    │  Mobile / bot / reduced  │
   │  (UA has OS tokens,  │    │  (no recommendation,    │
   │   not headless,      │    │   mobile notice shown,  │
   │   not mobile)        │    │   no tab preselect)     │
   └──────────┬──────────┘    └─────────────────────────┘
              │
   ┌──────────▼──────────────────────────────────────────────┐
   │  PLATFORM RECOMMENDATION (browser-based, best-guess)     │
   │                                                          │
   │  Mac: always "Apple Silicon only" — browsers can't tell  │
   │  Intel from AS under Rosetta; message directs to         │
   │  "About This Mac"                                       │
   │                                                          │
   │  Linux/Windows: arch from UA tokens (x86_64/ARM64);     │
   │  label as "best guess — you can choose any other"       │
   └──────────┬──────────────────────────────────────────────┘
              │
   ┌──────────▼──────────────────────────────────────────────┐
   │  QUICK DOWNLOAD GRID                                     │
   │                                                          │
   │  • "RECOMMENDED" chip on recommended platform column     │
   │  • "RECOMMENDED FOR YOU" badge on recommended arch row   │
   │  • ARM64 promoted first only when device hints arm64     │
   │  • Primary artifact per platform (deb for Linux, first   │
   │    format elsewhere) — same rule as detailed sections    │
   │  • Alternates shown inline (AppImage/RPM for Linux)      │
   └──────────┬──────────────────────────────────────────────┘
              │
   ┌──────────▼──────────────────────────────────────────────┐
   │  DETAILED PLATFORM SECTIONS (tabbed)                     │
   │                                                          │
   │  • Trust badge per platform (signed / unsigned / SHA256) │
   │  • All artifacts with checksums, SBOMs, install commands │
   │  • "Which package should I choose?" (Linux only)         │
   │  • System requirements per platform                      │
   └──────────┬──────────────────────────────────────────────┘
              │
   ┌──────────▼──────────────────────────────────────────────┐
   │  FIRST-USE CONVERSION                                    │
   │                                                          │
   │  "After you install" — 3 numbered steps:                 │
   │   1. Open the app (install commands per platform)        │
   │   2. First launch (welcome screen, unsigned warnings)    │
   │   3. Sample .varve document + first-project tutorial     │
   └──────────┬──────────────────────────────────────────────┘
              │
   ┌──────────▼──────────────────────────────────────────────┐
   │  TROUBLESHOOTING                                         │
   │                                                          │
   │  • Wrong architecture                                    │
   │  • Linux FUSE2 / WebKitGTK missing                       │
   │  • macOS unsigned build blocking                          │
   │  • Windows SmartScreen                                    │
   │  → Links to /support/troubleshooting, known-issues,      │
   │    report-issue, /security                               │
   └─────────────────────────────────────────────────────────┘
```

## Platform Recommendation Decision Matrix

| Visitor Type | Detection Source | Recommendation | Banner | Tab Preselect | Arch Promotion |
|---|---|---|---|---|---|
| Linux x86_64 desktop | UA tokens | Linux, x86_64 | Yes ("best guess") | Yes | None (x86_64 already first) |
| Linux ARM64 desktop | UA tokens | Linux, ARM64 | Yes ("best guess") | Yes | ARM64 promoted first |
| Windows x86_64 desktop | UA tokens | Windows, x86_64 | Yes | Yes | None (x86_64 already first) |
| Windows ARM64 desktop | UA tokens | Windows, ARM64 | Yes | Yes | ARM64 promoted first |
| macOS any architecture | UA tokens | macOS, arch unknown | Yes ("Apple Silicon only") | Yes | None (only one arch exists) |
| Bot / crawler | UA pattern match | none | No | No | No |
| Mobile / tablet | UA + touch + viewport | none | No | No | No |
| Privacy-reduced (no OS token) | UA token absence | none | No | No | No |
| Unknown / no JS | fallback | none | No | No | No |

Manual override: clicking a platform tab or download link persists the choice
in `localStorage` (`varve:download:choice`). A "Choose another platform" link
dismisses the recommendation. The recommendation is never forced redirection.

## What Was Built

### Files Created
- `apps/website/src/lib/download-detection.ts` — pure detection/recommendation
  logic (unit-testable, no DOM)
- `apps/website/src/test/download-detection.test.ts` — 21 unit tests
- `apps/website/tests/e2e/download.spec.ts` — 12 E2E tests
- `apps/website/public/samples/varve-poster.varve` — canonical sample document
  (6.8 KB, code-generated from `scripts/screenshots/demo-document.ts`)
- `docs/screenshots/download/` — 7 review screenshots

### Files Modified
- `apps/website/src/pages/download.astro` — recommendation UI, package
  tradeoffs, first-use conversion, troubleshooting, responsive CSS
- `scripts/release/website-release-data.mjs` — arch-neutral AppImage copy,
  x86_64-first artifact ordering
- `apps/website/src/data/release-manifest.json` — regenerated through the
  real generator (reordered artifacts, arch-neutral blurbs)

### Key Design Decisions
1. **Single primary-format rule** — `primaryFormatFor(platform, formats)` is
   shared by the quick grid and the detailed sections so they never disagree
   about which artifact is "the download". Linux prefers .deb (apt-managed);
   others take the first published format.
2. **macOS honesty** — the browser can never report ARM64 on macOS (all
   browsers say "Intel Mac OS X" even on Apple Silicon). The banner always
   leads with "Apple Silicon only" and directs to "About This Mac".
3. **No forced redirection** — recommendation is a progressive enhancement.
   Without JS the page shows x86_64-first artifacts (the dominant supported
   architecture). Override persists only in localStorage (this machine only,
   no network).
4. **[hidden] + display override** — CSS `display: inline-flex` on chips
   overrides the UA stylesheet's `[hidden] { display: none }`. The fix:
   `.recommend-chip[hidden], .arch-chip[hidden] { display: none }` with
   higher specificity.

## Test Matrix

| Test | Status | Method |
|---|---|---|
| Unit: detection/recommendation/ordering | 21/21 pass | vitest |
| E2E: recommendation (Linux, ARM64, Windows, macOS) | 12/12 pass | Playwright |
| E2E: bot/mobile/privacy-reduced guards | pass | Playwright |
| E2E: manual override persistence | pass | Playwright |
| E2E: keyboard tab navigation | pass | Playwright |
| E2E: 320px no horizontal overflow | pass | Playwright |
| E2E: no-JS server-rendered baseline | pass | Playwright |
| E2E: sample document 200 + tutorial links | pass | Playwright |
| E2E: axe-core (via existing axe.spec.ts) | pass | Playwright |
| Visual: light/dark, 4 viewports, 3 UA types | inspected | screenshot |

## What Cannot Be Automated on This Machine

- **macOS Intel Mac**: no hardware; the macOS-Intel feasibility decision
  (docs/plans/macos-intel-feasibility.md) confirms "DO NOT SHIP INTEL"
- **Windows SmartScreen behavior**: requires real Windows + unsigned build
- **macOS Gatekeeper dialog**: requires real macOS + unsigned build
- **Clean .deb/.rpm install**: requires Docker (not running) or native
  Debian/Fedora; `scripts/release/verify-package-install.sh` covers this
  when Docker is available
- **AppImage FUSE2 path**: needs a system with FUSE2 installed; the
  `--appimage-extract-and-run` fallback was verified on this Arch-based
  machine (FUSE2 not installed by default)
- **Actual GUI launch**: requires a display; the E2E tests serve the static
  build and verify DOM behavior only

## Manual Verification Steps

For the clean-install tests documented above, run on Docker-capable machines:
```bash
# .deb/.rpm in clean containers (Ubuntu 22.04 / Fedora 38)
scripts/release/verify-package-install.sh --bundle-dir <downloaded-artifacts-dir>

# AppImage on any Linux with WebKitGTK
./Varve-0.1.2-linux-x86_64.AppImage --appimage-extract-and-run
```

For wrong-architecture failure messaging:
```bash
# On an x86_64 host, attempt to run the aarch64 AppImage:
chmod +x Varve-0.1.2-linux-aarch64.AppImage
./Varve-0.1.2-linux-aarch64.AppImage
# Expected: "exec format error" (the troubleshooting section explains this)
```

## Commits

1. `c1bce905` — `fix(website): gate in-app updater claims on updater feed
   presence` (pre-existing in-flight work, committed first per coordination)
2. `55a2263f` — `chore: shorten README and drive its version strings from
   release tooling` (pre-existing in-flight work)
3. `feat(website): download funnel with platform recommendation, first-use
   conversion, and troubleshooting` (this session)
4. `test(website): download page E2E for recommendation, a11y, responsive,
   and no-JS baseline` (this session)
