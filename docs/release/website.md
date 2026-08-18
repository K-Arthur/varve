# Varve — Website Architecture and Launch Plan

**Date:** 2026-08-04 (updated 2026-08-12)
**Status:** implemented, deployed and live at **https://varve.studio** (custom domain, registered and DNS at Porkbun, hosted on GitHub Pages). See `custom-domain-runbook.md` for the DNS records, GitHub configuration and rollback.

---

## 1. What already existed

A complete Astro 7 site under `apps/website` — 42 pages covering product,
features, docs, support, licensing, privacy and security. Reusing it was the
right call; almost none of it needed rewriting.

Three things made it unshippable, all now fixed:

| Problem | Effect | Fix |
|---|---|---|
| `site: 'https://strata.design'`, `base: '/'` | Domain not owned. On GitHub Pages a project repo serves from `/<repo>/`, so every absolute asset path 404'd and every canonical URL and `og:url` pointed at a host that does not resolve | `SITE_URL`/`SITE_BASE` env vars, defaulting to the Pages URL that actually exists |
| `download.astro` never read `releases.json` | Hardcoded "Get it on GitHub" buttons, invented sizes, version `0.0.0`, and `yay -S varve-desktop` for a package that does not exist | Renders entirely from a generated manifest |
| Plausible loaded unconditionally | A paid subscription pointed at a non-existent domain: cost, no data, third-party request on every page | Varve-owned consent-gated Events API adapter; `ANALYTICS_DOMAIN` unset means no prompt or request |

A hand-maintained `public/sitemap.xml` listed 28 absolute URLs under the same
dead domain; it is now generated from the configured site and the actual page
files.

---

## 2. Architecture

```
apps/website/
├── astro.config.mjs           SITE_URL / SITE_BASE driven
├── public/                    static passthrough (favicon, og-image, llms.txt)
├── src/
    ├── data/
    │   └── release-manifest.json    GENERATED — never hand-edited
    ├── lib/siteUrl.ts               ONE URL system: sitePath/siteUrl/canonical
    ├── layouts/Layout.astro         meta, OG, CSP, consent surface, active nav
    ├── lib/analytics.ts              normalized routes + explicit Plausible adapter
    ├── pages/
    │   ├── download.astro           renders from src/data/release-manifest.json
    │   ├── sitemap.xml.ts           generated from site + base + page files
    │   ├── robots.txt.ts            generated from site + base (sitemap URL)
    │   ├── 404.astro
    │   └── … 40 more
    └── test/                        guards manifest honesty + URL rules
```

### The download manifest flow

Two paths produce the website's release data; both write through
`scripts/release/website-release-data.mjs`, both verify before writing, and
both derive everything from real bytes:

```
release.yml  →  dist/release/release-manifest.json + SHA256SUMS.txt + SBOMs
                        │
                        ├─ CI path (release workflow `completed` → website-deploy.yml)
                        │    fetch-website-release.mjs
                        │      • channel policy: latest published STABLE, else
                        │        latest published prerelease; drafts never
                        │        appear (deleted/withdrawn releases are drafts
                        │        internally and are skipped too)
                        │      • verifies manifest version == tag, every
                        │        artifact hash == SHA256SUMS.txt, known formats,
                        │        no unmanifested installers, SBOM coverage
                        │      • any failure FAILS the deployment
                        │      ▼
                        └─ offline path (rehearsal/local)
                             update-website-manifest.mjs --tag v0.1.0
                              │
                              ▼
    apps/website/src/data/release-manifest.json      (written at build time;
                                                       committed fallback is the
                                                       honest no-release state)
                        │
                        ▼
    download.astro  →  cards, sizes, checksums, per-platform install steps
```

The same published release also carries the signed Tauri updater feed when the
release workflow produces one. `fetch-website-release.mjs` mirrors the latest
published stable and beta feeds to the static routes
`/updates/stable.json` and `/updates/beta.json`; drafts, withdrawn releases, and
older releases without updater assets are not promoted. These machine-readable
routes are consumed by supported desktop installs, while the human-facing
package matrix and consent explanation live in
[`/docs/updates`](../../apps/website/src/pages/docs/updates.astro) and the
download page. The website does not promise self-update for package-manager,
read-only, translocated, development, or unsupported builds.

