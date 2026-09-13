# ChromeOS Stage 6: website experience, downloads, documentation, and support truth

**Status:** Website/docs implementation delivered and validated against the
production build; device validation still pending
**Research access date:** 2026-09-12
**Repository snapshot:** Stage 6 commits on `master` (`b98cb9072`, `a6139d9fc`,
`a76b0e669`, `fe517ecdf` plus the evidence commits that follow); base
`434015906314d14c579afe7e73de486bafb8c3d8`
**Reference device:** Lenovo Chromebook Duet 11M889, 8 GB — not present

This document separates vendor documentation, repository evidence, local test
results, and hypotheses. Nothing here is a Chromebook measurement claim. Stage 6
owns public routing and copy; it does not promote any route's support tier.

## 1. Research ledger

| Question | Primary source | Publisher / date | Applicable versions | Finding and confidence | Implementation consequence | Unresolved conflict |
|---|---|---|---|---|---|---|
| How is Linux enabled/removed, and who can block it? | [Set up Linux on your Chromebook](https://support.google.com/chromebook/answer/9145439?hl=en) | Google, accessed 2026-09-12 | Current ChromeOS stable | Linux is off by default; managed devices may block it and point to the administrator; hardware acceleration including GPU and video decode is not supported; ChromeVox is Terminal-only in Linux. **High** | The Linux route is documented as experimental and administrator-gated; no bypass is offered. | Chromium's developer docs still describe accelerated graphics as a Crostini feature; treat GPU as version-dependent and unavailable. |
| How does a user install a web app, and what does install give? | [Use web apps](https://support.google.com/chrome/answer/9658361?co=GENIE.Platform%3DDesktop&hl=en) | Google, accessed 2026-09-12 | Chrome desktop/ChromeOS | Install via the address-bar install icon or ⋮ → Cast, save, and share → Install page as app; uninstall offers "also delete data"; web apps may not work completely offline. **High** | The browser guide keeps its tested menus and warns that "delete data" removes documents. | None. |
| Can an administrator block or force-install web apps? | [Automatically install web apps](https://support.google.com/chrome/a/answer/9367354?hl=en) and [View and configure apps and extensions](https://support.google.com/chrome/a/answer/6177447?hl=en) | Google (Chrome Enterprise and Education Help), accessed 2026-09-12 | Managed ChromeOS | Policy can force-install, allow, or block a web app; `WebAppInstallForceList` installs without user interaction and prevents removal; a per-app Installation policy can be Block. **High** | The Chromebook guide states managed-device constraints and routes users to their administrator instead of suggesting a bypass. | Exact policy names vary by Admin console surface; the guide avoids naming them. |
| What are the current Core Web Vitals thresholds? | [Web Vitals](https://web.dev/articles/vitals) | Google (web.dev), last updated 2024-10-31, accessed 2026-09-12 | Current Chrome/CrUX | LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1, assessed at the 75th percentile; lab tools cannot measure INP and use TBT as a proxy; lab and field are not interchangeable. **High** | Measurement records device/network assumptions and labels TBT/Lighthouse as lab proxies, never as field INP or editor smoothness. | None. |
| What is the accessible minimum target size? | [Understanding SC 2.5.8 Target Size (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) | W3C WAI, updated 2026-05-11, accessed 2026-09-12 | WCAG 2.2 AA | 24×24 CSS px minimum, or the 24 px-circle spacing exception; 44 px is a best practice, not the AA minimum; the requirement is zoom-independent. **High** | The input guide states the project's 44 px coarse-pointer target and the AA floor; the website keeps its own touch-target suite. | None. |
| How should motion be reduced, and what about hidden tabs? | [prefers-reduced-motion](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion) and [Page Visibility API](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API) | MDN contributors, modified 2026-06-10 / 2025-12-30, accessed 2026-09-12 | Widely available | The media feature reports a user preference to remove/replace non-essential motion; browsers throttle rAF and timers in hidden tabs but non-background-exempt work should pause explicitly. **High** | The hero ticker now stops while hidden or off screen; the workflow video plays only while visible. | None. |
| How is the Linux package architecture determined inside the environment? | [dpkg(1)](https://manpages.debian.org/bookworm/dpkg/dpkg.1.en.html) (`--print-architecture`) | Debian project (dpkg 1.21.22 manpage), converted 2025-07-02, accessed 2026-09-12 | Debian bookworm+ | `dpkg --print-architecture` prints the architecture dpkg installs for (“i386” in the example); `uname -m` names the kernel machine. **High** | Both commands are documented in the ChromeOS Linux guide; the download page never auto-selects an installer for ChromeOS. | None. |
| Is font preloading justified before measuring? | [Best practices for fonts](https://web.dev/articles/font-best-practices) | Google (web.dev), last updated 2022-10-04, accessed 2026-09-12 | Current browsers | Self-hosted WOFF2 with `font-display: swap` is the recommended baseline; `preload` bypasses `unicode-range` negotiation and competes with other resources. **High** | The site already self-hosts WOFF2 with swap; no preload was added without a measured LCP win, and the gap is recorded. | None. |

PWA install criteria and service-worker lifecycle were researched in the Stage 2
ledger (same day) and reused, not re-derived.

## 2. Repository diagnosis (before)

| Finding | Evidence | Consequence |
|---|---|---|
| A touch Chromebook was classified as a phone/tablet | `isMobileOrTablet` matched `maxTouchPoints > 1 && screenWidth < 1280` regardless of the ChromeOS `CrOS` token; `detectPlatform` had no ChromeOS case | The Duet in tablet mode saw "There are no mobile or tablet builds" and no browser route |
| The mobile notice was JS-only and hidden in markup | `download.astro` `hidden` attribute, unhidden only when `detection.mobile` | No-JS and reduced-UA visitors saw no route guidance at all |
| iPadOS desktop mode was indistinguishable from a Mac | A Macintosh UA at ≥1280 px with touch points was not treated as a tablet | An iPad could be recommended the macOS disk image |
| The header CTA offered no route for touch devices and updated only the first CTA | `DownloadCTA.astro` returned `null` for mobile; `querySelector` singular | Touch users got "Download Varve" with no browser route |
| Package-manager update claims implied a repository | "updates through apt/dnf", "use your package manager" on `/download`; `chromeos-linux.md` correctly says no apt repo exists | Contradictory update guidance, explicitly disallowed by the task |
| `/releases` is a `noindex` redirect but appeared in the sitemap and an SEO test expected `index, follow` | `releases.astro` (`noindex`, canonical `/changelog`), `sitemap.xml.ts`, `seo.spec.ts` | Discovery contradiction (pre-existing; base-failing) |
| The FAQ test asserted a link inside a closed disclosure | `browser-demo.spec.ts:27` vs `faq.astro` `<details>` | Pre-existing failing test |
| Astro collapsed newlines before inline links | Rendered text "walkthrough is inVarve on ChromeOS", "follow the…" on new pages | Broken words across current and new copy |
| Hero phrase ticker never paused and had no stop path | `AnimatedText.astro` interval with unbounded rAF wait | Hidden-tab timer and rotating a CSS-hidden rotor at ≤640 px |
| The product workflow video autoplayed below the fold | `product.astro` `autoplay preload="metadata"` | Off-screen bandwidth/CPU use on constrained devices |
| 54 MB of workflow video ships unreferenced | `apps/website/public/screenshots/workflows/` (48,043,664 bytes per capture manifests); `CaptureVideo.astro` has no importers | Deploy artifact weight only; no page requests these files |

## 3. Implementation delivered

| Commit | Change |
|---|---|
| `b98cb9072` | ChromeOS detection (`CrOS`, low-entropy UA client hints), iPadOS desktop-mode classification, server-rendered device-route notice with the browser route and manual chooser, Chromebook banner copy, neutral touch/Chromebook CTA labels, apt/dnf and updater claim corrections, and a product-truth check that fails on the mobile block or a stale hardcoded artifact version |
| `a6139d9fc` | `/docs/chromebook` route chooser (browser / installed app / Linux), tested-status table, feature matrix, managed-device constraints, and cross-links; `/docs/performance` (adaptive profile truth, workload guidance, model costs, multitasking/power); `/docs/touch-and-pen` (gestures, unverified USI Pen 2 details, virtual keyboard, ChromeOS-reserved shortcuts, trackpad, accessibility); structured troubleshooting entries for WebGPU, heavy operations, storage quota, fonts, blocked models, unavailable Linux, wrong architecture, missing libraries, blank windows, hidden dialogs, printing, install/update/uninstall, and diagnostics; docs index and existing-guide cross-links; installation `.deb` command corrected to `apt install ./file.deb` |
| `a76b0e669` | Hero ticker starts only while on screen, stops on hidden/pagehide, and never runs in the narrow layout; product video plays only while visible with the poster otherwise |
| `fe517ecdf` | Glued-link copy repairs on every stage-owned page plus `/about`, `/accessibility`, `/releases`; rendered-text regression test; download notice id; iPad one-point touch fix; `/releases` removed from the sitemap; FAQ test opens its disclosure; visual baselines for the three new guides and refreshed download/ChromeOS baselines |
| this evidence commit | Stage 6 ownership record, this audit, support-matrix wording, README route wording |

Not changed, deliberately: the 4 GB model description (the reference device is
8 GB), any route's support tier, the release pipeline, and the editor.

## 4. Evidence

### 4.1 Commands and results (clean worktree, base + Stage 6)

```text
pnpm build:website            # 89 pages (base: 86), 0 errors
pnpm build:website:pages      # 89 pages, 0 errors
node scripts/release/verify-product-truth.mjs
                              # all 11 checks pass (new website-routing check)
pnpm test:website             # 196 passed; 2 pre-existing token failures (section 4.4)
VARVE_WEBSITE_E2E_PORT=4331 VARVE_WEBSITE_E2E_PORT_ROOT=4332 \
  node scripts/quality/heavy-lease.mjs website-stage6-certified -- \
  pnpm exec playwright test -c playwright.website.config.ts \
  apps/website/tests/e2e/{download,browser-demo,chromeos-linux,assets,seo,axe}.spec.ts \
  --project=ghpages
                              # 71 passed (44.9s)
```

Visual suite (same ports):

```text
# branch: 18 failed, 6 passed    # base commit: 12 failed, 9 passed
# The 12 base failures reproduce identically on the untouched base worktree
# (homepage ×4, product showcase, docs, workspaces docs, features dark,
# features icon rotation, typography, theme-matrix product ×2) and were not
# touched. The 6 branch-specific failures were inspected and are now the
# inspected baselines below.
```

Filtered re-run after inspection/update: 6 passed.

Full website suite (both deployment modes):

```text
VARVE_WEBSITE_E2E_PORT=4331 VARVE_WEBSITE_E2E_PORT_ROOT=4332 \
  node scripts/quality/heavy-lease.mjs website-stage6-full -- \
  pnpm exec playwright test -c playwright.website.config.ts --reporter=list
                              # 474 passed, 19 failed
```

Failure classification:

| Failures | Classification | Evidence |
|---|---|---|
| 12 visual baselines (homepage ×4, product showcase, docs, workspaces docs, features dark, features tone rotation, typography, theme-matrix product ×2) | Pre-existing baseline drift | Reproduced identically on the untouched base worktree |
| `background-removal-feature` ×2, `generative-editing.visual` ×2 | Pre-existing | Reproduced on the base worktree |
| `clipboard-feature` ×2, `corner-radius` ×1 | Renderer crashes under parallel load, plus one stale label assertion | All pass with `--workers=1` (14 passed); the clipboard assertion now targets the visible `[data-download-cta]` hook because the CTA correctly labels every instance |

No Stage 6-attributable failure remains.

### 4.2 Measured website changes

Method: same host, frozen base worktree at `434015906`, production builds with
the repository's own scripts; byte counts from `du -sb` and `find -printf`.

| Measure | Base | Stage 6 |
|---|---:|---:|
| Static pages | 86 | 89 |
| `dist` total | 67,172,945 B | 67,357,144 B |
| `dist/_astro` total | 645,530 B | 651,757 B |
| `download` page script | 6,150 B | 7,284 B |
| `AnimatedText` script | 1,115 B | 1,669 B |
| Unreferenced workflow media in `dist` | 54 MB (unchanged) | 54 MB (unchanged) |

The growth is the three new guides plus the route/detection logic (+6.2 KB of
JS/CSS); no third-party script or framework was added. The dominant artifact
cost is the 54 MB unreferenced workflow video directory, which no page requests.
Core Web Vitals were not field-measured; no telemetry exists and none was added.
The website has no consent-approved analytics in local builds, so lab-only
observations are stated as such.

### 4.3 Visual inspection (captures read at full size)

| Capture | What was verified |
|---|---|
| `chromebook-light-actual.png` | Route cards, tested-status table, feature matrix, managed-device copy, links render coherently; no overlap |
| `download-dark-actual.png` | Server-rendered notice sits above the quick grid; the recommendation banner and platform tabs are unaffected; no overflow |
| `performance-light-actual.png` | Tier table and "what it does not change" render; evidence caveat visible |
| `touch-and-pen-light-actual.png` | Gestures table, pen uncertainty, keyboard conflicts, accessibility sections render |
| `download-portrait-800x1280.png` | Tablet portrait: notice visible, single column, no horizontal drift |
| `chromebook-portrait-800x1280.png`, `chromebook-narrow-320x720.png` | Portrait and 320 px reflow; tables scroll inside their container instead of the page |
| `troubleshooting-*-800x1280.png` | New structured section renders at tablet width |

Paths are under `.stage6-artifacts/evidence/` (worktree-local, uncommitted).
Baselines committed under `apps/website/tests/e2e/visual.spec.ts-snapshots/`
reproduce the three guide captures and the updated download/ChromeOS captures.

### 4.4 Pre-existing failures (measured, not masked)

- `apps/website/src/test/tokens.test.ts` fails identically at base and after:
  `features/canvas.astro` and `docs/tools/grids.astro` contain deliberate
  illustration hex colors, and `--surface-raised`/`--font-ui` are referenced
  without definitions. Fixing them changes designed artwork or font rendering,
  so they are recorded rather than rewritten.
- 12 visual baselines fail identically at base; the branch adds only the six
  captures above, which were inspected and committed.
- Sitewide glued-link defects remain on contact/press/licensing pages outside
  the Stage 6 route set; the new regression test covers the stage-owned pages
  and the trust pages repaired here, and the remainder is recorded as a
  follow-up rather than silently swept.

## 5. Support truth after Stage 6

- Browser tab and installed web app remain **Tier 3 — Experimental**. Install,
  offline relaunch, update offer, export, and storage-cleanup behavior were
  verified against the production artifact (Stage 2); the device surface is not.
- ChromeOS Linux ARM64 remains **Tier 3**, separate from native Linux ARM64.
- No native ChromeOS installer exists and none is implied; Android, Windows,
  and macOS packages are not offered as substitutes.
- No `apt`/`dnf` repository is claimed; the manual `.deb` update path is stated.
- No battery, frame-rate, RAM, or NPU claim is published; the 8 GB Duet is the
  optimization target, not a tested device.

## 6. Next smallest verification step

On the Duet: open `varve.studio/download` in tablet mode and confirm the
notice, browser route, and manual chooser; install the web app from
`varve.studio/try/`, finish one online visit, disable Wi-Fi, relaunch from the
launcher, and edit/save/export the sample; record `chrome://version`, viewport,
DPR, and storage estimate. Then repeat the Stage 2 and Stage 5 hardware
checklists. Only that evidence can promote a tier.

## 7. Follow-up research and production consistency (2026-09-13)

This continuation was researched before the follow-up implementation. The
sources below are evidence for the decision, not instructions to run unknown
code. User reports from issue trackers are deliberately separated from vendor
documentation: they identify failure patterns worth preventing, but they do
not establish Varve or ChromeOS support.

### 7.1 Focused research ledger

| Question | Source URL / title | Publisher / access date | Applicable versions / platforms | Finding and confidence | Implementation consequence | Unresolved conflict |
|---|---|---|---|---|---|---|
| How should a below-the-fold video avoid consuming constrained-device bandwidth? | [Lazy-loading video](https://web.dev/articles/lazy-loading-video) | Google web.dev, updated 2026-07-02, accessed 2026-09-13 | Current Chromium and compatible browsers | `preload="none"` prevents a video from being preloaded; `loading="lazy"` can defer poster/metadata work; autoplay overrides preload. **High** | The product recording is user-controlled, uses a poster, and is `preload="none"`/lazy instead of starting when it enters the viewport. | Browser codec and preload behavior still varies; the regression test checks the current Chromium build only. |
| What does a field Core Web Vitals claim require? | [Web Vitals](https://web.dev/articles/vitals) | Google web.dev, accessed 2026-09-13 | Current Chrome/CrUX | LCP ≤ 2.5 s, INP ≤ 200 ms, and CLS ≤ 0.1 are 75th-percentile targets; lab TBT is not field INP. **High** | Follow-up measurements are labeled lab observations and do not claim field performance or editor smoothness. | No consent-approved field telemetry exists, so there is no Varve field sample. |
| What failures do users report when a browser editor is used on weak hardware or connections? | [Photopea #8018](https://github.com/photopea/photopea/issues/8018), [#5756](https://github.com/photopea/photopea/issues/5756), [#7275](https://github.com/photopea/photopea/issues/7275), [#5941](https://github.com/photopea/photopea/issues/5941), [#1066](https://github.com/photopea/photopea/issues/1066) | Photopea public issue tracker, accessed 2026-09-13 | Community reports; not platform certification | Reports include Chromebook/tablet lag, large request bursts/freezes, unbounded tab memory growth, huge-document save failures, and offline expectations not being met. **Low-to-medium signal confidence; individual causes are unverified** | Keep route guidance explicit, do not auto-download heavy media/models, state browser/offline prerequisites, distinguish explicit saves from recovery, and provide bounded escalation data. | Reports are anecdotal and product/version-specific; no numerical Varve limit is inferred from them. |
| What touch/pen failures are visible in another canvas editor? | [Excalidraw #9603](https://github.com/excalidraw/excalidraw/issues/9603), [#9705](https://github.com/excalidraw/excalidraw/issues/9705), [#6474](https://github.com/excalidraw/excalidraw/issues/6474) | Excalidraw public issue tracker, accessed 2026-09-13 | Community reports across iOS/Chromebook touch devices | Reports include coordinate drift, missing palm rejection/gesture handling, slow input, many-element slowdown, and skipped Chromebook pen samples. **Low signal confidence; not reproduced here** | Keep the touch/pen guide explicit about unverified hardware behavior and preserve a no-pen/no-keyboard route; require a real-device pointer test before promoting support. | No user-agent or hardware emulation can prove USI Pen 2 or Duet behavior. |
| Is the deployed website the same artifact as the Stage 6 source? | [Varve download page](https://varve.studio/download/), [Varve troubleshooting](https://varve.studio/support/troubleshooting/), [v0.2.1 release](https://github.com/K-Arthur/varve/releases/tag/v0.2.1), and the repository `release-manifest.json` | Varve production/GitHub/repository, accessed 2026-09-13 | Published v0.2.1 and current `master` source | The live download page still contains the old mobile/tablet block and the live troubleshooting page lacks the structured Stage 6 Chromebook entries. The direct v0.2.1 release is published, while its downloadable updater feed exists; the release prose still says updates are manual. **High for observed drift; feed target usability remains package-specific** | Do not claim deployment is complete. Reconcile the release-note generator and add source checks; request an authorized website deployment/cache validation separately. | A production deployment was not authorized in this task, and GitHub/Pages cache timing can change after publication. |

### 7.2 Follow-up implementation consequence

The previous Stage 6 table correctly described the product recording as an
intersection-observed autoplay. That was still unnecessary work for a marketing
page: it could start a large recording when a visitor did not ask for it, and
the poster was already a sufficient reduced-motion fallback. The source now
keeps the demonstration purposeful and available, but asks the visitor to
press play. The product page's release-route note also links directly to the
Chromebook chooser and browser demo.

The ChromeOS guide now reads filenames, sizes, URLs, and checksums from the
generated release manifest, with a build-time failure if the required ARM64 or
x86_64 Debian artifact is absent. The release-notes generator no longer emits
the blanket “no in-app updater” sentence when a feed is published; it states
that eligibility is target/package-specific and keeps Debian/RPM/manual paths
manual. The product-truth check covers those canonical sources so a future
release bump cannot silently leave v0.2.1 in the Chromebook instructions.

### 7.3 Validation boundary

The source and local production-equivalent build are the evidence boundary for
this continuation. A Playwright Chromium run captures the product route at
desktop, portrait, and narrow widths and asserts that the video has controls,
does not autoplay, and does not request either video source before an explicit
play. Captures are inspected as images, not accepted solely because the test
process passed. No screenshot here proves native ChromeOS, PWA installation,
Linux GUI behavior, touch latency, battery life, RAM headroom, GPU access, or
NPU access.

The live-site mismatch remains a release/deployment follow-up: the smallest
next step is an authorized deploy of the already-built website, followed by a
fresh request to `/download/`, `/docs/chromebook/`, and
`/support/troubleshooting/` with cache headers recorded. Until that happens,
public-production claims must be phrased as “implemented in `master` and
validated in the local production-equivalent build,” not as live-site proof.
