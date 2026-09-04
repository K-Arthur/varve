# Varve Website

Varve's marketing website — an Astro 7 static site for product pages,
documentation, downloads, and community.

## Architecture

- **Framework**: Astro 7 with static output (`astro build`)
- **Content**: `src/pages/` (69 routes), `src/components/`, `src/data/`
- **Deployment**: GitHub Pages via `.github/workflows/website-deploy.yml`
- **Testing**: Vitest unit tests (`src/test/`), Playwright E2E (`tests/e2e/`)

## Running

```bash
pnpm dev              # dev server at http://localhost:4321
pnpm build            # production build (astro check + astro build)
```

For the GitHub Pages build (with base path):

```bash
pnpm build:website:pages
```

## Testing

```bash
pnpm test:website           # Vitest unit tests
pnpm test:website:e2e       # Playwright E2E (build first)
```

The platform accessibility/responsiveness audit is tracked in
`docs/audits/platform-ux-accessibility-responsiveness-audit-2026-09-02.md`.
Website E2E covers axe-core, keyboard navigation, narrow-width overflow, and
visual snapshots; mobile viewport runs are browser emulation and do not replace
physical iOS/Android or screen-reader certification.

## Button and CTA contract

Shared Astro actions use `src/components/Button.astro` and the semantic
`.btn-default`, `.btn-secondary`, `.btn-outline`, `.btn-ghost`, `.btn-link`,
and `.btn-destructive` classes. The names mirror the product action contract
documented in `docs/architecture/button-action-system.md`; `btn-pill` and
`btn-pill-outline` are reserved for explicit marketing treatments. Buttons
default to `type="button"`, and all action transitions honor reduced motion.

## Structure

| Path | Purpose |
|------|---------|
| `src/pages/` | Astro page components (69 routes, including generated sitemap/robots/security endpoints) |
| `src/components/` | Shared Astro components (header, footer, CTA) |
| `src/data/` | Release manifest, structured data |
| `src/test/` | Vitest unit tests |
| `tests/e2e/` | Playwright E2E specs (navigation, theme, visual) |
| `scripts/` | Theme audit (`audit-theme.mjs`), color migration (`migrate-colors.mjs`), dist serving (`serve-dist.mjs`) |
| `scripts/website/` (repo root) | Post-deploy smoke tests (`smoke-pages.mjs`) |

## Key docs

- `docs/release/website.md` — website architecture and launch plan
- `docs/release/website.md` — website architecture, release-data flow, and deployment
- `docs/release/` — release engineering (the website publishes release data)

## Release data and public claims

`src/data/release-manifest.json` and `public/updates/{stable,beta}.json` are
generated release snapshots. Do not hand-edit them. To refresh the local
fallback from a published GitHub release, run:

```bash
node scripts/release/fetch-website-release.mjs --repo K-Arthur/varve --tag v0.2.1
```

The deployment workflow performs the same fetch after verifying that the
release is published and that its manifest, checksums, and SBOMs agree. The
download page must never be updated with guessed version, size, checksum, or
signing data.