Nothing about a download is typed by hand. The page cannot advertise a file that
was not built, a size that was not measured, or a checksum that was not computed.
When a release cannot be verified (missing integrity files, hash mismatch,
unknown artifact types, API outage) the deployment fails — an explicit error
beats a download page that invents data.

### Updater feeds

The same deployment step mirrors the Tauri updater feeds:

```
release.yml → dist/release/varve-update-{stable,beta}.json   (generated after
              the release trust gate, from the exact signed .sig/.app.tar.gz
              assets; see docs/release/update-strategy.md)
                        │
                        ▼
fetch-website-release.mjs → apps/website/public/updates/{stable,beta}.json
                        │   (only from PUBLISHED releases; drafts never
                        │    appear; malformed/version-mismatched feeds FAIL
                        │    the deployment)
                        ▼
https://varve.studio/updates/stable.json   ← the endpoint embedded in
https://varve.studio/updates/beta.json       tauri.conf.json / the per-channel
                                             build config
```

Because the feed URLs point at GitHub release-download URLs for the artifacts,
the JSON is only mirrored after the release is public — a draft release's
assets 404, and `fetch-website-release.mjs` only considers published releases.
This is the "publish update metadata last" invariant in action: a client can
never see version X advertised before X's assets and signatures exist.

`hasRelease: false` is a first-class rendered state: before the first tag, the
page says there is nothing to download and warns against Varve-branded builds
from elsewhere. This is the default committed state today.

---

## 3. Hosting

| Option | Cost | Verdict |
|---|---|---|
| **GitHub Pages** | Free | **Recommended.** `website-deploy.yml` already exists and works. Artifacts live on GitHub Releases anyway, so the site and the downloads share one trust boundary and one account. Requires a public repo for the free tier |
| Cloudflare Pages | Free | Genuine alternative: unlimited bandwidth, deploy previews, works with a private repo. Adds a second vendor and a second place credentials live. Switch if Pages bandwidth or repo visibility becomes a real constraint |
| Anything else | — | No material advantage |

**Deployment** is `.github/workflows/website-deploy.yml`: pushes touching
`apps/website/**` or `scripts/release/**`, plus a `workflow_run` trigger
fired by the Release workflow's `completed` event (the download page is
rebuilt from the exact published assets), plus manual
dispatch. The workflow runs the full quality gate (typecheck, unit tests,
both-mode builds, axe/link e2e) before uploading, and smoke-checks the live
URL after deploying (`scripts/website/smoke-pages.mjs`). With a custom domain
later, set `SITE_URL` and `SITE_BASE: /` — no source change; see
`custom-domain-runbook.md`.

GitHub Pages cannot set arbitrary security headers (`_headers` files are
ignored there — the old `public/_headers` was removed). CSP is enforced via
the `<meta>` tag in `Layout.astro`; X-Frame-Options/HSTS are not settable on
this host and are not claimed.

---

## 4. Domain

**Purchased 2026-08-12: `varve.studio`, registered at Porkbun.** Porkbun is
the registrar AND the DNS provider (nameservers `curitiba/fortaleza/maceio/
salvador.ns.porkbun.com`). Hosting stays on GitHub Pages; Porkbun hosting is
not used. Canonical origin is `https://varve.studio`; `www.varve.studio`
canonicalizes there. See `custom-domain-runbook.md` for the exact DNS records,
GitHub Pages settings, verification state and rollback.

Do not buy `.design` (~USD $40–50/yr) for a vanity TLD at alpha.

One dependency worth knowing: a Microsoft Store **Company** account requires a
work email on a domain you own. If commercial distribution is the goal, the
domain stops being optional.

---

## 5. Content inventory

Present and accurate:

- [x] Product name, description, supported platforms, system requirements
- [x] Download links, sizes, versions, release date — all generated
- [x] SHA-256 checksums per artifact, plus a link to `SHA256SUMS.txt`
- [x] SBOM link
- [x] Per-platform install instructions
- [x] Per-platform trust labels derived from the manifest `signing` block
      (verified state, never intent) — "Digitally signed" / "Developer ID
      signed and notarized" only when the corresponding verification report
      says so
