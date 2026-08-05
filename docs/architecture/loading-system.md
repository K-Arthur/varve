# Loading System Decision Framework

This document establishes the official patterns for loading and perceived performance in Varve.

## The Principle
> **Loading UI should communicate unavoidable latency, not advertise architectural inefficiency.**

## Decision Matrix

| Category | Duration | Pattern | Varve Implementation |
| --- | --- | --- | --- |
| **A. Near-Instant** | < 1s | No loader | Immediate transition / Optimistic UI |
| **B. Brief Activity** | 1s – 3s | Indeterminate | `InlineActivityIndicator` / `RegionLoader` (debounced 300ms) |
| **C. Structured Data** | 1s – 5s | Skeleton | `ContentSkeleton` (matches final layout) |
| **D. Long Task** | 3s – 10s | Determinate | `DeterminateProgress` (with actual data) |
| **E. Background Task** | > 10s | Non-blocking | Status bar / Toast / Activity center |
| **F. Initialization** | Startup | Branded Loader | `StartupLoader` (white logo + chromatic aberration) |
| **G. Failure** | Error | Failure State | Explicit error message + Retry action |

## Deployment Targets

Startup is **asymmetric by design** — each target covers the latency it actually controls.

### Tauri desktop (primary dev: CachyOS / WebKitGTK)

| Stage | What the user sees | When it ends |
| --- | --- | --- |
| **Native splash** | `splashscreen.html` — standalone HTML, white symbolic logo + chromatic aberration (CSS only, no JS) | `close_splashscreen` IPC when home data is ready |
| **Main window (hidden)** | React mounts; `StartupLoader` runs inside hidden main webview | `revealMainWindow()` shows main + closes splash |
| **In-app loader exit** | `StartupLoader` fade-out (`ready` from `HomeShell.onReady`) | 250ms CSS transition |

Config: `apps/desktop/src-tauri/tauri.conf.json` — `main.visible: false`, `splashscreen` window → `splashscreen.html`.

Research: [Tauri 2 splashscreen guide](https://v2.tauri.app/learn/splashscreen/) (accessed 2026-07-13).

**Stuck-splash failure mode:** If the frontend never calls `close_splashscreen`, the splash remains visible. Mitigations: `useStartup` 30s timeout → error UI with retry; `revealMainWindow` is invoked from `handleHomeReady`.

### Browser (Vite dev / static build)

| Stage | What the user sees | When it ends |
| --- | --- | --- |
| **Pre-JS fallback** | Inline `#varve-boot-fallback` in `index.html` (static SVG + CSS, no network) | `dismissBootFallback()` in `main.tsx` before React mount |
| **In-app loader** | `StartupLoader` via `useStartup` | `HomeShell.onReady` |

Cold-cache latency (bundle download) is dominated by network; the pre-JS fallback covers the gap before JS executes. Warm reload skips the branded loader via `sessionStorage` `varve-session-started`.

### Reduced motion per engine

| Engine | `prefers-reduced-motion` | Notes |
| --- | --- | --- |
| Chromium / Firefox / Safari | Supported | CSS `@media` in `StartupLoader.css` + `splashscreen.html` |
| WebKitGTK 2.41.4+ | Supported | Forwards GTK setting into web content ([release notes](https://webkitgtk.org/releases/webkitgtk-2.41.4.tar.xz.news), 2026-07-13) |
| WebView2 / WKWebView | Supported | Standard media query |

`checkStartupCapabilities()` also sets `shouldSimplify` when reduced-motion is active or WebGL probe score &lt; 0.4.

### Chromatic aberration implementation

**Single white SVG + layered `drop-shadow`** (not WebGPU, not RGB underlay ghosts). Thin cyan/rose channel split + soft white bloom. Mark size **160px** (boot fallback 136px). Quiet ambient luminosity pulse only.

**Theme policy (locked):** Startup is **brand-fixed dark** (`#10151f` + white mark) on every surface — native splash, pre-JS boot fallback, and `StartupLoader`. It intentionally does **not** follow light / dark / high-contrast `[data-theme]`. Same Cursor-style identity moment on every cold start. `color-scheme: dark` is set on those surfaces so OS/browser chrome cannot lighten them.

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

1. **App mount** (`init`): `useStartup` creates `BootManager`, records `performance.mark('app_mount')`. `StartupLoader` displays (unless warm restart or feature flag off).
2. **Tauri:** Native `splashscreen.html` visible until home ready; then `close_splashscreen` + main show.
3. **Browser:** `#varve-boot-fallback` removed in `main.tsx`; `StartupLoader` takes over.
4. **HomeShell fires `onReady`** (`init → home_ready`): Called once `useHomeView` completes its first data fetch. Loader begins exit animation (250ms fade-out).
5. **File open** (`home_ready → editor_ready`): Called when `App.handleOpenFile` resolves. Marks total startup via `performance.measure('varve-startup')`.
6. **Error** (`any → error`): Fatal boot error or 30s timeout. Loader shows error message + retry (`BootManager.reset()` + `retryCount` remounts `HomeShell`).

### Warm restart

When `sessionStorage` already contains `varve-session-started` (e.g. browser dev reload, hot restart), the branded loader is skipped entirely and the boot transitions directly to `home_ready`.

## Feature Flag

The branded startup loader can be disabled via `EditorSettings.startup.showBrandedLoader`:

```
localStorage.setItem('varve-editor-settings', JSON.stringify({
  startup: { showBrandedLoader: false }
}))
```

When disabled, the app transitions directly to `home_ready` with no loader.

## Component Guidelines

### 1. StartupLoader
- **Use:** Initial app boot ONLY.
- **Trigger:** Hooked to `useHomeView` readiness via `HomeShell.onReady`.
- **Motion:** White logo + static cyan/amber/rose spectral fringe; soft 4s luminosity breathe (`opacity`/`scale` + radial glow) — compositor-friendly. No filter-keyframe loops.
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
- `--startup-bg`: **removed / unused** — splash is brand-fixed `#10151f`, not theme tokens
- `--startup-logo`: white `#FFFFFF` (fixed; not theme-relative)
- `--skeleton-bg-color`: `var(--color-surface-raised)`
- `--skeleton-shimmer-color`: `var(--color-surface-overlay)`

## Performance Budget

| Metric | Target | Degradation |
|---|---|---|
| Max loader overhead | 50ms beyond init | Disable branded loader |
| Animation frame rate | 60 fps | Static logo if < 30 fps |
| Total cold start | < 1200ms | Flag regression in CI |
