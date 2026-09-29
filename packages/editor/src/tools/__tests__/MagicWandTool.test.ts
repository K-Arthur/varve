import { addNode, createDocument, makeImageShapeNode } from '@varve/scene';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MagicWandTool } from '../MagicWandTool';
import { DEFAULT_MAGIC_WAND_SETTINGS } from '../magicWandSettings';
import type { DecodedMaskPixels } from '../selectionMask';
import type { ToolContext } from '../types';

const { decode } = vi.hoisted(() => ({ decode: vi.fn() }));

vi.mock('../selectionMask', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../selectionMask')>();
  return { ...actual, decodeRasterMaskDataUrl: decode };
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function decodedPixels(): DecodedMaskPixels {
  return {
    width: 2,
    height: 2,
    data: new Uint8ClampedArray([
      220, 40, 30, 255, 220, 40, 30, 255, 220, 40, 30, 255, 220, 40, 30, 255,
    ]),
  };
}

function imageNode(id: string, src: string) {
  return makeImageShapeNode(id, { src, w: 2, h: 2, imageFit: 'stretch' });
}

function makeContext(nodes: ReturnType<typeof imageNode>[]) {
  let document = createDocument('magic-wand-test');
  for (const node of nodes) document = addNode(document, node);
  let hit = document.nodes[nodes[0]!.id] as ReturnType<typeof imageNode>;
  const setAreaSelection = vi.fn();
  const announce = vi.fn();
  const ctx = {
    document,
    selection: [],
    canvasToWorld: vi.fn((x: number, y: number) => ({ x, y })),
    hitTest: vi.fn(() => ({ nodeId: hit.id, node: hit })),
    getNode: vi.fn((id: string) => document.nodes[id]),
    getWorldTransform: vi.fn(() => [1, 0, 0, 1, 0, 0] as const),
    magicWandSettings: { ...DEFAULT_MAGIC_WAND_SETTINGS },
    areaSelection: null,
    setAreaSelection,
    announce,
  } as unknown as ToolContext;
  return {
    ctx,
    setHit: (node: ReturnType<typeof imageNode>) => {
      hit = node;
    },
    replaceNode: (node: ReturnType<typeof imageNode>) => {
      document = { ...document, nodes: { ...document.nodes, [node.id]: node } };
    },
    setAreaSelection,
    announce,
  };
}

function pointerDown(tool: MagicWandTool, ctx: ToolContext) {
  return tool.onPointerDown(
    {
      clientX: 1,
      clientY: 1,
      shiftKey: false,
      altKey: false,
      pointerId: 1,
      pointerType: 'mouse',
    } as PointerEvent,
    ctx,
  );
}

describe('MagicWandTool async image selection', () => {
  beforeEach(() => decode.mockReset());

  it('discards an earlier decode when a later click finishes first', async () => {
    const first = deferred<DecodedMaskPixels | null>();
    const second = deferred<DecodedMaskPixels | null>();
    decode.mockImplementation((src: string) => {
      if (src?.endsWith('first')) return first.promise;
      if (src?.endsWith('second')) return second.promise;
      return Promise.resolve(decodedPixels());
    });
    const firstNode = imageNode('first', 'data:image/png;base64,first');
    const secondNode = imageNode('second', 'data:image/png;base64,second');
    const state = makeContext([firstNode, secondNode]);
    const tool = new MagicWandTool();

    pointerDown(tool, state.ctx);
    state.setHit(state.ctx.getNode(secondNode.id) as ReturnType<typeof imageNode>);
    pointerDown(tool, state.ctx);
    second.resolve(decodedPixels());
    await Promise.resolve();
    await Promise.resolve();
    first.resolve(decodedPixels());
    await Promise.resolve();
    await Promise.resolve();

    expect(state.announce).not.toHaveBeenCalledWith(
      'The image changed before Magic Wand could finish; click it again',
    );
    expect(state.setAreaSelection).toHaveBeenCalledTimes(1);
  });

  it('discards a pending decode when the tool is deactivated', async () => {
    const pending = deferred<DecodedMaskPixels | null>();
    decode.mockReturnValue(pending.promise);
    const state = makeContext([imageNode('image', 'data:image/png;base64,image')]);
    const tool = new MagicWandTool();

    pointerDown(tool, state.ctx);
    tool.onDeactivate();
    pending.resolve(decodedPixels());
    await Promise.resolve();

    expect(state.setAreaSelection).not.toHaveBeenCalled();
  });

  it('rejects a result if the source node changed while decoding', async () => {
    const pending = deferred<DecodedMaskPixels | null>();
    decode.mockReturnValue(pending.promise);
    const original = imageNode('image', 'data:image/png;base64,image');
    const state = makeContext([original]);
    const tool = new MagicWandTool();

    pointerDown(tool, state.ctx);
    state.replaceNode({ ...original, name: 'Replaced image' });
    pending.resolve(decodedPixels());
    await Promise.resolve();

    expect(state.setAreaSelection).not.toHaveBeenCalled();
    expect(state.announce).toHaveBeenCalledWith(
      'The image changed before Magic Wand could finish; click it again',
    );
  });
});
