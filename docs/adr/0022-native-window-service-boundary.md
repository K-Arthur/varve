# ADR-0022: Native window service boundary

- **Status:** Accepted
- **Date:** 2026-08-05

## Context

`@varve/platform` exposes files/home/native-dialog APIs but no window or
monitor API (audit §6). Panel components must never call Tauri directly
today — `apps/desktop/src/chrome/` is the only exception, and it only
controls the current window's chrome.

## Alternatives

1. Add window methods directly to the `Platform` interface — rejected: the
   interface is already broad (60+ methods); windowing is a distinct
   capability with its own failure modes and testing needs.
2. A dedicated `windowService` capability object on the platform (chosen).

## Decision

Extend `@varve/platform` with a `NativeWindowService` (new module
`packages/platform/src/windows/`), returned by `getWindowService(platform)`:

```ts
interface NativeWindowService {
  readonly capability: 'native' | 'browser-popup' | 'single-window';
  createWindow(options: CreateWorkspaceWindowOptions): Promise<CreatedWindow>;
  closeWindow(windowId: WorkspaceWindowId): Promise<void>;
  focusWindow(windowId: WorkspaceWindowId): Promise<void>;
  showWindow / hideWindow(windowId): Promise<void>;
  getCurrentWindow(): Promise<WorkspaceWindowInfo>;
  listWindows(): Promise<WorkspaceWindowInfo[]>;
  listMonitors(): Promise<DisplayInfo[]>;
  getWindowPlacement / setWindowPlacement(windowId, placement): Promise<void>;
  listenToWindowEvents(handler): Promise<() => void>;
}
```

- Implementations: `memory` (test), `browser` (capability
  `'single-window'`; popup only behind opt-in with warnings), `tauri`
  (wraps `@tauri-apps/api/window` via dynamic import, mirroring
  `useWindowChrome.ts`'s pattern).
- `DisplayInfo`/`DisplayFingerprint` and `WindowPlacement` types live in
  `packages/platform/src/windows/types.ts` (ADR-0033).
- Logical `WorkspaceWindowId` ↔ Tauri label mapping lives in the service
  (label derivation per ADR-0020).
- The service is **per-window**: in an auxiliary window it returns the
  auxiliary window's own identity via `getCurrentWindow()`.

## Consequences

- React never imports Tauri APIs; the service is injectable and mockable
  (memory implementation + contract tests, M4).
- The Tauri implementation requires new capability permissions
  (`core:window:allow-*` for create/focus/geometry/monitors) scoped to the
  primary window only; auxiliary windows get a narrow set (ADR-0040).

## Migration impact

None to existing platform consumers; the service is additive.

## Cross-platform implications

The service is the single place that translates Wayland placement
restrictions, Windows work areas, and macOS Spaces behavior into the shared
model (ADR-0033, ADR-0036).

## Security implications

The service validates window ids, sanitizes labels, refuses arbitrary URLs
(only application routes), and bounds window counts (ADR-0040).

## Accessibility implications

`focusWindow` is the sanctioned way to move focus across windows; the
service reports window state (minimized/fullscreen) so recovery UI can act.

## Performance implications

The browser implementation does not fabricate windows; `capability` tells
the UI to hide native-only affordances (ADR-0034).

## Rejected shortcuts

Panel components importing `@tauri-apps/api/window` directly; extending the
main `Platform` interface; a `createWindow` that accepts arbitrary URLs.
