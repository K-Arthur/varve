# Marketing Copy Review — 2026-08-10

**Scope:** `apps/website` marketing surfaces (homepage, hero, download,
releases, product, features, support-project, about), the shared
`PRODUCT_STATUS` source of truth, and the release-data script that generates
download-page copy.
**Method:** audit against the running product and repository state — every
claim checked against source, docs, or the committed release manifest before
being kept or changed.
**State at review:** master @ 0699bcd5, first public release **Varve 0.1.0**
published 2026-08-09 (`release-manifest.json` → `hasRelease: true`,
`signed: false`, `notarized: false`), product in public beta
(`PRODUCT_STATUS.stage: 'beta'`).

---

## 1. Messaging problems found

| Issue | Severity | Status |
|---|---|---|
| `/support-project` sponsorship tiers promised benefits that do not exist: "Name/Logo on supporters page" (no supporters page exists anywhere), "SLA for critical bugs", "Custom integration support", "Monthly development update email", "Early access to release notes" (release notes are public the moment a release is tagged), "Discord/badge" (no Discord), "Company logo on homepage" | High (unverifiable commitments) | Fixed |
| Release channel labelled **"Stable"** on `/download` and `/releases` (`prerelease: false` → "Stable"), contradicting the "public beta" positioning on every other surface | High (positioning contradiction) | Fixed |
| `/product` implied a usable web product: "with a WASM-based web version using the same architecture" — the WASM build exists for the web target, but no hosted web app is deployed (llms.txt already said so; the product page did not) | High (overstated availability) | Fixed |
| "No feature creep" on `/product` — unsupported absolute claim | Low | Softened |
| Mixed spelling "notarised/notarized" in macOS download caveats (site copy + generated manifest + release-data script) | Low | Unified to US spelling |
| Broken import in `/about/security`: `../data/release-manifest.json` from `src/pages/about/` resolves to a nonexistent path — the page cannot build | High (broken page, pre-existing) | Fixed |
| `/learn/tutorials` presents feature pages as "tutorials" with invented durations ("20 minutes") | Medium | **Not fixed** — file is being concurrently edited by another agent; see §6 |
| "Free forever" (TrustStrip, FAQ) | Retained | Documented commitment in `COMMERCIAL.md` ("Community Edition ... stays free") |
| "no uploads" (hero) | Retained | Verified: `@varve/crash` contains no network code; model downloads are explicit user-initiated downloads, not uploads |
| "HarfBuzz-grade care" (DisciplineTabs) | Retained | Supported: browser shaping via the native HarfBuzz-based text engine; print shaper in `crates/varve-print` |
| "Zoom range 0.001x-64x" (/releases) | Retained | Verified: `packages/shared/src/viewport.ts` `MIN_ZOOM = 0.001`, `MAX_ZOOM = 64` |

## 2. Audience and positioning (unchanged from 2026-08-04 review)

**Category:** local-first, cross-platform design suite (vector + layout +
typography + motion + prototyping + print in one application).

**Audience:** independent designers and freelancers; Linux creators;
privacy-conscious designers; print designers on a budget; technical
designers (code export).

**Positioning:** one application for the full arc of design work that runs
natively on your machine, works offline, costs nothing, and does not upload
your files — with the honest caveat that it is a young beta.

**Channel rule added:** a release tagged "Stable" on GitHub is still
described as **Beta** while `PRODUCT_STATUS.stage !== 'stable'`; the product
stage, not the GitHub prerelease flag, decides how a release is labelled on
the website.

## 3. Changes implemented

### `apps/website/src/pages/support-project.astro`
Sponsorship section rewritten around what a solo project can actually
deliver:
- Removed: supporters page, Discord/badge, SLA for critical bugs, custom
  integration support, monthly update email, early-access release notes,
  homepage logo placement, priority bug/feature consideration.
- Kept: tier price ranges and the GitHub Sponsors link.
- New tier copy: recognition in release notes (with permission) — name,
  larger entry with link, featured placement, company logo — plus "a direct
  conversation about what to build next" for Gold/Corporate.
- Added an explicit line: no paid edition; sponsorship does not buy
  features, early builds, or support contracts.
- Transparency section now says acknowledgment happens in release notes
  (was: "acknowledged on the website", which no mechanism supports).

### `apps/website/src/pages/releases.astro` + `apps/website/src/pages/download.astro`
- Channel label now derives from `PRODUCT_STATUS.stage`:
  `Prerelease` / `Stable` (only when the product stage is stable) / `Beta`.
- v0.1.0 now renders "Beta" instead of "Stable" on both pages.

### `apps/website/src/pages/product.astro`
- Intro: "It runs natively on Linux, macOS, and Windows. The same engine is
  compiled to WASM for the web target, but there is no hosted web app yet —
  the desktop installers are how you use Varve today."
