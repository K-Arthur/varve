# Social Surface Plan & Brand Collision Research

Status: prepared. Account creation/claiming is manual and intentionally not
done by this workstream. This document records the research so a future
session or the maintainer can act without re-doing it.

## 1. Brand collision research (recorded 2026-08-18, web search)

"Varve" is not a unique mark. Known third parties found by current-tool
search; none were contacted and no account was claimed:

| Entity | What it is | Collision level |
|---|---|---|
| Varve (varve.io) | Object-storage dataset cataloging product, private preview; GitHub org `varveio` | Name identical, category different (data infra). Same spelling; no design software overlap |
| Varve (PyPI `varve`) | Python pipeline/caching CLI tool | Name identical, dev-tool category |
| Varve Studios | Design studio by Mark Hilverda (since 2005, space/tech design) | Near-identical name in the design industry; different geography and clientele |
| Varve (varve.ca / open.varve.ca) | "Varve agency SDKs" for official statistics (Canada) | Name identical, unrelated domain |
| Varve IT | Dallas-based IT staffing firm | Name identical, unrelated domain |
| Varve Media | Aerial photo/video company, Netherlands | Name identical, unrelated domain |
| Varve (LinkedIn company) | Physics/tech team, 3 people | Name identical, unrelated |
| Varve (Devpost) | ML-lineage hackathon project | Name identical, one-off project |
| Varv Varv (formerly Varv) | London/Malmo graphic design studio | Spelling-adjacent, design industry |
| Vectric VCarve | CNC carving software | Phonetically similar, creative-software adjacent |

No design-suite competitor uses the exact mark; the risk is generic
confusion, not an infringement claim against us. GitHub handle and repo
`K-Arthur/varve` are already taken by this project; social handles may be
taken by the entities above — do not claim a handle that belongs to one of
them (e.g. do not squat `@varve` where a company with that name operates).

## 2. Descriptor strategy (entity disambiguation)

Never use "Varve" bare in discovery surfaces. Always pair it with a category
descriptor so search and directories can tell the design suite apart from
the other Varves:

- Primary: **Varve design suite** ("local-first design suite")
- Alternate: **Varve design software** / **Varve design app**
- Contextual: **Varve for Linux**, **Varve print production**
- Never: "VARVE", "varve" mid-sentence, "Varve Studio" (collides with the
  existing design studio; also not the product name).

Copy that already follows this: homepage title, `press.astro` descriptions,
`packages/shared/src/product.ts`. Any new page must too. The trademark line
in the root README ("Varve" is a trademark of K-Arthur) stays.

## 3. Recommended account set (deliberately small)

Three channels, chosen for audience overlap and maintainability. Creation is
manual and should happen only when someone commits to running them:

1. **Mastodon** (e.g. fosstodon.org or hachyderm.io) — primary. Best fit for
   a local-first/FOSS-adjacent design tool; no paid reach required.
   Bio template: "Varve — local-first design suite for vector, layout,
   typography, motion, and print. Free, source-available (FSL-1.1-MIT),
   no subscription. varve.studio"
2. **X/Twitter** — only if the Mastodon handle is confirmed; secondary
   mirror, not a separate editorial stream. Same bio, short.
3. **YouTube** — one channel for deterministic product-capture videos and
   the three engineering articles (see `docs/plans/discovery-content-plan.md`)
   when they exist. Not needed at beta stage.

Deliberately not planned: TikTok/Instagram/Facebook/LinkedIn company pages
in the near term, and no per-platform "presence" without content capacity.

## 4. Avatar and banner specs

- Avatar: square, from the canonical `packages/ui/src/icons/varve-app-icon.svg`
  master (1024x1024) — do not create a social-only variant. Generate:
  `rsvg-convert -w 512 -h 512 packages/ui/src/icons/varve-app-icon.svg -o avatar.png`
- Banner: 1500x500 (Mastodon) with the wordmark from
  `packages/ui/src/icons/varve-wordmark.svg` on the brand dark surface
  (#10151F); regenerate from source, never screenshot.
- All assets must come from the same generation pipeline as the GitHub
  repository icon (see `docs/brand/github-repository-presence.md`).

## 5. Content templates

Launch template (first 3 posts, truthful):

1. Product announcement: what ships today (vector/layout/typography/motion
   alpha/print CMYK+PDF-X), the download link, "public beta" status, the
   FSL-1.1-MIT wording (source-available, not open source), one screenshot
   from the capture pipeline.
2. Platform note: "Linux is a first-class platform, not a port" — AppImage/
   deb/rpm/AUR, x86_64 + aarch64, Wayland/X11.
3. Engineering note: the IR-replay rendering explainer (seeded by the
   planned article), linking the repo.

Release template (per release): version, what changed (from the release
notes generator), download + checksums links, "public beta" framing.
Never: subscriber counts, funding figures, competitor comparisons, or
screenshots not from the capture pipeline.

## 6. Manual account checklist (for a future session/human)

- [ ] Mastodon: register on one instance; bio from the template; avatar +
  banner generated from canonical sources; first post = launch template.
- [ ] Verify handle availability against the collision table first; if the
  exact handle is an active third party, choose `varve_design` style
  instead — never claim a handle another Varve operates.
- [ ] X/Twitter: only after Mastodon is live; mirror content, no separate
  editorial calendar.
- [ ] Add verified account links to the website footer and to the
  Organization `sameAs` array in `apps/website/src/layouts/Layout.astro`
  (and update `apps/website/tests/e2e/seo.spec.ts` if the assertion shape
  changes).
- [ ] Update `docs/brand/github-repository-presence.md` topic list only if
  a social surface becomes a real channel.
- [ ] Directory submissions (AlternativeTo and similar) only from
  `docs/release/directory-listing-packet.md`, only with explicit human
  authorization.

## 7. Boundaries

- No account creation, claiming, or handle squatting by automation.
- No paid promotion, no engagement bait, no "follow for more".
- No screenshots beyond the deterministic capture pipeline, no
  pre-release confidentiality breaks.
