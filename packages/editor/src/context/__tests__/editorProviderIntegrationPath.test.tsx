/**
 * High-value integration path test (Prompt 4 Task 4): open document -> select -> transform ->
 * undo -> redo -> save.
 *
 * Verified before writing this: no existing test (Vitest or the Playwright specs under
 * tests/e2e/workflow/ and tests/e2e/canvas/) chains all six of these steps end to end through
 * real EditorProvider code paths. `tests/e2e/workflow/shortcuts.spec.ts` and the canvas
 * cross-mode/crop workflow specs each cover pieces of this, not the full chain.
 *
 * Written as a Vitest/RTL test rather than a Playwright E2E spec: every step here (create,
 * select, mutate, undo, redo, save) is a real EditorProvider method call exercising the actual
 * state machine — none of it requires a real browser, real pointer events, or real canvas
 * rendering (that's the separate, already-flagged visual-regression harness concern in
 * test-reality.md §5 item 3). This is faster and more reliable for characterizing
 * EditorProvider's own behavior, which is this document's actual subject.
 */
import { render, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EditorProvider, useEditor } from '../../context';

describe('EditorProvider integration path: open -> select -> transform -> undo -> redo -> save', () => {
  it('chains all six steps and leaves state consistent at each one', async () => {
    let ctx: ReturnType<typeof useEditor> | undefined;
    function TestComponent() {
      ctx = useEditor();
      return null;
    }

    // 1. Open (mount = a fresh document is already open on first render).
    render(
      <EditorProvider>
        <TestComponent />
      </EditorProvider>,
    );
    await waitFor(() => expect(ctx).toBeDefined());
    if (!ctx) throw new Error('ctx not available');
    expect(ctx.state.document).toBeDefined();
    const initialNodeCount = Object.keys(ctx.state.document.nodes).length;

    // Create a fresh shape to select/transform, on top of whatever the default document
    // starts with.
    ctx.setTool('rect');
    await waitFor(() => expect(ctx?.state.tool).toBe('rect'));
    ctx.createShapeAt({ x: 100, y: 100 }, { w: 50, h: 50 });
    await waitFor(() => {
      expect(Object.keys(ctx?.state.document.nodes ?? {}).length).toBe(initialNodeCount + 1);
    });
    // Characterized behavior: createShapeAt makes the new shape the active selection
    // immediately, so read the new node's id from there rather than diffing key sets.
    const nodeId = ctx.state.selection[0];
    if (!nodeId) throw new Error('shape was not created / not auto-selected');

    // 2. Select (re-affirm the selection explicitly, as a real "select" step would).
    ctx.setTool('select');
    ctx.setSelection(nodeId);
    await waitFor(() => {
      expect(ctx?.state.selection).toEqual([nodeId]);
    });

    // 3. Transform.
    const before = ctx.state.document.nodes[nodeId];
    if (!before || !('shape' in before) || before.shape.kind !== 'rect') {
      throw new Error('expected a rect shape node');
    }
    const beforeX = before.shape.x;
    ctx.updateNode(nodeId, (node) => {
      if (!('shape' in node) || node.shape.kind !== 'rect') return node;
      return { ...node, shape: { ...node.shape, x: node.shape.x + 25 } };
    });
    await waitFor(() => {
      const n = ctx?.state.document.nodes[nodeId];
      if (!n || !('shape' in n) || n.shape.kind !== 'rect') throw new Error('node missing');
      expect(n.shape.x).toBe(beforeX + 25);
    });

    // 4. Undo — must revert the transform, not the selection or the shape creation.
    ctx.undo();
    await waitFor(() => {
      const n = ctx?.state.document.nodes[nodeId];
      if (!n || !('shape' in n) || n.shape.kind !== 'rect') throw new Error('node missing');
      expect(n.shape.x).toBe(beforeX);
    });
    // The node itself must still exist after undoing the transform (only the transform
    // should have been undone, not the creation — they were separate transactions).
    expect(ctx.state.document.nodes[nodeId]).toBeDefined();

    // 5. Redo — must reapply the transform.
    ctx.redo();
    await waitFor(() => {
      const n = ctx?.state.document.nodes[nodeId];
      if (!n || !('shape' in n) || n.shape.kind !== 'rect') throw new Error('node missing');
      expect(n.shape.x).toBe(beforeX + 25);
    });

    // 6. Save — this test provides no `platform` prop (matches this repo's existing test
    // convention; no test in this codebase mounts EditorProvider with a real platform).
    // Characterizing the actual, current behavior: save() without a platform fails cleanly
    // rather than throwing, and reports it via `saveState`.
    const saveResult = await ctx.save();
    expect(saveResult).toBe(false);
    await waitFor(() => {
      expect(ctx?.state.saveState).toBe('error');
    });
  });
});
