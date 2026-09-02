# Varve positioning and discovery brief

**Status:** Current operating brief  
**Last verified:** 2026-09-02  
**Owner:** Varve project maintainer

This is the source of truth for public-facing positioning, audience priorities,
search intent, and claim hygiene. It complements the dated marketing audits in
`docs/audits/`; it does not replace product or release documentation.

## Positioning

**Category:** Varve is a local-first, cross-platform desktop design suite for
vector graphics, page layout, typography, motion, prototyping, and print
production.

**Primary audience:** independent and multidisciplinary designers, Linux
creators, privacy-conscious freelancers, and technical designers who need to
move from visual work to code or print output.

**Problem:** a single project often crosses vector, layout, type, motion,
prototype, and print tasks. Existing workflows can require multiple
applications, account-based cloud storage, or a platform that does not support
the creator's machine.

**Value proposition:** Varve keeps those disciplines in one document model and
one desktop application. It is free to use, requires no account, stores work
locally, and supports offline core editing on Linux, macOS, and Windows.

**Positioning sentence:**

> Varve is the free, local-first design suite for creators whose work crosses
> vector, layout, type, motion, prototyping, and print — in one cross-platform
> desktop application.

### Message hierarchy

1. **What it is:** a design suite, not a hosted web editor or a single-purpose
   vector app.
2. **Who it is for:** independent creators and teams of one who move between
   disciplines, especially on Linux or with local-file requirements.
3. **Why it matters:** one document and one workflow reduce context switching
   between separate design applications.
4. **Why believe it:** the repository contains the Rust desktop engine, the
   shared document model, implemented feature pages, real application
   screenshots, and a generated release/download manifest.
5. **Trust qualifier:** Varve is public beta. Collaboration is not implemented,
   complex-script text support is still in development, and the `.varve` format
   may change. The website must keep those limitations adjacent to conversion
   paths.

### Category essentials and differentiators

| Type | Message | Evidence / public surface |
|---|---|---|
| Essential | Vector tools, layout, typography, export, and documentation | `apps/website/src/pages/features/`, `apps/website/src/pages/docs/` |
| Essential | Supported platforms and install requirements | Generated release manifest and `/download` |
| Differentiator | No account or mandatory cloud sync; core editing works offline | `/product`, `/about/privacy`, `/support/faq` |
| Differentiator | One document model spans vector, layout, type, motion, prototyping, and print | `/product`, `/features`, workspace and print architecture docs |
| Differentiator | Free Community Edition with source available under FSL-1.1-MIT | `/about/license`, `COMMERCIAL.md` |
| Differentiator | Native Linux support and a Rust desktop engine | Product architecture and `/features/canvas` |
| Proof of maturity | Public beta, published release, checksums, SBOMs, and known issues | `/releases`, `/download`, `/support/known-issues` |

Varve should not claim that it is the best, fastest, most secure, or most
complete option without a current, reproducible measure. “Native” describes
the desktop application and engine; it does not imply every feature has equal
platform parity.

## Audience and search-intent map

Search pages should answer a clear question and lead to the next useful action.
Do not create location pages, competitor doorway pages, or thin keyword pages.

| Audience | User question | Search themes | Canonical page | Next action |
|---|---|---|---|---|
| Linux creator | What design software runs natively on Linux? | Linux design app, Linux vector editor, Linux print design | `/product` and `/download` | Check requirements and download |
| Independent designer | Can one tool cover vector, layout, motion, and print? | free design suite, multidisciplinary design app | `/features` and `/product` | Explore a feature or start beta |
| Privacy-conscious creator | Can I design without an account or cloud storage? | offline design software, local-first design tool | `/features/local-first` and `/about/privacy` | Read data handling, then download |
| Print designer | Can a free tool export CMYK PDF/X files? | free CMYK design software, PDF/X export | `/features/print-production` and `/features/export` | Review preflight limits |
| Technical designer | Can design work become code? | design to React, Flutter export, SwiftUI export | `/features/export` | Review supported outputs |
| Evaluating a beta | Is Varve ready for my workflow? | Varve beta, Varve alternative | `/compare`, `/releases`, `/support/known-issues` | Test with backups |

The primary conversion path is `homepage → product/features → download`. The
trust path is `homepage → privacy/license/security/release notes`. Documentation
and feature pages should link into one of those paths rather than ending in an
orphaned article.

