# Varve notification-system audit

Date: 2026-08-31

## Result

The repository has one production toast implementation and one explicitly
mounted provider. No Sonner package, Sonner import, legacy `useToast` wrapper,
`window.alert`, or duplicate production toaster was found. The existing custom
system was retained and consolidated because it was already the only system;
the work focused on its missing lifecycle, action, accessibility, and burst
controls rather than adding another runtime.

## Areas inspected

- `packages/ui`: Toast, provider, tokens, radius system, icon registry, Spinner,
  component exports, tests, and Storybook fixture.
- `packages/editor`: Shell/provider bridge, context `showToast`, thumbnail
  commands, tab close failure, layer/effect feedback, navigation findings,
  shortcut palette, text outlining, status-bar save state, and async model
  panels.
- `apps/desktop`: React root and Shell mounting path; Tauri uses the same
  per-window editor provider.
- `apps/website`: feature/release messaging and visual page coverage.
- `tests` and `docs`: repository-wide notification terms, E2E references,
  accessibility guidance, overlay/radius/loading documentation, and existing
  audit conventions.

## Classification decisions

| Surface | Decision | Reason |
| --- | --- | --- |
| Thumbnail preference | Toast lifecycle | Async, non-trivial result; stable per-file ID and watchdog |
| Tab save failure | Error toast | Recoverable, document stays open |
| Layer/effect operation outcome | Toast when result is otherwise invisible | Existing action feedback; no high-frequency path |
| Locked/hidden navigation finding | Warning/info toast | User needs awareness while navigation continues |
| Text outlining | Warning/success/error toast | Async conversion with normalized product-safe failure copy |
| Shortcut import/remap/reset | Inline palette feedback | Keeps feedback next to the focused dialog workflow |
| Manual/autosave status | Status bar | Persistent state must not expire as a toast |
| Model download/progress | Inline panel progress | Determinate/long-running work needs progress and cancellation |
| Selection/tool/zoom/brush/nudge | No toast | Direct manipulation already provides immediate feedback |

Routine success remains intentionally limited. The system does not celebrate
every selection, tool change, or autosave.

## Canonical implementation

`packages/ui/src/components/ToastProvider.tsx` owns local visible and queued
state, stable IDs, key-based updates, opt-in aggregation, promise settlement,
dismiss-all, and stack expansion. `Toast.tsx` owns semantic rendering, shared
icons/Spinner, action behavior, timer accounting, visibility pausing, focus
handling, Escape dismissal, and the live-region contract. There are no
feature-specific positions or toast renderers.

The API is `toast`, `toast.success`, `toast.info`, `toast.warning`,
`toast.error`, `toast.loading`, `toast.update`, `toast.dismiss`,
`toast.dismissAll`, and `toast.promise`. Actions support Undo/Retry/Open/Details
patterns without confusing close with cancellation.

## Remaining justified exceptions

- `packages/editor/src/shortcuts/ShortcutPalette.tsx` contains an inline
  `role="status"` region because the message belongs to the open palette and
  must not move focus or cover the editor. It is named `feedback`, not `toast`.
- The editor context retains a bridge so state/command code can report an
  outcome without importing or mounting a UI store. The bridge is per mounted
  Shell lifecycle and has cleanup.
- Existing action call sites continue to use the compatible `{ message, type }`
  shape. They are migration-safe and can opt into stable IDs as operations gain
  task identity.

## Verification record

Focused UI tests cover roles, auto-dismiss, hover pause, queue bounds, loading
settlement, stable-key dedupe, aggregation, action dismissal, and dismiss-all.
The Storybook development fixture includes all semantic variants, lifecycle,
actions, long copy, and burst states for light/dark/reduced-motion review.

