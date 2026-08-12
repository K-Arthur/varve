# Varve — Production Domain (Porkbun + GitHub Pages)

**Applies to:** the production website origin `https://varve.studio`.

**Status:** performed 2026-08-12. `varve.studio` is registered at **Porkbun**,
Porkbun is also the **DNS provider** (nameservers
`curitiba/fortaleza/maceio/salvador.ns.porkbun.com`), and the site is **hosted
on GitHub Pages** (Actions deployment, `build_type=workflow`). Porkbun Static
Hosting is deliberately **not** used — hosting remains GitHub Pages; the
registrar only registers the domain and serves DNS.

| Component | Owner | Value |
|---|---|---|
| Registrar | Porkbun | `varve.studio` |
| DNS provider | Porkbun | porkbun nameservers |
| Hosting | GitHub Pages | `K-Arthur/varve` (workflow build, `actions/deploy-pages`) |
| Canonical origin | — | `https://varve.studio` |
| `www` behavior | GitHub Pages | `www.varve.studio` serves the site, GitHub redirects it to the apex |
| Deploy method | GitHub Actions | `.github/workflows/website-deploy.yml` |
| Domain configured where | GitHub | Repository → Settings → Pages → Custom domain |
| Legacy URL | GitHub | `https://k-arthur.github.io/varve/` (redirects to `https://varve.studio/`) |

**One rule above all:** every link, asset, canonical URL, Open Graph URL,
sitemap entry, robots location and JSON-LD URL on the site is derived from
`SITE_URL` + `SITE_BASE` (see `apps/website/astro.config.mjs` and
`apps/website/src/lib/siteUrl.ts`). The production build uses the defaults
(`https://varve.studio`, base `/`) with **no environment variables** in the
deploy workflow. The legacy Pages mode is preserved as `build:website:pages`
(`SITE_URL=https://k-arthur.github.io`, `SITE_BASE=/varve`) for the CI
dual-mode suite and for rollback.

---

## 1. DNS zone on Porkbun

Zone as found before the migration (Porkbun parking defaults):

| Type | Host | Answer | Purpose |
|---|---|---|---|
| A | (root/apex) | `207.207.210.107` | Porkbun parking page — replaced |
| A | (root/apex) | `207.207.210.229` | Porkbun parking page — replaced |
| CNAME | `www` | `pixie.porkbun.com` | Porkbun parking — replaced |

There were no TXT, MX, CAA, AAAA or DNSSEC records, and nothing used for
email, analytics, domain verification or other services. Nothing unrelated had
to be preserved.

### Required records

In Porkbun DNS for `varve.studio`, the root host field is left **blank**
(blank root host = the apex; do not type `@`). TTL 600 (10 min) is
recommended for cutover; 3600 after stability.

| Type | Host | Answer | TTL | Purpose |
|---|---|---|---|---|
| A | *(blank = apex)* | `185.199.108.153` | 600 | GitHub Pages IPv4 (apex) |
| A | *(blank = apex)* | `185.199.109.153` | 600 | GitHub Pages IPv4 (apex) |
| A | *(blank = apex)* | `185.199.110.153` | 600 | GitHub Pages IPv4 (apex) |
| A | *(blank = apex)* | `185.199.111.153` | 600 | GitHub Pages IPv4 (apex) |
| AAAA | *(blank = apex)* | `2606:50c0:8000::153` | 600 | GitHub Pages IPv6 (apex) |
| AAAA | *(blank = apex)* | `2606:50c0:8001::153` | 600 | GitHub Pages IPv6 (apex) |
| AAAA | *(blank = apex)* | `2606:50c0:8002::153` | 600 | GitHub Pages IPv6 (apex) |
| AAAA | *(blank = apex)* | `2606:50c0:8003::153` | 600 | GitHub Pages IPv6 (apex) |
| CNAME | `www` | `k-arthur.github.io` | 600 | `www` hostname; GitHub redirects to apex |
| TXT | `_github-pages-challenge-<account>.varve.studio` | *value shown by GitHub* | 600 | Domain verification — only if GitHub requests it |

Notes:

- The CNAME target is a **hostname, not a URL**: `k-arthur.github.io`, never
  `https://k-arthur.github.io` and never `k-arthur.github.io/varve` (a CNAME
  cannot carry a path).
- GitHub publishes the exact A/AAAA addresses in Repository → Settings →
  Pages after the domain is added; **re-verify them there** — they have
  changed before.
- The apex records must be plain `A`/`AAAA` records. Porkbun also offers an
  ALIAS feature; plain A/AAAA is what GitHub recommends and what is
  configured here.
- No `*.varve.studio` wildcard: a wildcard pointing at GitHub Pages is a
  domain-takeover hazard. Only `www` is enumerated.
- **Do not** enable Porkbun Static Hosting or Porkbun's GitHub Connect. The
  site is hosted by GitHub Pages; Porkbun only registers the domain and
  serves DNS.
- **No MX/SPF/DKIM/DMARC records exist.** None are needed until an email
  provider is chosen (then MX + SPF + DKIM + DMARC would be added at Porkbun;
  see section 5 of `docs/plans/website-operations-guide.md` if one is ever
  configured — nothing current blocks `hello@` / `support@` /
  `security@` / `press@varve.studio` later).

## 2. GitHub Pages configuration

Configured in Repository → Settings → Pages (performed via the REST API
`PUT /repos/K-Arthur/varve/pages` with `cname: varve.studio`):

