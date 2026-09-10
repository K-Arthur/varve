import { act, render, waitFor } from '@testing-library/react';
import React from 'react';
import { describe, expect, it } from 'vitest';
import { EditorProvider, useEditor } from '../context';

/**
 * Product decision (docs/architecture/workspace-system.md):
 * the workspace mode is GLOBAL to the application, not remembered per
 * document. Switching tabs must therefore never change the workspace, and
 * switching workspaces must never change the active tab. This test locks
 * the invariant in so a future per-document-mode change has to be a
 * deliberate product decision, not an accident of state plumbing.
 */
function Harness({ onReady }: { onReady: (ctx: ReturnType<typeof useEditor>) => void }) {
  const ctx = useEditor();
  React.useEffect(() => {
    onReady(ctx);
  });
  return null;
}

describe('workspace mode is application-global', () => {
  it('switchTab preserves the active workspace mode', async () => {
    let ctx: ReturnType<typeof useEditor> | undefined;
    render(
      <EditorProvider>
        <Harness
          onReady={(c) => {
            ctx = c;
          }}
        />
      </EditorProvider>,
    );
    await waitFor(() => expect(ctx).toBeDefined());

    // Open a second document so there is something to switch between.
    ctx?.newTab();
    await act(async () => {
      await Promise.resolve();
    });
    expect(ctx?.state.sessions).toHaveLength(2);

    await act(async () => {
      await ctx?.requestWorkspaceSwitch('print');
    });
    expect(ctx?.state.workspaceMode).toBe('print');

    const firstId = ctx?.state.sessions[0]?.id;
    if (!firstId) throw new Error('expected a first session');
    await act(async () => {
      ctx?.switchTab(firstId);
    });

    // The document switched, the workspace did not.
    expect(ctx?.state.activeId).toBe(firstId);
    expect(ctx?.state.workspaceMode).toBe('print');
  });

  it('workspace switch preserves the active document', async () => {
    let ctx: ReturnType<typeof useEditor> | undefined;
    render(
      <EditorProvider>
        <Harness
          onReady={(c) => {
            ctx = c;
          }}
        />
      </EditorProvider>,
    );
    await waitFor(() => expect(ctx).toBeDefined());
    const initialId = ctx?.state.activeId;

    await act(async () => {
      await ctx?.requestWorkspaceSwitch('motion');
    });
    expect(ctx?.state.workspaceMode).toBe('motion');
    expect(ctx?.state.activeId).toBe(initialId);
  });
});
