# ADR-0040: Security and capability scoping

- **Status:** Accepted
- **Date:** 2026-08-05

## Context

The desktop app today grants `["main"]` a small window permission set
(`capabilities/default.json`: start-dragging, close, minimize,
toggle-maximize). Multi-window support will demand more window APIs, and
every new window is a new attack surface. Every cross-window message is
untrusted input.

## Alternatives

1. Grant every window the full capability set (rejected — one compromised
   panel window could create/control anything).
2. Narrow per-window capabilities with a strict message validator
   (chosen).

## Decision

- **Tauri capabilities:** primary window gains the window/monitor
  permissions it needs (`core:window:allow-create` (via
  `WebviewWindow`), `allow-available-monitors`, `allow-primary-monitor`,
  `allow-current-monitor`, `allow-monitor-from-point`,
  `allow-set-position`, `allow-set-size`, `allow-inner-position`,
  `allow-inner-size`, `allow-outer-position`, `allow-outer-size`,
  `allow-set-focus`, `allow-show`, `allow-hide`, `allow-set-title`,
  `allow-set-min-size`, `allow-start-dragging`, `allow-close`,
  `allow-destroy`). Auxiliary windows get **only**: `core:default`,
  `core:window:allow-set-position/size/show/hide/set-focus/close`,
  `dialog:default` (file dialogs parented to themselves), `fs:default`
  scoped to read nothing extra — no create, no monitors, no arbitrary
  URL navigation.
- **Window creation rules:** only application-owned routes
  (`index.html?surface=panel-window...`); no arbitrary URLs; labels are
  sanitized/bounded (ADR-0020); query strings carry opaque ids only —
  never file contents, credentials, native paths, document names, or
  document JSON (ADR-0020/0021).
- **Message validation** (ADR-0023): protocol version, session id,
  window registration + generation, sender permission, message type,
  payload schema, payload size, sequence, document revision, panel
  capability, target document, command authorization. Reject: spoofed
  session/window ids, replayed/duplicate commands (commandId dedupe),
  stale commands, floods (rate limits), oversized snapshots, prototype
  pollution (schema validation, no `__proto__` keys), drag payload
  tampering.
- **Imported layouts** (ADR-0032): schema-validated, geometry sanitized
  (NaN/Infinity/huge coordinates rejected), panel ids must reference the
  registry; a malicious layout cannot create arbitrary windows or invoke
  arbitrary commands — it is a data file, validated like any other
  document import.
- **Window-count bounds:** max auxiliary windows (default 8) with a
  warning before restore of costly layouts.
- **CSP:** the existing CSP (`tauri.conf.json`) is not weakened; the
  auxiliary route inherits it. `frame-src: 'none'` stays.
- Crash reports use opaque window/panel ids, never document names or
  paths (privacy).

## Consequences

- An auxiliary window that is compromised cannot create windows, read
  monitors, or navigate elsewhere; it can only send session commands,
  which are validated against its registered panels.
- The capability files enumerate exactly what each window role may do.

## Migration impact

`capabilities/default.json` is split into primary/auxiliary capability
files with matching `windows` scopes.

## Cross-platform implications

Capabilities are platform-agnostic in Tauri; macOS/Wayland/Windows all
enforce the same scopes.

## Security implications

This ADR is the security contract; validated by the fuzz/security test
suite (ADR-0042) and a review pass in M15.

## Accessibility implications

None (no user-facing change).

## Performance implications

Validation is O(payload) with precompiled validators; negligible.

## Rejected shortcuts

Granting all capabilities to all windows; trusting window labels as
identifiers; serializing document JSON into URLs; unbounded window counts.
