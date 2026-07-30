import { act, render, waitFor } from '@testing-library/react';
import React from 'react';
import { describe, expect, it } from 'vitest';
import { EditorProvider, useEditor } from '../context';

/**
 * The host hands the same open request to the provider twice: once as
 * `initialDocumentJson`, which becomes the bootstrap session, and once via
 * `openFile`. The bootstrap session used to carry no file identity, so
 * `openFile`'s dedupe — which matches on file id or path — could not recognise
 * it and opened the same document a second time, leaving two tabs on one file.
 */
function docJson(name: string) {
  return JSON.stringify({
    schemaVersion: 1,
    id: 'doc-1',
    name,
    nodes: {},
    rootChildren: [],
  });
}

function Harness({ onReady }: { onReady: (ctx: ReturnType<typeof useEditor>) => void }) {
  const ctx = useEditor();
  React.useEffect(() => {
    onReady(ctx);
  });
  return null;
}

describe('opening the bootstrapped file again', () => {
  it('reuses the bootstrap session instead of adding a second tab', async () => {
    let ctx: ReturnType<typeof useEditor> | undefined;
    render(
      <EditorProvider
        initialDocumentJson={docJson('DesignFile1')}
        initialDocumentName="DesignFile1"
        initialFileId="file-1"
      >
        <Harness
          onReady={(c) => {
            ctx = c;
          }}
        />
      </EditorProvider>,
    );

    await waitFor(() => expect(ctx).toBeDefined());
    expect(ctx?.state.sessions).toHaveLength(1);

    // The host's openFile dispatch for the very file already bootstrapped.
    ctx?.openFile('file-1', 'DesignFile1', undefined, docJson('DesignFile1'));
    // Settle the state update before asserting — a waitFor on the count can
    // observe the pre-update value and pass while a duplicate is being added.
    await act(async () => {
      await Promise.resolve();
    });

    expect(ctx?.state.sessions.map((s) => s.name)).toEqual(['DesignFile1']);
    expect(ctx?.state.sessions[0]?.fileId).toBe('file-1');
  });

  it('still opens a genuinely different file in its own tab', async () => {
    let ctx: ReturnType<typeof useEditor> | undefined;
    render(
      <EditorProvider
        initialDocumentJson={docJson('DesignFile1')}
        initialDocumentName="DesignFile1"
        initialFileId="file-1"
      >
        <Harness
          onReady={(c) => {
            ctx = c;
          }}
        />
      </EditorProvider>,
    );
    await waitFor(() => expect(ctx).toBeDefined());

    ctx?.openFile('file-2', 'Other', undefined, docJson('Other'));
    await act(async () => {
      await Promise.resolve();
    });

    expect(ctx?.state.sessions).toHaveLength(2);
  });
});
