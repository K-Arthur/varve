# Loading system audit

Date: 2026-08-31

## Scope

This audit covers the loading and activity indicators used by the UI packages,
desktop shell, Home surfaces, editor dialogs/panels, model workflows, and the
marketing documentation that describes those workflows. The repository search
found four overlapping primitives (`InlineActivityIndicator`,
`RegionLoader`, `DeterminateProgress`, and `ContentSkeleton`), button-specific
loading CSS, the branded `StartupLoader`, and local spinner CSS in the asset
and icon browsers.

The implementation target is a small, CSS/SVG-based `Spinner` primitive plus
compositions for visible status text. Existing progress, skeleton, and startup
components remain separate because they communicate different information.

## Classification

| Surface / operation | Actual state | Correct presentation | Decision |
| --- | --- | --- | --- |
| Save/apply/refresh buttons | Active work, no useful percentage | Small spinner inside the existing button | Use `Button loading` / `IconButton loading` |
| Activity feed, permissions, version history | Component data is being fetched | Inline spinner with specific status text | Use `LoadingLabel` |
| Home project list and asset grid | Structured content shape is known | Skeleton that preserves layout | Keep `ContentSkeleton` |
| Thumbnail/icon previews | Individual content is not ready | Local skeleton/placeholder | Keep thumbnail/icon skeletons; do not add dozens of spinners |
| Model download, import, export, archive phases | Measurable bytes/items/phases | Determinate progress and cancel | Keep `DeterminateProgress` or domain progress UI |
| Model/runtime initialization and AI inference | Work is active but percentage is not exposed | Spinner plus real phase text | Use the shared spinner in the existing status row |
| Blocking preview/region refresh | Interaction is unsafe while data is replaced | Debounced region overlay with status | Use `RegionLoader`; avoid backdrop blur |
| Application startup | High-level initialization | Branded startup surface with failure/retry | Keep `StartupLoader` separate from `Spinner` |
| Failure, empty, cancelled, complete | Work is no longer active | Error/empty/success status | Remove the spinner immediately |

## Shared contract

`Spinner` is the base indeterminate indicator:

- sizes are `xs`, `sm`, `md`, and `lg`; ordinary controls use `sm`;
- the SVG inherits `currentColor` and uses one partial circular arc;
- CSS transforms provide the animation; the base primitive does not import
  Motion or run JavaScript timers;
- an optional accessible label is supported for a standalone spinner; when
  visible status text is present, the spinner is decorative;
- `prefers-reduced-motion: reduce` freezes the arc at a clear static state;
- shared keyframes are defined once, so each instance adds only one SVG and no
  injected `<style>` element.

`LoadingLabel` owns the repeated spinner-plus-copy composition. Its live region
announces the task text once rather than exposing animation frames to assistive
technology. `InlineActivityIndicator` remains as a compatibility wrapper for
callers outside the main package while new code uses the shared names.

## State and interaction findings

- `Button` already guards its callback while loading and preserves its label in
  the DOM, which keeps width stable. Busy semantics are immediate, while the
  shared visual spinner waits 150ms so fast actions do not flicker. The spinner
  remains decorative inside that button and loading remains keyboard-coherent.
- `IconButton` had no loading contract. It now needs the same callback guard,
  `aria-busy`, and stable icon-sized spinner for refresh/acquire actions.
- `RegionLoader` already debounces short requests. Its content should not be
  blurred: the overlay communicates why the region is unavailable and avoids
  unnecessary paint/compositor work on WebKitGTK and low-spec hardware.
- Home and asset list loading already have the correct skeleton semantics.
  Download percentages must not be replaced with invented spinner progress.
- Startup has an explicit error/retry path and remains a branded special case;
  it is not a generic loader variant.

## Deliberately deferred

Document save status, archive phase UI, and model-download progress each have
domain-specific state machines and meaningful existing copy. They should adopt
the primitive where an indeterminate sub-state exists, but this pass does not
invent a global task manager or move their persistence/cancellation ownership.

## Verification requirements

The focused verification set covers the shared primitive, button and icon-button
duplicate-click guards, reduced-motion CSS contract, `RegionLoader` delay and
overlay semantics, icon/asset browser migration, Storybook states, and browser
screenshots in light/dark/reduced-motion conditions. The affected planner and
the website build remain the final integration gates for this change.
