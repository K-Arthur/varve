# Marketing Copy, Positioning, SEO/GEO/AEO Review — 2026-08-04

**Scope:** `apps/website` (Astro 5 marketing site), public release materials
(`docs/release/`), and user-facing strings in `packages/editor`.
**Method:** audit against the running product (codebase verification), not
invented capability. Claims were checked against current source before any
copy was written or kept.
**State at review:** master @ b4a5e3e6, website deployed on GitHub Pages
(`https://k-arthur.github.io/varve/`), no public release tagged
(`release-manifest.json` → `hasRelease: false`), product in active beta.

---

## 1. Audit — weaknesses found

### Discovery infrastructure (SEO/GEO/AEO)
| Issue | Severity | Status |
|---|---|---|
| No `<link rel="canonical">` on any page | High | Fixed |
| `og:image` / `twitter:image` used a relative URL (`/og-image.png`) — resolves to the wrong host under the `/varve` base path; broken when shared | High | Fixed |
| `robots.txt` pointed at `sitemap-index.xml`, which does not exist (the site generates `sitemap.xml`); sitemap undiscoverable | High | Fixed |
| No structured data anywhere (no SoftwareApplication, Organization, WebSite, FAQPage) | High | Fixed |
| `<title>{title} | Varve</title>` duplicated the brand for titles already containing "Varve" ("Features - Varve \| Varve") | Medium | Fixed |
| ~30 pages had no meta description | Medium | Fixed |
| No `og:site_name`, `theme-color`, `og:locale` | Low | Fixed |
| 404 page not marked `noindex` | Medium | Fixed |
| No `llms.txt` (generative-engine discoverability) | Medium | Added |

### Copy / consistency
| Issue | Severity | Status |
|---|---|---|
| `/releases` fabricated a release: "Version: 0.0.0 (development)", hardcoded "Last updated: 2026-07-20", "Download Varve 0.0.0" CTA — while `/download` (manifest-driven) correctly says no release exists. Direct contradiction on a trust-critical page | High | Fixed (manifest-driven) |
| Hero copy did not state the product category or audience ("Design across disciplines. One canvas." with a features list) — a new visitor cannot tell what the product is in the first seconds | Medium | Fixed |
| In-app brand stragglers: onboarding dialog still said "Welcome to Strata" (3 strings); a Did You Know tip, tutorial sample text, exported logo-package README, PDF metadata author, settings and diagnostics copy also said "Strata" after the rename to Varve | High (brand consistency) | Fixed |

### Verified-OK (no change needed)
- Feature/limitation claims on the site match the codebase: text-on-path
  (`sceneToEngine.ts`, `CanvasArea.tsx:1605`), inline text editing
  (`TextEditOverlay.tsx`), CJK line breaking (`textLayout.ts` Intl.Segmenter),
  boolean operations (`createActionHandlers.ts`), PDF/X-1a/X-4 (`exportService.ts`),
  export preflight findings (`runExportPreflight`), video export
  (`motion/videoExportBridge.ts`), Smart Animate, workspace modes.
- Download page integrity messaging (unsigned builds, SHA-256, SBOM) is honest
  and matches `docs/release/budget-plan.md` (Integrity: SHA-256 + SBOM, $0).
- Privacy page ("no analytics, no cookies") matches the build (analytics are
  opt-in and off by default; CSP permits no third-party hosts).
- FAQ "Community Edition" terminology matches `COMMERCIAL.md`.

---

## 2. Positioning

**Category:** local-first, cross-platform design suite (vector + layout +
typography + motion + prototyping + print in one application).

**Primary audience:** independent designers and freelancers; Linux creators;
privacy-conscious designers; technical designers/developers (code export).

**Core problem:** creative work spans disciplines (poster = vector + type +
print; social set = layout + motion + export; UI = components + prototype +
handoff), but existing tools force either separate applications per task, or
cloud subscriptions with account and upload requirements.

**Value proposition:** one application for the full arc of design work —
vector, layout, type, motion, prototype, print — that runs natively on your
machine, works offline, costs nothing, and never uploads your files.

**Differentiators (verifiable):**
1. Local-first by design — no account, no sync, no telemetry; files on disk.
2. Free and source-available (FSL-1.1-MIT) — no subscription, no feature
   lockouts; converts to MIT after two years per release.
3. Native Rust engine on desktop, WASM on web, one architecture.
4. Print production depth in a free tool (CMYK + ICC, PDF/X-1a/X-4, marks,
   preflight) — rare in the free segment.
5. Honest development — solo-built, publicly documented limitations, beta
   status stated everywhere a download is offered.

**Alternatives users compare against:** Figma, Adobe Illustrator/InDesign/
After Effects (suite), Sketch, Affinity, Inkscape, Penpot.

**When Varve is NOT the right choice (stated on /product):** critical paid
production deadlines today, teams needing real-time collaboration, Arabic/
Hebrew/Devanagari text, Linux/Windows ARM.

---

## 3. Audiences, intents, search intents

| Audience | Intent | Search terms |
|---|---|---|
| Freelancer/independent designer | Replace multi-tool + subscription workflow | "design software no subscription", "local first design app", "free design suite" |
| Linux creator | Native design tool on Linux | "design software linux", "linux vector design app", "linux alternative to figma" |
| Privacy-conscious user | No cloud/account/tracking | "design tool without cloud", "offline design software", "no account design app" |
| Technical designer | Code export, architecture | "design to code", "flutter export from design tool", "rust design engine" |
| Print designer | CMYK/PDF-X on a budget | "free pdf/x export", "cmyk design software free" |
| Early adopter | Evaluate beta, influence roadmap | "varve design app", "varve beta" |

---

## 4. Changes implemented

