// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { Document, NodeId } from '@varve/scene';
import { addNode, buildShapeBuilderModel, createDocument, makeShapeNode } from '@varve/scene';
import { describe, expect, it, vi } from 'vitest';
import type { ShapeBuilderDraft } from '../tools';
import { ShapeBuilderOverlay } from './ShapeBuilderOverlay';

const identity = [1, 0, 0, 1, 0, 0] as const;

function strokeFixture(withStroke: boolean): Document {
  const doc = createDocument('shape-builder-overlay', true);
  const node = makeShapeNode(
    'shape',
    { kind: 'rect', x: 0, y: 0, w: 100, h: 100 },
    { transform: identity },
  );
  if (withStroke) {
    node.strokes = [
      {
        color: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
        weight: 4,
        cap: 'butt',
        join: 'miter',
        visible: true,
      } as never,
    ];
  }
  return addNode(doc, node);
}

const draft: ShapeBuilderDraft = {
  kind: 'shape-builder',
  revision: 'shape-builder-v1:0',
  hoveredFaceId: null,
  selectedFaceIds: [],
  sweep: [],
  status: 'unsupported',
  message: 'Outline the stroke before using its visible area.',
};

function renderOverlay(doc: Document, selection: NodeId[], onOutlineStrokes = vi.fn()) {
  render(
    <ShapeBuilderOverlay
      document={doc}
      selection={selection}
      draft={draft}
      canvasSize={{ width: 800, height: 600 }}
      worldToCanvas={(x, y) => ({ x, y })}
      onAction={vi.fn()}
      onExit={vi.fn()}
      onOutlineStrokes={onOutlineStrokes}
    />,
  );
  return onOutlineStrokes;
}

describe('ShapeBuilderOverlay stroke recovery', () => {
  it('offers an outline action when the visible stroke is the only blocker', () => {
    const onOutlineStrokes = renderOverlay(strokeFixture(true), ['shape']);
    const button = screen.getByTestId('shape-builder-outline-strokes');
    expect(button).toHaveTextContent('Outline strokes and retry');
    fireEvent.click(button);
    expect(onOutlineStrokes).toHaveBeenCalledTimes(1);
  });

  it('does not offer the outline action for an already eligible filled selection', () => {
    renderOverlay(strokeFixture(false), ['shape']);
    expect(screen.queryByTestId('shape-builder-outline-strokes')).not.toBeInTheDocument();
  });

  it('offers Create for a bounded empty region and blocks destructive actions', () => {
    let doc = createDocument('empty-region-overlay', true);
    const point = (x: number, y: number) => ({ x, y, handleIn: null, handleOut: null });
    const outer = [point(0, 0), point(100, 0), point(100, 100), point(0, 100)];
    const hole = [point(25, 25), point(25, 75), point(75, 75), point(75, 25)];
    doc = addNode(
      doc,
      makeShapeNode(
        'donut',
        {
          kind: 'path',
          points: outer,
          contours: [outer, hole],
          holes: [hole],
          closed: true,
          tolerance: 3,
          fillRule: 'evenodd',
        },
        { transform: identity },
      ),
    );

    const model = buildShapeBuilderModel(doc, ['donut']);
    const emptyFace = model.faces.find((face) => !face.selectable && face.filledBy.length === 0);
    expect(emptyFace).toBeDefined();

    render(
      <ShapeBuilderOverlay
        document={doc}
        selection={['donut']}
        draft={{
          kind: 'shape-builder',
          revision: model.revision,
          hoveredFaceId: emptyFace!.id,
          selectedFaceIds: [emptyFace!.id],
          sweep: [],
          status: 'ready',
          message: undefined,
        }}
        canvasSize={{ width: 800, height: 600 }}
        worldToCanvas={(x, y) => ({ x, y })}
        onAction={vi.fn()}
        onExit={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: /^create selected regions$/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /^merge selected regions$/i })).toBeDisabled();
    expect(screen.getByTestId('shape-builder-status')).toHaveTextContent(/empty region/i);
  });
});
