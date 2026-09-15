# Analytics, privacy & measurement audit — 2026-08-18

Companion to `docs/audits/analytics-audit-2026-08-13.md` (pre-implementation).
This audit verifies the shipped implementation against the product's
local-first/privacy positioning and defines the bounded measurement
specification. All statements below were re-verified against the working tree
on 2026-08-18; the 2026-08-13 findings are not treated as current facts.

## 1. Current-state trace (verified)

| Trace point | State | Location (verified) |
|---|---|---|
| Provider(s) | Plausible (hosted). Website: script `pa-9Rpt-MZjJts8awPbiRZl3.js` loaded only after consent. Desktop: direct POST to `https://plausible.io/api/event`. No other provider. | `apps/website/src/lib/analytics.ts:11,121-207`, `packages/editor/src/analytics/desktopAnalytics.ts:17,29-80` |
| Deployment config | Website: `ANALYTICS_DOMAIN=varve.studio` in `website-deploy.yml:38`; script gated on `PROD && domain` (`Layout.astro:112`). Desktop: `VITE_VARVE_ANALYTICS_DOMAIN=varve.studio` in `release.yml:421`; custom `VITE_VARVE_ANALYTICS_ENDPOINT` also supported. Both are public config, not secrets. | `apps/website/src/layouts/Layout.astro:92-112`, `apps/desktop/src/App.tsx:33-46` |
| Production domain | `varve.studio` for both website and desktop events (single Plausible site). Desktop events attribute to pseudo-page `https://varve.studio/app`. | `packages/editor/src/analytics/desktopAnalytics.ts:64` |
| Consent state | Three independent categories (`website`/`usage`/`diagnostics`), each `unknown|granted|denied`. Unknown = denied. Website stored in `varve:website-analytics-consent` (localStorage); desktop in settings `privacy.usageAnalytics`/`privacy.diagnostics`. Crash consent fully separate (policy v1, `varve:crash-consent`). | `packages/shared/src/analytics/schema.ts:11-18`, `apps/website/src/lib/analytics.ts:47-64`, `packages/editor/src/settings.ts:144,229`, `docs/privacy/consent-state.md` |
| Cookie / local-storage | No cookies set by Varve code. Consent in localStorage; analytics queue is memory-only. Caveat: the Plausible script itself defaults to a localStorage event queue — must be verified/disabled (see §7, manual item M-2). | `apps/website/src/lib/analytics.ts:47-64`, `packages/shared/src/analytics/client.ts:97-101` |
| DNT / GPC | Both fail closed; banner suppressed entirely when either is set. | `apps/website/src/lib/analytics.ts:66-69,240-243` |
| IP treatment | Not collected by Varve; in transit to Plausible, which does not store IPs. Disclosure mentions IP only for the update endpoint. | `apps/website/src/pages/about/privacy.astro:80-81` |
| Event queue / retry | Bounded memory-only queue (website 25, desktop 50), single-attempt flush, no retry, `keepalive: false`. Desktop has no periodic flush — only the boot flush in `App.tsx`. | `packages/shared/src/analytics/client.ts:116,137-147`, `apps/website/src/lib/analytics.ts:163-165`, `apps/desktop/src/App.tsx:59-65` |
| Route normalization | 8 closed routes; `/docs/*`, `/support/*` collapse to section roots. `/support/known-issues`, `/product`, `/contact`, `/about`, `/security` currently collapse to `/`. | `apps/website/src/lib/analytics.ts:71-91` |
| Custom events / properties | 10 closed events, exact-field runtime validation + denylist + bounded version strings. **Only 4 are emitted in production**: `app_launched` (desktop), `website_page_viewed`, `website_download_started`, `website_outbound_clicked`. The other 6 are schema-defined but not wired. | `packages/shared/src/analytics/schema.ts`, `packages/shared/src/analytics/privacy.ts`, grep of `.track(` across packages/apps |
| Dev / localhost exclusion | Website: hard-gated (`PROD && domain`). Desktop: no build-kind guard — a dev build with `VITE_VARVE_ANALYTICS_DOMAIN` set would use the Plausible provider, but consent defaults to `unknown`, so nothing sends until the user opts in. | `apps/website/src/layouts/Layout.astro:112`, `packages/editor/src/analytics/desktopAnalytics.ts:82-88,99-112` |
| App telemetry | Only `app_launched` at boot. **Platform is hardcoded `unknown`** (`App.tsx:43`), so per-platform desktop usage is currently unmeasurable. | `apps/desktop/src/App.tsx:42-46,60` |
| Crash reporting | Separate system (`@varve/crash`), own consent state machine, local scrubbing, no uploader by default. Never enabled by an analytics preference. | `docs/privacy/consent-state.md`, `packages/crash/src/consent.ts` |
| Privacy-policy disclosures | Full policy + technical analytics disclosure page + measurement-plan doc. **Disclosure lists desktop events as active that are not emitted**, and the in-app settings copy claims "this build has no configured usage endpoint" — false for release builds. | `apps/website/src/pages/about/privacy.astro`, `apps/website/src/pages/docs/privacy/analytics.astro:29-39`, `packages/editor/src/crash/privacyDiagnosticsSection.tsx:120-122` |
| Data retention controls | Client-side: nothing persisted (memory queue only). Provider-side: **undefined** — the 2026-08-13 audit's remaining gap ("retention period, access list, deletion process, DPA/legal review recorded in the release ops checklist before publishing the first analytics-enabled release") is still open; release 0.1.2 shipped analytics-enabled. | `docs/audits/analytics-audit-2026-08-13.md:67-74`, `docs/privacy/analytics.md:13` |
| Tests | Shared sanitizer/client tests, desktop adapter tests, E2E consent/withdraw + download-attribute specs, visual spec seeds denied consent. | `packages/shared/src/analytics/analytics.test.ts`, `packages/editor/src/analytics/desktopAnalytics.test.ts`, `apps/website/tests/e2e/analytics.spec.ts`, `apps/website/tests/e2e/download.spec.ts` |

