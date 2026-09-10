# Runbooks: crash triage, symbols, privacy incidents, safe mode

## 1. Crash triage runbook

Prerequisites: report id (shown in the app after sending, or found in the
queue), the release id from the report (`release.releaseId`), and consent
metadata (reports carry `consentPolicyVersion`; never assume consent).

1. **Fetch the report** by id (ingestion API) or read the local queue
   (Privacy & Diagnostics → queued reports). Confirm the payload is the
   canonical form (schema v1; no unknown fields; no attachment content).
2. **Classify**: `crash.type` + `crash.category` from the taxonomy
   (`docs/privacy/crash-audit.md` §3.1 data inventory). Filter out
   ordinary errors that are not crashes (e.g. `window-error` with category
   `command.failed` during a user-cancelled operation).
3. **Group** by `groupFingerprint` (type + category + top frames + release
   + runtime). Never group by user identity, document name, path, or IP.
4. **Verify release**: confirm `releaseId` maps to a known release and that
   symbols exist (section 2). Missing symbols ⇒ the report is triaged
   coarsely (frame modules only).
5. **Read the sanitized stack**: module basenames resolve against the
   release's source maps / symbols. Look for the crash site, then correlate
   with `breadcrumbs` (typed events only) and `recoveryStatus`.
6. **Check platform breakdown**: `runtime.osFamily`, `runtime.runtime`,
   `runtime.rendererBackend`, `runtime.memoryPressure`. A category
   concentrated on one runtime is a webview/backend bug, not a scene bug.
7. **Regression check**: first-seen/last-seen releases for the group;
   affected version ranges; known-issue annotations.
8. **Resolve or annotate**: fixed-in release, known-issue, or needs-more-
   info. Reopening a resolved group requires a release that reintroduced it.

Metrics to record per group: capture success, recovery success, safe-mode
recovery, symbolication success (from local reporter metrics where
consented; otherwise aggregate counts only).

## 2. Source-map and native-symbol runbook

No public web server ever serves source maps or symbols.

1. **Frontend**: CI uploads `*.js.map` artifacts to the ingestion symbol
   store, keyed by `releaseId` + `frontendBundleVersion`, only for
   trusted builds (tagged releases; CI token-scoped, never in client
   builds).
2. **Release identity**: `window.__VARVE_RELEASE__` is stamped at build
   time via Vite `define` from `VARVE_APP_VERSION`, `VARVE_BUILD_CHANNEL`,
   `VARVE_RELEASE_ID`, `VARVE_GIT_COMMIT` env vars. Dev/unstamped builds
   report channel `dev` and are separated from production ingestion.
3. **Native**: `cargo` debug symbols for each target are archived per
   release (`.dwp`/`.pdb`/`.dSYM` as applicable); the Rust emergency
   records carry `CARGO_PKG_VERSION` for lookup.
4. **WASM**: `wasm-opt --debuginfo` builds archive DWARF per release id.
5. **Release verification**: before a release is marked supported, CI
   checks the symbol manifest covers the release id; missing entries fail
   the gate (`detect missing symbols during release verification`).
6. **Retention**: symbols are kept for supported historical releases
   (default: 12 months or 6 releases, whichever is longer) and purged with
   an audit log.
7. **Credentials**: symbol-upload tokens live in CI secrets; ingestion
   administration secrets never appear in application code or client
   bundles.

## 3. Privacy incident runbook

Trigger: any report (or attachment, or support bundle) believed to contain
prohibited data (document content, paths, credentials, screenshots without
consent), or any suspected pre-consent transmission.

1. **Contain**: pause the ingestion queue (server side) and revoke the
   uploader config; do not delete evidence.
2. **Assess**: check the report payload against the data inventory
   (`docs/privacy/crash-audit.md` §3). Verify consent state, policy
   version, and whether the redaction pipeline or ingestion validator
   should have caught it.
3. **Classify** severity: single report vs systemic leak (e.g. a new field
   added without classification, a redaction gap).
4. **Delete**: purge affected reports per `retention.md` deletion
   workflows; keep an audit record (no payload copy).
5. **Fix root cause**: new redaction rule + fixture + test (Phase 20 rule:
   every field needs privacy classification and tests); re-run the
   full `packages/crash` + ingestion test suites.
6. **Notify**: per applicable law/contract; engineering review is not legal
   approval — have privacy/legal review final policies and retention
   choices.
7. **Reopen ingestion** only after verification (validator + tests green).

## 4. Safe-mode and recovery guide (users)

- **What it is**: Varve detected several consecutive failed startups and
  offers a reduced startup. Nothing is deleted: documents, settings,
  models, fonts, and autosaves stay in place.
- **What to try**: disable GPU acceleration, skip reopening the last
  document, skip workspace restore, disable downloaded models/extensions,
  reset only affected caches, or reset the window layout — then start in
  safe mode.
- **Recovering documents**: recovery points open through the normal
  recovery dialog after the editor starts; they are independent of safe
  mode and of crash reporting.
- **Leaving safe mode**: choose "Continue normal startup" on the safe-mode
  screen, or exit from Privacy & diagnostics settings. Safe mode is always
  visible and reversible.
- **Reporting**: crash-reporting consent is respected in safe mode exactly
  as outside it.

## 5. Support guide (report ids)

When a user shares a report id (`r-…`), support can look it up in the
ingestion store. The id is opaque, unguessable, and linked only to the
report payload — not to a user account, device, or document name. If the
report was declined or deleted locally, the id does not exist server-side;
ask the user to reproduce and send.
