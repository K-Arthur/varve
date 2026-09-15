import { addNode, createDocument, makeShapeNode } from '@varve/scene';
import { describe, expect, it, vi } from 'vitest';
import { RefineMaskTool } from '../RefineMaskTool';
import { SelectTool } from '../SelectTool';
import { ToolManager } from '../ToolManager';
import type { ToolContext } from '../types';

describe('ToolManager.getTool', () => {
  it('returns undefined for a never-activated tool id', () => {
    const tm = new ToolManager('select');
    tm.register('select', () => new SelectTool());
    tm.register('refineMask', () => new RefineMaskTool());
    expect(tm.getTool('refineMask')).toBeUndefined();
  });

  it('returns the same cached instance after setTool activates it', () => {
    const tm = new ToolManager('select');
    tm.register('select', () => new SelectTool());
    tm.register('refineMask', () => new RefineMaskTool());
    tm.setTool('refineMask');
    const first = tm.getTool<RefineMaskTool>('refineMask');
    const second = tm.getTool<RefineMaskTool>('refineMask');
    expect(first).toBeDefined();
    expect(first).toBe(second);
  });

  it('forwards focus loss to the active tool', () => {
    const onFocusLoss = vi.fn();
    const tm = new ToolManager('select');
    tm.register('select', () => ({
      id: 'select',
      cursor: () => ({ css: 'default' }),
      onFocusLoss,
    }));
    const ctx = {} as ToolContext;

    tm.handleFocusLoss(ctx);

    expect(onFocusLoss).toHaveBeenCalledWith(ctx);
  });
});

