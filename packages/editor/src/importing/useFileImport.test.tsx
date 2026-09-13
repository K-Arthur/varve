// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { type ImportReport, ImportService } from '@varve/import';
import { addNode, createDocument, makeFrameNode, makeShapeNode } from '@varve/scene';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FileImportEditor } from './useFileImport';
import { useFileImport } from './useFileImport';

function reportFor(name: string): ImportReport {
  let document = createDocument(`${name} source`, true);
  const node = makeShapeNode(`${name}-root`, {
    kind: 'rect',
    x: 0,
    y: 0,
    w: 10,
    h: 10,
  });
  document = addNode(document, node);
  return {
    startedAt: 0,
    completedAt: 1,
    durationMs: 1,
    totalFiles: 1,
    successCount: 1,
    partialCount: 0,
    failureCount: 0,
    unsupportedCount: 0,
    files: [
      {
        name,
        source: 'file-picker',
        format: 'svg',
        status: 'success',
        byteCount: 10,
        durationMs: 1,
        nodeCount: 1,
        artifacts: [{ kind: 'document-fragment', document, nodeIds: [node.id] }],
        warnings: [],
        unsupportedFeatures: [],
      },
    ],
    warnings: [],
  };
}

function editorFixture(): FileImportEditor {
  const document = createDocument('destination');
  return {
    state: {
      document,
      activeId: 'session',
      revision: 0,
      selectionRevision: 0,
      selection: [],
      workspaceMode: 'print',
      zoom: 1,
      pan: { x: 0, y: 0 },
      cameraRotation: 0,
    },
    canvasToWorld: vi.fn((x: number, y: number) => ({ x, y })),
    announce: vi.fn(),
    addLutAdjustment: vi.fn(),
    batchImportNodes: vi.fn(),
    commitPreparedFragment: vi.fn(() => ['committed-root']),
  };
}

describe('useFileImport operation ownership', () => {
  afterEach(() => vi.restoreAllMocks());

  it('captures the picker destination before the browser file dialog opens', async () => {
    vi.spyOn(ImportService, 'importFiles').mockResolvedValue(reportFor('picked.svg'));
    const editor = editorFixture();
    const frame = makeFrameNode('destination-frame', {
      name: 'Destination',
      transform: [1, 0, 0, 1, 300, 200],
      w: 100,
      h: 80,
      children: [],
    });
    editor.state.document = addNode(editor.state.document, frame);
    editor.state.selection = [frame.id];

    const { result } = renderHook(() => useFileImport(editor));
    const click = vi.fn();
    result.current.inputRef.current = { click } as unknown as HTMLInputElement;

    act(() => result.current.openPicker());
    expect(click).toHaveBeenCalledTimes(1);

    // Camera changes while the native picker is open must not change the
    // placement captured by the initiating gesture.
    editor.state.pan = { x: 900, y: -400 };
    editor.state.zoom = 4;
    const event = {
      target: {
        files: [new File(['picked'], 'picked.svg', { type: 'image/svg+xml' })],
        value: '',
      },
    } as unknown as React.ChangeEvent<HTMLInputElement>;

    await act(async () => {
      await result.current.onFilesSelected(event);
    });

    expect(editor.commitPreparedFragment).toHaveBeenCalledWith(
      expect.objectContaining({
        targetParentId: frame.id,
        center: { x: 350, y: 240 },
      }),
    );
  });

  it('lets a newer picker gesture commit while an older decode settles late', async () => {
    const pending: Array<{
      resolve: (report: ImportReport) => void;
      signal?: AbortSignal;
    }> = [];
    const importSpy = vi
      .spyOn(ImportService, 'importFiles')
      .mockImplementation(
        (_inputs, _options, signal) =>
          new Promise<ImportReport>((resolve) => pending.push({ resolve, signal })),
      );
    const editor = editorFixture();
    const { result } = renderHook(() => useFileImport(editor));
    const firstEvent = {
      target: {
        files: [new File(['first'], 'first.svg', { type: 'image/svg+xml' })],
        value: '',
      },
    } as unknown as React.ChangeEvent<HTMLInputElement>;
    const secondEvent = {
      target: {
        files: [new File(['second'], 'second.svg', { type: 'image/svg+xml' })],
        value: '',
      },
    } as unknown as React.ChangeEvent<HTMLInputElement>;

    let firstRun!: Promise<void>;
    act(() => {
      firstRun = result.current.onFilesSelected(firstEvent);
    });
    await waitFor(() => expect(importSpy).toHaveBeenCalledTimes(1));

    let secondRun!: Promise<void>;
    act(() => {
      secondRun = result.current.onFilesSelected(secondEvent);
    });
    await waitFor(() => expect(importSpy).toHaveBeenCalledTimes(2));
    expect(pending[0]?.signal?.aborted).toBe(true);

    await act(async () => {
      pending[1]!.resolve(reportFor('second.svg'));
      await secondRun;
    });
    await act(async () => {
      pending[0]!.resolve(reportFor('first.svg'));
      await firstRun;
    });

    expect(editor.commitPreparedFragment).toHaveBeenCalledTimes(1);
    expect(editor.announce).toHaveBeenCalledWith('Imported 1 file; 0 failed');
  });
});
