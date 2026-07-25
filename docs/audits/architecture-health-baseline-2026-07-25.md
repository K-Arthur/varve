# Architecture Health Baseline — 2026-07-25

## Scope

Repository-wide code-health triage for all 16 TypeScript workspace packages
and 12 Rust crates. Produced by `scripts/audit-architecture.mjs`.

## Source Inventory

| Package | Files | Lines | Size | Max Complexity | Avg Complexity |
|---------|-------|-------|------|---------------|---------------|
| shared | 59 | 14,461 | 448KB | 74 | 24.5 |
| engine | 433 | 95,752 | 2.9MB | 650 | 27.1 |
| scene | 160 | 48,710 | 1.5MB | 404 | 44.7 |
| ui | 97 | 11,828 | 349KB | 80 | 11.0 |
| compositor | 14 | 2,009 | 67KB | 83 | 14.3 |
| import | 30 | 6,251 | 182KB | 239 | 40.5 |
| prototype | 31 | 5,712 | 169KB | 63 | 23.0 |
| codegen | 57 | 13,813 | 443KB | 302 | 52.1 |
| layout | 1 | 8 | 191B | 1 | 1.0 |
| platform | 18 | 6,497 | 222KB | 118 | 37.8 |
| help | 14 | 1,300 | 58KB | 36 | 4.2 |
| ai | 5 | 418 | 14KB | 20 | 9.3 |
| collab | 1 | 87 | 3KB | 2 | 2.0 |
| print | 7 | 305 | 10KB | 6 | 3.0 |
| home | 56 | 9,640 | 306KB | 102 | 20.2 |
| editor | 831 | 176,234 | 5.6MB | 810 | 26.9 |
| **Total** | **1,814** | **433,025** | **13.9MB** | | |

## 1. Dependency Cycles — 19 Confirmed

### Engine (3 cycles)

```
engine.ts ↔ wasmLoader.ts
  → engine.ts imports wasmLoader.ts for createEngine('wasm')
  → wasmLoader.ts imports engine.ts (likely for types or config)

filterCompositor.ts → lut/bake.ts → lut/index.ts
  → filterCompositor imports from lut barrel
  → lut/bake.ts re-exported through lut/index.ts

raster-size.ts ↔ raster.ts
  → raster-size.ts imports types from raster.ts
  → raster.ts imports sizing function from raster-size.ts
```

### Scene (10 cycles — the "16-file mega-cycle")

```
Core type cycles:
  types.ts → component-sync.ts (A → B)
  types.ts → typography.ts (A → B)

Document-bridged cycles:
  adjustmentScope.ts → document.ts → bindings.ts → types.ts
  bindings.ts → component-sync.ts → document.ts → types.ts
  bindings.ts → document.ts → types.ts → typography.ts

Document-leaf cycles:
  brush.ts → document.ts
  clone.ts → document.ts
  document.ts → intelligence/linterTypes.ts
  document.ts → library.ts
  assets.ts → document.ts → version.ts
```

The scene mega-cycle is driven by two root causes:

- **`types.ts` imports from `component-sync.ts` and `typography.ts`**, which in
  turn import from `types.ts` (direct cycles). `types.ts` is the foundational
  type module that should never import from domain modules.
- **`document.ts` imports 50+ modules**, many of which import `types.ts`
  (indirect cycle through the barrel). `document.ts` acts as both the hub
  and a domain module, creating bidirectional edges with brush, clone,
  library, linterTypes, bindings, assets, version.

### UI (1 cycle)

```
components/Button.tsx ↔ components/IconButton.tsx
  → Button imports IconButton for internal use
  → IconButton imports Button for its base styling
```

### Editor (5 cycles)

```
sectionRegistry.ts → workspace/workspaceTypes.ts → context/types.ts
sectionRegistry.ts → sectionState.ts → context/types.ts → workspace/workspaceTypes.ts
context/types.ts → tools/types.ts
context/types.ts → workspace/workspaceTypes.ts
context.tsx → context/index.ts  (barrel self-import)
```

The section registry/workspace types/context types cycle is the tightest.
`context/index.ts` importing `context.tsx` is a barrel self-reference bug.

### False positive analysis

- All 19 cycles are **genuine source cycles** — not generated code, not
  lockfile artifacts.
- Barrel-export "cycles" like `index.ts → moduleA → index.ts` are excluded;
  madge's resolution correctly traverses re-exports and only reports when
  actual source files form a directed cycle.
- Type-only imports are not distinguished — madge resolves all import
  statements equally. Some engine/scene cycles may be type-only on one
  side.

## 2. Module Instability — 34 Modules with I > 0.9

Most unstable modules are barrel `index.ts` files (I=1.0), which is expected.
A few non-barrel modules are notably unstable:

