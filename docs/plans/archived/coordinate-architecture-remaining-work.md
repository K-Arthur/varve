# Coordinate Architecture: Remaining Work (Phases 2–5)

## What's done

Phase 0 (foundation) is complete:
- `packages/scene/src/coordinateService.ts` — centralized coordinate API
- `packages/scene/src/nodeBounds.ts` — canonical local bounds
- Migration 2.4 → 2.5 (bake rotation into transform, validate)
- 35 tests + ADR-0010 + AGENTS.md section
- `@varve/editor/scene/world.ts` re-exports from `@varve/scene` (backward compat)

## Remaining work: Phases 2–5

Migrate existing consumers from inline coordinate math / duplicated wrappers to
the centralized `CoordinateService`. Each phase is independently testable.

### Phase 2: Hit-testing and snapping (TDD-first)

**Goal**: `HitTestEngine` and `snapping.ts` use `CoordinateService` functions.

1. In `packages/editor/src/hitTest/HitTestEngine.ts`:
   - Replace `nodeWorldTransform` + `nodeWorldBounds` imports with a single
     `import { ... } from '@varve/scene'`
   - Add `localToWorld`/`worldToLocal` where world↔local point conversions
     happen inline
   - Verify hit-test tolerance math still uses `nodeWorldTransform` for
     inverse-transforming points

2. In `packages/editor/src/tools/snapping.ts`:
   - Replace `nodeWorldBounds` import with `@varve/scene` version
   - Use `localSpaceTransform` for cross-artboard snap comparisons
   - Snap comparisons must happen in world space, results converted back to
     parent-local space of the edited node

3. Write tests for cross-artboard snapping (snap a node in one artboard to
   an object in another artboard).

**Run**: `pnpm --filter @varve/editor test -- --run packages/editor/src/hitTest packages/editor/src/tools/snapping`

### Phase 3: Tools (TDD-first)

**Goal**: SelectTool, shape creation tools, drag operations use `CoordinateService`.

1. In `packages/editor/src/tools/SelectTool.ts`:
   - Import `nodeWorldTransform`/`nodeWorldBounds` from `@varve/scene`
   - Use `computeReparentTransform` for the drag-end reparent logic (replaces
     inline `invertAffine` + `multiplyAffine` pattern)
   - Use `localToWorld`/`worldToLocal` for nudge operations

2. In `packages/editor/src/context.tsx`:
   - `createShapeAt` / `createTextNodeAt`: use `worldToParent` from
     `CoordinateService` instead of inline `applyAffine(invertAffine(...))`
   - `reparentNode`: use `computeReparentTransform` from `@varve/scene`

3. Shape creation tools (RectTool, EllipseTool, etc.):
   - Import world-transform helpers from `@varve/scene`
   - Ensure tool preview and committed geometry use the same conversion path
     (no "jump" on commit)

4. Test: drag an object from one artboard to another and assert its world
   position is preserved (use `nodeWorldTransform` before and after).

**Run**: `pnpm --filter @varve/editor test -- --run packages/editor/src/tools packages/editor/src/context`

### Phase 4: Overlays (batch refactor)

**Goal**: Eliminate duplicated `worldToScreen`/`screenToWorld` wrappers in
overlay components.

These components each implement their own wrapper that calls
`simpleWorldToScreen` / `simpleScreenToWorld` from `@varve/shared/viewport.ts`.
Under view rotation, these simplified helpers drift from the canonical camera
transform. Migrate them to use `worldToScreen`/`screenToScreen` from
`@varve/shared/viewport.ts` directly (or via the editor context's
`worldToCanvas`/`canvasToWorld`).

Files to update (each is a small mechanical change):
- `packages/editor/src/SelectionOverlay.tsx`
- `packages/editor/src/components/NodeEditOverlay.tsx`
- `packages/editor/src/components/TextEditOverlay.tsx`
- `packages/editor/src/components/SnapGuidesOverlay.tsx`
- `packages/editor/src/components/SpecPanel/MeasureOverlay.tsx`
- `packages/editor/src/components/AlignmentOverlay/AlignmentHandleOverlay.tsx`
- `packages/editor/src/components/AlignmentOverlay/AlignmentGuideOverlay.tsx`
- `packages/editor/src/components/GradientHandleOverlay.tsx`
- `packages/editor/src/components/MeshWarpOverlay.tsx`
- `packages/editor/src/components/OnionSkinOverlay.tsx`
- `packages/editor/src/components/ImageCompareOverlay.tsx`

Pattern: replace `simpleWorldToScreen(wx, wy, zoom, pan)` with
`worldToScreen(cam, wx, wy, viewport, [0, 0])` using the camera/viewport from
editor context. The editor context already provides `worldToCanvas` /
`canvasToWorld` wrappers that include rotation — prefer those.

**Run**: `pnpm --filter @varve/editor test -- --run packages/editor/src/components`

### Phase 5: Export/import

**Goal**: Coordinate correctness in serialization and interchange.

1. Verify `packages/scene/src/documentCodec.ts` round-trips the `transform`
   tuple correctly (no precision loss, no rotation field after migration).

2. Verify `packages/codegen/src/svg.ts` outputs correct `transform`
   attributes (already uses `nodeWorldTransform` indirectly via the scene).

3. Verify `packages/import/src/svg.ts` import builds parent-local coordinates
   for nested nodes (already handled by `addChild` with proper local
   transform).

4. Add a test: create a document with a rotated frame containing a child,
   serialize, deserialize, assert the child's world position is preserved.

**Run**: `pnpm --filter @varve/scene test -- --run packages/scene/src/documentCodec`

## Regression protocol (mandatory after each phase)

```bash
pnpm format
pnpm typecheck        # scene + editor must pass
pnpm lint             # 0 new errors on touched files
pnpm test             # full test suite must pass
pnpm audit:emoji      # zero violations
pnpm audit:tokens     # 120/120 WCAG-AA (3 themes)
```

## Invariants (do not violate)

1. **Scene graph correctness**: Moving a parent must NOT rewrite descendant
   transforms. Only the parent's own `transform` changes.
2. **World-position preservation on reparent**: `newLocal = parentWorld⁻¹ × oldWorld`
   (already implemented in `computeReparentTransform`).
3. **Matrix multiply order**: `multiplyAffine(parent, child)` = `parent · child`
   (post-multiply, child applied first).
4. **No ad hoc offset subtraction**: Never subtract an artboard's x/y from a
   world point to get "artboard-local" — use `worldToArtboardLocal` which
   handles rotation via the full inverse transform.
5. **Backward compatibility**: Keep `editor/scene/world.ts` and
   `editor/scene/nodeBounds.ts` as thin re-exports. Do NOT remove them until
   all consumers within `@varve/editor` have migrated.

## Definition of done

Each phase is complete when:
- All targeted files import from `@varve/scene` (not duplicated math)
- Tests pass (existing + new TDD tests for the phase's functionality)
- Typecheck clean on scene + editor
- Lint 0 errors on touched files
- No coordinate "jump" bugs at extreme zoom or rotation

Phase 5 is complete when:
- A full round-trip (create → serialize → deserialize) preserves world
  positions for nested, rotated, multi-artboard documents
- All import/export paths produce correct coordinates