## 2. Prohibited-data verification

Every item in the prompt's prohibited list is enforced by the schema's exact
field list plus the runtime denylist (`packages/shared/src/analytics/privacy.ts`):
document names, file paths, imported/asset names, layer/node names, canvas
content, user text, design dimensions, prompts, persistent cross-site
identifiers, and fingerprinting are all rejected keys or non-existent event
fields. No autocapture, DOM capture, session replay, or fingerprinting exists.
The only bounded free-form value is the `release` version string
(`[A-Za-z0-9._-]{1,40}`).

**Verdict: compliant, with one disclosure-accuracy defect** — the disclosure
page and measurement-plan table present schema-defined desktop events as if
they were measured (see §3, N-3/N-4).

## 3. Approved / needs-change matrix

| # | Item | Status | Action |
|---|---|---|---|
| A-1 | Typed closed event schema + runtime validator + denylist | **Approved** | None |
| A-2 | Consent model (unknown = denied, per-category, revocable, queue dropped) | **Approved** | None |
| A-3 | GPC/DNT fail-closed on the website | **Approved** | None |
| A-4 | Provider-neutral client; no vendor imports in feature code | **Approved** | None |
| A-5 | Bounded memory-only queue; no disk persistence | **Approved** | None |
| A-6 | Website consent prompt + withdraw path, E2E-tested | **Approved** | None |
| A-7 | Crash reporting isolation from analytics consent | **Approved** | None |
| A-8 | No dev/localhost analytics on the website | **Approved** | None |
| A-9 | Trust boundary: analytics domain is public config; no secrets in client builds | **Approved** | None |
| N-1 | Desktop `app_launched` platform hardcoded `unknown` | **Needs change** | **Fixed in this audit** — pass detected OS into `configureDesktopAnalytics` (`apps/desktop/src/App.tsx`) |
| N-2 | In-app privacy copy claims "this build has no configured usage endpoint" — false for release builds (release.yml sets the domain; granted consent + boot → POST) | **Needs change** | **Fixed in this audit** — copy is now conditional on `hasConfiguredAnalyticsEndpoint()` |
| N-3 | Public analytics disclosure lists `document_created`, `feature_used`, `export_completed/failed`, `renderer_fallback`, `performance_sample` as active desktop events — none are emitted | **Needs change** | **Fixed in this audit** — disclosure now distinguishes active vs defined-not-yet-emitted |
| N-4 | `docs/privacy/analytics.md` retention column still says "must be documented before activation"; activation shipped without the provider retention/access/DPA record | **Needs change** | **Fixed in this audit** — governance section written; manual items M-1..M-5 remain account-side |
| N-5 | Desktop flush cadence undefined (only boot flush exists) | Needs change | Prompt 11 (flush strategy) |
| N-6 | Route normalization collapses `/support/known-issues`, `/product`, `/contact`, `/about`, `/security` to `/`; no `/try` route for the built browser demo (`build:try`) | Needs change | Prompt 11 (route set extension) |
| N-7 | Dead `data-analytics-contact` attribute (`ContactChannel.astro:48`) — no listener, no schema event | Needs change | Prompt 11 (wire a contact event or remove the attribute) |
| N-8 | No attribution design documented (README vs Releases vs docs vs search vs demo) | Needs change | **Fixed in this audit** — §5 below |
| N-9 | No baseline/leading-indicator/vanity-metric definition | Needs change | **Fixed in this audit** — §6 below |
| N-10 | No browser-demo events in the schema (demo now built as `build:try` → `/try/` per AGENTS.md) | Needs change | Prompt 11 (proposals in §4) |
| N-11 | Plausible script's own localStorage queue default unverified | Needs change | Manual item M-2 (no code change needed if disabled) |

