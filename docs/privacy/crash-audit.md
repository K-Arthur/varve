# Crash-reporting audit: failure capture and diagnostic data flows

Status: audit completed 2026-08-04. Part of the privacy-first crash-reporting
and crash-recovery work (see `docs/crash-reporting/README.md`).

This document maps every place information could leave the device without
informed consent, and every failure source with its capture boundary. It is
the baseline the implementation in `packages/crash` (and the editor/Rust
integrations) builds on.

## 1. Existing-system findings

### 1.1 Logging

- No logger abstraction anywhere. Raw `console.*` (~55 call sites) in TS and
  `println!`/`eprintln!` (~15 call sites) in Rust. No `log`/`tracing` crate in
  any manifest or lockfile.
- Call-site prefixes: `[Strata]`, `[Varve]`, `[spike]`, `[dbg-kd]`, `[nativeMenu]`.
- No log files are written; no logs leave the device today.

### 1.2 Telemetry / analytics (updated 2026-08-13)

- **No third-party telemetry, analytics, or crash SDKs are bundled.** No Sentry,
  Crashpad, Breakpad, Bugsnag, Rollbar, OpenTelemetry, PostHog, Mixpanel,
  Amplitude, GA4, Plausible SDK, or Segment appears in `package.json`,
  `pnpm-lock.yaml`, `Cargo.toml`, or `Cargo.lock`. The website has a
  provider-neutral, explicit Plausible Events API adapter in its own app
  boundary; it is disabled unless configured and consented.
- Local product signals remain local-only and consent-free:
  - `ActionTracker` — localStorage `strata:actions` (editor intelligence).
  - Template usage — localStorage `varve-template-usage`.
  - Design fingerprint — localStorage `strata:design-fingerprint`.
  - Interaction traces — in-memory ring (dev diagnostics panel).
- Desktop usage analytics and diagnostics are separate explicit settings in
  `varve-editor-settings`, both defaulting to `unknown` and failing closed.
  `ai.shareUsageData` remains unrelated and is **never** interpreted as
  analytics or crash-reporting consent. See `docs/architecture/analytics.md`.

### 1.3 Crash handlers (existing)

| Layer | What exists | Gap |
|---|---|---|
| Boot (pre-bundle) | `apps/desktop/index.html` inline `error`/`unhandledrejection` → `showBootError()`; 20s startup watchdog | No record; no consent; no queue |
| React | `ErrorBoundary` (`componentDidCatch` → `console.error`, reload UI) | No record |
| Rust | `spawn_blocking` converts ONNX inference panics to `JoinError`; mutex poisoning recovery in `varve-sync` | No `panic::set_hook`; no emergency record; native aborts invisible |
| WASM | `Result<_, JsValue>` returns from `varve-wasm` | No `console_error_panic_hook`; traps abort silently |
| Workers | `workerHost.ts`, `brushWorkerHost.ts`, inference/upscale/outline pools: `onerror` → terminate + fallback | Errors are swallowed, never recorded |
| WebGL/WebGPU | Canvas fallbacks (render worker → main thread) | Context loss not tracked |
| Autosave/recovery | `RecoveryManager` (IDB `strata-recovery`), `AutoSaveService`, `BackupService`, `strata-clean-shutdown` marker | No crash *report* system at all |

### 1.4 Network egress inventory (all content-fetching, none analytics)

| Destination | Purpose | Credentials |
|---|---|---|
| github.com / raw.githubusercontent.com | ONNX model downloads | none |
| huggingface.co / *.hf.co | model downloads | none |
| fonts.googleapis.com, www.googleapis.com | font API | none |
| api.fontsource.org, api.iconify.design, cdn.jsdelivr.net | font/icon content | none |
| User-configured cloud bg-removal endpoint | opt-in cloud provider (`strata-bg-cloud-config`, default disabled) | Bearer token (user-supplied key, stored plaintext in localStorage) |

CSP (`tauri.conf.json`): `connect-src` allows only `'self'`, `ipc:`,
`http://ipc.localhost`, the model/font/icon hosts above. No telemetry
endpoint exists.

### 1.5 Storage inventory (privacy-relevant)

localStorage keys (current): `varve-settings`/`strata-settings`,
`varve-editor-settings`, `varve-theme`, `varve-workspace-preferences`,
`strata-shortcut-overrides`, `varve-panel-*`, `strata-clean-shutdown`,
`strata-backup-service`, `varve-backup-config`, `recentFiles.v1`,
`strata:actions`, `strata:design-fingerprint`, `strata:onboarding`,
`varve-template-usage`, `strata-bg-cloud-config`, `strata-versions`,
model-state keys, icon/font favourites, quick-actions recents.

IndexedDB databases: `varve-home` (web files/projects), `strata-recovery`
(recovery sessions — still the primary name), `varve-backups`,
`varve-model-store`, `varve-fonts`, `varve-icon-storage`,
`varve-recent-handles`.

SQLite (desktop): `<app_data>/documents.db` (`DocumentStore`); settings KV
(`app-setting:*`); file metadata; thumbnails. Legacy Strata data dir is
migrated at startup (`migrate_legacy_data_dir`).

### 1.6 Strata identifiers (affect grouping/migration)

- localStorage keys still named `strata:*` (actions, onboarding, tips,
  design-fingerprint, shortcut-overrides, bg-cloud-config, versions…).
- IDB DB `strata-recovery` is the primary recovery store name.
- Model directory `~/.local/share/strata/models/` on all OSes.
- `.strata` file extension + `application/x-strata` MIME association.
- Console prefixes `[Strata]`, `[Varve]`, gradient format `strata-gradient`,
  prototype announcer key, codegen classes.