## SEO, GEO, and AEO implementation contract

The website implements the following technical contract:

- Every indexable page has a distinct title, description, canonical URL,
  robots directive, Open Graph card, and Twitter card from
  `apps/website/src/layouts/Layout.astro`.
- Every indexable page emits `Organization`, `WebSite`, `BreadcrumbList`, and
  page-level `WebPage` JSON-LD. Product, FAQ, download, and getting-started
  surfaces add only schemas that match visible content.
- `/robots.txt` points to the generated `/sitemap.xml`; the sitemap is derived
  from actual page routes and excludes 404 and compatibility aliases.
- `/llms.txt` is a concise, human-readable fact sheet. It must be refreshed
  when release status, platform support, licensing, privacy behavior, or
  public limitations change.
- Important answers appear as visible headings and paragraphs first. JSON-LD
  mirrors visible content; it is not a second claims database.
- Real screenshots use descriptive alt text and are linked to the feature or
  workflow they demonstrate. Mockups and generated testimonials are not used
  as product proof.

### Page ownership

| Intent | Page role | Required facts |
|---|---|---|
| Definition | `/product` | category, audience, value, boundaries, beta status |
| Discovery | `/` and `/features` | message hierarchy, implemented capabilities, primary CTA |
| Decision | `/compare` | verifiable differences and honest non-fit cases |
| Transaction | `/download` | published artifacts, requirements, checksums, signing state |
| Answers | `/support/faq` and `/docs/*` | direct questions, current behavior, limitations |
| Trust | `/about/privacy`, `/about/license`, `/security`, `/releases` | data, license, disclosure, release provenance |

## Claim register

### Approved when kept qualified

- “Free” means the current Community Edition has no subscription or feature
  paywall; it does not promise that every future edition will have the same
  terms.
- “Local-first” means no account or mandatory cloud sync is required and core
  editing works offline. Optional model/font downloads, update checks,
  user-configured providers, and consented aggregate measurements remain
  separate network features.
- “Cross-platform” means the currently published installers and requirements
  listed on `/download`; macOS is Apple Silicon only.
- “Source-available” means FSL-1.1-MIT, not OSI-approved open source. Each
  release converts to MIT after two years under the license terms.
- “Print production” means the implemented CMYK/ICC, PDF/X, marks, and
  preflight workflows, with beta caveats and a recommendation to test before
  critical work.

### Removed or prohibited

- Fabricated release versions, dates, installer sizes, package-manager
  commands, testimonials, customer logos, awards, user counts, or performance
  numbers.
- “Real-time collaboration” as an available capability; current status is
  single-user with UI scaffolding only.
- “Hosted web app” or “web version” as a download destination; the WASM target
  exists in the repository, but no hosted web editor is available.
- Absolute privacy claims such as “nothing ever leaves your machine”; they are
  inaccurate once a user opts into a model download, update check, aggregate
  measurement, or their own provider.

## Measurement and maintenance

The default production build sends no analytics and shows no consent prompt.
When `ANALYTICS_DOMAIN` is deliberately configured, the website may collect
consented aggregate routes and enumerated download properties only. Evaluation
should therefore use:

- GitHub release asset counts for download completion and platform mix;
- consented website events for CTA and route-funnel questions;
- support questions and issue labels for intent gaps and onboarding friction;
- release and documentation audits for claim accuracy.

Before publishing a copy change:

1. Verify the claim against the implementation, release manifest, or a current
   policy document.
2. Put the answer on the canonical page for its intent and link from related
   pages.
3. Update `/llms.txt` and this brief when a core fact changes.
4. Run the website type/unit checks, the affected website E2E corpus, and the
   representative visual and accessibility checks.

## External category references

These are reference points for user expectations, not endorsements or copy to
imitate. Recheck before changing the comparison page:

- [Figma Design](https://www.figma.com/design/) — collaborative, browser-based
  product-design workflows.
- [Adobe Illustrator](https://www.adobe.com/products/illustrator.html) —
  vector graphics and illustration software.
- [Penpot](https://penpot.app/design/ux-design) — open-source UX design and
  prototyping platform.
- [Inkscape](https://inkscape.org/) — free and open-source vector graphics
  editor.
- [Sketch](https://www.sketch.com/design/) — Mac-native design with web and
  collaboration surfaces.

