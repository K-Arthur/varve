# ADR-0153: Browser versus desktop capabilities

- **Status:** Accepted
- **Date:** 2026-08-05

## Context

The app runs in Tauri (Linux WebKitGTK / Windows WebView2 / macOS WKWebView)
and the browser. Native features (font enumeration, OS print, file dialogs,
rustybuzz shaping IPC) are desktop-only; existing capability flags exist
(`platform/runtime.ts:43,224`).

## Decision

D1 — Multipage editing, master pages, text flow, print preview, and web PDF
export work in both environments. Desktop-only paths are: OS print (CUPS,
`print.rs`), native font enumeration, rustybuzz shaping IPC, native file
dialogs, system color profiles.

D2 — Feature gating uses the capability model; disabled controls explain the
platform limitation instead of silently disappearing (spec §36).

D3 — Composition results must be identical across environments: the
composition engine is deterministic from inputs (ADR-0137 D3); font-manifest
differences are surfaced, not hidden.

D4 — Storage limits (browser IndexedDB vs desktop SQLite) are handled:
autosave and version history degrade gracefully with quota errors surfaced
(ADR-0154).

## Alternatives

- Desktop-only multipage — rejected: spec requires browser parity for core
  editing.
- Feature-detecting per API at call sites — rejected: central capability
  model exists.

## Consequences

- E2E Playwright runs in Chromium cover the web path; native smoke tests
  cover Tauri paths (spec §38.10).

## Migration impact

None.

## Compatibility impact

None.

## Security considerations

Browser CSP already in place (`security-csp.md`); native commands remain
allow-listed through Tauri IPC.

## Rejected shortcuts

- Disabling features on web silently.
- Different composition outputs per platform.
