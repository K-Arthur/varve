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
