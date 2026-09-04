# Notification system

Status: implemented 2026-09-02

Varve has one transient-notification system: the `ToastProvider` and `Toast`
primitives in `packages/ui`. The provider is mounted once inside each editor
`Shell` and Home shell, so a Tauri window owns its own notification state. The
editor context forwards operation feedback through a bridge; Home uses the
same provider directly and does not maintain a second toast store.

## Product rule

Notifications are for non-blocking operation outcomes and recoverable failures.
Routine editing state belongs in the control that owns it or in the status bar.

Use a toast for an asynchronous result, a non-trivial completion, a recoverable
failure, a non-blocking warning, or a meaningful Undo/Retry/Open action. Prefer
inline validation for field errors, a dialog for decisions, the status bar for
save/render state, and a task surface for work that needs determinate progress
or may run for minutes.

The editor deliberately does not toast selection, tool, zoom, autosave-success,
brush, nudge, or other high-frequency direct-manipulation changes. The
shortcut palette's short-lived message is dialog-local inline feedback, not a
second notification system.

## API

```ts
const { toast } = useToast();

toast('Copied to clipboard');
toast.success({ message: 'PDF exported', id: 'export:42' });
toast.warning('Some unsupported effects were flattened');
toast.error({ message: 'Export failed', action: { label: 'Retry', onClick } });

const id = toast.loading({
  message: 'Updating file thumbnail…',
  id: 'thumbnail:file-42',
  dedupeKey: 'thumbnail-preference:file-42',
});
toast.update(id, { message: 'File thumbnail updated', type: 'success' });
toast.dismiss(id);
toast.dismissAll();

await toast.promise(savePromise, {
  id: 'save:manual',
  loading: 'Saving…',
  success: 'Document saved',
  error: 'Could not save document',
});
```

The supported variants are `default`, `info`, `success`, `warning`, `error`,
and `loading`. `type` remains the concise application spelling for backwards
compatibility; `variant` is also accepted by the primitive.

In-flight work must use an operation-specific `id` or `dedupeKey`. Promise
settlement updates that same item, so a late operation cannot overwrite another
document's notification. Repeated events can opt into `aggregate: true` with a
shared key; the provider renders a count summary instead of a burst of cards.
Direct loading calls have a two-minute safety timeout. Work expected to exceed
that window belongs in a task/progress surface and should not rely on a toast.

Actions dismiss after a successful action by default. Set `dismiss: false` for
an action such as Details that should leave the notification available. Close
only dismisses the notification; it never cancels the underlying operation.

## Visual and interaction contract

- Notifications use a neutral elevated surface with a small semantic leading
  accent and icon. Success, warning, error, info, and loading are never
  represented by color alone.
- Loading uses the shared `Spinner`; no feature creates its own loader glyph.
- The geometry uses `--radius-floating`, shared with popover-like surfaces. It
  does not use Shine Border or decorative gradients.
- The default position is bottom-right, above the status bar and inset from the
  inspector width. Narrow windows clamp to the viewport with equal side insets.
- The portal shell has `pointer-events: none`; cards, actions, and the overflow
  control opt into pointer events.
- Three cards are visible by default. Additional cards remain queued and are
  represented by an accessible overflow control. Expansion shows up to ten
  cards in a bounded scroll region.
- Success/info/default notifications are polite live regions. Errors are
  assertive. Updates are atomic so a loading-to-result transition is announced
  as one lifecycle change rather than three stacked notifications.
- Timers pause on hover, keyboard focus, and hidden document visibility, and
  resume with the remaining time. Escape and the close button dismiss.
- Reduced-motion users receive no entry/exit translation or spring-like stack
  choreography.

## Ownership and platform behavior

`ToastProvider` is explicitly mounted by `Shell`; there is no auto-created DOM
root and no SSR-time `document` access. The provider's local React state keeps
browser, Tauri, and auxiliary window lifetimes isolated. `ToastBridge` clears
the editor callback when it unmounts, preventing a stale window from receiving
future messages.

Save/autosave state remains owned by `SaveStatusIndicator`. Thumbnail choice is
the current production example of an asynchronous toast lifecycle: it reports
loading, updates in place on success, and updates in place on failure, with a
stable file-scoped operation key.

Home file acquisition follows the same boundary. Asset-library batches and
bulk library imports keep determinate progress and per-file parser errors in
their queue/dialog, then emit one aggregate success, partial-failure, or
failure notification. The broad Home drop uses a single loading notification
that updates in place when local ingestion finishes. Selection validation stays
inline so one rejected file does not create a notification burst.

There is no Sonner dependency in the repository. `ToastProvider` is the
canonical notification implementation for both editor and Home surfaces.
