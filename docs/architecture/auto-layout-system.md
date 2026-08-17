# Auto Layout / Responsive Layout System

**Canonical doc** — audit status, model, engine, and known limitations.

## 1. Current State (2026-08-17)

| Capability | Scene Model | Engine | Inspector | Canvas | Tests | Status |
|---|---|---|---|---|---|---|
| Horizontal / vertical layout | ✓ | ✓ | ✓ | ✓ | ✓ | **Working** |
| Reverse direction | ✓ | ✓ | ✓ | ✓ | ✓ | **Working** |
| Padding | ✓ | ✓ | ✓ (per-side) | ✓ | ✓ | **Working** |
| Gap | ✓ | ✓ | ✓ | ✓ | ✓ | **Working** |
| Wrap | ✓ | ✓ | ✓ | ✓ | ✓ | **Working** — was ignoring the flag entirely; fixed |
| Alignment (cross-axis) | ✓ | ✓ | ✓ | ✓ | ✓ | **Working**, incl. per-child override + hug/stretch conflict resolved |
| Distribution (justify) | ✓ | ✓ | ✓ | ✓ | ✓ | **Working**, incl. new spaceEvenly; spaceAround/spaceEvenly offset-accumulation bug fixed |
| Fixed size | ✓ | ✓ | ✓ | ✓ | ✓ | **Working** |
| Fill container | ✓ | ✓ | ✓ | ✓ | ✓ | **Working** — was equal-split; now correct fill-after-fixed |
| Hug contents (leaf children) | ✓ | ✓ | ✓ | ✓ | ✓ | **Working** |
| Hug contents (frame sizing itself) | ✓ | ✓ | ✓ | ✓ | ✓ | **Working (new)** — recursive bottom-up resolution |
| Per-axis sizing (width ≠ height mode) | ✓ | ✓ | ✓ | ✓ | ✓ | **Working (new)** |
| Absolute-positioned children | ✓ | ✓ | ✓ | ✓ | ✓ | **Working (new)** — filtered from flow, hug, gap |
| Hidden children | ✓ | ✓ | N/A | N/A | ✓ | **Working (new)** — filtered from flow, hug, gap |
| Min/max constraints | ✓ | ✓ | ✓ | ✓ | ✓ | **Working (new)** — was modeled, never enforced |
| Nested layout (multi-level, hug + fill mixed) | ✓ | ✓ | N/A | ✓ | ✓ | **Working (new)** — was single-level only |
| Cycle handling (fill inside hug) | ✓ | ✓ | N/A | N/A | ✓ | **Working (new)** — broken by construction (min-size contribution), diagnostic in cycleDetection.ts is available but not yet wired into the inspector as a user-facing warning |
| Grid layout | ✓ | ✓ | ✓ | ✓ | ✓ | **Working (basic)** — unchanged this pass |
| Grid hug/intrinsic sizing | ✓ | ✓ | ✓ | — | ✓ | **Working (new)** — px/auto tracks resolve from content; fr tracks contribute 0 to hug measurement (same policy as flex fill-in-hug) |
| Grid hidden/absolute filtering | ✓ | ✓ | — | — | — | **Working (new)** — parity fix, not deeply tested |
| Components/instances | ✓ | ✓ | ✓ | N/A | — | **Unverified this pass** — structurally frames, so the generic frame path applies, but no dedicated instance/override test was run |
| Text intrinsic sizing | ✓ | ✓ | N/A | ✓ | ✓ | **Working** (measureText), confirmed visually |
| Codegen | ✓ | N/A | N/A | N/A | — | **Untouched this pass** — basic flex mapping pre-existing, not re-audited |
| Save/reopen | ✓ | N/A | N/A | N/A | — | **Untouched this pass** — schema is additive/optional, no migration needed, not re-verified end-to-end |
| Undo/redo | ✓ | N/A | N/A | N/A | — | **Untouched this pass** — goes through the existing updateDoc/history path, not independently re-verified |