describe('ToolManager generic canvas nudge fallback', () => {
  it('routes SelectTool arrows through the same controller and lets Escape finish first', () => {
    let document = addNode(
      createDocument('select nudge'),
      makeShapeNode('shape', { kind: 'rect', x: 0, y: 0, w: 20, h: 20 }),
    );
    const ctx = {
      document,
      selection: ['shape'],
      setSelection: vi.fn(),
      setNodePosition: vi.fn(),
      setNodePositions: vi.fn((positions: ReadonlyArray<{ id: string; x: number; y: number }>) => {
        document = {
          ...document,
          nodes: {
            ...document.nodes,
            shape: {
              ...document.nodes.shape!,
              transform: [1, 0, 0, 1, positions[0]!.x, positions[0]!.y],
            },
          },
        };
        ctx.document = document;
      }),
      beginTransaction: vi.fn(),
      commitTransaction: vi.fn(),
      announceOperation: vi.fn(),
    } as unknown as ToolContext;
    const tm = new ToolManager('select');
    tm.register('select', () => new SelectTool());

    expect(tm.handleKeyDown(new KeyboardEvent('keydown', { key: 'ArrowRight' }), ctx)).toBe(true);
    expect(ctx.setNodePositions).toHaveBeenCalledWith([{ id: 'shape', x: 1, y: 0 }]);
    expect(tm.handleKeyDown(new KeyboardEvent('keydown', { key: 'Escape' }), ctx)).toBe(true);
    expect(ctx.commitTransaction).toHaveBeenCalledOnce();
    expect(ctx.setSelection).not.toHaveBeenCalled();
  });

  it('closes the old transaction before a held repeat addresses a changed selection', () => {
    let document = createDocument('nudge session boundary');
    document = addNode(
      document,
      makeShapeNode('first', { kind: 'rect', x: 0, y: 0, w: 20, h: 20 }),
    );
    document = addNode(
      document,
      makeShapeNode('second', { kind: 'rect', x: 50, y: 0, w: 20, h: 20 }),
    );
    const ctx = {
      document,
      selection: ['first'],
      setNodePosition: vi.fn(),
      setNodePositions: vi.fn((positions: ReadonlyArray<{ id: string; x: number; y: number }>) => {
        const nodes = { ...document.nodes };
        for (const position of positions) {
          const current = nodes[position.id];
          if (!current) continue;
          nodes[position.id] = {
            ...current,
            transform: [1, 0, 0, 1, position.x, position.y],
          };
        }
        document = { ...document, nodes };
        ctx.document = document;
      }),
      beginTransaction: vi.fn(),
      commitTransaction: vi.fn(),
      announceOperation: vi.fn(),
    } as unknown as ToolContext;
    const tm = new ToolManager('frame');
    tm.register('frame', () => ({ id: 'frame', cursor: () => ({ css: 'crosshair' }) }));

    tm.handleKeyDown(new KeyboardEvent('keydown', { key: 'ArrowRight' }), ctx);
    ctx.selection = ['second'];
    tm.handleKeyDown(new KeyboardEvent('keydown', { key: 'ArrowRight', repeat: true }), ctx);
    tm.handleKeyUp(new KeyboardEvent('keyup', { key: 'ArrowRight' }), ctx);

    expect(ctx.beginTransaction).toHaveBeenCalledTimes(2);
    expect(ctx.commitTransaction).toHaveBeenCalledTimes(2);
    expect(ctx.setNodePositions).toHaveBeenNthCalledWith(1, [{ id: 'first', x: 1, y: 0 }]);
    expect(ctx.setNodePositions).toHaveBeenNthCalledWith(2, [{ id: 'second', x: 1, y: 0 }]);
  });

  it('nudges a selected node after an idle non-Select tool declines Arrow', () => {
    let document = addNode(
      createDocument('generic nudge'),
      makeShapeNode('shape', { kind: 'rect', x: 0, y: 0, w: 20, h: 20 }),
    );
    const ctx = {
      document,
      selection: ['shape'],
      shiftKey: false,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      setNodePosition: vi.fn(),
      setNodePositions: vi.fn((positions: ReadonlyArray<{ id: string; x: number; y: number }>) => {
        document = {
          ...document,
          nodes: {
            ...document.nodes,
            shape: { ...document.nodes.shape!, transform: [1, 0, 0, 1, positions[0]!.x, 0] },
          },
        };
      }),
      beginTransaction: vi.fn(),
      commitTransaction: vi.fn(),
      announceOperation: vi.fn(),
    } as unknown as ToolContext;
    const tm = new ToolManager('frame');
    tm.register('frame', () => ({ id: 'frame', cursor: () => ({ css: 'crosshair' }) }));

    expect(tm.handleKeyDown(new KeyboardEvent('keydown', { key: 'ArrowRight' }), ctx)).toBe(true);
    expect(ctx.setNodePositions).toHaveBeenCalledWith([{ id: 'shape', x: 1, y: 0 }]);
    expect(ctx.beginTransaction).toHaveBeenCalledOnce();
    tm.handleKeyUp(new KeyboardEvent('keyup', { key: 'ArrowRight' }), ctx);
    expect(ctx.commitTransaction).toHaveBeenCalledOnce();
  });

  it('finishes a generic nudge before a tool switch', () => {
    const document = addNode(
      createDocument('generic nudge cleanup'),
      makeShapeNode('shape', { kind: 'rect', x: 0, y: 0, w: 20, h: 20 }),
    );
    const ctx = {
      document,
      selection: ['shape'],
      setNodePosition: vi.fn(),
      setNodePositions: vi.fn(),
      beginTransaction: vi.fn(),
      commitTransaction: vi.fn(),
      announceOperation: vi.fn(),
    } as unknown as ToolContext;
    const tm = new ToolManager('frame');
    tm.register('frame', () => ({ id: 'frame', cursor: () => ({ css: 'crosshair' }) }));
    tm.register('select', () => ({ id: 'select', cursor: () => ({ css: 'default' }) }));

    tm.handleKeyDown(new KeyboardEvent('keydown', { key: 'ArrowRight' }), ctx);
    tm.setTool('select', ctx);
    expect(ctx.commitTransaction).toHaveBeenCalledTimes(1);
  });
});
