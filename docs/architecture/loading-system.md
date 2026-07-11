# Loading System Decision Framework

This document establishes the official patterns for loading and perceived performance in Strata.

## The Principle
> **Loading UI should communicate unavoidable latency, not advertise architectural inefficiency.**

## Decision Matrix

| Category | Duration | Pattern | Strata Implementation |
| --- | --- | --- | --- |
| **A. Near-Instant** | < 1s | No loader | Immediate transition / Optimistic UI |
| **B. Brief Activity** | 1s – 3s | Indeterminate | `InlineActivityIndicator` / `RegionLoader` (debounced 300ms) |
| **C. Structured Data** | 1s – 5s | Skeleton | `ContentSkeleton` (matches final layout) |
| **D. Long Task** | 3s – 10s | Determinate | `DeterminateProgress` (with actual data) |
| **E. Background Task** | > 10s | Non-blocking | Status bar / Toast / Activity center |
| **F. Initialization** | Startup | Branded Loader | `StartupLoader` (white logo + chromatic aberration) |
| **G. Failure** | Error | Failure State | Explicit error message + Retry action |

## Boot Sequence

The startup follows a two-phase state machine:

```
init → home_ready → editor_ready
```

### States

| State | Meaning | Loader visible? |
|---|---|---|
| `init` | App mounted, home data loading | Yes |
| `home_ready` | Home screen is interactive | No |
| `editor_ready` | Editor session is active | No |
| `error` | Fatal startup error | Yes (with error message + retry) |

### Transitions

1. **App mount** (`init`): The `useStartup` hook creates the `BootManager`. `StartupLoader` is displayed.
2. **HomeShell fires `onReady`** (`init → home_ready`): Called once `useHomeView` completes its first data fetch. The loader begins its exit animation (250ms fade-out).
3. **File open** (`home_ready → editor_ready`): Called when `App.handleOpenFile` resolves. Marks total startup via `performance.measure('strata-startup')`.
4. **Error** (`any → error`): If a fatal boot error occurs, the loader shows an error message and retry button.

### Warm restart

When `sessionStorage` already contains `strata-session-started` (e.g. browser dev reload, hot restart), the branded loader is skipped entirely and the boot transitions directly to `home_ready`.

## Feature Flag

The branded startup loader can be disabled via `EditorSettings.startup.showBrandedLoader`:

```
localStorage.setItem('strata-editor-settings', JSON.stringify({
  startup: { showBrandedLoader: false }
}))
```

When disabled, the app transitions directly to `home_ready` with no loader.

## Component Guidelines

### 1. StartupLoader
- **Use:** Initial app boot ONLY.
- **Trigger:** Hooked to `useHomeView` readiness via `HomeShell.onReady`.
- **Motion:** White logo, subtle chromatic aberration sweep (CSS keyframes).
- **A11y:** Static mark if `prefers-reduced-motion`. `role="status"`, `aria-live="polite"`.
- **Props:** `error`, `onRetry`, `ready`, `simplified`, `onExited`, `exitDuration`.
- **Graceful degradation:** `simplified` prop hides chromatic-aberration layers. Set automatically when `checkStartupCapabilities().shouldSimplify` is true (reduced-motion OR GPU score < 0.4).

### 2. InlineActivityIndicator
- **Use:** Buttons, row-level refreshes, small panel updates.
- **Visual:** 16px/20px spinner.
- **Constraint:** Replace text only if button is icon-only; otherwise append to text.

### 3. RegionLoader
- **Use:** Panel-level loading (e.g. Layers, Assets, model status).
- **Behavior:** Debounce appearance by 300ms to avoid flicker.
- **A11y:** `aria-busy="true"`.

### 4. DeterminateProgress
- **Use:** Export, Import, Model Download.
- **Requirement:** Must show real percentage/count; include "Cancel" if applicable.
- **Avoid:** Fake progress bars.

### 5. ContentSkeleton
- **Use:** Placeholder shimmer for structured content (file grids, asset lists, sidebars).
- **Variants:** `list` (rows), `grid` (matrix of cells), `card` (icon+title+desc), `inline` (text-sized).
- **A11y:** `role="status"` with `aria-label`.
- **Reduced motion:** Shimmer animation disabled, static 50% opacity.

## Capability Detection

`checkStartupCapabilities()` detects at boot time:

- **`canAnimate`** — Respects `prefers-reduced-motion: reduce`
- **`gpuScore`** — 0.0–1.0 based on WebGL context availability
- **`canvasAvailable`** — Whether `HTMLCanvasElement` is defined (always true in modern browsers)
- **`shouldSimplify`** — True when reduced-motion OR gpuScore < 0.4

These are read once at mount and used to adjust the loader visual complexity.

## Anti-Patterns
- **Spinner Overload:** Do not show multiple spinners in the same view.
- **Fake Delays:** Never add artificial timers to "show off" animations.
- **Blocking Overlays:** Do not block the whole app for a panel-local operation.
- **Infinite Spinners:** Always have a timeout or explicit failure state.
- **Ad-hoc loading text:** Use `InlineActivityIndicator`, `ContentSkeleton`, or `RegionLoader` instead of bare "Loading..." text.

## Design Tokens

### Motion
- `--loader-spin-duration`: 0.8s (linear)
- `--loader-fade-in`: 0.2s (ease-out)
- `--loader-debounce`: 300ms
- `--skeleton-shimmer-duration`: 1.5s (ease-in-out)

### Colors
- `--loader-primary`: `var(--color-interactive-default)`
- `--loader-muted`: `var(--color-text-muted)`
- `--startup-bg`: `var(--color-surface-app)` (Dark)
- `--startup-logo`: `#FFFFFF`
- `--skeleton-bg-color`: `var(--color-surface-raised)`
- `--skeleton-shimmer-color`: `var(--color-surface-overlay)`

## Performance Budget

| Metric | Target | Degradation |
|---|---|---|
| Max loader overhead | 50ms beyond init | Disable branded loader |
| Animation frame rate | 60 fps | Static logo if < 30 fps |
| Total cold start | < 1200ms | Flag regression in CI |
