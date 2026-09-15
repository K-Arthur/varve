# GitHub repository presence

This is the maintenance note for Varve's public GitHub surface. It records
the canonical identity, the assets used by the repository page, and the small
set of GitHub settings that cannot be represented in git.

## Canonical identity

| Field | Value |
|---|---|
| Repository | `K-Arthur/varve` |
| Website | <https://varve.studio> |
| Source repository | <https://github.com/K-Arthur/varve> |
| Application release shortcut | <https://github.com/K-Arthur/varve/releases/latest> |
| Current public status | Public beta; latest published application release is `v0.2.1` (published 2026-08-24) |
| License wording | Source-available under FSL-1.1-MIT; not OSI-approved open source |

The repository description should remain a short product definition rather
than a slogan:

> Local-first, cross-platform design suite for vector graphics, layout, typography, motion, prototyping, and print — no subscription, no cloud account required.

The current topic set is intentionally limited to product and implementation
terms: `cross-platform`, `design-editor`, `design-tool`, `desktop-app`,
`graphic-design`, `local-first`, `motion-design`, `print-design`,
`prototyping`, `rust`, `source-available`, `tauri`, `typescript`,
`typography`, `vector-editor`, `vector-graphics`, `wasm`, `webassembly`, and
`webgpu`.

If the product stage or latest published release changes, update the source
of truth first (`packages/shared/src/product.ts` and the generated website
release manifest), then refresh the README and `public/llms.txt` statements.

## Brand and social preview

The canonical repository-facing mark is the Varve wordmark in
`packages/ui/src/icons/varve-wordmark.svg` and its dark-theme counterpart
`varve-wordmark-dark.svg`. The application mark and favicon use the same
identity; do not create a second repository-only logo.

The social card is the generated 1200×630 PNG at
`apps/website/public/og-image.png`. Regenerate it from
`scripts/screenshots/og-template.html` with:

```bash
pnpm screenshots:og
```

It is also the website's Open Graph image, which keeps link previews and the
repository page visually consistent.

The square 512×512 repository/owner icon is
`docs/brand/github-repository-icon.png`. It is generated from the canonical
`packages/ui/src/icons/varve-app-icon.svg` master with:

```bash
rsvg-convert -w 512 -h 512 packages/ui/src/icons/varve-app-icon.svg \
  -o docs/brand/github-repository-icon.png
```

GitHub does not expose a normal per-repository avatar setting: the small icon
shown beside a repository name is the owner or organization avatar. Use this
PNG for a Varve organization avatar, or for the K-Arthur profile only if
changing the profile avatar for every repository is intentional. The README
hero and social preview provide repository-specific branding without changing
the account identity.

## GitHub settings that are not stored in git

Verify these after a repository transfer, domain change, or major release:

1. **GitHub → Settings → General → Repository details**
   - Description: use the canonical description above.
   - Website: `https://varve.studio`.
   - Topics: use the maintained list above; remove stale product names or
     competitor names.
2. **GitHub → Settings → General → Social preview**
   - Upload `apps/website/public/og-image.png`.
   - Re-upload after a deliberate redesign; the file in the repository is the
     reproducible source for the intended card.
3. **GitHub → Settings → Features**
   - Keep Issues and Discussions enabled.
   - The current discussion categories are Announcements, General, Ideas,
     Polls, Q&A, and Show and tell. Link a category only when it is intended
     for that kind of post.
4. **GitHub → Settings → Code security and analysis**
   - Keep Dependabot alerts/security updates and private vulnerability
     reporting enabled.
   - Verify secret scanning and push protection are enabled when available on
     the repository plan; the REST surface used by the audit does not expose
     their state reliably.

GitHub-generated community health checks may not recognize uncommitted local
templates. After `.github/ISSUE_TEMPLATE/` and
`.github/PULL_REQUEST_TEMPLATE.md` are merged, re-open the Community Standards
view to confirm that GitHub recognizes them.

## Public-content rules

- Say **public beta**, not stable, until `PRODUCT_STATUS.stage` changes.
- Call the current license **source-available**, not open source.
- Treat the latest published application release (currently `v0.2.1`) as the latest
  until GitHub publishes a newer `vX.Y.Z` release. `varve-models-v1` is an auxiliary
  model-artifact release and must not be presented as an application download.
- Keep privacy wording scoped to core editing. Model downloads, online
  font/icon providers, user-configured remote providers, update checks, and
  consented aggregate analytics are distinct network features.
- Historical pre-rename references belong only in migration, file-format, and
  dated engineering documentation; current product copy should say Varve.