**Rule adopted:** no legacy Strata preference is crash-reporting consent.
Only an explicit `strata:crash-consent` decision record may migrate (see
`packages/crash/src/consent.ts`). Legacy analytics opt-ins never do.

### 1.7 Places information could leave the device today

1. Model downloads (github/huggingface) — content fetches; request includes
   IP and headers only. No consent gate today (out of scope; disclosed).
2. Font/icon fetches (Google Fonts, Fontsource, Iconify) — same.
3. Cloud bg-removal provider — user-configured, opt-in, disabled by default.
   Sends image content to the configured endpoint. Consent is explicit
   (user-configured), but not crash-related.
4. Analytics transport exists only behind explicit category consent and an
   endpoint/provider configuration. The default desktop build has no endpoint;
   the website has no endpoint unless `ANALYTICS_DOMAIN` is set at production
   build time. Crash reporting remains separately configured and defaults to a
   no-op uploader.

## 2. Target architecture map

```
failure source
  → capture boundary        (window.onerror, unhandledrejection, ErrorBoundary,
                             worker onerror, WASM trap, Rust panic hook →
                             emergency record, context-loss handlers, hangs)
  → local normalization     (crash taxonomy → typed category + subsystem)
  → redaction               (structured allowlist + redactText — BEFORE storage)
  → consent gate            (versioned consent state machine; sync lookup)
  → local queue             (bounded, opaque IDs, atomic writes, expiry)
  → optional user review    (review-before-send, removable attachments)
  → upload                  (TLS-only, bounded retries, idempotent reportId)
  → backend ingestion       (size limits, schema validation, canonical-
                             redaction verification, rate limiting)
  → grouping                (technical fingerprint — never user identity)
  → retention/deletion      (documented TTL, deletion workflows, audit logs)
  → developer triage        (release id + symbols/source maps, separated envs)
```

Consent gate placement: before the queue is *visible* is not required; the
gate sits (a) at capture-time routing (upload vs ask vs silent), (b) at every
upload dispatch (synchronous re-check), and (c) at revocation (abort in
flight). Redaction runs before the queue so locally stored reports are
already safe to review and safe to hold on disk.

## 3. Data inventory (crash-reporting)

### 3.1 Required minimized crash data

| Field | Example | Notes |
|---|---|---|
| schema version | `1` | versioned report schema |
| report id | `r-…` | random, opaque, per report |
| session id | `s-…` | non-persistent, dedup only |
| created at | epoch ms | |
| app version | `0.1.0` | |
| build channel | `dev`/`nightly`/`beta`/`production` | |
| release id | immutable release identifier | report grouping anchor |
| document schema version | `3` | number only — no content |
| runtime | `tauri`/`browser`/`webview2`/`webkitgtk`/`wkwebview` | |
| OS family + broad range | `linux`, `6.0+` | never a full version string |
| CPU arch | `x64`/`arm64` | |
| renderer backend | `canvas2d`/`webgpu`/`webgl` | |
| crash type + normalized category | `wasm`, `wasm-trap` | taxonomy |
| thread category | `main`/`worker`/`render`/`native`/`wasm` | |
| feature subsystem | `canvas`, `export`, `print`… | |
| sanitized stack trace | ≤ 32 frames, code-file basenames only | |
| memory-pressure category | `low`…`critical` | never a dump |
| recovery status | `recovered`/`not-recovered` | |
| consent-policy version | `1` | what the user agreed to |
| group fingerprint | `g-…` | technical only |

### 3.2 Optional diagnostic data (separate opt-in)

- Extended context: subsystem, reason, raw (redacted) stack, git commit,
  tauri/frontend bundle versions.
- Local log excerpt (sanitized, bounded) — attachment class.
- Performance context (breadcrumbs of typed events).

### 3.3 Prohibited data (never collected by any path)

Canvas screenshots, window screenshots, screen recordings, document
contents, layer/page/component names, user-entered design text, imported
images, exported output, clipboard data, full filesystem paths, usernames
in paths, home-directory paths, network share paths, recent-file names,
email addresses (except explicit user contact field), IP addresses as
identifiers, precise location, stable hardware fingerprints, advertising
identifiers, full URLs with query strings or document ids, access tokens,
authorization headers, cookies, API keys, environment secrets, model
prompts, full process memory dumps, arbitrary browser storage, raw console
history, unbounded application logs.

### 3.4 Attachments (explicit user selection only, never default)

Sanitized local log excerpt; user-authored description/reproduction steps;
manually selected diagnostic bundle; redacted configuration snapshot; a
screenshot or example file deliberately attached by the user. The currently
open Varve document is never attached automatically.

## 4. Key decisions recorded here

1. **Consent is a versioned state machine** (`unknown` /
   `askEachTime` / `automaticAllowed` / `denied` / `managedDisabled` /
   `unavailable`). Unknown fails closed. Spec: `docs/privacy/consent-state.md`.
2. **Default uploader is a no-op.** No endpoint is configured in any build;
   ingestion is a documented contract (`docs/privacy/ingestion.md`).
3. **Redaction runs before storage** and is verified at ingestion
   (canonical-redaction check) — client-side redaction is not the only
   control.
4. **Recovery and reporting are separate.** Recovery works with reporting
   disabled; the recovery dialog never conditions recovery on sending.
5. **No persistent device fingerprint.** Report correlation uses per-report
   technical fingerprints and a non-persistent session id only.
