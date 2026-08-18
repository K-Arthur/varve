# Analytics measurement plan and data inventory

Production website and desktop release builds are configured for the
`varve.studio` Plausible site, but transmission still requires the relevant
user consent. Local and unconfigured builds remain network-silent. This
document describes the permitted contract and the data transmitted by the
enabled aggregate provider. The website loads Plausible's production script
only after website consent and disables its automatic capture features; Varve
emits only the events listed below.

| Question | Metric / event | Fields | Category | Status | Decision |
|---|---|---|---|---|---|
| Which pages help visitors reach a useful destination? | `website_page_viewed` | normalized route | Website | ACTIVE | Improve navigation and documentation |
| Which release/platform downloads matter? | `website_download_started` | release, platform, architecture, package type, release channel | Website | ACTIVE | Prioritize packaging and release support |
| Do community links help? | `website_outbound_clicked` | destination category | Website | ACTIVE | Improve contribution/support paths |
| Which contact channels are used? | `website_contact_clicked` | channel category | Website | ACTIVE | Improve support routing |
| What starts an opted-in desktop session? | `app_launched` | surface | Usage | ACTIVE | Understand activation at aggregate level |
| Which broad workflows are adopted? | `document_created`, `feature_used` | closed source/feature enum | Usage | ACTIVE | Prioritize feature work |
| Where do exports fail or slow down? | `export_completed`, `export_failed` | format, duration bucket, error code | Diagnostics / usage | ACTIVE | Improve export reliability |
| Which renderer/platform paths need work? | `renderer_fallback` | from, to, reason | Diagnostics | ACTIVE | Improve compatibility |
| Does the browser demo drive downloads? | `browser_demo_launched`, `browser_demo_desktop_download` | entry source, release/platform/arch | Usage / website | ACTIVE | Measure demo-to-desktop conversion |

## Explicitly prohibited data

The analytics boundary rejects filenames, paths, document/project/layer/page/
component names, design text, comments, clipboard data, document contents,
canvas pixels, screenshots, exports, imported metadata, EXIF, image hashes,
geometry, generated code, AI prompts, arbitrary URLs and query strings, raw
error messages/stacks, email addresses, usernames, tokens, cookies,
authorization values, machine/host/device identifiers, authentication IDs,
advertising IDs, and arbitrary unknown fields.

## Consent and retention

Missing or corrupt consent is `unknown` and sends nothing. Revocation removes
pending events in that category. The client queue is bounded in memory and is
discarded on process shutdown; it has no disk persistence. Crash-report
retention remains governed by `docs/privacy/retention.md` and is independent of
this inventory.

## Data governance

- **Retention**: client retains nothing. Plausible retains while the
  subscription is active; data deleted within ~30 days of cancellation.
- **Access**: owner + one reviewer only; re-verified quarterly.
- **Deletion / export**: export (CSV/API) before any account change; deletion
  is subscription termination + provider deletion request.
- **Provider settings**: auto pageviews/file-downloads/outbound-links/form-
  submissions off, localStorage queue disabled, query-param stripping on,
  DNT honored.

## Search Console and Bing Webmaster Tools

Manual setup steps (owner only):

### Google Search Console
1. Go to https://search.google.com/search-console.
2. Add property: **Domain** type `varve.studio` (DNS verification) or
   **URL prefix** `https://varve.studio/`.
3. DNS verification: add the TXT record Google provides to the DNS zone for
   `varve.studio` (GitHub Pages domain).
4. Submit sitemap: `https://varve.studio/sitemap.xml`.
5. Monitor Coverage, Performance, and Core Web Vitals weekly.

### Bing Webmaster Tools
1. Go to https://www.bing.com/webmasters.
2. Add site: `https://varve.studio/`.
3. Verification: DNS CNAME record or HTML meta tag (GitHub Pages: meta tag).
4. Submit sitemap: `https://varve.studio/sitemap.xml`.
5. Monitor traffic and crawl health monthly.

### Canonical and structured data
- Canonical URL is set in `Layout.astro` via `<link rel="canonical">`.
- `sitemap.xml` is auto-generated from `.astro` pages plus the `/try` demo
  route (added manually since it is a separate Vite build).
- `robots.txt` allows all crawlers and points to the sitemap.
- Structured data (ContactPage, FAQPage) is on `contact.astro`.

## Legal and operational note

Technical controls do not determine the legal basis for a deployment. Before
enabling a real provider, Varve maintainers must confirm the actual user
jurisdictions, provider terms/DPA, data residency, retention, access controls,
deletion workflow, and applicable GDPR/ePrivacy, UK, Canadian, and
CCPA/CPRA requirements with qualified legal advice where needed.
