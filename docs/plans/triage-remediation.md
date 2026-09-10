# Triage Remediation Plan

Generated from code quality triage (2026-07-14). Composite grade: **D (68.5/100)**.

## Goal

Close all 6 triage findings — scene module cycles, EditorProvider god function, CanvasArea god function, Shell/Menubar action duplication, unstable modules, and missing layer rules.

---

## Phase 1 — Break scene module cycles (2-node cycles through `document.ts`)

**Problem:** Three 2-node cycles all mediated by `document.ts`:
- `document.ts` ↔ `clone.ts` (doc imports `deepCloneSubtree`; clone imports `Document` type)
- `document.ts` ↔ `component-sync.ts` (doc imports sync functions; component-sync imports `Document` type)
- `document.ts` ↔ `library.ts` (doc imports `InstalledLibraryRef` type; library imports `Document` type + `isContainer` value)

**Fix:** Extract a `DocumentBase` type interface that `clone.ts`, `component-sync.ts`, and `library.ts` import instead of `Document`. The `DocumentBase` type lives in `types.ts` (already the foundational type file with 0 cycle imports). `Document` extends `DocumentBase`. This breaks all three cycles by making the type dependency one-way.

**Files to modify:**
- `packages/scene/src/types.ts` — add `DocumentBase` interface (minimal subset: `rootChildren`, `pages`, `styles`, `variableStore`, `componentLibrary`)
- `packages/scene/src/document.ts` — `Document extends DocumentBase`
- `packages/scene/src/clone.ts` — import `DocumentBase` instead of `Document`
- `packages/scene/src/component-sync.ts` — import `DocumentBase` instead of `Document`
- `packages/scene/src/library.ts` — import `DocumentBase` instead of `Document`; `isContainer` stays as-is (value import, no cycle)

**Verification:** `pnpm typecheck`, `cargo test --workspace`, `pnpm test --filter @varve/scene`, dependency cycle check.

---

## Phase 2 — Break engine 2-file cycles

**Problem:** Two 2-file cycles in `packages/engine/src/`:
1. `raster-size.ts` ↔ `raster.ts` (raster-size imports `RasterFormat` type; raster imports `estimateFileSize` value)
2. `engine.ts` ↔ `wasmLoader.ts` (wasmLoader imports `Engine` type; engine calls wasmLoader at runtime)