## 2. Architecture

```
Scene Model (persistent, packages/scene/src/types.ts)
    │
    ├── FrameNode.layoutStyle       → container properties (direction, gap, padding, align, justify, wrap)
    ├── NodeBase.layoutSizing       → legacy unified sizing (fixed/hug/fill), kept for back-compat
    ├── NodeBase.layoutSizingWidth  → per-axis width sizing (falls back to layoutSizing)
    ├── NodeBase.layoutSizingHeight → per-axis height sizing (falls back to layoutSizing)
    ├── NodeBase.layoutPosition     → flow | absolute
    ├── NodeBase.layoutAlign        → per-child cross-axis alignment override
    └── NodeBase.minWidth/maxWidth/minHeight/maxHeight → constraints, enforced on every axis regardless of sizing mode
    │
    ▼
Layout Engine (@varve/layout — pure TS, no DOM)
    │
    ├── measure.ts            → shared: node natural size, flow-participation filter, min/max clamp
    ├── computeFlexLayout()   → row/column/reverse, wrap, gap, padding, align/justify, fill-after-fixed, per-axis sizing, min/max
    ├── computeGridLayout()   → explicit tracks, auto-flow, placement overrides (unchanged this pass)
    ├── intrinsicSize.ts      → resolveIntrinsicSizes(): bottom-up hug resolution across a subtree
    ├── reflow.ts             → reflowLayoutChildren(): the single entry point (see phases below)
    └── cycleDetection.ts     → checkLayoutCycle(): diagnostic, not yet wired into any mutation path
    │
    ▼
Resolved Geometry (transform + w/h written back onto each node)
    │
    ▼
Render Pipeline (Canvas2D / selection overlay / export) — reads the same resolved geometry, no separate representation
```

### `reflowLayoutChildren(doc, frameId)` — the four-step pass

Called with the frame whose children (and, transitively, descendants) need laying out. Every layout-mutating editor action funnels through this one function — sizing-mode setters, padding/gap/align edits, canvas resize, insert/delete/reparent.

1. **Bottom-up intrinsic resolution** (`resolveIntrinsicSizes`): walks `frameId`'s subtree post-order (deepest frames first) and, for every frame whose width/height sizing is `hug`, recomputes its own box from its *already-resolved* flow children — natural size for fixed/hug children, `minWidth`/`minHeight` (or 0) for fill/grow children. Using the min size instead of an expanded size for fill children is what breaks the classic "parent hugs child, child fills parent" cycle by construction, without needing a runtime guard.
2. **Top-down flex/grid layout**: `computeFlexLayout` (or `applyGridLayout` for grid-mode) positions `frameId`'s children against its now-resolved box. Per axis, a child's geometry is only overwritten when that axis's sizing mode isn't `fixed` — hug children get their own (already-correct) size re-applied, fill/grow children get their computed share.
3. **Recurse into child layout frames**: any child that is itself a frame with `layoutStyle` gets `reflowLayoutChildren` called on it, now that its box is final, so deeper nesting resolves correctly.
4. **Propagate upward**: if `frameId`'s own size changed (because it hugs), that invalidates its parent's measurement, so the parent is reflowed too. Bounded by tree depth — a fill/hug pair can't oscillate because of the min-size contribution in step 1.

### Cross-axis hug vs. stretch

A child whose cross-axis sizing is `hug` never stretches, even under `alignItems: stretch` or an explicit `layoutAlign: 'stretch'` override sourced from the parent. Without this rule, a hug *frame* child would get stretched by its parent's alignment pass, then immediately shrink back to its intrinsic size on the next reflow (step 1 of the child's own recursive call) — visibly fighting itself. Hug is treated as the more authoritative signal: "sized by my own content," full stop.

## 3. Files Changed

