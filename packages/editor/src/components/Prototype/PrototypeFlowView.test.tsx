// @vitest-environment jsdom

import {
  addInteraction,
  addNode,
  createDocument,
  makeFrameNode,
  makeShapeNode,
} from '@strata/scene';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { EditorProvider, useEditor } from '../../context';
import { PrototypeFlowView } from './PrototypeFlowView';

afterEach(cleanup);

function buildFlowDoc() {
  let doc = createDocument('Flow');
  doc = addNode(doc, makeFrameNode('f1', { name: 'Home', order: 'a0' }));
  doc = addNode(doc, makeFrameNode('f2', { name: 'Details', order: 'a1' }));
  doc = addNode(
    doc,
    makeShapeNode(
      'btn1',
      { kind: 'rect', x: 0, y: 0, w: 80, h: 40 },
      {
        name: 'CTA',
        transform: [1, 0, 0, 1, 10, 20],
      },
    ),
  );
  doc = {
    ...doc,
    rootChildren: ['f1', 'f2'],
    nodes: {
      ...doc.nodes,
      f1: { ...(doc.nodes.f1 as import('@strata/scene').FrameNode), children: ['btn1'] },
    },
  };
  const { doc: withIx, id: interactionId } = addInteraction(doc, 'btn1', {
    name: 'Go details',
    trigger: { kind: 'onClick' },
    actions: [
      {
        kind: 'navigateTo',
        targetId: 'f2',
        transition: { kind: 'dissolve', duration: 300, easing: { kind: 'ease' } },
      },
    ],
    enabled: true,
  });
  return { doc: withIx, interactionId };
}

describe('PrototypeFlowView', () => {
  it('clicking flow edge selects interaction via context', async () => {
    const { doc, interactionId } = buildFlowDoc();
    let ctx: ReturnType<typeof useEditor> | undefined;

    function Harness() {
      ctx = useEditor();
      return (
        <PrototypeFlowView
          document={ctx?.state.document}
          selectedInteractionId={ctx?.selectedInteractionId}
          onSelectInteraction={ctx?.selectPrototypeInteraction}
        />
      );
    }

    render(
      <EditorProvider initialDocumentJson={JSON.stringify(doc)}>
        <Harness />
      </EditorProvider>,
    );

    const edgeBtn = screen.getByRole('button', { name: /Edit interaction to Details/i });
    fireEvent.click(edgeBtn);

    await waitFor(() => {
      expect(ctx?.selectedInteractionId).toBe(interactionId);
      expect(ctx?.state.selection).toEqual(['btn1']);
    });
  });
});