**Fix 1 (raster):** Move the `RasterFormat` type from `raster.ts` to `raster-size.ts` (it belongs there — it's about raster format metadata). Break the cycle by making the dependency one-way: `raster.ts` → `raster-size.ts` only.

**Fix 2 (wasmLoader):** This is a soft cycle (runtime call, not static import). The fix is to move the `Engine` type to a shared `types.ts` in the engine package, so `wasmLoader.ts` imports from `types.ts` instead of `engine.ts`. Both `engine.ts` and `wasmLoader.ts` depend on `types.ts` — no cycle.

**Files to modify:**
- `packages/engine/src/raster-size.ts` — add `RasterFormat` type export
- `packages/engine/src/raster.ts` — remove `RasterFormat` type, import from `raster-size.ts`
- `packages/engine/src/types.ts` (new or existing) — add `Engine` interface if not already there; `engine.ts` exports implement it; `wasmLoader.ts` imports it from `types.ts`

**Verification:** `pnpm typecheck`, `pnpm test --filter @varve/engine`.

---

## Phase 3 — Shared action registry (eliminates Menubar/useShortcuts duplication)

**Problem:** `Menubar.handleAction` (~220-line switch, 45 cases) and `useShortcuts.getHandler` (~255-line switch, 68 cases) duplicate ~30 identical action mappings. Shell's context menu also duplicates some.

**Fix:** Complete the `ActionRegistry` pattern that already exists in the codebase (`packages/editor/src/actions/registerAll.ts`). Create a single `createEditorActions(editor: EditorContextValue)` function that returns `Map<string, () => void>` with all action handlers. Both `useShortcuts` and `Menubar.handleAction` delegate to this map. Shell's context menu also reads from it.

**Files to modify:**
- `packages/editor/src/actions/registerAll.ts` — expand to include ALL 68 action mappings (currently only has a subset)
- `packages/editor/src/shortcuts/useShortcuts.ts` — replace `getHandler` switch with `actionRegistry.get(id)?.()` 
- `packages/editor/src/Menubar.tsx` — replace `handleAction` switch with `actionRegistry.get(id)?.()`
- `packages/editor/src/Shell.tsx` — context menu items call `actionRegistry.get(item.action)?.()`

**Verification:** `pnpm typecheck`, `pnpm test --filter @varve/editor`, manual shortcut/menubar testing.

---

## Phase 4 — EditorProvider context extraction: MotionContext + PrototypeContext

**Problem:** `EditorProvider` has 1,021 cyclomatic complexity, 6,423 lines, 252 members in `EditorContextValue`. All 252 are implemented inline in a single 4,300-line `useMemo`. Existing sub-contexts (ViewportContext, SelectionContext) are real but only cover ~29 members.

**Fix — MotionContext (18 methods):** Extract all timeline/animation methods into a new `MotionContext` sub-context:
- `playTimeline`, `pauseTimeline`, `stopTimeline`, `seekTimeline`, `setActiveTimeline`, `setPlaybackSpeed`, `toggleLoop`, `addKeyframeToSelected`, `createTimeline`, `removeTimeline`, `renameTimeline`, `removeTrack`, `toggleTimelinePanel`, `addTimelineMarker`, `removeTimelineMarker`, `renameTimelineMarker`, `createMotionPresetFromTimeline`, `applyMotionPreset`, `toggleAutoKeyframe`
- These all depend on `state.motion`, `state.document`, and `updateDoc` — clean dependency set
- `useMotion()` hook for consumers

**Fix — PrototypeContext (10 methods):** Extract prototype methods into a new `PrototypeContext` sub-context:
- `setPrototypeMode`, `updatePrototypeData`, `handlePrototypeEvent`, `getPrototypeVariable`, `setPrototypeVariable`, `startPresentation`, `stopPresentation`, `getPrototypeScreens`, `prototypeCurrentScreen`, `navigatePrototypeTo`
- These depend on `state.prototypeMode`, `state.prototypeRuntime`, `updateDoc`, and `@varve/prototype` runtime
- `usePrototype()` hook for consumers

**Files to create:**
- `packages/editor/src/context/MotionContext.tsx` (~250 lines)
- `packages/editor/src/context/PrototypeContext.tsx` (~200 lines)

**Files to modify:**
- `packages/editor/src/context.tsx` — remove extracted methods from `value` useMemo, add MotionProvider + PrototypeProvider wrappers
- `packages/editor/src/context/types.ts` — add `MotionContextValue` and `PrototypeContextValue` interfaces
- `packages/editor/src/context/index.ts` — export new sub-contexts

**Verification:** `pnpm typecheck`, `pnpm test --filter @varve/editor`, `pnpm test --filter @varve/prototype`.

---

## Phase 5 — CanvasArea overlay consolidation

**Problem:** CanvasArea is 3,500 lines with 28 overlays rendered inline, `replaySubtreeToCtx` (583 lines), `buildToolCtx` (230 lines), and all pointer/keyboard handlers inline. Instability: I=0.95 (82 deps, 4 consumers).

**Fix — CanvasOverlays component:** Extract the 28 overlay renders into a `CanvasOverlays` component that receives the same context values as props. This is a pure JSX extraction — no logic changes. Removes ~400 lines from CanvasArea.

**Fix — buildToolCtx extraction:** Extract the 230-line `buildToolCtx()` function into `canvas/buildToolCtx.ts`. It constructs the `ToolContext` — a data object with no React hooks. Clean extraction.

**Fix — replaySubtreeToCtx extraction:** Extract into `render/replaySubtreeToCtx.ts`. It currently captures closure variables from `drawContent` — convert these to an explicit `ReplayContext` parameter. This is the highest-complexity extraction (~583 lines, cyclo 169).

**Files to create:**
- `packages/editor/src/components/CanvasOverlays.tsx` (~400 lines)
- `packages/editor/src/canvas/buildToolCtx.ts` (~230 lines)
- `packages/editor/src/render/replaySubtreeToCtx.ts` (~580 lines)

**Files to modify:**
- `packages/editor/src/CanvasArea.tsx` — import and use extracted modules, remove inlined code

**Verification:** `pnpm typecheck`, `pnpm test --filter @varve/editor`, Playwright E2E (`tests/e2e/canvas/tools.spec.ts`).

---

## Phase 6 — Shell sub-component extraction

**Problem:** ShellInner is 965 lines with 22 hooks and 38 sub-components. Manages DnD, recovery, onboarding, export, context menu, and file import inline.

**Fix — DnDShell wrapper:** Extract `DndContext` + drag handlers + `DragOverlay` into `<DndShell>` wrapper. Removes ~150 lines.

**Fix — RecoveryManager:** Extract recovery session check, restore/discard handlers, `<RecoveryDialog>` into self-contained component. Removes ~80 lines.

**Fix — OnboardingLayer:** Extract welcome dialog, spotlight, checklist, "Did You Know?", tutorial banner into one orchestrating component. Removes ~120 lines.

**Fix — ExportLayer:** Extract export engine ref, save adapters, `<ExportDialog>`, `<BatchBgRemoveDialog>`. Removes ~80 lines.

**Fix — CanvasContextMenu:** The 110-line IIFE for right-click menu becomes its own component. Removes ~110 lines.

**Files to create:**
- `packages/editor/src/components/Shell/DnDShell.tsx` (~160 lines)
- `packages/editor/src/components/Shell/RecoveryManager.tsx` (~90 lines)
- `packages/editor/src/components/Shell/OnboardingLayer.tsx` (~130 lines)
- `packages/editor/src/components/Shell/ExportLayer.tsx` (~90 lines)
- `packages/editor/src/components/Shell/CanvasContextMenu.tsx` (~120 lines)

**Files to modify:**
- `packages/editor/src/Shell.tsx` — replace inline code with extracted components

**Verification:** `pnpm typecheck`, `pnpm test --filter @varve/editor`, Playwright E2E.

---

## Phase 7 — Define architecture layer rules

**Problem:** No `architecture.layers` defined in `.jcodemunch.jsonc` — layer violations can't be caught at PR time.

**Fix:** Define layers for the Strata monorepo:

```json
{
  "architecture": {
    "layers": [
      {
        "name": "shared",
        "paths": ["packages/shared/src/"],
        "may_not_import": ["packages/editor/", "packages/home/", "apps/"]
      },
      {
        "name": "engine",
        "paths": ["packages/engine/src/"],
        "may_not_import": ["packages/editor/", "packages/home/", "apps/"]
      },
      {
        "name": "scene",
        "paths": ["packages/scene/src/"],
        "may_not_import": ["packages/editor/", "packages/home/", "apps/"]
      },
      {
        "name": "ui",
        "paths": ["packages/ui/src/"],
        "may_not_import": ["packages/editor/", "packages/home/", "apps/"]
      },
      {
        "name": "editor",
        "paths": ["packages/editor/src/"],
        "may_not_import": ["apps/"]
      },
      {
        "name": "app",
        "paths": ["apps/"],
        "may_not_import": []
      }
    ]
  }
}
```

**Files to modify:**
- `.jcodemunch.jsonc` — add layer rules

**Verification:** `jcodemunch_get_layer_violations` reports violations.

---

## Execution order

Phases are independent and can be parallelized, except:
- Phase 3 (action registry) should come before Phase 6 (Shell extraction) — Shell uses the action registry
- Phase 4 (context extraction) should come before Phase 5 (CanvasArea) — CanvasArea reads from context

**Recommended sequence:**
1. Phase 1 + Phase 2 (cycle breaks) — parallel, zero risk
2. Phase 3 (action registry) — foundation for Phases 5 and 6
3. Phase 4 (context extraction) — high value, moderate risk
4. Phase 5 (CanvasArea) — high value, depends on context
5. Phase 6 (Shell) — moderate value, depends on Phase 3
6. Phase 7 (layer rules) — zero risk, do anytime

---

## Verification gate

After each phase, run:
```bash
pnpm typecheck          # all 17 packages clean
pnpm lint               # 0 errors on modified files
pnpm test               # full suite passes
pnpm audit:emoji        # clean
pnpm audit:tokens       # 96/96 WCAG-AA
cargo test --workspace  # Rust tests pass
```

After all phases, re-run triage tools to measure improvement.