## 4. Exact event schema (authoritative)

Schema v1, three categories. **Status: ACTIVE = emitted in production; DEFINED = in schema/disclosure but not wired.**

### Website (category `website`)

| Event | Fields (closed enums) | Status |
|---|---|---|
| `website_page_viewed` | `route` ∈ {`/`, `/download`, `/releases`, `/features`, `/docs`, `/contribute`, `/support`, `/about/privacy`} | ACTIVE |
| `website_download_started` | `release` (bounded ≤40 chars), `platform` ∈ {linux, windows, macos, unknown}, `architecture` ∈ {x64, arm64, unknown}, `packageType` ∈ {appimage, deb, rpm, dmg, nsis, unknown}, `releaseChannel` ∈ {beta, stable, prerelease} | ACTIVE |
| `website_outbound_clicked` | `destination` ∈ {github, docs, community} | ACTIVE |

### Desktop (categories `usage` / `diagnostics`)

| Event | Fields | Category | Status |
|---|---|---|---|
| `app_launched` | `surface` = desktop | usage | ACTIVE (platform field fixed in this audit) |
| `document_created` | `source` ∈ {blank, template, import} | usage | DEFINED |
| `feature_used` | `feature` ∈ 12 closed values | usage | DEFINED |
| `export_completed` | `format`, `durationBucket` | usage | DEFINED |
| `export_failed` | `format`, `code` | diagnostics | DEFINED |
| `renderer_fallback` | `from`, `to`, `reason` | diagnostics | DEFINED |
| `performance_sample` | `metric` ∈ {startup, export, interaction}, `durationBucket` | diagnostics | DEFINED |

Every event carries context `{appVersion (bounded), platform, runtime, releaseChannel}` and a timestamp; every event is validated field-by-field and passed through the denylist before queueing. Desktop events attribute to pseudo-page `https://varve.studio/app`.

### Proposed additions (Prompt 11 candidates — require the §8 change-review before shipping)

| Event | Fields | Category | Answers |
|---|---|---|---|
| `browser_demo_launched` | `entry` ∈ {website, direct} | usage (web) | Demo reach/activation without pageview logic |
| `browser_demo_desktop_download` | `release`, `platform`, `architecture`, `packageType` | website | Demo → desktop conversion |
| `website_contact_clicked` | `channel` ∈ {support, community, email} | website | Support/troubleshooting navigation (replaces dead attribute, N-7) |

Not proposed: event content, dimensions, timings, session/retention derivations, or any field that could fingerprint documents.

## 5. Attribution design

Goal: distinguish GitHub README, GitHub Releases, docs, homepage, search, and
the browser demo **without UTM parameters, redirects, or persistent tracking
parameters**.

- **GitHub README / repo links** → land on varve.studio; Plausible's built-in
  referrer tracking shows `github.com` as the source with the entry page. No
  extra instrumentation.
- **GitHub Releases** → downloads happen on `github.com` release assets;
  GitHub's own per-file release statistics are the source of truth (already
  the documented practice, `about/privacy.astro:28-30`). Cross-check totals
  against `website_download_started` volume.
- **Docs** → entry page = `/docs`; the pageview sequence `/docs → /download`
  is the docs→download conversion, read from Plausible's entry-page and flow
  data.
- **Homepage** → entry = `/` (direct or referred).
- **Search** → Plausible search-engine referrers give the engine and the
  landing page; **queries themselves come only from Search Console / Bing
  Webmaster Tools** (manual, §6), never from analytics events.
- **Browser demo** → `/try` pageview + proposed `browser_demo_launched`
  event; demo→desktop download via the proposed event. No cross-session
  linkage: demo and download are correlated only at cohort level.
- **Explicitly avoided**: no UTM/fbclid/gclid-style parameters on any Varve
  link, no referrer persistence, no query-string or fragment retention, no
  cookie-based cross-session attribution. Attribution is session-scoped,
  referrer-derived, and read only from the provider dashboard.

## 6. Measurement plan

- **Baseline period**: first 90 days of consented data from the analytics-
  enabled release (v0.1.2, 2026-08-14). Compare week-over-week and vs the
  baseline window; do not read absolute numbers as demand signal.
- **Primary leading indicators** (in priority order):
  1. `website_download_started` per platform / architecture / package type
     (per-platform download ratio: Linux x64 vs arm64 vs Windows vs macOS,
     AppImage vs deb vs rpm vs dmg vs nsis), cross-checked with GitHub
     release stats.
  2. Download CTA conversion: `/download` pageviews → `website_download_started`.
  3. Referral/source quality: referrer/entry-page funnel to the download CTA
     (GitHub vs docs vs search vs direct) at cohort level.
  4. Opted-in desktop sessions (`app_launched` per platform/channel) — proxy
     for activation volume, not retention.
  5. Docs → download sequence rate.
  6. Support-path clicks (`website_outbound_clicked` to community/github) —
     proxy for troubleshooting demand.