- **Custom domain:** `varve.studio`
- **Enforce HTTPS:** on (once the certificate is provisioned — do not enable
  it before TLS is issued, it locks the site behind broken HTTPS)
- **Build and deployment:** GitHub Actions (`build_type=workflow`), source
  `master`

Domain ownership: GitHub's account-level verified-domains feature (Settings →
Pages → Verified domains) has no public API; if used, it issues a
`_github-pages-challenge-<account>.varve.studio` TXT record to add at Porkbun.
The repo-level custom-domain flow provisions TLS automatically once the apex
A records resolve to GitHub's addresses. Do not remove the verification TXT
record until GitHub explicitly reports the domain verified.

TLS: the certificate for `varve.studio` is provisioned by **GitHub Pages**.
Do not download or install a Porkbun SSL certificate, and never commit
certificates or private keys to the repository.

## 3. HTTPS + redirect behavior

- `http://varve.studio` → `https://varve.studio` (GitHub Pages Enforce HTTPS)
- `http://www.varve.studio` → `https://varve.studio` (www redirects to apex)
- `https://www.varve.studio` → `https://varve.studio` (GitHub's www→apex
  redirect; both must resolve for this to work)
- `https://k-arthur.github.io/varve/` → `https://varve.studio/` (GitHub's
  redirect for the legacy URL while the custom domain is configured)

HSTS is **not** preloaded and GitHub Pages cannot set the HSTS header; the
domain should not be submitted to the HSTS preload list until HTTPS has been
stable for a long period.

## 4. Verification

After any DNS change, verify with real DNS tools against multiple resolvers
(propagation can take minutes to hours; do not mutate records repeatedly):

```sh
dig @1.1.1.1 varve.studio A
dig @8.8.8.8 varve.studio AAAA
dig www.varve.studio CNAME
dig varve.studio TXT
curl -sI https://varve.studio | head -5
curl -sI https://www.varve.studio | head -5
```

The deploy workflow runs a bounded-retry smoke check after every deploy
(`scripts/website/smoke-pages.mjs <url> --expect-origin https://varve.studio`):
homepage, download, docs, nested docs page, releases, sitemap, robots,
favicon, OG image, 404 behavior, and the canonical origin.

## 5. Troubleshooting

| Symptom | Likely layer | Fix |
|---|---|---|
| `varve.studio` does not resolve | DNS | Confirm apex A records at Porkbun (blank root host); check `dig @1.1.1.1` |
| Resolves but no HTTPS/cert pending | GitHub Pages | Wait — TLS provisioning takes minutes to hours after DNS is correct; check Settings → Pages |
| Certificate mismatch | GitHub Pages | GitHub provisions per-hostname; make sure both `varve.studio` and `www` resolve (www needs the CNAME) |
| `www` 404s while apex works | DNS / Pages | `www` CNAME missing, or the custom domain was never added in repo settings |
| Assets 404 (`/varve/assets/...`) | Base path | Site is built root-based by default; a stale Pages-mode deploy (old workflow env) is serving — redeploy from master |
| Canonical still `k-arthur.github.io` | Base path | Stale build; redeploy from master (defaults now `https://varve.studio`) |
| Download page 404s after release | Build | Rebuild with the release workflow (`workflow_run` redeploys) |

## 6. Rollback

The migration is config-only and reversible per layer:

1. **DNS:** at Porkbun, delete the GitHub A/AAAA/CNAME records and restore
   the recorded parking defaults (section 1) — or leave them; GitHub stops
   serving the custom domain when it is removed from settings.
2. **GitHub Pages:** remove the custom domain in Settings → Pages (or
   `DELETE`-style revert via the Pages API). `https://k-arthur.github.io/varve/`
   serves again immediately.
3. **Site build:** to deploy the legacy project-site build, set
   `SITE_URL=https://k-arthur.github.io` / `SITE_BASE=/varve` as the
   `build:website` defaults and redeploy. Rollback must be per-layer —
   diagnose before changing anything, and never use destructive git resets.

## 7. Registrar security checklist (owner, manual)

- [ ] Porkbun account 2FA enabled (app or hardware key, not SMS-only)
- [ ] Strong, unique account password in a password manager
- [ ] Account recovery info current; API keys (if any) scoped and rotated
- [ ] Domain lock enabled (prevents unauthorized transfer)
- [ ] Auto-renewal enabled; payment method valid
- [ ] Expiration date noted; renewal notifications on
- [ ] WHOIS privacy enabled
- [ ] DNSSEC: if enabled, confirm the chain validates; a broken DNSSEC chain
      is worse than none — verify with `delv`/`dig +dnssec` after any change
- [ ] Never paste Porkbun passwords, API keys, cookies or recovery codes into
      the repository, issues, screenshots, logs or Actions artifacts

## 8. What this project deliberately does NOT use

| Thing | Status |
|---|---|
| Porkbun Static Hosting / GitHub Connect | Not used — hosting is GitHub Pages |
| Porkbun SSL | Not used — TLS is GitHub Pages' |
| Committed `CNAME` file | Not used — Actions deployments read the domain from repo settings; a committed CNAME is ignored/conflicting |
| `_redirects` / `_headers` files | Not used — GitHub Pages ignores them; the `k-arthur.github.io/varve` → custom-domain redirect is GitHub's own |
| Wildcard DNS | Not used |
| HSTS preload | Deferred until HTTPS is long-stable |
| Email records (MX/SPF/DKIM/DMARC) | None — to be added at Porkbun only when an email provider is chosen |
