# Context Extraction Plan

## Problem

`packages/editor/src/context.tsx` is 4,598 lines with a 285-member `EditorContextValue`
interface implemented in a 3,519-line `EditorProvider` function body. This is the
textbook "god object" antipattern — it conflates viewport, selection, document CRUD,
tools, motion, prototype, guides, variables, components, background removal, export,
page management, undo/redo, and a11y announcements into a single React context.

## Impact

1. **Bundle splitting impossible** — any `useEditor()` import pulls the full 4,598-line file.
2. **Testing friction** — mocking 285 methods in tests is error-prone.
3. **Team bottleneck** — two developers modifying `context.tsx` will conflict on every PR.
4. **Feature scaling blocked** — adding a new feature requires touching 3+ files
   (types, context, implementation), with `context.tsx` being the bottleneck.

## Status (2026-07-06)

Extraction has started. Three sub-contexts exist:

| Sub-context | File | Methods | Pattern |
|-------------|------|---------|---------|
| `ViewportContext` | `ViewportContext.tsx` (314 lines) | 20 | Accepts `state`/`setState`/`stateRef`; implements directly |
| `SelectionContext` | `SelectionContext.tsx` (175 lines) | 9 | Accepts `state`/`setState`; implements directly |
| `DocumentContext` | `DocumentContext.tsx` (184 lines) | ~80 | Pass-through: receives pre-built `value` from `EditorProvider` |

All three are composed in `EditorProvider`:

```tsx
<EditorCtx.Provider value={value}>
  <DocumentProvider value={documentValue}>
    <ViewportProvider state={state} setState={setState} stateRef={stateRef}>
      <SelectionProvider state={state} setState={setState}>
        {children}
      </SelectionProvider>
    </ViewportProvider>
  </DocumentProvider>
</EditorCtx.Provider>
```

## Next Extraction Targets

### 1. ToolContext (~40 methods)

- `setTool`, `setDraft`, tool creation via `createShapeAt`/`createTextNodeAt`
- All tool-related state (cursorPos, unitType, snapEnabled, etc.)
- No undo/redo dependency

### 2. MotionContext (~20 methods)

- All timeline/animation methods
- References `MotionState` from `state/motion-state.ts`
- Partially already extracted to `MotionFacade` pattern

### 3. PrototypeContext (~20 methods)

- Prototype mode, runtime, presentation, interactions
- References `PrototypeRuntime`, `PrototypeData`

### 4. InspectorContext (~30 methods)

- Binding field state, fill/opacity/blend mode setters
- Adjustment layer operations
- Background removal (cross-cutting — unclear boundary)

## Strategy

Each extraction should:

1. Create the sub-context file in `packages/editor/src/context/`
2. Define `interface XContextValue` with the subset of `EditorContextValue` members
3. Implement a `XProvider` that accepts `state`/`setState`/needed refs from parent
4. Export a `useX()` hook
5. Wire `XProvider` into `EditorProvider`'s render tree
6. **Do NOT remove** members from `EditorContextValue` (backward compat)
7. Re-export `useX` from `context/index.ts` and `context.tsx`
8. Migrate consumers incrementally to use focused hooks

## Migration Pattern

```tsx
// Before
const { zoom, setZoom, selection, setSelection } = useEditor();

// After (preferred for new code)
const { zoom, setZoom } = useViewport();
const { selection, setSelection } = useSelection();
```

To migrate an existing consumer:
1. Import the specific hook
2. Replace the destructured members from `useEditor()` with the focused hook
3. Remove the focused members from the `useEditor()` destructuring
4. Verify typecheck
