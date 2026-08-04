# Strata — Website Architecture and Launch Plan

**Date:** 2026-08-04
**Status:** implemented and building; not yet deployed

---

## 1. What already existed

A complete Astro 5 site under `apps/website` — 42 pages covering product,
features, docs, support, licensing, privacy and security. Reusing it was the
right call; almost none of it needed rewriting.

Three things made it unshippable, all now fixed:

| Problem | Effect | Fix |
|---|---|---|
| `site: 'https://strata.design'`, `base: '/'` | Domain not owned. On GitHub Pages a project repo serves from `/<repo>/`, so every absolute asset path 404'd and every canonical URL and `og:url` pointed at a host that does not resolve | `SITE_URL`/`SITE_BASE` env vars, defaulting to the Pages URL that actually exists |
| `download.astro` never read `releases.json` | Hardcoded "Get it on GitHub" buttons, invented sizes, version `0.0.0`, and `yay -S strata-desktop` for a package that does not exist | Renders entirely from a generated manifest |
| Plausible loaded unconditionally | A paid subscription pointed at a non-existent domain: cost, no data, third-party request on every page | Opt-in via `ANALYTICS_DOMAIN`; CSP derived from the same flag |

A hand-maintained `public/sitemap.xml` listed 28 absolute URLs under the same
dead domain; it is now generated from the configured site and the actual page
files.

---

## 2. Architecture

```
apps/website/
├── astro.config.mjs           SITE_URL / SITE_BASE driven
├── public/                    static passthrough (favicon, og-image, robots, _headers)
└── src/
    ├── data/
    │   └── release-manifest.json    GENERATED — never hand-edited
    ├── layouts/Layout.astro         meta, OG, CSP, opt-in analytics
    ├── pages/
    │   ├── download.astro           renders from src/data/release-manifest.json
    │   ├── sitemap.xml.ts           generated from site + base + page files
    │   ├── 404.astro
    │   └── … 40 more
    └── test/releases.test.ts        guards manifest honesty
```

### The download manifest flow

```
release.yml  →  dist/release/release-manifest.json   (hashes from real bytes)
                        │
                        ▼
    scripts/release/update-website-manifest.mjs --tag v0.1.0
                        │
                        ▼
    apps/website/src/data/release-manifest.json      (committed)
                        │
                        ▼
    download.astro  →  cards, sizes, checksums, per-platform install steps
```

Nothing about a download is typed by hand. The page cannot advertise a file that
was not built, a size that was not measured, or a checksum that was not computed.

`hasRelease: false` is a first-class rendered state: before the first tag, the
page says there is nothing to download and warns against Strata-branded builds
from elsewhere. This is the default committed state today.

---

## 3. Hosting

| Option | Cost | Verdict |
|---|---|---|
| **GitHub Pages** | Free | **Recommended.** `website-deploy.yml` already exists and works. Artifacts live on GitHub Releases anyway, so the site and the downloads share one trust boundary and one account. Requires a public repo for the free tier |
| Cloudflare Pages | Free | Genuine alternative: unlimited bandwidth, deploy previews, works with a private repo. Adds a second vendor and a second place credentials live. Switch if Pages bandwidth or repo visibility becomes a real constraint |
| Anything else | — | No material advantage |

**Deployment** is unchanged: `.github/workflows/website-deploy.yml` on pushes
touching `apps/website/**`. With a custom domain later, set `SITE_URL` and
`SITE_BASE: /` in that workflow — no source change.

---

## 4. Domain

**Defer.** `k-arthur.github.io/Strata` is a working, free, honest URL.

When it is worth buying (public beta), Cloudflare Registrar sells at cost with
no renewal markup — `.com` at USD $10.44/yr ≈ **CAD $24** with tax and FX
buffer. Verify the renewal price equals the registration price before paying;
that is the trap most registrars set.

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
- [x] Unsigned-build warnings with the correct OS-specific walkthrough
- [x] Data-loss warning, placed **above** the download controls
- [x] Privacy policy matching actual behaviour (no analytics, no cookies)
- [x] Licence, security reporting, support and bug-report links
- [x] Known issues, release notes, roadmap
- [x] SEO + social metadata, favicon, custom 404
- [x] No analytics by default

Outstanding:

- [ ] **Authentic screenshots.** The site currently has none of the application.
      These must be real captures, not mockups
- [ ] Contact method that is not a personal address — needs the domain, or a
      GitHub-only channel in the interim
- [ ] Third-party licence page rendering `THIRD_PARTY_NOTICES`

---

## 6. Accessibility

The repo already runs axe-core through Playwright. For the site specifically,
verify before launch:

- [ ] Keyboard-only path through the download flow, including the platform tabs
- [ ] Visible focus on every interactive element
- [ ] Platform tabs expose correct roles and state (currently plain `<button>`s
      driving `.active` classes — needs `role="tab"`/`aria-selected` or a
      non-tab pattern)
- [ ] Contrast ≥ 4.5:1 in light, dark and high-contrast themes
- [ ] Headings form a sensible outline; one `<h1>` per page
- [ ] Checksum `<details>` blocks are reachable and announced
- [ ] 320 px viewport has no horizontal scroll
- [ ] Prefers-reduced-motion respected

Target WCAG 2.2 AA.

---

## 7. Launch checklist

- [ ] Repository visibility decided (Pages free tier needs public)
- [ ] `website-deploy.yml` run once; site loads at the Pages URL
- [ ] Every internal link resolves under the `/Strata` base path
- [ ] `sitemap.xml` and `robots.txt` serve correctly
- [ ] OG image renders in a link preview
- [ ] Real screenshots added
- [ ] Accessibility pass (§6)
- [ ] Mobile layout checked at 320/375/768 px
- [ ] Download page verified against a **real** release manifest
- [ ] Every checksum on the page matches the published artifact
- [ ] Privacy, licence and security pages re-read for accuracy