| Package | Module | I | Ce | Ca |
|---------|--------|---|----|----|
| engine | backgroundRemoval/index.ts | 0.968 | 30 | 1 |
| engine | backgroundRemoval/providers/directOnnxProvider.ts | 0.917 | 11 | 1 |
| engine | backup/index.ts | 0.917 | 11 | 1 |
| engine | colorization/pipelineDispatch.ts | 0.917 | 11 | 1 |
| scene | intelligence/index.ts | 0.929 | 13 | 1 |
| ui | components/ColorPicker/ColorPicker.tsx | 0.929 | 13 | 1 |
| ui | components/ColorPicker/index.ts | 0.929 | 13 | 1 |
| ui | components/index.ts | 0.967 | 29 | 1 |
| import | service.ts | 0.909 | 10 | 1 |
| home | HomeShell.tsx | 0.962 | 25 | 1 |
| editor | CanvasArea.tsx | 0.967 | 58 | 2 |
| editor | Shell.tsx | 0.975 | 39 | 1 |
| editor | components/CanvasOverlays.tsx | 0.966 | 28 | 1 |
| editor | components/Inspector/PropertiesPanel.tsx | 0.966 | 28 | 1 |

Hub files (CanvasArea, Shell, PropertiesPanel, HomeShell) are expected to be
unstable — they are integration points. The bgRemoval index, ColorPicker,
and import service.ts are concerning because they accumulate dependencies
without proportional afferent coupling.

## 3. Cyclomatic Complexity — Hotspots

| File | Complexity | Ceiling | OK? |
|------|-----------|---------|-----|
| editor/context.tsx | 810 | 200 | **REFACTOR** |
| engine/replay.ts | 650 | 50 | **REFACTOR** |
| editor/CanvasArea.tsx | 602 | 200 | **REFACTOR** |
| scene/document.ts | 404 | 50 | **REFACTOR** |
| scene/masks.ts | 358 | 50 | **REFACTOR** |
| codegen/ir-converter.ts | 302 | 50 | **REFACTOR** |
| scene/boolean.ts | 212 | 50 | **REFACTOR** |
| scene/version.ts | 212 | 50 | **REFACTOR** |
| editor/EffectsSection.tsx | 264 | 200 | **REFACTOR** |
| editor/LayersTree.tsx | 220 | 200 | **REFACTOR** |
| import/svg.ts | 239 | 50 | **REFACTOR** |
| codegen/svg.ts | 248 | 50 | **REFACTOR** |
| codegen/html.ts | 177 | 50 | **REFACTOR** |
| codegen/index.ts | 159 | 50 | **REFACTOR** |
| editor/IntelligencePanel.tsx | 189 | 200 | OK |
| platform/web.ts | 118 | 50 | **REFACTOR** |
| platform/memory.ts | 89 | 50 | **REFACTOR** |

Thresholds from AGENTS.md:
- React component body: 200
- Non-component function: 50
- Tool handler: 30

## 4. Layer Boundary Violations

**Confirmed: 0.** The package dependency graph respects the declared layering:

```
shared (L1) → engine (L2) → scene/compositor/import/prototype/codegen/layout/platform/help/print (L3)
→ ui/ai/collab (L4) → editor/home (L5)
```

All `workspace:*` dependencies flow downward. No `@strata/editor` package is
imported by a lower layer.

## 5. Hub File Budgets

All hub files currently under their import budgets:

| File | Lines | Imports | Budget | OK? |
|------|-------|---------|--------|-----|
| Shell.tsx | 840 | 45 | 48 | ✓ |
| CanvasArea.tsx | 3,944 | 64 | 67 | ✓ |
| Menubar.tsx | 1,633 | 10 | 13 | ✓ |
| HomeShell.tsx | 1,104 | 31 | 34 | ✓ |
| context.tsx | 7,707 | 57 | 60 | ✓ |

`context.tsx` has the most extreme line-to-import ratio (135 lines per import),
confirming it is an inline monolith rather than an integration hub.

## 6. Comparison to Reported Findings

| Reported | Measured | Delta |
|----------|----------|-------|
| 7 dependency cycles | 19 cycles | **+12** (report undercounted) |
| EditorProvider ~1215 | context.tsx 810 | Lower (RTL/TLA+ tools measure differently) |
| CanvasArea ~964 | CanvasArea.tsx 602 | Lower |
| Shell.tsx ~63 outgoing deps | Shell.tsx 45 imports | Lower (48 budget) |
| 16-file scene-package cycle | 10 cycles across scene | Multiple smaller cycles, not one 16-file cycle |
| No layer violations | 0 | Confirmed |
| 198 files omitted by 2K cap | 1,814 source files | Cap not an issue (3,732 total .ts/.tsx minus test and noise) |

## Prioritized Refactoring Plan

### Phase 1 — Quick Fixes (1-2 hours each)

1. **`context.tsx → context/index.ts` (editor)** — Delete the barrel
   `context/index.ts` or fix it to not re-export `context.tsx` itself.
   Self-referencing barrel is always a bug.

