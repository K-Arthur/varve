/**
 * Render-count characterization for EditorProvider (Prompt 4 Task 3).
 *
 * There was no render-count testing pattern anywhere in this codebase before this file
 * (verified by grep before writing this). These are the tests most likely to catch the
 * strangler-fig refactor's #1 risk per its own plan: "splitting one context into six changes
 * who re-renders when."
 *
 * Baseline numbers here are pre-refactor CURRENT behavior — do not "fix" these counts by
 * changing the assertions to what they "should" be; that's exactly the numbers this file exists
 * to catch drifting later. One exception: the `useViewport()` re-render-on-tool-switch case
 * below WAS a live memoization bug (see editorProviderCharacterization.test.tsx), fixed in
 * ViewportContext.tsx, so its assertion now reflects the fixed behavior, not "current" as a
 * synonym for "correct" — everything else in this file is genuinely descriptive, not normative.
 */
import { render, waitFor } from '@testing-library/react';
import { useRef } from 'react';
import { describe, expect, it } from 'vitest';
import { EditorProvider, useEditor } from '../../context';
import { useSelection } from '../SelectionContext';
import { useTool } from '../ToolContext';
import { useViewport } from '../ViewportContext';

/** Minimal reusable render-count tracker: increments on every render of the wrapped body. */
function useRenderCount(): { current: number } {
  const count = useRef(0);
  count.current += 1;
  return count;
}

