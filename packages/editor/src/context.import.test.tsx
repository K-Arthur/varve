import { render, screen, waitFor } from '@testing-library/react';
import { ImportService } from '@varve/import';
import {
  activePageNodes,
  addChild,
  createDocument,
  DocumentCodec,
  getParent,
  imageFill,
  isImageShape,
  makeGroupNode,
  makeShapeNode,
} from '@varve/scene';
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

/**
 * Structurally complete 1×1 RGBA PNG (signature + IHDR + IDAT + IEND with
 * valid CRCs). The bare 8-byte PNG signature is rejected by the hardened
 * content probe in @varve/import (rasterInspection), so clipboard tests
 * that reach ImportService must feed a decodable container.
 */
function realPngBytes(): Uint8Array {
  const crc32 = (data: Uint8Array, seed = 0xffffffff): number => {
    let crc = seed;
    for (let i = 0; i < data.length; i++) {
      crc ^= data[i]!;
      for (let k = 0; k < 8; k++) {
        crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
      }
    }
    return (crc ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Uint8Array): Uint8Array => {
    const out = new Uint8Array(12 + data.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, data.length, false);
    out.set(new TextEncoder().encode(type), 4);
    out.set(data, 8);
    view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)), false);
    return out;
  };
  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, 1, false);
  ihdrView.setUint32(4, 1, false);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const idat = new Uint8Array([
    0x78, 0x9c, 0x63, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01,
  ]);
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const concat = (...parts: Uint8Array[]): Uint8Array => {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let offset = 0;
    for (const part of parts) {
      out.set(part, offset);
      offset += part.length;
    }
    return out;
  };
  return concat(signature, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', new Uint8Array(0)));
}

function createClipboardEventWithFiles(files: File[]): ClipboardEvent {  const dt = {
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

function createClipboardEventWithVarveNodes(nodes: unknown[]): ClipboardEvent {
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
    const file = new File([realPngBytes()], 'clipboard.png', {
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

  it('atomically imports dropped images into a compatible clipping target', async () => {
    let initial = createDocument('Mask target');
    const page = initial.pages?.[0];
    if (!page) throw new Error('Expected initial page');
    initial = addChild(
      initial,
      page.contentRoot,
      makeGroupNode('nested-parent', { transform: [1, 0, 0, 1, 200, 100] }),
    );
    initial = addChild(
      initial,
      'nested-parent',
      makeShapeNode('mask-target', { kind: 'circle', cx: 50, cy: 50, r: 50 }),
    );

    const image = makeShapeNode('image', { kind: 'rect', x: 0, y: 0, w: 100, h: 100 });
    image.fills = [imageFill('data:image/png;base64,AA==')];
    const sourceDoc = {
      ...createDocument('Dropped image', true),
      nodes: { image },
      rootChildren: ['image'],
    };

    let ctx: ReturnType<typeof useEditor> | undefined;
    function Test() {
      ctx = useEditor();
      return (
        <button
          type="button"
          onClick={() =>
            ctx?.batchImportNodes([{ node: image, sourceDoc, position: { x: 250, y: 150 } }], {
              maskTargetId: 'mask-target',
            })
          }
        >
          mask imported image
        </button>
      );
    }

    render(
      <EditorProvider initialDocumentJson={DocumentCodec.encode(initial)}>
        <Test />
      </EditorProvider>,
    );
    screen.getByText('mask imported image').click();

    await waitFor(() => {
      const selectedId = ctx?.state.selection[0];
      expect(selectedId ? ctx?.state.document.nodes[selectedId]?.kind : undefined).toBe('group');
    });
    const groupId = ctx?.state.selection[0];
    if (!ctx || !groupId) throw new Error('Expected clipping group selection');
    const group = ctx.state.document.nodes[groupId];
    expect(group?.kind).toBe('group');
    expect(group?.mask?.sourceNodeId).toBe('mask-target');
    if (group?.kind !== 'group') return;
    expect(getParent(ctx.state.document, groupId)).toBe('nested-parent');
    expect(group.children).toContain('mask-target');
    expect(group.children.some((id) => isImageShape(ctx!.state.document.nodes[id]!))).toBe(true);
  });
});

describe('Editor file open — camera fits content far from world origin', () => {
  it('openFile() frames content instead of defaulting to zoom:1/pan:(0,0)', async () => {
    // Mirrors the reported bug: a document whose only content sits at
    // world x≈69192 (a pasted image, matching a real user's file) opened
    // with the camera still at its (0,0)/100% default — the layers panel
    // showed the nodes correctly, but the canvas was entirely blank because
    // nothing pointed the camera at where the content actually lives.
    let doc = createDocument('Far');
    const page = doc.pages?.[0];
    if (!page) throw new Error('createDocument did not produce a page');
    const shape = makeShapeNode(
      'far-shape',
      { kind: 'rect', x: 0, y: 0, w: 100, h: 80 },
      { transform: [1, 0, 0, 1, 69192, 2048] },
    );
    doc = addChild(doc, page.contentRoot, shape);
    const json = DocumentCodec.encode(doc);

    let ctx: ReturnType<typeof useEditor> | undefined;
    function Test() {
      ctx = useEditor();
      return (
        <button type="button" onClick={() => ctx?.openFile('file-1', 'Far', undefined, json)}>
          open
        </button>
      );
    }

    render(
      <EditorProvider>
        <Test />
      </EditorProvider>,
    );

    screen.getByText('open').click();
    await waitFor(() => expect(ctx?.state.document.nodes['far-shape']).toBeDefined());
    if (!ctx) throw new Error('editor context unavailable');

    const { zoom, pan } = ctx.state;
    // The shape's world center (69242, 2088) must land inside the viewport
    // after the fit — screen = world*zoom + pan, using the same simple
    // mapping the camera itself resolves to at zero rotation.
    const screenX = 69242 * zoom + pan.x;
    const screenY = 2088 * zoom + pan.y;
    // Generous viewport bound (jsdom's window is 1024x768 by default) — the
    // point is that it's framed at all, not exact pixel placement.
    expect(screenX).toBeGreaterThan(-500);
    expect(screenX).toBeLessThan(2000);
    expect(screenY).toBeGreaterThan(-500);
    expect(screenY).toBeLessThan(2000);
    // The old bug's exact signature: zoom stuck at 1 and pan stuck at
    // (0,0) regardless of content — assert we actually moved.
    expect(pan.x !== 0 || pan.y !== 0 || zoom !== 1).toBe(true);
  });
});

describe('Editor native clipboard paste (Varve-format data)', () => {
  it('pastes a plain shape node so it is visible via activePageNodes, not just doc.nodes', async () => {
    const shape = makeShapeNode('src-1', { kind: 'rect', x: 0, y: 0, w: 10, h: 10 });
    captureClipboardEvent(createClipboardEventWithVarveNodes([shape]));

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
    captureClipboardEvent(createClipboardEventWithVarveNodes([group, child]));

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