2. **`types.ts → component-sync.ts` (scene)** — Remove the import from
   `types.ts` into `component-sync.ts`. `component-sync.ts` needs types from
   `types.ts`; if `types.ts` needs something from component-sync, that
   something belongs in `types.ts` itself or in a shared lower-level module.

3. **`types.ts → typography.ts` (scene)** — Same pattern. Remove the
   `types.ts`→`typography.ts` edge. The typography type references needed by
   `types.ts` should live alongside other primitive types.

4. **`Button.tsx ↔ IconButton.tsx` (ui)** — Extract shared primitive into
   `ButtonBase.tsx` or compose via slots. Both components depend on the same
   base styling; they should not import each other.

5. **`context/types.ts ↔ tools/types.ts` (editor)** — Identify the type
   dependency that crosses in the wrong direction and relocate it.

### Phase 2 — Scene Mega-Cycle Fixes (4-8 hours)

6. **`document.ts` hub reduction** — The root cause of 5 of 10 scene cycles.
   `document.ts` imports brush, clone, library, intelligence, bindings,
   component-sync, etc. while those modules import `types.ts`. When
   `types.ts→component-sync.ts` and `types.ts→typography.ts` are fixed,
   4 cycles (1-5) are resolved. `document.ts→brush`, `document.ts→clone`,
   `document.ts→library`, `document.ts→linterTypes` are separate concerns
   that should be extractable.

7. **`assets.ts → document.ts → version.ts`** — `assets.ts` imports from
   `document.ts` (likely for types), `version.ts` imports from `assets.ts`
   (migration), `document.ts` imports from `version.ts`. Relocate the asset
   types that `version.ts` needs into a standalone module.

### Phase 3 — Complex Fixes (8-16 hours)

8. **`engine.ts ↔ wasmLoader.ts`** — `engine.ts` creates engine instances;
   `wasmLoader.ts` loads WASM. The loader should receive configuration
   from the caller, not import from `engine.ts`. Invert with a callback
   or configuration type.

9. **`filterCompositor.ts → lut/` cycle** — `lut/index.ts` re-exports
   `bake.ts`. `filterCompositor.ts` imports from `lut/index.ts`. `bake.ts`
   imports from `filterCompositor.ts`. Extract the shared types into
   `lut/types.ts`.

10. **`raster-size.ts ↔ raster.ts`** — Split the sizing logic that
    `raster.ts` needs into a leaf module that doesn't depend back on
    `raster.ts`.

### Phase 4 — Editor Context Reduction (Session-scale effort)

11. **`context.tsx` decomposition** (810 complexity) — The acknowledged
    monolith. AGENTS.md already documents the sub-context pattern
    (ViewportContext, SelectionContext, DocumentContext). Continue
    extracting: tool state, history, command dispatch, persistence,
    platform integration. Each extraction should: create a focused hook,
    move pure logic to domain functions, add tests, verify no new cycles.

12. **`CanvasArea.tsx` separation** (602 complexity) — Separate rendering
    pipeline, input handling, overlay management into focused modules.
    The rendering pipeline (`buildIr` → `replaySubtreeToCtx`) is already
    somewhat modular; the input/gesture/shortcut state machine is the main
    complexity driver.

### Acceptance Thresholds

| Metric | Current | Phase 1 | Phase 2 | Phase 3 | Phase 4 | Ceiling |
|--------|---------|---------|---------|---------|---------|---------|
| Total cycles | 19 | ≤14 | ≤8 | ≤4 | ≤2 | 5 |
| Scene cycles | 10 | ≤6 | ≤3 | ≤3 | ≤3 | 3 |
| context.tsx complexity | 810 | 810 | 810 | 810 | ≤400 | 200 |
| CanvasArea complexity | 602 | 602 | 602 | 602 | ≤350 | 200 |
| Layer violations | 0 | 0 | 0 | 0 | 0 | 0 |
| Hub file budget breaches | 0 | 0 | 0 | 0 | 0 | 0 |

## Tooling

### Running the audit

```bash
# Full architecture health check
node scripts/audit-architecture.mjs

# CI mode (fails on new regressions vs baseline)
node scripts/audit-architecture.mjs --ci

# Update baseline after intentional improvements
node scripts/audit-architecture.mjs --update

# Individual checks
node scripts/audit-architecture.mjs --cycles
node scripts/audit-architecture.mjs --complexity
node scripts/audit-architecture.mjs --layers

# Combined gate
just gate              # includes architecture-check
```

### Baseline files

- `.health-baseline.json` — Hub file line/import budgets
- `.architecture-baseline.json` — Cycles, complexity, layers, global thresholds

The CI gate (`scripts/audit-architecture.mjs --ci`) compares current
measurements against `.architecture-baseline.json`. To allow for gradual
improvement, use:

```bash
node scripts/audit-architecture.mjs --update
```

This resets the baseline to current values. CI will only fail if new
regressions appear relative to the updated baseline.
