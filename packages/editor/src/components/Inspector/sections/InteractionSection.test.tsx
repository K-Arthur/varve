// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  addInteraction,
  addNode,
  createDocument,
  createTimeline,
  makeFrameNode,
  makeShapeNode,
} from '@varve/scene';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorProvider, useEditor } from '../../../context';
import { InteractionSection } from './InteractionSection';

vi.mock('@floating-ui/dom', () => ({
  computePosition: vi.fn(() => Promise.resolve({ x: 0, y: 0 })),
  autoUpdate: vi.fn(() => vi.fn()),
  flip: vi.fn(),
  shift: vi.fn(),
  offset: vi.fn(),
  size: vi.fn(),
}));

afterEach(cleanup);

function buildInteractionDoc() {
  let doc = createDocument('Proto Test');
  doc = addNode(doc, makeFrameNode('f1', { name: 'Home', order: 'a0' }));
  doc = addNode(doc, makeFrameNode('f2', { name: 'Details', order: 'a1' }));
  doc = addNode(
    doc,
    makeShapeNode(
      'btn1',
      { kind: 'rect', x: 0, y: 0, w: 120, h: 44 },
      {
        name: 'CTA',
        transform: [1, 0, 0, 1, 20, 40],
      },
    ),
  );
  doc = {
    ...doc,
    rootChildren: ['f1', 'f2'],
    nodes: {
      ...doc.nodes,
      f1: { ...(doc.nodes.f1 as import('@varve/scene').FrameNode), children: ['btn1'] },
    },
  };
  const { doc: withIx, id: interactionId } = addInteraction(doc, 'btn1', {
    name: 'Go to details',
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

function renderInteractionSection(docJson: string) {
  let ctx: ReturnType<typeof useEditor> | undefined;
  function Harness() {
    ctx = useEditor();
    return <InteractionSection />;
  }
  render(
    <EditorProvider initialDocumentJson={docJson}>
      <Harness />
    </EditorProvider>,
  );
  return () => ctx!;
}

describe('InteractionSection', () => {
  it('changes trigger kind', async () => {
    const { doc } = buildInteractionDoc();
    const getCtx = renderInteractionSection(JSON.stringify(doc));
    await waitFor(() => expect(getCtx().selectedNodes()).toHaveLength(0));

    getCtx().setSelection('btn1');
    await waitFor(() => expect(screen.getByLabelText('Trigger')).toBeTruthy());

    fireEvent.click(screen.getByLabelText('Trigger'));
    fireEvent.click(screen.getByRole('option', { name: /on hover/i }));
    await waitFor(() => {
      const ix = getCtx().getNodeInteractions('btn1')[0];
      expect(ix?.trigger).toMatchObject({ kind: 'onHover' });
    });
  });

  it('changes target screen on navigateTo', async () => {
    const { doc } = buildInteractionDoc();
    const getCtx = renderInteractionSection(JSON.stringify(doc));
    getCtx().setSelection('btn1');
    await waitFor(() => expect(screen.getByLabelText('Target screen')).toBeTruthy());

    fireEvent.click(screen.getByLabelText('Target screen'));
    fireEvent.click(screen.getByRole('option', { name: /details/i }));
    await waitFor(() => {
      const action = getCtx().getNodeInteractions('btn1')[0]?.actions[0] as {
        targetId?: string;
      };
      expect(action?.targetId).toBe('f2');
    });
  });

  it('toggles enabled checkbox', async () => {
    const { doc } = buildInteractionDoc();
    const getCtx = renderInteractionSection(JSON.stringify(doc));
    getCtx().setSelection('btn1');
    await waitFor(() => expect(screen.getByLabelText('Enabled')).toBeTruthy());

    const checkbox = screen.getByLabelText('Enabled') as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    fireEvent.click(checkbox);
    await waitFor(() => {
      expect(getCtx().getNodeInteractions('btn1')[0]?.enabled).toBe(false);
    });
  });

  it('removes interaction', async () => {
    const { doc } = buildInteractionDoc();
    const getCtx = renderInteractionSection(JSON.stringify(doc));
    getCtx().setSelection('btn1');
    await waitFor(() => expect(getCtx().getNodeInteractions('btn1')).toHaveLength(1));

    fireEvent.click(screen.getByRole('button', { name: /remove interaction/i }));
    await waitFor(() => expect(getCtx().getNodeInteractions('btn1')).toHaveLength(0));
  });

  it('exposes Play animation action with a target timeline selector', async () => {
    let doc = createDocument('Proto Test');
    doc = addNode(doc, makeFrameNode('f1', { name: 'Home', order: 'a0' }));
    doc = addNode(
      doc,
      makeShapeNode('btn1', { kind: 'rect', x: 0, y: 0, w: 120, h: 44 }, { name: 'CTA' }),
    );
    doc = {
      ...doc,
      rootChildren: ['f1'],
      nodes: {
        ...doc.nodes,
        f1: { ...(doc.nodes.f1 as import('@varve/scene').FrameNode), children: ['btn1'] },
      },
    };
    const { doc: docTl, id: tlId } = createTimeline(doc, 'Spin', 1000);
    doc = docTl;
    const { doc: withIx } = addInteraction(doc, 'btn1', {
      name: 'Play',
      trigger: { kind: 'onClick' },
      actions: [
        {
          kind: 'navigateTo',
          targetId: 'f1',
          transition: { kind: 'dissolve', duration: 300, easing: { kind: 'ease' } },
        },
      ],
      enabled: true,
    });

    const getCtx = renderInteractionSection(JSON.stringify(withIx));
    getCtx().setSelection('btn1');
    await waitFor(() => expect(screen.getByLabelText('Action')).toBeTruthy());

    fireEvent.click(screen.getByLabelText('Action'));
    fireEvent.click(screen.getByRole('option', { name: /play animation/i }));
    await waitFor(() => expect(screen.getByLabelText('Target animation')).toBeTruthy());

    fireEvent.click(screen.getByLabelText('Target animation'));
    fireEvent.click(screen.getByRole('option', { name: /spin/i }));
    await waitFor(() => {
      const action = getCtx().getNodeInteractions('btn1')[0]?.actions[0] as {
        animationId?: string;
      };
      expect(action?.animationId).toBe(tlId);
    });
  });
});
