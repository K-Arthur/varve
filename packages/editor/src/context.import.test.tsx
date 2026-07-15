import { ImportService } from '@strata/import';
import { activePageNodes, createDocument, makeGroupNode, makeShapeNode } from '@strata/scene';
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
  } as unknown as DataTransfer;

  return { type: 'paste', clipboardData: dt } as ClipboardEvent;
}

function createClipboardEventWithStrataNodes(nodes: unknown[]): ClipboardEvent {
  const json = JSON.stringify({ nodes });
  const dt = {
    files: createFileList([]),
    items: [] as unknown as DataTransferItemList,
    getData: (type: string) => (type === 'application/vnd.strata+json' ? json : ''),
  } as unknown as DataTransfer;

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

describe('Editor native clipboard paste (Strata-format data)', () => {
  it('pastes a plain shape node so it is visible via activePageNodes, not just doc.nodes', async () => {
    const shape = makeShapeNode('src-1', { kind: 'rect', x: 0, y: 0, w: 10, h: 10 });
    captureClipboardEvent(createClipboardEventWithStrataNodes([shape]));

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

    // The EditorProvider's default document (createDocument('Untitled') with
    // no `flat` option) is a paged document — the normal case for every
    // real session, not an edge case.
    expect(ctx?.state.document.activePageId).toBeTruthy();

    screen.getByText('paste').click();
    await waitFor(() => expect(ctx?.state.selection).toHaveLength(1));
    const pastedId = ctx?.state.selection[0];
    expect(pastedId).toBeDefined();
    if (!ctx || !pastedId) throw new Error('Pasted node was not selected');

    expect(ctx.state.document.nodes[pastedId]).toBeDefined();
    // The actual bug: a node can exist in doc.nodes yet be unreachable from
    // the page-scoped renderer/hit-tester/marquee-selector if it only ended
    // up in doc.rootChildren instead of the active page's contentRoot.
    expect(activePageNodes(ctx.state.document)).toContain(pastedId);
  });

  it('pastes a container (group) subtree without also splicing its descendants into rootChildren', async () => {
    const child = makeShapeNode('src-child', { kind: 'rect', x: 0, y: 0, w: 10, h: 10 });
    const group = makeGroupNode('src-group', { children: ['src-child'] });
    // Matches what copySelected() now serializes: the selected node plus its
    // full descendant subtree (gatherSubtreeNodes), not just the root — a
    // paste handler that only reads the root would drop this child entirely.
    captureClipboardEvent(createClipboardEventWithStrataNodes([group, child]));

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
    await waitFor(() => expect(ctx?.state.selection).toHaveLength(1));
    const pastedGroupId = ctx?.state.selection[0];
    expect(pastedGroupId).toBeDefined();
    if (!ctx || !pastedGroupId) throw new Error('Pasted group was not selected');

    const pastedGroup = ctx.state.document.nodes[pastedGroupId];
    expect(pastedGroup?.kind).toBe('group');
    if (pastedGroup?.kind !== 'group') return;
    expect(pastedGroup.children).toHaveLength(1);
    const pastedChildId = pastedGroup.children[0];
    expect(pastedChildId).toBeDefined();
    if (!pastedChildId) throw new Error('Pasted group child was not cloned');

    // The group root must be reachable from the active page.
    expect(activePageNodes(ctx.state.document)).toContain(pastedGroupId);
    // The child belongs under the group only — it must not also be spliced
    // into doc.rootChildren as a spurious top-level sibling (which would
    // make it paint twice: once via the group, once as a stray root node).
    expect(ctx.state.document.rootChildren).not.toContain(pastedChildId);
  });
});