- [x] Unsigned-build warnings with the correct OS-specific walkthrough
- [x] Data-loss warning, placed **above** the download controls
- [x] Privacy policy matching actual behaviour (consent-gated analytics, no cookies)
- [x] Licence, security reporting, support and bug-report links
- [x] Known issues, release notes, roadmap
- [x] SEO + social metadata, favicon, custom 404
- [x] No analytics by default; configured production analytics requires explicit visitor consent
- [x] Consent-first updater guidance: package authority, privacy, signature verification, and manual fallbacks

### Advanced verification (for users who want to verify provenance)

```bash
# 1. Integrity: the published checksum must match the downloaded file
sha256sum -c SHA256SUMS.txt            # Linux
shasum -a 256 -c SHA256SUMS.txt        # macOS
Get-FileHash .\Varve-*.exe -Algorithm SHA256   # Windows

# 2. Build provenance: the file must be attested by the release workflow
gh attestation verify ./Varve-0.1.0-windows-x86_64.exe -R K-Arthur/varve

# 3. Platform signatures (post-signing releases):
#    Windows: right-click -> Properties -> Digital Signatures (status "Valid"),
#    or: signtool verify /pa /v Varve-0.1.0-windows-x86_64.exe
#    macOS:  xcrun stapler validate Varve-0.1.0-macos-aarch64.dmg
```

An attestation proves the file came from the Varve release workflow; it is NOT
a Windows Authenticode signature and NOT Apple notarization — for signed
platforms, check the signature in the OS UI as well.

Outstanding:

- [x] **Authentic screenshots.** Real captures of the application now exist
      (captured 2026-08-09 via the deterministic pipeline;
      `apps/website/public/screenshots/`, driven by
      `apps/website/src/data/screenshot-manifest.json` + `ProductShowcase.astro`)
- [ ] Contact method that is not a personal address — needs the domain, or a
      GitHub-only channel in the interim
- [ ] Third-party licence page rendering `THIRD_PARTY_NOTICES`

---

## 6. Accessibility

The repo already runs axe-core through Playwright. The route-wide
computed-style contrast audit (`apps/website/tests/e2e/visibility.spec.ts`)
and the axe suite cover the site in both deployment modes:

- [x] Keyboard-only path through the download flow, including the platform tabs
      (arrow-key tablist navigation, Home/End, focus management)
- [x] Platform tabs expose `role="tablist"`/`role="tab"`/`aria-selected`/`aria-controls`
- [x] Copy-checksum buttons announce results via an aria-live region
- [x] Active navigation state (`aria-current="page"`)
- [x] Escape-to-close and focus return for the mobile menu
- [x] Visible focus on every interactive element (axe + computed-style audits)
- [x] Contrast ≥ 4.5:1 in light and dark themes (route-wide computed-style audit; the decorative footer wordmark is aria-hidden and excluded)
- [x] Headings form a sensible outline; one `<h1>` per page (axe rule)
- [x] Checksum `<details>` blocks are reachable and announced
- [x] 320 px viewport has no horizontal scroll (structural visibility audit)
- [x] Prefers-reduced-motion respected (theme test + reduced-motion emulation)

Target WCAG 2.2 AA — enforced by the CI website e2e gate.

## 7. Launch checklist

- [x] Repository visibility decided (Pages free tier needs public)
- [x] `website-deploy.yml` run once; site loads at the Pages URL
- [x] Every internal link resolves under the `/varve` base path (link-crawl e2e)
- [x] `sitemap.xml` and `robots.txt` serve correctly (smoke check + e2e)
- [x] OG image renders in a link preview
- [x] Real screenshots added (2026-08-09)
- [x] Accessibility pass (§6)
- [x] Mobile layout checked at 320/375/768 px (e2e)
- [x] Download page verified against a **real** release manifest (v0.1.0, published 2026-08-09)
- [x] Every checksum on the page matches the published artifact
- [x] Privacy, licence and security pages re-read for accuracy
- [x] Post-deployment smoke check wired into the workflow (`scripts/website/smoke-pages.mjs`)
