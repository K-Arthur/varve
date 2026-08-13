# Analytics repository audit — 2026-08-13

## Initial findings

The repository had no product analytics transport or provider SDK in the desktop
application. Existing network egress is for user-invoked/content-related work
(models, fonts, icons, and explicitly configured AI providers), not analytics.

The crash system is a substantial existing privacy boundary: it has separate
consent, bounded queues, local redaction, a no-op uploader by default, and a
Privacy & Diagnostics settings surface. Crash consent must not be inferred from
any analytics or AI preference.

The website already had an environment-gated Plausible script path, but it was
not a Varve-owned event interface and the public privacy page described the site
as having no analytics. The default build was network-silent, but there was no
visitor choice, no GPC/DNT handling, and no explicit event inventory.

Settings are persisted through `packages/editor/src/settings.ts` and exposed by
`SettingsProvider`. Desktop and browser surfaces share the editor settings UI;
Tauri persistence and existing content-fetch permissions are separate from the
frontend analytics boundary. The Tauri CSP has no analytics host by default.

## Trust boundaries and integration points

```text
editor / website feature
  -> Varve typed event map
  -> category consent gate
  -> exact-field runtime validator + denylist
  -> bounded memory queue
  -> provider adapter (no-op by default)
  -> optional aggregate endpoint
```

The shared package contains only provider-neutral contracts and sanitization.
The desktop adapter is in `packages/editor/src/analytics/`; the website adapter
is in `apps/website/src/lib/analytics.ts`. Provider names and network details do
not appear in feature code. Crash reporting remains in `packages/crash` and is
not merged into the analytics client.

## Provider decision matrix

| Option | Ownership | Static Astro | Desktop | Main risk / tradeoff | Decision |
|---|---|---:|---:|---|---|
| No external provider | Varve | yes | yes | No measurement until an endpoint exists | Local and unconfigured builds |
| Plausible Events API | Hosted, paid; custom endpoint possible | yes | yes | Hosted processor and operational retention need review; no client secret may be used | `varve.studio` website and desktop adapters, only after consent |
| Umami | Open source; self-host or cloud | yes | possible | Requires operating a backend and retention/deletion policy; features such as session views must remain disabled | Future self-hosting candidate |
| Custom Varve endpoint | Varve | not without a backend | yes | Highest maintenance/security burden | Future option only after backend threat model |

Current provider facts were checked against the vendors’ documentation on
2026-08-13: [Plausible Events API](https://plausible.io/docs/events-api),
[Plausible optional measurements](https://plausible.io/docs/script-extensions),
[Umami introduction](https://docs.umami.is/docs), and
[Umami FAQ](https://docs.umami.is/docs/faq). These pages are not treated as a
substitute for a legal review or provider DPA review.

## Gaps resolved by this implementation

- No centralized typed product/website analytics contract.
- No runtime rejection of unknown or sensitive event fields.
- No independent product-usage and diagnostics consent settings.
- No website consent prompt or browser privacy-signal handling.
- No normalized website route/download event inventory.
- No public technical disclosure generated from or aligned with the event map.

## Remaining operational gaps

- The Plausible account retention period, access list, deletion process, and
  DPA/legal review must be recorded in the release operations checklist before
  publishing the first analytics-enabled release.
- Any future custom endpoint must add rate limiting and server-side validation.
- Native WebKitGTK, WebView2, and WKWebView network behavior still requires a
  native-platform release validation once a real endpoint is enabled.
