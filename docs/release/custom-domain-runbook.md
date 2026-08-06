# Varve — Custom-Domain Runbook (GitHub Pages)

**Applies to:** moving the public site from its default project-site URL
`https://k-arthur.github.io/varve/` to a purchased domain.

**Status:** the configuration-only path described here is implemented and
tested (both deployment modes pass the full e2e suite in CI). No domain has
been purchased or configured — do not run these steps until one is.

**The default URL today:** `https://k-arthur.github.io/varve/`. Varve is a
GitHub Pages **project site**; this repository is not named
`K-Arthur.github.io`, so the owner-level site does not exist and is not
required. Do not rename the repository.

**One rule above all:** switching domains must be configuration and GitHub/DNS
settings — never source-code edits. Every link, asset, canonical URL, Open
Graph URL, sitemap entry, robots location and JSON-LD URL is derived from
`SITE_URL` + `SITE_BASE` (see `apps/website/astro.config.mjs` and
`apps/website/src/lib/siteUrl.ts`). Change the two variables, redeploy, done.

---

## 1. Decide: apex or www

Choose ONE canonical address. GitHub can redirect the noncanonical variant to
it, but you must configure both or the wrong one silently 404s.

| Canonical | Configure in Pages settings | DNS for the other |
|---|---|---|
| `varve.example` (apex) | `varve.example` | `www` → `k-arthur.github.io` (CNAME) |
| `www.varve.example` (subdomain) | `www.varve.example` | apex → GitHub's `A` records (below) |

`varve.github.io` is **not** available: that hostname belongs to the `varve`
GitHub account or organization and cannot be claimed by this repository.

## 2. Verify the domain in the account first

In GitHub account settings (Settings → Pages → Verified domains — accessible
from the account, not the repo), add the domain and complete the TXT-record
verification **before** attaching it to the repository. This proves ownership
to GitHub and prevents anyone else from claiming it.

## 3. Add the custom domain to the repository

Repository → Settings → Pages → Custom domain → enter the chosen domain and
Save. Do this **before** changing DNS: GitHub uses the DNS state to provision
the TLS certificate, and it needs to know the domain is intended.

## 4. DNS for a subdomain

For a `www` (or any subdomain) canonical address, point it with a CNAME at the
**bare Pages host**:

```
www  CNAME  k-arthur.github.io.
```

Never `k-arthur.github.io/varve` — a CNAME target is a hostname, and the
`/varve` path is added by the site build via `SITE_BASE`.

## 5. DNS for an apex domain

GitHub currently supports apex domains via `A` (and `AAAA`) records or an
`ALIAS`/`ANAME` record from your DNS provider. GitHub publishes the exact
addresses in the Pages settings page after the domain is added; the current
documented set is:

```
@  A    185.199.108.153
@  A    185.199.109.153
@  A    185.199.110.153
@  A    185.199.111.153
@  AAAA  2606:50c0:8000::153
@  AAAA  2606:50c0:8001::153
@  AAAA  2606:50c0:8002::153
@  AAAA  2606:50c0:8003::153
```

**Verify these addresses against GitHub's Pages settings page at configuration
time** — they have changed before. If your provider supports ALIAS/ANAME for
apex hosts, `@  ALIAS  k-arthur.github.io.` is a valid alternative.

## 6. Do not use wildcard DNS

`*.varve.example  CNAME  k-arthur.github.io` is a **domain-takeover hazard**:
any subdomain pointing at a GitHub user with a Pages site (or future
deployment) can serve content under your domain. GitHub's own DNS guidance
rejects wildcards for this reason. Enumerate the subdomains you actually use.

## 7. Configure both apex and www

GitHub redirects the noncanonical variant to the canonical one **only when
both resolve**. If you host `varve.example` as canonical, also point `www`
at `k-arthur.github.io` (or vice versa) so both work and the redirect lands
where you expect.

## 8. Wait for verification and TLS provisioning

GitHub checks DNS and provisions the certificate automatically. This can take
minutes to hours. The Pages settings page shows the state; do not proceed to
"Enforce HTTPS" until the certificate is issued, or you will lock the site
behind a broken HTTPS.

