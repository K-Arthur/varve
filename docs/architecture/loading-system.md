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

## Component Guidelines

### 1. StartupLoader
- **Use:** Initial app boot ONLY.
- **Trigger:** Hooked to `useHomeView` readiness.
- **Motion:** White logo, subtle chromatic aberration sweep.
- **A11y:** Static mark if `prefers-reduced-motion`.

### 2. InlineActivityIndicator
- **Use:** Buttons, row-level refreshes, small panel updates.
- **Visual:** 16px/20px spinner.
- **Constraint:** Replace text only if button is icon-only; otherwise append to text.

### 3. RegionLoader
- **Use:** Panel-level loading (e.g. Layers, Assets).
- **Behavior:** Debounce appearance by 300ms to avoid flicker.
- **A11y:** `aria-busy="true"`.

### 4. DeterminateProgress
- **Use:** Export, Import, Model Download.
- **Requirement:** Must show real percentage/count; include "Cancel" if applicable.
- **Avoid:** Fake progress bars.

## Anti-Patterns
- **Spinner Overload:** Do not show multiple spinners in the same view.
- **Fake Delays:** Never add artificial timers to "show off" animations.
- **Blocking Overlays:** Do not block the whole app for a panel-local operation.
- **Infinite Spinners:** Always have a timeout or explicit failure state.

## Design Tokens

### Motion
- `--loader-spin-duration`: 0.8s (linear)
- `--loader-fade-in`: 0.2s (ease-out)
- `--loader-debounce`: 300ms

### Colors
- `--loader-primary`: `var(--color-interactive-default)`
- `--loader-muted`: `var(--color-text-muted)`
- `--startup-bg`: `var(--color-surface-app)` (Dark)
- `--startup-logo`: `#FFFFFF`