### `apps/website/src/layouts/Layout.astro`
- Canonical URL (site + base path, trailing-slash normalized).
- Absolute `og:image`/`twitter:image` joined with site + base.
- `og:site_name`, `og:locale`, `theme-color` (dark/light).
- Title de-duplication (`Features - Varve` no longer renders `| Varve` twice).
- Sitewide JSON-LD: `Organization` + `WebSite`.
- `structuredData` prop for per-page schemas; `noindex` prop for 404.
- `robots` meta (`index, follow` default, `noindex, nofollow` on 404).

### `apps/website/src/pages/releases.astro`
- Rewritten to read `src/data/release-manifest.json` (same source of truth as
  /download). No release tagged → page says so, links to GitHub releases and
  /features. Release-tagged state renders version/date/channel from the
  manifest. Removed fabricated 0.0.0 / hardcoded date / "Download Varve 0.0.0".

### `apps/website/src/pages/index.astro`
- Hero subtitle now answers "what/who/why" in one sentence (category,
  platforms, free, local-first, no subscription/account/uploads) while keeping
  the existing H1 brand line.
- Secondary CTA now targets the AEO/definition intent: "What is Varve?" →
  `/product` (was "See what's built" → `/features`).
- Added `SoftwareApplication` JSON-LD (DesignApplication, OS list, free offer).

### `apps/website/src/pages/support/faq.astro`
- Added `FAQPage` JSON-LD mirroring the 10 visible Q&As (licensing, pricing,
  platforms, collaboration, print, ARM, export, contribution).

### `apps/website/src/pages/product.astro`
- Added "Who Varve is not for (yet)" — honest fit guidance for answer engines
  and conversion de-risking.

### All remaining pages
- Distinct meta descriptions added (~30 pages: about, learn, support,
  contribute, support-project, privacy, security, license, features/*,
  support/*, learn/*, docs/*). Titles normalized to a single style; brand
  appended once by the Layout.

### `apps/website/public/robots.txt`
- Sitemap URL corrected to the generated `sitemap.xml` (was a nonexistent
  `sitemap-index.xml`), with a comment tying it to SITE_URL/SITE_BASE.

### `apps/website/public/llms.txt`
- Added: factual project summary + key facts + links to the highest-value
  pages, for generative engines (GEO) and LLM crawlers. Relative links resolve
  against the file's own path so a future domain change does not break it.

### `packages/editor` — brand stragglers ("Strata" → "Varve")
- `components/Onboarding/WelcomeDialog.tsx` (dialog title, heading, icon label)
- `onboard/DidYouKnow/tips.ts` (undo tip)
- `samples/tutorial-document.ts` (sample doc text)
- `logo/logoPackageExport.ts` (exported logo-package README, 3 strings)
- `components/SpecPanel/export.ts` (PDF metadata `author`, 3 sites)
- `components/Settings/SettingsDialog.tsx` (shortcut-reserved copy)
- `components/Settings/ModelManager.tsx` (diagnostics header)

Comments and internal identifiers containing "Strata" were left untouched
(no user impact; avoids churn in concurrently-edited files).

---

## 5. Claims removed / softened / requiring evidence

| Claim | Action | Reason |
|---|---|---|
| "Version: 0.0.0 (development)" + "Download Varve 0.0.0" on /releases | Removed | No such release exists; contradicted the manifest-driven download page |
| "Last updated: 2026-07-20" (hardcoded release date) | Removed | Static dates rot; now derived from the manifest when a release exists |
| "Previous releases: none" hardcoded | Softened | Now conditional on `hasRelease` |
| All remaining feature claims (boolean ops, CJK, inline editing, text-on-path, PDF/X, preflight, video export, workspace modes, u2netp) | Retained | Each verified against source at review time |
| "Community Edition" terminology | Retained | Matches COMMERCIAL.md; only the free edition exists today |

No fabricated testimonials, fake urgency, or dark patterns were present.

---

## 6. Verification

- `pnpm --filter @varve/website build` (astro check + build) — passed.
- Website e2e (`pnpm --filter @varve/website test:e2e`): assets, axe, theme,
  visibility, content specs — passed; visual snapshots regenerated
  deliberately (`--update-snapshots`) because hero copy and layout changed.
- Editor unit tests for touched packages (`packages/editor`,
  `packages/engine`) — passed; no test asserted the old "Strata" strings
  (verified by grep before editing).
- `pnpm lint` on touched files — passed.

## 7. Remaining limitations / recommendations

1. **No analytics by design** (privacy page + budget plan). Conversion
   measurement is limited to GitHub per-asset download counts. If this
   changes, enable Plausible via `ANALYTICS_DOMAIN` **and** update
   `/about/privacy` first — the copy currently promises no analytics.
2. **No domain.** The site lives at `k-arthur.github.io/varve`. A custom
   domain (e.g. `varve.design`) materially improves brand recall, canonical
   stability, and shareability; `SITE_URL`/`SITE_BASE` already support it.
3. **`og-image.png`** — confirm the image visually represents the product
   (screenshot of the canvas would outperform the logo mark for social shares).
4. **`/learn` tutorials and examples are placeholders** — highest-value
   long-tail SEO content gap; a couple of real walkthroughs targeting
   "text on path", "PDF/X export", "Smart Animate" queries would compound.
5. **Releases page** currently shows no content while `hasRelease` is false —
   consider a "What's being built" roadmap teaser (links to
   `docs/plans/` are fine; GitHub milestones would be better) once a release
   cadence exists.
6. **In-app strings** outside `packages/editor` (e.g. Rust crate comments,
   `tauri.conf.json` product metadata) were not audited here — the Tauri
   `productName`/`longDescription` should be checked against "Varve" before
   the first release build.
7. **Sitemap `lastmod`/`changefreq`** are static; acceptable for a static
   site, revisit after the first release.
