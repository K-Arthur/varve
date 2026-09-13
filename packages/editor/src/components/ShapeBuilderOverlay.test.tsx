// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { Document, NodeId } from '@varve/scene';
import { addNode, createDocument, makeShapeNode } from '@varve/scene';
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
});
