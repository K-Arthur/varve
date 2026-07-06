import { createDocument, makeGroupNode, makeShapeNode } from '@strata/scene';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EditorProvider, useEditor } from './context';

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
    const importedId = ctx?.state.selection[0]!;
    const imported = ctx?.state.document.nodes[importedId];
    expect(imported?.kind).toBe('group');
    if (imported?.kind !== 'group') return;
    expect(imported.children).toHaveLength(1);
    expect(imported.children[0]).not.toBe('s1');
    expect(ctx?.state.document.nodes[imported.children[0]!]).toBeDefined();
  });
});