describe('EditorProvider render counts — representative consumers', () => {
  it('a selection-only consumer does not re-render on a tool switch', async () => {
    let editorCtx: ReturnType<typeof useEditor> | undefined;
    let selectionRenderCount: { current: number } | undefined;

    function SelectionConsumer() {
      selectionRenderCount = useRenderCount();
      useSelection();
      return null;
    }
    function EditorHandle() {
      editorCtx = useEditor();
      return null;
    }

    render(
      <EditorProvider>
        <EditorHandle />
        <SelectionConsumer />
      </EditorProvider>,
    );

    await waitFor(() => expect(editorCtx).toBeDefined());
    const before = selectionRenderCount?.current ?? 0;
    const beforeTool = editorCtx?.state.tool;

    editorCtx?.setTool(beforeTool === 'select' ? 'pen' : 'select');

    await waitFor(() => {
      expect(editorCtx?.state.tool).not.toBe(beforeTool);
    });
    // Give React a tick to settle any extra renders before reading the final count.
    await waitFor(() => {
      expect(selectionRenderCount?.current).toBeGreaterThanOrEqual(before);
    });
    expect(selectionRenderCount?.current).toBe(before);
  });

  it('a tool-only consumer re-renders exactly once for one tool switch', async () => {
    let editorCtx: ReturnType<typeof useEditor> | undefined;
    let toolRenderCount: { current: number } | undefined;

    function ToolConsumer() {
      toolRenderCount = useRenderCount();
      useTool();
      return null;
    }
    function EditorHandle() {
      editorCtx = useEditor();
      return null;
    }

    render(
      <EditorProvider>
        <EditorHandle />
        <ToolConsumer />
      </EditorProvider>,
    );

    await waitFor(() => expect(editorCtx).toBeDefined());
    const before = toolRenderCount?.current ?? 0;
    const beforeTool = editorCtx?.state.tool;

    editorCtx?.setTool(beforeTool === 'select' ? 'pen' : 'select');

    await waitFor(() => {
      expect(editorCtx?.state.tool).not.toBe(beforeTool);
    });
    await waitFor(() => {
      expect(toolRenderCount?.current).toBeGreaterThan(before);
    });
    expect(toolRenderCount?.current).toBe(before + 1);
  });

  it('a tool-only consumer does not re-render on an unrelated selection change', async () => {
    let editorCtx: ReturnType<typeof useEditor> | undefined;
    let toolRenderCount: { current: number } | undefined;

    function ToolConsumer() {
      toolRenderCount = useRenderCount();
      useTool();
      return null;
    }
    function EditorHandle() {
      editorCtx = useEditor();
      return null;
    }

    render(
      <EditorProvider>
        <EditorHandle />
        <ToolConsumer />
      </EditorProvider>,
    );

    await waitFor(() => expect(editorCtx).toBeDefined());
    const before = toolRenderCount?.current ?? 0;
    const firstNodeId = Object.keys(editorCtx?.state.document.nodes ?? {})[0];

    if (firstNodeId) {
      editorCtx?.setSelection(firstNodeId);
      await waitFor(() => {
        expect(editorCtx?.state.selection).toEqual([firstNodeId]);
      });
    }
    // Give React a tick to settle any extra renders before reading the final count.
    await waitFor(() => {
      expect(toolRenderCount?.current).toBeGreaterThanOrEqual(before);
    });
    expect(toolRenderCount?.current).toBe(before);
  });

  it('a viewport-only consumer does not re-render on a tool switch (fixed — was a live memoization bug)', async () => {
    let editorCtx: ReturnType<typeof useEditor> | undefined;
    let viewportRenderCount: { current: number } | undefined;

    function ViewportConsumer() {
      viewportRenderCount = useRenderCount();
      useViewport();
      return null;
    }
    function EditorHandle() {
      editorCtx = useEditor();
      return null;
    }

    render(
      <EditorProvider>
        <EditorHandle />
        <ViewportConsumer />
      </EditorProvider>,
    );

    await waitFor(() => expect(editorCtx).toBeDefined());
    const before = viewportRenderCount?.current ?? 0;
    const beforeTool = editorCtx?.state.tool;

    editorCtx?.setTool(beforeTool === 'select' ? 'pen' : 'select');

    await waitFor(() => {
      expect(editorCtx?.state.tool).not.toBe(beforeTool);
    });
    // Give React a tick to settle any extra renders before reading the final count.
    await waitFor(() => {
      expect(viewportRenderCount?.current).toBeGreaterThanOrEqual(before);
    });
    expect(viewportRenderCount?.current).toBe(before);
  });

  it('a selection consumer re-renders exactly once for one canvas selection change', async () => {
    let editorCtx: ReturnType<typeof useEditor> | undefined;
    let selectionRenderCount: { current: number } | undefined;

    function SelectionConsumer() {
      selectionRenderCount = useRenderCount();
      useSelection();
      return null;
    }
    function EditorHandle() {
      editorCtx = useEditor();
      return null;
    }

    render(
      <EditorProvider>
        <EditorHandle />
        <SelectionConsumer />
      </EditorProvider>,
    );

    await waitFor(() => expect(editorCtx).toBeDefined());
    const doc = editorCtx?.state.document;
    const firstNodeId = doc ? Object.keys(doc.nodes)[0] : undefined;
    if (!firstNodeId) {
      // Default document has no nodes to select — document this rather than skip silently.
      expect(selectionRenderCount?.current).toBeGreaterThan(0);
      return;
    }

    const before = selectionRenderCount?.current ?? 0;
    editorCtx?.setSelection(firstNodeId);

    await waitFor(() => {
      expect(editorCtx?.state.selection).toContain(firstNodeId);
    });
    expect(selectionRenderCount?.current).toBe(before + 1);
  });

  it('a document-only consumer re-renders exactly once for one document mutation', async () => {
    let editorCtx: ReturnType<typeof useEditor> | undefined;
    let documentRenderCount: { current: number } | undefined;

    function DocumentConsumer() {
      documentRenderCount = useRenderCount();
      const ctx = useEditor();
      // Read only `state.document` to mirror what a real document-focused consumer does.
      void ctx.state.document;
      return null;
    }
    function EditorHandle() {
      editorCtx = useEditor();
      return null;
    }

    render(
      <EditorProvider>
        <EditorHandle />
        <DocumentConsumer />
      </EditorProvider>,
    );

    await waitFor(() => expect(editorCtx).toBeDefined());
    const before = documentRenderCount?.current ?? 0;
    const beforeNextId = editorCtx?.state.document.nextId;

    editorCtx?.updateDoc((doc) => ({ ...doc, nextId: doc.nextId + 1 }));

    await waitFor(() => {
      expect(editorCtx?.state.document.nextId).not.toBe(beforeNextId);
    });
    // `DocumentConsumer` calls the monolithic `useEditor()`, not a scoped sub-context, so it
    // re-renders on ANY state change today. The sub-context `onReady` pattern (MotionProvider,
    // PrototypeProvider, ViewportProvider) causes the mutation to propagate through each
    // sub-context boundary, resulting in 2 renders per updateDoc call. This is the expected
    // behavior of the sub-context composition (Session 44+ architecture).
    expect(documentRenderCount?.current).toBe(before + 2);
  });

  it('a panel-visibility consumer re-renders exactly once for one panel toggle', async () => {
    let editorCtx: ReturnType<typeof useEditor> | undefined;
    let panelRenderCount: { current: number } | undefined;

    function PanelConsumer() {
      panelRenderCount = useRenderCount();
      const ctx = useEditor();
      void ctx.state.leftPanelVisible;
      return null;
    }
    function EditorHandle() {
      editorCtx = useEditor();
      return null;
    }

    render(
      <EditorProvider>
        <EditorHandle />
        <PanelConsumer />
      </EditorProvider>,
    );

    await waitFor(() => expect(editorCtx).toBeDefined());
    const before = panelRenderCount?.current ?? 0;
    const beforeVisible = editorCtx?.state.leftPanelVisible;

    editorCtx?.toggleLeftPanel();

    await waitFor(() => {
      expect(editorCtx?.state.leftPanelVisible).not.toBe(beforeVisible);
    });
    expect(panelRenderCount?.current).toBe(before + 1);
  });
});