- Local-first section: same qualification ("a hosted web app is not
  available yet").
- "No feature creep" replaced with "no feature-checklist deadlines —
  features are built when they work, not when they sound good in marketing
  copy" (matches the About page's own philosophy wording).

### `apps/website/src/pages/about/security.astro`
- Fixed broken manifest import (`../../data/release-manifest.json`). The
  page could not build before this change.

### `apps/website/src/components/DownloadCTA.astro`
- Beta chip now shows `PRODUCT_STATUS.label` ("Public Beta") instead of
  `PRODUCT_STATUS.stage` ("beta") — same source of truth, better badge copy.

### `packages/shared/src/product.ts`
- `ProductStatusStage` is now a declared union type
  (`'pre-alpha' | 'alpha' | 'beta' | 'stable'`), matching the documented
  contract and the test's `STAGES` list; previously it was derived from the
  `as const` object and collapsed to the literal `'beta'`, which made any
  future-stage comparison a type error.
- `PRODUCT_STATUS` is now explicitly typed with `stage: ProductStatusStage`
  (no `as const`), so consumers can compare `PRODUCT_STATUS.stage ===
  'stable'` legally. No consumer behavior changes.

### `scripts/release/website-release-data.mjs` + `apps/website/src/data/release-manifest.json`
- "notarised" → "notarized" in the macOS caveat/caveatSigned strings, in
  both the generator script and the committed manifest (site-wide US
  spelling consistency).

## 4. Claims verified, softened, removed

| Claim | Action |
|---|---|
| Sponsor tier benefits (supporters page, SLA, Discord, update email, etc.) | Removed — no evidence any exists |
| "Channel: Stable" for v0.1.0 | Changed to Beta (product-stage-derived) |
| WASM "web version" availability | Softened to "no hosted web app yet" |
| "No feature creep" | Softened |
| "Free forever" / Community Edition stays free | Retained — documented in `COMMERCIAL.md` |
| "No telemetry / nothing leaves your machine" | Retained — verified in `packages/crash` (no network code) |
| Feature claims on /features, /releases (video export, PDF/X, CMYK, boolean ops, CJK, zoom range, multi-page) | Retained — each verified against source at this review |
| macOS/Windows unsigned-build caveats | Retained — derived from manifest verification state, now spelling-consistent |
| Security response "within 48 hours" (About) | Retained — matches `SECURITY.md` and `/about/security` |

## 5. Risks flagged (not legal advice)

- **GitHub Sponsors link** (`github.com/sponsors/K-Arthur`): existence not
  verified from inside the repo; confirm the profile is active before
  promoting it further.
- **Sponsor recognition in release notes**: the mechanism is now promised
  in tier copy — it must actually ship (a supporters section in release
  notes) or the tiers should be simplified again.
- **/learn tutorials page** still describes feature pages as tutorials with
  invented durations; see §6.
- **Brand/edition terminology** ("Community Edition", "Free forever") is
  a documented project commitment; if a paid edition is ever introduced,
  the promise language must be revisited with legal review.
- Release-manifest caveat strings are generated by
  `scripts/release/update-website-manifest.mjs`; the committed manifest was
  hand-corrected for spelling — the generator produces "notarized" now, but
  the next manifest refresh must be checked to confirm the correction
  survives regeneration.

## 6. Not fixed (concurrent work)

`/learn/tutorials`, `/learn/examples`, `/learn/community`, `/support/*`, and
the `/docs/*` pages are being edited by another agent in the same working
tree (uncommitted changes present). The tutorials page still needs: honest
card copy (no invented durations, no "Master …" framing for pages that are
feature docs), and either real walkthroughs or labels that say what the
links actually are. Recommend a follow-up pass once the concurrent edits
land.

## 7. Verification performed

- `pnpm --filter @varve/shared build` (tsc --noEmit) — passed.
- `pnpm --filter @varve/shared test` — 798/798 passed.
- `pnpm --filter @varve/website build` (astro check + build, 42 pages) —
  passed.
- `pnpm exec vitest run apps/website/src/test` — 144/144 passed.
- Playwright e2e (ghpages project): axe, navigation, assets suites (22
  tests, includes the download page and the 320px overflow check) — passed.
- `pnpm exec biome check` on every touched file — clean.

**Pre-existing failures NOT caused by this change** (working tree is
mid-migration from the vite/vitest deps bump, commit c0edaa2b):
- `pnpm typecheck` fails in `packages/editor` (`ScaleTool.test.ts` vitest
  mock typing — file unmodified by this review, imports only affine helpers)
  and `apps/desktop` (CSS-module imports TS2882/TS6263).
- `scripts/screenshots/demo-document.ts` fails `tsc` (stale `Document`
  import) when typechecked from the website project.
- Untracked probe files (`probe-contrast2.mjs`, `probe-pagenav.mjs`) left
  untouched.
