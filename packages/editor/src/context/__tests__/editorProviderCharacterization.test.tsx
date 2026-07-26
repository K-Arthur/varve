/**
 * Characterization tests for EditorProvider (context.tsx:1882).
 *
 * These describe CURRENT behavior, not desired behavior — the goal is a suite that fails if
 * the strangler-fig split (docs/quality/editorprovider-surface.md) changes observable behavior,
 * not a suite that asserts what the behavior "should" be. Written per the gaps identified in
 * docs/quality/test-reality.md §5 (items 1 and 2 are the highest-value, covered first and most
 * thoroughly).
 *
 * Where a test documents behavior that looks like a bug, it says so in a comment and preserves
 * the behavior anyway — fixing it is a separate, later change (test-reality.md's own rule).
 */
import { render, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { EditorProvider, getBackupService, useEditor } from '../../context';
import { useSelection } from '../SelectionContext';
import { useTool } from '../ToolContext';
import { useViewport } from '../ViewportContext';

function mountEditor() {
  let ctx: ReturnType<typeof useEditor> | undefined;
  function TestComponent() {
    ctx = useEditor();
    return null;
  }
  render(
    <EditorProvider>
      <TestComponent />
    </EditorProvider>,
  );
  return () => {
    if (!ctx) throw new Error('ctx not found');
    return ctx;
  };
}

describe('EditorProvider characterization — auto-save/backup freshness', () => {
  // Priority 1 per test-reality.md §5: this is the test that would have caught the
  // stale-closure bug injected during the audit (auto-save effect's dependency array
  // dropping `state.document`, which caused markDirty() to be called with the document
  // as it was *before* the edit, silently).
  it('backs up the LATEST document content after an edit, not a stale one', async () => {
    const getCtx = mountEditor();

    await waitFor(() => {
      expect(getBackupService()).not.toBeNull();
    });
    const backupService = getBackupService();
    if (!backupService) throw new Error('backup service not ready');
    const markDirtySpy = vi.spyOn(backupService, 'markDirty');

    const before = getCtx().state.document.nextId;
    getCtx().updateDoc((doc) => ({ ...doc, nextId: doc.nextId + 1 }));

    await waitFor(() => {
      expect(markDirtySpy).toHaveBeenCalled();
    });

    const lastCall = markDirtySpy.mock.calls[markDirtySpy.mock.calls.length - 1];
    expect(lastCall).toBeDefined();
    const backedUpJson = lastCall?.[1] as string;
    const backedUpDoc = JSON.parse(backedUpJson) as { nextId: number };

    // The backup must reflect the edit, not the pre-edit document. If the auto-save
    // effect's dependency array ever drops `state.document` again, this fails.
    expect(backedUpDoc.nextId).toBe(before + 1);
    expect(backedUpDoc.nextId).not.toBe(before);
  });
});

describe('EditorProvider characterization — context value identity', () => {
  it('useSelection() returns a new reference when selection changes', async () => {
    let selectionCtx: ReturnType<typeof useSelection> | undefined;
    let editorCtx: ReturnType<typeof useEditor> | undefined;
    const seen: ReturnType<typeof useSelection>[] = [];

    function TestComponent() {
      editorCtx = useEditor();
      selectionCtx = useSelection();
      seen.push(selectionCtx);
      return null;
    }

    render(
      <EditorProvider>
        <TestComponent />
      </EditorProvider>,
    );

    await waitFor(() => expect(editorCtx).toBeDefined());
    const firstRef = selectionCtx;
    const doc = editorCtx?.state.document;
    const firstNodeId = doc ? Object.keys(doc.nodes)[0] : undefined;

    if (firstNodeId) {
      editorCtx?.setSelection(firstNodeId);
      await waitFor(() => {
        expect(selectionCtx).not.toBe(firstRef);
      });
    } else {
      // No node to select in the default document — still meaningful to confirm the
      // provider is stable rather than skip silently.
      expect(firstRef).toBeDefined();
    }
  });

  it('useSelection() reference does NOT change when an unrelated field (tool) changes', async () => {
    let selectionCtx: ReturnType<typeof useSelection> | undefined;
    let editorCtx: ReturnType<typeof useEditor> | undefined;

    function TestComponent() {
      editorCtx = useEditor();
      selectionCtx = useSelection();
      return null;
    }

    render(
      <EditorProvider>
        <TestComponent />
      </EditorProvider>,
    );

    await waitFor(() => expect(editorCtx).toBeDefined());
    const beforeRef = selectionCtx;
    const beforeTool = editorCtx?.state.tool;

    editorCtx?.setTool(beforeTool === 'select' ? 'pen' : 'select');

    await waitFor(() => {
      expect(editorCtx?.state.tool).not.toBe(beforeTool);
    });
    // Selection value must be memoized independently of tool — a tool switch must not
    // invalidate selection-dependent consumers (this is the exact class of bug injected
    // as bug #3 in test-reality.md, just verified on a sub-context that already exists
    // rather than the pre-extraction bgRemoval field).
    expect(selectionCtx).toBe(beforeRef);
  });

  it('useTool() and useEditor().setTool are the same underlying implementation (Phase B extraction)', async () => {
    // ToolContext.tsx's applyToolChange() is shared by both `useTool().setTool` and
    // `useEditor().setTool` — this is the specific thing that guarantees they can't
    // diverge the way `useEditor().setZoom` and `useViewport().setZoom` already have
    // (see docs/quality/editorprovider-surface.md). Asserted here via observable
    // behavior: calling either one updates both views identically.
    let toolCtx: ReturnType<typeof useTool> | undefined;
    let editorCtx: ReturnType<typeof useEditor> | undefined;

    function TestComponent() {
      editorCtx = useEditor();
      toolCtx = useTool();
      return null;
    }

    render(
      <EditorProvider>
        <TestComponent />
      </EditorProvider>,
    );

    await waitFor(() => expect(editorCtx).toBeDefined());
    expect(toolCtx?.tool).toBe(editorCtx?.state.tool);

    const target = editorCtx?.state.tool === 'select' ? 'pen' : 'select';
    editorCtx?.setTool(target);

    await waitFor(() => {
      expect(editorCtx?.state.tool).toBe(target);
    });
    expect(toolCtx?.tool).toBe(target);

    const target2 = target === 'select' ? 'pen' : 'select';
    toolCtx?.setTool(target2);

    await waitFor(() => {
      expect(toolCtx?.tool).toBe(target2);
    });
    expect(editorCtx?.state.tool).toBe(target2);
  });

  it('useTool() reference does NOT change when an unrelated field (selection) changes', async () => {
    let toolCtx: ReturnType<typeof useTool> | undefined;
    let editorCtx: ReturnType<typeof useEditor> | undefined;

    function TestComponent() {
      editorCtx = useEditor();
      toolCtx = useTool();
      return null;
    }

    render(
      <EditorProvider>
        <TestComponent />
      </EditorProvider>,
    );

    await waitFor(() => expect(editorCtx).toBeDefined());
    const beforeRef = toolCtx;
    const firstNodeId = Object.keys(editorCtx?.state.document.nodes ?? {})[0];
    if (firstNodeId) {
      editorCtx?.setSelection(firstNodeId);
      await waitFor(() => {
        expect(editorCtx?.state.selection).toEqual([firstNodeId]);
      });
    }
    expect(toolCtx).toBe(beforeRef);
  });

  it('useViewport() returns a new reference when zoom changes', async () => {
    let viewportCtx: ReturnType<typeof useViewport> | undefined;
    let editorCtx: ReturnType<typeof useEditor> | undefined;

    function TestComponent() {
      editorCtx = useEditor();
      viewportCtx = useViewport();
      return null;
    }

    render(
      <EditorProvider>
        <TestComponent />
      </EditorProvider>,
    );

    await waitFor(() => expect(editorCtx).toBeDefined());
    const beforeRef = viewportCtx;
    const beforeZoom = editorCtx?.state.zoom;

    editorCtx?.setZoom((beforeZoom ?? 1) + 0.5);

    await waitFor(() => {
      expect(editorCtx?.state.zoom).not.toBe(beforeZoom);
    });
    expect(viewportCtx).not.toBe(beforeRef);
  });

  // FIXED (was a live bug, found by this characterization pass, fixed in its own PR —
  // see docs/quality/editorprovider-surface.md): `useViewport()`'s memoization used to be
  // completely defeated on every EditorProvider render, not just viewport-relevant ones.
  // Root cause was `ViewportContext.tsx`'s `ViewportProvider` doing
  // `const animRef = panAnimationRef ?? { current: null };` — since `EditorProvider` never
  // passes `panAnimationRef`, that fallback allocated a brand-new object every render.
  // `smoothZoomTo`/`smoothPanTo` listed `animRef` in their own `useCallback` deps, cascading
  // through `revealSelection` -> `fitAll` -> the top-level `value` `useMemo`'s deps, busting
  // the entire viewport context value on every render regardless of cause. Fixed by replacing
  // the fallback with a stable `useRef` default inside `ViewportProvider` itself, so the
  // fallback is only ever created once, not per-render. This test now asserts the intended
  // (and now real) behavior: an unrelated state change does not bust the viewport memo.
  it('useViewport() reference is stable when an unrelated field (tool) changes', async () => {
    let viewportCtx: ReturnType<typeof useViewport> | undefined;
    let editorCtx: ReturnType<typeof useEditor> | undefined;

    function TestComponent() {
      editorCtx = useEditor();
      viewportCtx = useViewport();
      return null;
    }

    render(
      <EditorProvider>
        <TestComponent />
      </EditorProvider>,
    );

    await waitFor(() => expect(editorCtx).toBeDefined());
    const beforeRef = viewportCtx;
    const beforeTool = editorCtx?.state.tool;

    editorCtx?.setTool(beforeTool === 'select' ? 'pen' : 'select');

    await waitFor(() => {
      expect(editorCtx?.state.tool).not.toBe(beforeTool);
    });
    expect(viewportCtx).toBe(beforeRef);
  });
});

describe('EditorProvider characterization — first render, before any effect', () => {
  it('exposes a fully-formed state and callable methods synchronously on first render', () => {
    let ctx: ReturnType<typeof useEditor> | undefined;
    function TestComponent() {
      ctx = useEditor();
      return null;
    }
    render(
      <EditorProvider>
        <TestComponent />
      </EditorProvider>,
    );
    // No `await waitFor` — this asserts what's true on the very first synchronous render,
    // before React has flushed any passive effect.
    if (!ctx) throw new Error('ctx not available on first render');
    expect(ctx.state.document).toBeDefined();
    expect(Array.isArray(ctx.state.selection)).toBe(true);
    expect(typeof ctx.updateDoc).toBe('function');
    expect(typeof ctx.setTool).toBe('function');
  });
});

describe('EditorProvider characterization — async sub-context readiness (onReady)', () => {
  // MotionContext follows AGENTS.md's documented onReady pattern: `motionValue` starts as
  // `null` (useState<MotionContextValue | null>(null)) and EditorProvider substitutes a
  // `MOTION_NOOP` fallback into the merged context value until MotionProvider's own effect
  // calls `onReady` back. Consumers must never observe `undefined` for motion fields, only
  // a safe no-op before ready and the real implementation after.
  it('motion-related fields are defined (a safe no-op) before MotionProvider signals ready, and remain defined after', async () => {
    let ctx: ReturnType<typeof useEditor> | undefined;
    function TestComponent() {
      ctx = useEditor();
      return null;
    }
    render(
      <EditorProvider>
        <TestComponent />
      </EditorProvider>,
    );

    // Immediately: `playTimeline` (a MOTION_NOOP field) must be a callable no-op, not
    // undefined, even before MotionProvider's own effect has flushed.
    if (!ctx) throw new Error('ctx not available on first render');
    const playTimeline = (ctx as unknown as { playTimeline?: unknown }).playTimeline;
    expect(typeof playTimeline).toBe('function');
    expect(() => (playTimeline as () => void)()).not.toThrow();

    await waitFor(() => {
      expect(ctx).toBeDefined();
    });
    // After settling, the field is still a callable function — whether it's still the
    // MOTION_NOOP or the real MotionProvider implementation by this point isn't asserted
    // here (would require reaching into MotionContext's internal readiness signal
    // directly, out of scope for this pass) — only that consumers never see `undefined`.
    const playTimelineAfter = (ctx as unknown as { playTimeline?: unknown }).playTimeline;
    expect(typeof playTimelineAfter).toBe('function');
  });
});

describe('EditorProvider characterization — cleanup on unmount', () => {
  it('stops the auto-save service and shuts down the backup service on unmount', async () => {
    let ctx: ReturnType<typeof useEditor> | undefined;
    function TestComponent() {
      ctx = useEditor();
      return null;
    }
    const { unmount } = render(
      <EditorProvider>
        <TestComponent />
      </EditorProvider>,
    );

    await waitFor(() => expect(ctx).toBeDefined());
    await waitFor(() => expect(getBackupService()).not.toBeNull());
    const backupService = getBackupService();
    if (!backupService) throw new Error('backup service not ready');
    const shutdownSpy = vi.spyOn(backupService, 'shutdown');

    unmount();

    expect(shutdownSpy).toHaveBeenCalled();
    // The module-level backup-service getter must be cleared on unmount so a stale
    // reference from a previous EditorProvider instance is never returned to a later one.
    expect(getBackupService()).toBeNull();
  });
});

describe('EditorProvider characterization — StrictMode double-invocation', () => {
  // React.StrictMode double-invokes effects (mount → cleanup → mount) in development to
  // surface non-idempotent effects. If any of these differ from the non-StrictMode
  // behavior above, that's a real bug worth flagging separately, not fixing here.
  it('still exposes a fully-formed context under StrictMode', async () => {
    let ctx: ReturnType<typeof useEditor> | undefined;
    function TestComponent() {
      ctx = useEditor();
      return null;
    }
    render(
      <StrictMode>
        <EditorProvider>
          <TestComponent />
        </EditorProvider>
      </StrictMode>,
    );

    await waitFor(() => {
      expect(ctx).toBeDefined();
    });
    if (!ctx) throw new Error('ctx not found');
    expect(ctx.state.document).toBeDefined();
    expect(typeof ctx.updateDoc).toBe('function');
  });

  it('backup freshness still holds under StrictMode (confirms the auto-save effect is idempotent)', async () => {
    let ctx: ReturnType<typeof useEditor> | undefined;
    function TestComponent() {
      ctx = useEditor();
      return null;
    }
    render(
      <StrictMode>
        <EditorProvider>
          <TestComponent />
        </EditorProvider>
      </StrictMode>,
    );

    await waitFor(() => expect(getBackupService()).not.toBeNull());
    const backupService = getBackupService();
    if (!backupService) throw new Error('backup service not ready');
    const markDirtySpy = vi.spyOn(backupService, 'markDirty');

    await waitFor(() => expect(ctx).toBeDefined());
    const before = ctx?.state.document.nextId ?? 0;
    ctx?.updateDoc((doc) => ({ ...doc, nextId: doc.nextId + 1 }));

    await waitFor(() => expect(markDirtySpy).toHaveBeenCalled());
    const lastCall = markDirtySpy.mock.calls[markDirtySpy.mock.calls.length - 1];
    const backedUpDoc = JSON.parse(lastCall?.[1] as string) as { nextId: number };
    expect(backedUpDoc.nextId).toBe(before + 1);
  });
});
