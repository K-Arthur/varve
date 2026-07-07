import { ImportService } from '@strata/import';
import { createDocument, makeGroupNode, makeShapeNode } from '@strata/scene';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { captureClipboardEvent } from './clipboard';
import { EditorProvider, useEditor } from './context';

if (typeof Blob !== 'undefined') {
  if (!Blob.prototype.arrayBuffer) {
    Blob.prototype.arrayBuffer = async function () {
      const reader = new FileReader();
      return new Promise<ArrayBuffer>((resolve, reject) => {
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(this);
      });
    };
  }
  if (!Blob.prototype.text) {
    Blob.prototype.text = async function () {
      const buffer = await this.arrayBuffer();
      return new TextDecoder().decode(buffer);
    };
  }
}

function createFileList(files: File[]): FileList {
  return {
    ...files,
    length: files.length,
    item: (index: number) => files[index] ?? null,
    [Symbol.iterator](): Iterator<File> {
      let i = 0;
      return {
        next: (): IteratorResult<File> => {
          if (i >= files.length) return { done: true, value: undefined as unknown as File };
          const file = files[i];
          i += 1;
          if (!file) return { done: true, value: undefined as unknown as File };
          return { done: false, value: file };
        },
      };
    },
  } as unknown as FileList;
}

function createClipboardEventWithFiles(files: File[]): ClipboardEvent {
  const dt = {
    files: createFileList(files),
    items: files.map((file) => ({
      kind: 'file',
      type: file.type,
      getAsFile: () => file,
    })) as unknown as DataTransferItemList,
    getData: () => '',
  } as DataTransfer;

  return { type: 'paste', clipboardData: dt } as ClipboardEvent;
}

describe('Editor import insertion', () => {
  it('deep-clones imported container subtrees into editor state', async () => {
    const child = makeShapeNode('s1', { kind: 'rect', x: 0, y: 0, w: 10, h: 10 });
    const group = makeGroupNode('g1', { children: ['s1'] });
    const sourceDoc = {
      ...createDocument('Imported', true),
      rootChildren: ['g1'],
      nodes: { g1: group, s1: child },
      nextId: 2,
    };

    let ctx: ReturnType<typeof useEditor> | undefined;
    function Test() {
      ctx = useEditor();
      return (
        <button
          type="button"
          onClick={() => ctx?.importNode(group, sourceDoc, { position: { x: 10, y: 20 } })}
        >
          import group
        </button>
      );
    }

    render(
      <EditorProvider>
        <Test />
      </EditorProvider>,
    );

    screen.getByText('import group').click();

    await waitFor(() => expect(ctx?.state.selection).toHaveLength(1));
    const importedId = ctx?.state.selection[0];
    expect(importedId).toBeDefined();
    if (!ctx || !importedId) throw new Error('Imported node was not selected');
    const imported = ctx.state.document.nodes[importedId];
    expect(imported?.kind).toBe('group');
    if (imported?.kind !== 'group') return;
    expect(imported.children).toHaveLength(1);
    expect(imported.children[0]).not.toBe('s1');
    const childId = imported.children[0];
    expect(childId).toBeDefined();
    if (!childId) throw new Error('Imported group child was not cloned');
    expect(ctx.state.document.nodes[childId]).toBeDefined();
  });

  it('routes clipboard file imports through ImportService', async () => {
    const spy = vi.spyOn(ImportService, 'importFiles');
    const file = new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], 'clipboard.png', {
      type: 'image/png',
    });
    captureClipboardEvent(createClipboardEventWithFiles([file]));

    let ctx: ReturnType<typeof useEditor> | undefined;
    function Test() {
      ctx = useEditor();
      return (
        <button type="button" onClick={() => ctx?.paste()}>
          paste
        </button>
      );
    }

    render(
      <EditorProvider>
        <Test />
      </EditorProvider>,
    );

    screen.getByText('paste').click();

    await waitFor(() => expect(spy).toHaveBeenCalled());
    const firstCall = spy.mock.calls[0];
    expect(firstCall).toBeDefined();
    if (!firstCall) throw new Error('ImportService was not called');
    const [inputs, options] = firstCall;
    expect(inputs[0]).toMatchObject({ name: 'clipboard.png', source: 'clipboard' });
    expect(options).toMatchObject({ center: true, embedImages: true });
    await waitFor(() => expect(ctx?.state.selection).toHaveLength(1));
    spy.mockRestore();
  });
});
