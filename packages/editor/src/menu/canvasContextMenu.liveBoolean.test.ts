import { addNode, createDocument, makeGroupNode, type SceneNode } from '@varve/scene';
import { describe, expect, it, vi } from 'vitest';
import type { EditorContextValue } from '../context';
import { buildCanvasContextMenuItems } from './canvasContextMenu';

describe('canvas live Boolean menu', () => {
  it('offers expansion and all operation changes for a selected live Boolean', () => {
    let document = createDocument('menu Boolean', true);
    document = addNode(
      document,
      makeGroupNode('live', {
        name: 'Boolean Union',
        boolean: { schemaVersion: 1, operation: 'union' },
      }),
    );
    let updated: SceneNode | undefined;
    const recordAction = vi.fn();
    const editor = {
      state: { document, selection: ['live'] },
      recordAction,
      updateNode: (_id: string, updater: (node: SceneNode) => SceneNode) => {
        updated = updater(document.nodes.live!);
      },
    } as unknown as EditorContextValue;

    const items = buildCanvasContextMenuItems({ editor, closeMenu: vi.fn() });
    expect(items.map((item) => item.label)).toContain('Expand Boolean');
    expect(items.map((item) => item.label)).toEqual(
      expect.arrayContaining([
        'Change Boolean to Union',
        'Change Boolean to Subtract',
        'Change Boolean to Intersect',
        'Change Boolean to Exclude Overlap',
      ]),
    );

    items.find((item) => item.label === 'Change Boolean to Subtract')?.onAction?.();
    expect(updated?.kind === 'group' ? updated.boolean?.operation : undefined).toBe('subtract');
    expect(updated?.name).toBe('Boolean Subtract');
    expect(recordAction).toHaveBeenCalledWith('menu:boolean-subtract');
  });
});
