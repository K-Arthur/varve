# Tables & Linked Color Modifiers — Current-State Capability Audit (2026-08-05)

Evidence-backed status of every capability required by the tables + linked
color modifiers program, verified against the working tree at commit 77053fe9.

## Capability matrix

| Capability | Existing | Partial | Missing | Broken | Evidence | Proposed owner |
| ---------- | -------: | ------: | ------: | -----: | -------- | -------------- |
| Grid columns and rows | | x | | | `LayoutStyle.gridTemplateColumns/Rows` (scene types.ts:1133-1135); TS engine `parseGridTracks` px/fr/auto (editor layout/computeGridLayout.ts:45-67); Rust grid stub (crates/varve-layout/src/lib.rs:112-114) | `@varve/layout` + editor layout |
| Grid row/column spans | | x | | | `GridItemPlacement` + explicit placement with spans (computeGridLayout.ts:171-205, 320-336); spans are a lower-level primitive, not a table algorithm | editor layout |
| Intrinsic track sizing | | x | | | Auto tracks resolve to max child size (computeGridLayout.ts:98-122) via deterministic `measureText` (shared textMeasure.ts:140-160); no two-pass/bounded convergence | editor layout |
| Semantic table model | | | x | | Zero `TableNode` hits in repo; tables only as HTML in UI panels | `@varve/scene` |
| Cell selection | | | x | | Selection is node-only (`state.selection: NodeId[]`) | `@varve/editor` |
| Row/column insertion | | | x | | | `@varve/scene` |
| Header roles | | | x | | | `@varve/scene` |
| Frozen/sticky headers | | | x | | | `@varve/scene` + editor |
| Responsive column rules | | | x | | Breakpoints exist only for flex (crates/varve-layout lib.rs:207 `validate_breakpoints`) | editor layout |
| CSV/TSV import | | | x | | No CSV parser anywhere in `packages/import` | `@varve/import` |
| Large-table virtualization | | | x | | Canvas culls per node; layers tree virtualized; no table-level culling | editor + engine |
| Color-variable binding | x | | | | `PropertyBinding{variableId, expression?}` (types.ts:651-654), `applyBindingsToNode` (bindings.ts:35-91) — fill/opacity/rotation/x/y/w/h/fontSize/text | `@varve/scene` |
| Numeric binding expressions | x | | | | Pratt parser `expr.ts`, `resolveBinding` (variables.ts:437-459) | `@varve/scene` |
| Color modifiers | | | x | | `expression` is numeric-only; colors ignore it silently (variables.ts:439, 458) | `@varve/scene` |
| Linked alpha modifier | | | x | | | `@varve/scene` |
| Gradient modifier support | | | x | | Per-gradient-stop binding deferred (docs/plans/inspector-deferred.md:23) | `@varve/scene` |
| Modifier serialization | | | x | | Bindings serialize as flat `{variableId, expression?}` (types.ts:940) | `@varve/scene` |
| Modifier inspector UI | | | x | | `TokenBindIndicator.tsx` exists but is imported nowhere; `BindingMenu` binds variableId+expression only | `@varve/editor` |

## Grid-span assessment

Current grid spans are **a useful lower-level primitive, not sufficient for
the table layout algorithm**: `applyGridLayout` writes child positions only,
never sizes (computeGridLayout.ts:365-370); implicit rows collapse to the
full container height (:156); auto-row sizing ignores spans; there is no
two-pass intrinsic sizing and no convergence bound. The table layout
algorithm is a new dedicated module (ADR-0016 D4); the grid engine is left
untouched.

## Binding resolution call path (verified)

```
Document.variableStore (document.ts:174)
  → CanvasArea loop: applyBindingsToNode(node, store)   CanvasArea.tsx:1573
  → sceneNodeToEngineNode → engine.buildIr → replayIr   sceneToEngine.ts:59; replay.ts:667
  → paintFill: ctx.fillStyle = rgba(color)              replay.ts:893-896
```

- Worker/export path: `flattenSceneToEngine` runs the same `applyBindingsToNode`
  (sceneToEngine.ts:244-251).
- Variable-only changes invalidate exactly the dependent nodes via
  `getChangedVariableIds` + `buildVariableDependencyMap` (CanvasArea.tsx:514-535).
- Missing variables: `resolveBinding` throws; `applyBindingsToNode` catches per
  property and keeps the original value silently (bindings.ts:85-87) — fail-soft
  with **no UI warning** (this is preserved; the warning state is added).

## Key limitations confirmed during audit

1. Strokes have no binding path (`StrokeSection` has no `BindingMenu`;
   `applyBindingsToNode` has no `stroke` case).
2. `cornerRadius`/`lineHeight`/`letterSpacing` bindings can be created but are
   never applied.
3. `@varve/layout` package is a 7-line stub; the real engine lives in
   `packages/editor/src/layout/`; `@varve/layout` is imported nowhere.
4. Rust `varve-layout` grid is a stub; no WASM layout binding exists.
5. `deleteVariableFromDocument` strips bindings document-wide
   (document.ts:903-919) — the explicit detach path.
6. WebGPU backend routes non-GPU primitives through the Canvas2D present path
   (compositor/src/webgpu/backend.ts:394-409), so a new `table` primitive needs
   no WebGPU-specific work.
7. Native engine is strict: a shape kind Rust cannot deserialize rejects the
   batch (withStubFallback, engine.ts:343-379) — hence the Rust pass-through in
   ADR-0016 D3.
8. `.varve` is plain JSON text (not zip); clipboard is `application/vnd.varve+json`
   via `DocumentCodec`-style closure; paste remaps ids through
   `deepCloneSubtree` (scene/clone.ts:36-116).

## Test inventory (pre-change)

- Bindings: `packages/scene/src/__tests__/bindings.test.ts` (missing-variable
  keeps original, fill hex→ManagedColor, opacity/x/y/w/h/rotation/text/fontSize).
- Variables: `variables.test.ts` (alias chains, cycles, modes, math).
- Grid layout: `packages/editor/src/layout/__tests__/computeGridLayout.test.ts`
  (13 tests). No table, no modifier, no E2E coverage for either feature.
