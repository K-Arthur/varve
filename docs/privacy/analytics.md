# Analytics measurement plan and data inventory

Production website and desktop release builds are configured for the
`varve.studio` Plausible site, but transmission still requires the relevant
user consent. Local and unconfigured builds remain network-silent. This
document describes the permitted contract and the data transmitted by the
enabled aggregate provider.

| Question | Metric / event | Fields | Category | Retention | Decision |
|---|---|---|---|---|---|
| Which pages help visitors reach a useful destination? | `website_page_viewed` | normalized route | Website | Provider policy must be documented before activation | Improve navigation and documentation |
| Which release/platform downloads matter? | `website_download_started` | release, platform, architecture, package type, release channel | Website | Provider policy must be documented before activation | Prioritize packaging and release support |
| Do community links help? | `website_outbound_clicked` | destination category | Website | Provider policy must be documented before activation | Improve contribution/support paths |
| What starts an opted-in desktop session? | `app_launched` | surface | Usage | Provider policy must be documented before activation | Understand activation at aggregate level |
| Which broad workflows are adopted? | `document_created`, `feature_used` | closed source/feature enum | Usage | Provider policy must be documented before activation | Prioritize feature work |
| Where do exports fail or slow down? | `export_completed`, `export_failed` | format, duration bucket, error code | Diagnostics / usage | Provider policy must be documented before activation | Improve export reliability |
| Which renderer/platform paths need work? | `renderer_fallback`, `performance_sample` | backend/reason/metric/duration bucket | Diagnostics | Provider policy must be documented before activation | Improve compatibility and performance |

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

## Legal and operational note

Technical controls do not determine the legal basis for a deployment. Before
enabling a real provider, Varve maintainers must confirm the actual user
jurisdictions, provider terms/DPA, data residency, retention, access controls,
deletion workflow, and applicable GDPR/ePrivacy, UK, Canadian, and
CCPA/CPRA requirements with qualified legal advice where needed.