- **Vanity metrics to de-emphasize**: raw pageviews, unique visitors, time-on-
  page, bounce rate. **PMF/retention must never be derived from website
  pageviews.**
- **Search**: Search Console property for varve.studio (manual), Bing
  Webmaster Tools; queries reviewed monthly for content gaps only.
- **Qualitative activation/retention research**: manual and voluntary —
  GitHub Discussions threads, support email themes, opt-in interviews.
  Nothing automated, nothing derived from analytics.

## 7. Data governance

- **Retention period**: client keeps nothing (memory queue only, dropped on
  shutdown/revocation). Provider side: Plausible retains while the
  subscription is active and deletes within ~30 days of cancellation;
  document this as the operative retention and re-verify at each release.
- **Who has access**: owner + one reviewer, nothing else, no third-party
  subcontractor access. Access list re-verified quarterly and before each
  release (manual item M-3).
- **Deletion / export**: export (CSV/API) before any account change; deletion
  is by subscription termination + provider deletion request; record each
  execution in the release checklist. User-side "deletion" = clearing the
  localStorage consent key (no server data exists to erase per-visitor).
- **Provider privacy settings (Plausible dashboard)**: verify automatic
  pageviews/file-downloads/outbound-links/form-submissions are off (client
  forces them off, but verify), the script's localStorage queue flag is
  disabled (M-2), query-parameter stripping is on, and DNT is honored.
- **Change-review requirement (already in force)**: any schema change runs
  the six-question checklist in `docs/architecture/analytics.md` ("Adding an
  event"), adds validator coverage + a privacy test, updates both disclosure
  surfaces and this matrix, and lands in a reviewable commit. No provider SDK
  or new endpoint may bypass the provider boundary.

## 8. Privacy risks

1. **Third-party script on consent**: the Plausible script is third-party
   code executed after consent only; automatic capture is disabled, but
   upstream script changes are outside our control — mitigation is the
   closed-event client plus periodic re-verification of the loaded script.
2. **Plausible script localStorage queue**: the script defaults to queueing
   offline events in localStorage; unverified, and would contradict the
   "nothing persisted" framing (M-2).
3. **IP in transit**: events reach Plausible's servers; Plausible does not
   store IPs, but the request metadata is visible to the provider (disclosed
   in the privacy policy for the update endpoint; the analytics paragraph
   should state the same).
4. **Desktop network egress to plausible.io**: Tauri CSP already allows
   `https://plausible.io` in release and dev CSPs; egress happens only after
   consent, but the CSP allow-list entry is now unconditional in all builds.
5. **Release/version strings**: bounded to 40 chars of safe charset; low but
   non-zero correlation surface with specific builds — acceptable and
   disclosed.
6. **Provider account compromise**: aggregate data only, no design content;
   mitigated by the two-person access policy and no admin keys in client
   builds.

## 9. Manual account / config needs

- **M-1** Plausible subscription active for `varve.studio`; record retention
  understanding + DPA/legal review (GDPR/ePrivacy, UK, Canadian, CCPA/CPRA)
  in the release ops checklist before the next analytics-enabled release.
- **M-2** Verify/disable the Plausible script localStorage queue flag and
  dashboard optional measurements; verify query-parameter stripping.
- **M-3** Trim Plausible member access to owner + one reviewer; re-verify
  quarterly and pre-release.
- **M-4** Search Console property verification for varve.studio (GitHub
  Pages domain verification); Bing Webmaster Tools.
- **M-5** Record export-before-cancellation and deletion procedure in
  `docs/release/release-checklists.md`.

## 10. Implementation scope for Prompt 11 (bounded)

In priority order; each item requires the change-review of §7 before landing:

1. Desktop flush strategy — periodic timer + best-effort flush on
   shutdown/unload; keep the memory-only queue.
2. Wire `document_created` (blank/template/import) at creation points.
3. Wire `export_completed` / `export_failed` (format, duration bucket, code).
4. Wire `feature_used` for the high-signal subset (image_trace,
   background_removal, upscale) — not all 12 features.
5. Website route normalization extension (`/support/known-issues` →
   `/support`, `/product` → `/features`; add `/try` when the demo lands).
6. Resolve `data-analytics-contact`: wire `website_contact_clicked` or remove
   the attribute.
7. Demo events (`browser_demo_launched`, `browser_demo_desktop_download`) when
   the demo workstream lands — coordinated, not owned, by this workstream.
   The demo is now built as `build:try` and serves at `/try/` (AGENTS.md).
8. Update disclosure pages, `docs/privacy/analytics.md`, and this matrix for
   every landed item; extend the E2E specs.