### Layout Engine (`packages/layout/src`)
- `measure.ts` — **new**. Shared `measureNodeSize`, `isFlowParticipant`, `axisSizing`, `clampAxis`.
- `computeFlexLayout.ts` — rewritten. Fixes: wrap flag ignored, fill-after-fixed distribution (was equal split), per-axis sizing support, hidden/absolute filtering, min/max clamping, spaceAround/spaceEvenly offset accumulation, hug-vs-stretch conflict.
- `computeGridLayout.ts` — hidden/absolute filtering parity fix.
- `intrinsicSize.ts` — **new**. Recursive bottom-up hug sizing.
- `reflow.ts` — rewritten. Two-phase (bottom-up measure, top-down layout) with recursion into child frames and upward propagation.
- `index.ts` — exports for the new modules.
- `__tests__/autolayout.test.ts`, `__tests__/reflow.test.ts` — expanded (engine bug regressions, hug/nested/cycle-breaking coverage).

### Scene Model (`packages/scene/src`)
- `types.ts` — `layoutSizingWidth`, `layoutSizingHeight`, `layoutPosition`, `layoutAlign`, `spaceEvenly` (pre-existing from an earlier pass on this branch, verified still correct).
- `canonical.ts` — new fields added to canonical key order.

### Editor (`packages/editor/src`)
- `context/layoutChildSetters.ts` — **new**. `applySelectedLayoutChildField`: batch-apply a sizing/position field to a selection and reflow every affected frame (the changed node itself when it's a frame with `layoutStyle`, plus its parent). Extracted out of `context.tsx` to stay under its complexity ceiling.
- `context.tsx` — `setSelectedLayoutSizing/Width/Height/Position` and `setNodeLayout` now reflow after mutating (previously wrote the field and did nothing else — no visible effect until an unrelated action happened to trigger a reflow).
- `context/types.ts` — new setter signatures.
- `components/Inspector/sections/LayoutChildSection.tsx` — **new**. Flow/absolute position + per-axis width/height sizing controls for non-frame children of a layout frame.
- `components/Inspector/sectionRegistry.ts` — new `layout-child` section id (was incorrectly sharing `layout`'s frame-only availability gate, which meant the section above never rendered until this fix).
- `components/Inspector/PropertiesPanel.tsx` — wires `LayoutChildSection` under the new id.
- `canvas/inputPipeline.ts` — unrelated one-line fix (`canvasRectRef` missing from a destructured parameter list, crashing on any canvas drag). Found while visually verifying; not part of Auto Layout but blocked all interactive testing.

### Canvas direct-manipulation (`packages/editor/src`)

- `packages/scene/src/document-nodes.ts` — **new** `frameNodes(doc, ids, frameNode)`: wraps 1+ sibling nodes in a new `FrameNode`, sized/positioned to their world bounding box, preserving each child's world-space appearance (frame transform is pure translation, so a child's rotation/scale is untouched — only its tx/ty shift by the frame's new origin). Mirrors `groupNodes`' same-parent guard and order-preserving reparent.
- `context.tsx` — **new** `addAutoLayoutSelected()`: wraps the current selection via `frameNodes`, infers direction/gap/alignment from the selection's current geometry via the existing `suggestAutoLayout` heuristic (2+ nodes; a plain row for a single node), reflows immediately. Wired as **Object → Add Auto Layout** (`Ctrl+Alt+A`) alongside Group/Ungroup.
- `tools/SelectTool.ts` — **new** `computeLayoutDropIndex`/`computeLayoutInsertionSegment`: canvas drag-drop into a flex frame previously only ever appended (and dropping back into the same frame was a silent no-op — no reorder existed at all). Now derives an insertion index from where the drop point falls along the frame's main axis relative to current flow children, for both same-frame reorders and cross-frame inserts. Freeform/grid frames keep prior append-or-no-op behavior (layer order there isn't tied to canvas position).
- `canvas/overlayManager.tsx`, `CanvasArea.tsx`, `canvas/toolContext.ts`, `tools/types.ts` — new `layoutInsertion` world-space line segment, plumbed the same way the existing `dropTargetFrameId` dashed-frame highlight already is, drawn live during the drag.
- `SelectionOverlay.tsx` — double-click a pure-edge resize handle (e/w for width, n/s for height; corners skipped — ambiguous axis) calls `setSelectedLayoutSizingWidth/Height('hug')` directly, the documented way back from a fixed size to hug (mirrors the one existing double-click-to-reset precedent, `PanelResizeHandle`).

### Follow-up fixes (found during this pass's own visual verification)

- `transform/TransformEngine.ts` — **fix**: dragging a hug-sized frame's resize handle now converts the *dragged axis only* from `hug` to `fixed` before `bakeNode`'s own reflow call runs. Root cause: `bakeNode`'s frame branch calls `reflowLayoutChildren(frameId)` on itself after baking a new w/h; that reflow's first step (`resolveIntrinsicSizes`) re-derives *any* hug-sized frame's own box from its content — including `frameId` itself — silently discarding the just-baked drag size and snapping back to a content-derived one. Converting the resized axis's sizing mode to `fixed` first (mirroring Figma's manual-resize behavior) makes the reflow skip re-deriving it. The untouched axis (e.g. height, when only the east handle was dragged) is left as `hug`. Covered by 3 new unit tests exercising the exact `resize()`/`commit()`/`bakeNode()` path production canvas code calls; **not independently confirmed via Playwright** — see the E2E note below.
- `components/Inspector/sections/LayoutSection.tsx` — **fix**: the frame's own Width and Height sizing selects (in the "Sizing" sub-section, which controls a frame's sizing as a layout child of *its own* parent) both called the axis-agnostic `setSelectedLayoutSizing`, so changing one axis silently overwrote the other. Switched to `setSelectedLayoutSizingWidth`/`setSelectedLayoutSizingHeight`, matching the pattern `LayoutChildSection.tsx` already used correctly. Covered by 3 new integration tests (`LayoutSection.test.tsx`) driving the real `EditorProvider` + document state, not mocks.

## 4. Known Limitations (see final report for full prioritization)

- **E2E verification gap on the hug→fixed resize fix.** Driving a frame resize-handle drag through Playwright (`page.mouse.move/down/move/up` at the handle's real screen bounding box) produced no visible effect at all — confirmed to be pre-existing and unrelated to this change by reproducing the identical non-response on a plain, non-layout frame with no code changes involved. An existing, currently-passing spec (`tests/e2e/canvas/background-removed-transform.spec.ts`) drags a *shape's* resize handle successfully with the same technique, so this appears specific to frame resize handles in this environment, not a general E2E-driving problem. Given strong unit coverage of the actual fix (see above) and that chasing this matched a previously-identified environmental dead end (double-click-to-hug's zoom-persistence issue), verification stopped here rather than continuing to debug test infrastructure.
- **Cycle diagnostic not surfaced**: `checkLayoutCycle` exists and is tested but isn't called from any mutation path — there's no user-facing warning when a configuration would have cycled (the engine still resolves deterministically; this is about UX feedback, not correctness).
- **Absolute-child constraints** (left+top / right+bottom / center / stretch scale) are not layered on top of `layoutPosition: 'absolute'` — absolute children currently just keep their existing transform, with no responsive anchoring within the layout parent, and there's no canvas indicator distinguishing them from flow children.
- **Gap/padding drag handles** on the canvas were not built — those remain inspector-only fields.
- **Real typographic baseline alignment** is not implemented; `alignItems` has no `baseline` option, which is correct per the "don't expose a fake option" principle rather than an oversight.
- **RTL/logical direction** (`start`/`end` independent of `left`/`right`) is not modeled — `row`/`column` are physical, not logical.
- Components/instances, save/reopen round-trip, undo/redo, and codegen fidelity were not independently re-verified this pass (pre-existing behavior, structurally unaffected by the engine changes, but not proven).
