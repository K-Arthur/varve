import { addChild, addNode, createDocument, makeFrameNode, makeShapeNode } from '@varve/scene';
import { describe, expect, it, vi } from 'vitest';
import { CanvasNudgeController } from './nudgeController';

describe('CanvasNudgeController', () => {
  it('announces selected items that were excluded from a mixed nudge', () => {
    let document = createDocument('mixed nudge announcement');
    const frame = makeFrameNode('frame', { w: 200, h: 100 });
    const child = makeShapeNode('child', {
      kind: 'rect',
      x: 10,
      y: 10,
      w: 20,
      h: 20,
    });
    document = addNode(document, frame);
    document = addChild(document, frame.id, child);

    const announceOperation = vi.fn();
    const setNodePositions = vi.fn(
      (positions: ReadonlyArray<{ id: string; x: number; y: number }>) => {
        const position = positions[0];
        if (!position) return;
        const node = document.nodes[position.id];
        if (!node) return;
        document = {
          ...document,
          nodes: {
            ...document.nodes,
            [position.id]: {
              ...node,
              transform: [
                node.transform[0],
                node.transform[1],
                node.transform[2],
                node.transform[3],
                position.x,
                position.y,
              ],
            },
          },
        };
      },
    );
    const ctx = {
      document,
      selection: [frame.id, child.id],
      setNodePosition: vi.fn(),
      setNodePositions,
      beginTransaction: vi.fn(),
      commitTransaction: vi.fn(),
      announceOperation,
    };
    const controller = new CanvasNudgeController();

    expect(controller.handleKeyDown({ key: 'ArrowRight' } as KeyboardEvent, ctx)).toBe(true);
    expect(setNodePositions).toHaveBeenCalledWith([{ id: frame.id, x: 1, y: 0 }]);
    expect(announceOperation).toHaveBeenCalledWith(
      'Nudge',
      '1px · 1 nested or non-manual selected item skipped',
    );
  });
});
