# ADR-0035: Dialog and overlay ownership

- **Status:** Accepted
- **Date:** 2026-08-05

## Context

Dialogs use inline `<dialog>` in the Shell tree; menus/popovers portal to
`document.body` (`FloatingPortal.tsx:152-157`); tooltips portal to
`document.body` (`Tooltip.tsx:513`). In a multi-window app, `document.body`
is per-window — but cross-window modal coordination (a modal in one window
blocking another) has no mechanism.

## Alternatives

1. Global modal state in the broker, one modal root per window
   (chosen).
2. Let each window manage modals independently (rejected: a document-close
   prompt in the primary could be circumvented by editing in an auxiliary).

## Decision

- Every window gets its own React root, portal root, focus boundary,
  tooltip host, context-menu host, and toast handling (already per-window
  by construction once auxiliary windows mount their own roots).
- **Window-local UI** — tooltips, context menus, dropdowns, panel search,
  panel popovers, toasts for actions originating in that window — stays
  window-local; no broker traffic.
- **Session modals** — document close confirmation, save failure, global
  preferences, authentication, fatal recovery, transfer-error dialogs —
  are broker-coordinated: one modal at a time per session; while a session
  modal is open, other windows' session-affecting shortcuts are gated and
  session-commands are queued/rejected (ADR-0028); native file dialogs
  get the correct parent window where supported (`plugin:dialog` parent
  param, `tauri.ts` dialog calls).
- Per-window z-index/stacking only; never attempt cross-window CSS
  stacking. Popovers never render into another window's root.

## Consequences

- No invisible modal in one window silently blocking another.
- Existing dialogs (Settings, Export, FindReplace, Prompt, IconBrowser,
  Recovery) stay primary-owned; auxiliary windows host only
  window-local popovers plus the session modal *mirror* (announcement +
  disabled state), never a second copy of the modal content.

## Migration impact

Session-modal coordination is additive (M11); existing dialogs unchanged
until then.

## Cross-platform implications

Native dialog parenting differs per OS; the platform service abstracts it.

## Security implications

Session modals gate session commands; a detached window cannot open a
second save-failure flow or bypass a confirmation.

## Accessibility implications

Per-window focus boundaries + `useFocusTrap`
(`hooks/useFocusTrap.ts:159`) reused; modal announcements are session-wide
("A dialog is waiting in the main window").

## Performance implications

One modal instance per session; window-local overlays stay local (no
cross-window message traffic for tooltips).

## Rejected shortcuts

Shared DOM portal root across windows; replicating modal content per
window; uncoordinated per-window modals.
