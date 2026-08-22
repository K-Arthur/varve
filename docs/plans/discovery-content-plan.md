# Discovery & Content Architecture Plan

Status: prepared (implementation only where marked IMPLEMENTED). Owned by the
discovery workstream (Task 14). This plan decides what content Varve should
publish for durable discovery, and what it must not publish.

## Principles

- Publish only what the product can substantiate first-hand. No generic
  "Figma alternative" keyword pages, no competitor bashings, no invented
  numbers.
- Target narrow intersections where Varve genuinely is one of very few
  tools: print workflows (CMYK/ICC/PDF-X), vector + layout + print on Linux,
  local-first/no-account design, and engineering writing that only this
  project could have produced.
- Discovery metadata (titles, descriptions, structured data) is a contract:
  asserted by `apps/website/tests/e2e/seo.spec.ts`, never hand-maintained
  ad hoc.
- Performance is a constraint: any new page or image must not move the
  homepage or download page measurably. The site is fully static (Astro);
  new pages add files, not runtime weight.

## Current coverage map (verified 2026-08-18)

| Intersection | Existing surface | Gap |
|---|---|---|
| Local-first / no-account design | `features/local-first.astro`, homepage, README | No dedicated narrative page; homepage covers it |
| Print production (CMYK, ICC, PDF/X) | `features/print-production.astro`, `docs/tools/export.astro`, `docs/file-formats.astro` | Strong; consider a first-hand "CMYK and PDF/X on Linux" article |
| Vector tools | `features/vector-tools.astro`, `docs/tools/vector.astro` | Covered |
| Linux design software | No Linux-specific page; download page recommends by platform | **Gap**: no first-hand Linux surface |
| Engineering articles | None on the website | **Gap**: rich raw material exists in `docs/architecture/` |
| Compare | `compare.astro` (focused, honest) | Keep as-is; do not expand into a keyword farm |

## Proposed new pages (prepared, not yet built)

### 1. `/features/linux` — "Varve for Linux" (highest priority)

First-hand and easy to substantiate: Linux is the primary development OS and
the most complete packaging surface (AppImage, deb, rpm, AUR via
`docs/release/platform-support-matrix.md`; x86_64 + aarch64 installers).

Outline (title candidates: "Varve for Linux — design software that runs
where you work", ~160-char description mentioning local-first, print, no
subscription):

- What ships: native Tauri 2 app on Linux (x86_64, aarch64), WebKitGTK
  runtime, Wayland and X11.
- What works today on Linux: vector, layout, typography, motion (alpha),
  print production (CMYK/ICC/PDF-X), export; on-device image features.
- Honest limitations: signing status, Intel macOS excluded, beta stability.
- Download CTAs per package type with the SHA-256/SBOM links from the
  release manifest.
- Structured data: `SoftwareApplication` with `operatingSystem: Linux`
  (or `WebPage` + FAQ). No invented benchmarks or testimonials.

Gate before building: confirm the packaging matrix in
`docs/release/platform-support-matrix.md` is current (another workstream
touches it — re-read before implementation).

### 2. `/learn/articles/*` — first-hand engineering articles (seed 3)

Source material exists and is uniquely Varve's. Each article must be written
fresh for a public audience, cite the canonical doc, and avoid over-claiming.
Proposed seeds, in priority order:

- **"IR-replay rendering: why a design app computes a scene in Rust and
  redraws it in the webview"** — from `docs/architecture/render-pipeline.md`
  and ADR-0001. Covers the 42 KB/frame IR, Canvas2D replay, camera-only
  worker bitmap path, dirty-rect discipline, and the frame-oracle rule.
- **"CMYK, ICC, and PDF/X from a local-first app"** — from
  `docs/architecture/colour-management.md`, `docs/architecture/text-pipeline.md`,
  and the varve-print crate. What PDF/X export actually checks, where color
  management runs (no cloud), and what is still limited.
- **"Source-available release integrity: checksums, SBOMs, signing policy"** —
  from `docs/release/signing-decision-record.md` and the release tooling.
  Explains why the pipeline is fail-closed and what "source-available, not
  open source" means operationally.

Format: single-page articles, one JSON-LD `Article` schema each, canonical
under `/learn/articles/`, linked from `/learn` and the relevant feature page.
No ad network, no newsletter bait.

### 3. `/try/` indexability decision (implemented 2026-08-22)

The browser demo serves at `/try/` from the staged Vite `index.html` (see
`docs/architecture/browser-demo.md`). The public demo build now injects its
own title, description, canonical, robots, Open Graph/Twitter metadata, and
WebPage JSON-LD. It is therefore included in the sitemap as a useful,
first-party search destination rather than inheriting the desktop app shell's
bare `<title>Varve</title>`.

- If deep editor states are ever shared as URLs, noindex them; only the
  landing should be a search destination.
- Do not let the demo page move the sitemap's `/download` priority.

## Explicitly not planned

- No "best Figma alternatives" listicle, no comparison keyword landing
  pages beyond the existing focused `/compare`.
- No per-feature landing pages for features that are scaffolding
  (collaboration transport is UI-only; do not market it).
- No user-count, adoption, or performance claims not verifiable from the
  repository.
- No additional per-page OG images: one regenerable 1200x630 brand card
  (documented in `docs/brand/github-repository-presence.md`) is enough; the
  cost/benefit of sixty bespoke cards is negative.

## Discovery durability rules

1. Every page must pass `apps/website/tests/e2e/seo.spec.ts` (title,
   description, canonical, OG/Twitter, JSON-LD, robots, sitemap).
2. New pages must be added to the sitemap automatically (they are — it is
   generated from the page files); do not hand-edit `sitemap.xml.ts` unless
   a page needs exclusion, and keep the exclusion list to aliases/404.
3. Keep naming consistent: "Varve" always capitalised, never "VARVE",
   never "varve" mid-sentence, no "Varve Studio" (see
   `docs/plans/social-surface-plan.md` for the descriptor strategy).
4. Truth gate: any claim on a new page must be traceable to the release
   manifest, `packages/shared/src/product.ts`, or a canonical doc. Run
   `pnpm audit:product-truth` after building content pages.
5. Measure before/after with `scripts/website/smoke-pages.mjs` against the
   live site and the page-count/perf output of the build; new pages must not
   regress the homepage or download page.
