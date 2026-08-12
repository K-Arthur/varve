# Varve Website

Varve's marketing website — an Astro 5 static site for product pages,
documentation, downloads, and community.

## Architecture

- **Framework**: Astro 5 with static output (`astro build`)
- **Content**: `src/pages/` (42 pages), `src/components/`, `src/data/`
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
| `src/pages/` | Astro page components (42 pages) |
| `src/components/` | Shared Astro components (header, footer, CTA) |
| `src/data/` | Release manifest, structured data |
| `src/test/` | Vitest unit tests |
| `tests/e2e/` | Playwright E2E specs (navigation, theme, visual) |
| `scripts/` | Theme audit (`audit-theme.mjs`), color migration (`migrate-colors.mjs`), dist serving (`serve-dist.mjs`) |
| `scripts/website/` (repo root) | Post-deploy smoke tests (`smoke-pages.mjs`) |

## Key docs

- `docs/release/website.md` — website architecture and launch plan
- `docs/plans/website-operations-guide.md` — how to add releases and platforms
- `docs/release/` — release engineering (the website publishes release data)