## 9. Enforce HTTPS

Pages settings → Enforce HTTPS → enable once the certificate is provisioned.

## 10. Rebuild with SITE_BASE=/

The site is deployed by `.github/workflows/website-deploy.yml`, which reads
the build variables. Set, in the workflow or via repository environment
variables:

```
SITE_URL=https://<chosen-domain>    # no trailing slash
SITE_BASE=/                         # root deployment
```

The same source now produces a root-hosted site: internal links,
canonical URLs, OG images, sitemap and robots all switch automatically. This
is verified continuously by the `custom-domain` project in
`playwright.website.config.ts` (built from the same `SITE_URL`/`SITE_BASE`
variables, served at `/`).

## 11. Verify redirects from the old project URL

`https://k-arthur.github.io/varve/` should 301 to the new domain once DNS and
Pages settings propagate. Verify:

```sh
curl -sI https://k-arthur.github.io/varve/ | head -5
```

Then run the full post-deploy smoke suite (the workflow does this
automatically after every deploy):

```sh
node scripts/website/smoke-pages.mjs https://<chosen-domain>
```

## 12. Post-move checks

- **Mixed content:** every asset, script and stylesheet must load over HTTPS
  (the smoke check covers the asset set; grep the served HTML for `http://`).
- **Stale canonical URLs:** fetch a few pages and confirm `<link rel=canonical>`
  and `og:url` point at the new domain (they are derived from `SITE_URL`, so
  a rebuild is the fix).
- **Old sitemap entries:** the sitemap is generated from `SITE_URL`; confirm
  no `k-arthur.github.io/varve` URLs remain in `sitemap.xml` and
  `robots.txt`'s `Sitemap:` line.
- **Cached assets:** Pages caches with long TTLs; if anything looks stale,
  wait for cache expiry or bump asset filenames (Astro hashes `_astro/`
  assets by content, so a rebuild normally suffices).
- **Download links:** confirm the download page's asset URLs still point at
  `https://github.com/K-Arthur/varve/releases/...` (they always have — the
  downloads live on GitHub Releases, not on the site).

## 13. Rollback

To restore the default deployment:

1. Revert `SITE_URL` to `https://k-arthur.github.io` and `SITE_BASE` to
   `/varve` in the deploy configuration.
2. Remove the custom domain from the repository's Pages settings.
3. Redeploy (push a trivial website change or use workflow_dispatch).
4. Confirm `https://k-arthur.github.io/varve/` serves again.
5. Leave DNS records in place or remove them — GitHub stops serving the
   custom domain when it is removed from settings.

---

## How deployment actually works here (no committed CNAME)

This project deploys with **GitHub Actions** (`website-deploy.yml` →
`actions/upload-pages-artifact` + `actions/deploy-pages`). For Actions-based
deployments, the custom domain is taken **from the repository's Pages
settings**, and a committed `CNAME` file in the build output is not the source
of truth and can be silently ignored (or, worse, conflict). Configure the
domain in repository settings only; do not rely on a `CNAME` file.

## What GitHub Pages can and cannot do here (honest list)

| Capability | GitHub Pages | Impact |
|---|---|---|
| Custom domains + HTTPS | Yes, with the steps above | Full support |
| HTTP→HTTPS redirect | Yes (Enforce HTTPS) | Full support |
| Custom security headers (`_headers`-style) | **No** — Pages ignores `_headers` files and cannot set arbitrary headers | CSP is enforced via `<meta>` tag (in `Layout.astro`); other headers (X-Frame-Options etc.) cannot be set. Do not claim they are. |
| HSTS | No (`Strict-Transport-Security` cannot be set) | Documented trade-off; GitHub serves over HTTPS anyway |
| Server-side redirect rules (`_redirects`) | **No** | The `k-arthur.github.io/varve/` → new-domain redirect is done by GitHub itself, not by a rules file |
| Cache control | Limited (`_headers` ignored; asset hashing is the caching strategy) | `_astro/` content-hashed filenames + `Cache-Control: max-age=0, must-revalidate` on HTML where supported |
