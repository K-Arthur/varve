# ADR-0012 — Runtime Capability Abstraction

**Status:** Accepted
**Date:** 2026-07-27
**Decisions:** One canonical runtime detection module in `@varve/platform`

## Context

Nine independent `isTauriRuntime()` / `isTauri()` / `detectTauri()` implementations
were scattered across `packages/editor`, `packages/engine`, `apps/desktop`, and
`packages/print`. Every module reimplemented the same `'__TAURI__' in window` check,
diverging in edge cases (worker detection, `indexedDB` presence, `__TAURI_INTERNALS__`
availability). Feature code couldn't be tested deterministically — mocking required
`Object.defineProperty(window, '__TAURI__', ...)`.

## Decision

Create `@varve/platform/src/runtime.ts` as the single source of truth:

- `RuntimeKind` (`'memory' | 'web' | 'tauri'`) — coarse backend identity
- `PlatformCapability` — granular flags (`fs.read`, `webgpu`, `wasm`, `webWorker`, …)
- `PlatformInfo` — structured snapshot bundling kind + OS + capabilities
- `getPlatformInfo()` — memoised full detection (safe in SSR, workers, tests)
- `setPlatformInfoForTest()` — deterministic injection for tests
- `detectRuntimeKind()` — low-level check for the Tauri global

Every other module imports from `@varve/platform` instead of reimplementing the
check.

## Consequences

- **One detection path** — bug fixes and new capabilities land in one place
- **Testable** — `setPlatformInfoForTest()` replaces fragile `window` mocking
- **No circular dependency** — `@varve/platform` is the lowest layer both scene
  and editor depend on
- **SSR-safe** — returns `'memory'` when `window` is undefined
- **Worker-safe** — detects Web Worker environment correctly

## Migration

All 9+ sites migrated:
- `packages/editor/src/menu/capabilities.ts` — delegates to `getPlatformInfo()`
- `packages/editor/src/shortcuts/reservedShortcuts.ts` — re-exports from platform
- `packages/editor/src/menu/nativeAdapter.ts` — uses `isTauriRuntime()` for gating
- `packages/editor/src/backupService.ts` — uses `isTauriRuntime()` for platform select
- `packages/editor/src/navigation/deepLinkHandler.ts` — uses `isTauriRuntime()`
- `packages/engine/src/backgroundRemoval/providers/tauriProvider.ts` — imports from platform
- `packages/engine/src/denoiseProviders/nativeProvider.ts` — imports from platform
- `packages/engine/src/upscaleProviders/nativeProvider.ts` — imports from platform
- `packages/engine/src/upscaleProviders/nativeTraceProvider.ts` — imports from platform
- `packages/engine/src/font/fontLoader.ts` — imports from platform
- `packages/engine/src/backgroundRemoval/environmentCapabilities.ts` — imports from platform
- `packages/engine/src/inference/core/RuntimeCapabilities.ts` — imports from platform
- `packages/engine/src/upscaleCapabilities.ts` — imports from platform
- `apps/desktop/src/startup/revealMainWindow.ts` — re-exports from platform
- `packages/print/src/index.ts` — imports from platform
