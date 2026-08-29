import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Document, ManagedColor, SceneNode } from '@varve/scene';
import { createDocument, gradientFill, imageFill, makeShapeNode, solidFill } from '@varve/scene';
import { afterEach, describe, expect, it } from 'vitest';
import { EditorProvider, useEditor } from '../../../context';
import { SelectionColorsSection } from './SelectionColorsSection';

afterEach(cleanup);

const red: ManagedColor = { space: 'rgb', r: 255, g: 0, b: 0, a: 255 };
const blue: ManagedColor = { space: 'rgb', r: 0, g: 0, b: 255, a: 255 };

function withNodes(nodes: SceneNode[]): Document {
  const document = createDocument('Selection Colors', true);
  return {
    ...document,
    rootChildren: nodes.map((node) => node.id),
    nodes: Object.fromEntries(nodes.map((node) => [node.id, node])),
  };
}

function renderSection(document: Document, selectionIds: string[]) {
  return render(
    <EditorProvider>
      <SelectionColorsSection document={document} selectionIds={selectionIds} />
    </EditorProvider>,
  );
}

function renderEditableSection(document: Document, selectionIds: string[]) {
  return render(
    <EditorProvider initialDocumentJson={JSON.stringify(document)} disablePersistentHistory>
      <SelectionColorsSection selectionIds={selectionIds} />
      <HistoryControls />
    </EditorProvider>,
  );
}

function HistoryControls() {
  const { redo, undo } = useEditor();
  return (
    <>
      <button type="button" onClick={undo}>
        Undo selection color
      </button>
      <button type="button" onClick={redo}>
        Redo selection color
      </button>
    </>
  );
}

describe('SelectionColorsSection', () => {
  it('renders semantically labelled, deduplicated fill/stroke/gradient swatches', () => {
    const node = {
      ...makeShapeNode('shape', { kind: 'rect', x: 0, y: 0, w: 100, h: 80 }),
      fills: [
        solidFill(red),
        gradientFill('linear', [
          { position: 0, color: red },
          { position: 1, color: blue },
        ]),
      ],
      strokes: [
        {
          color: red,
          weight: 1,
          align: 'center' as const,
          dashPattern: [],
          dashOffset: 0,
          cap: 'round' as const,
          join: 'miter' as const,
          miterLimit: 4,
          visible: true,
        },
      ],
    };
    renderSection(withNodes([node]), ['shape']);

    expect(screen.getByTestId('selection-colors')).toBeTruthy();
    expect(
      screen.getByRole('button', {
        name: 'RGB #FF0000, Fill · Gradient stop · Stroke, 3 paint uses',
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'RGB #0000FF, Gradient stop, 1 paint use' }),
    ).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
  });

  it('opens the authoritative color picker from a focused swatch', () => {
    const node = makeShapeNode('shape', { kind: 'rect', x: 0, y: 0, w: 100, h: 80 }, { fill: red });
    renderSection(withNodes([node]), ['shape']);

    fireEvent.click(screen.getByRole('button', { name: 'RGB #FF0000, Fill, 1 paint use' }));
    expect(screen.getByRole('dialog', { name: /pick rgb #ff0000/i })).toBeTruthy();
  });

  it('replaces the selected usage through the standard picker', () => {
    const node = makeShapeNode('shape', { kind: 'rect', x: 0, y: 0, w: 100, h: 80 }, { fill: red });
    renderEditableSection(withNodes([node]), ['shape']);

    fireEvent.click(screen.getByRole('button', { name: 'RGB #FF0000, Fill, 1 paint use' }));
    const teal = screen.getByRole('option', { name: 'Teal 500' });
    fireEvent.pointerDown(teal);
    fireEvent.pointerUp(teal);
    fireEvent.click(teal);
    expect(screen.getByRole('button', { name: 'RGB #14B8A6, Fill, 1 paint use' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Undo selection color' }));
    expect(screen.getByRole('button', { name: 'RGB #FF0000, Fill, 1 paint use' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Redo selection color' }));
    expect(screen.getByRole('button', { name: 'RGB #14B8A6, Fill, 1 paint use' })).toBeTruthy();
  });

  it('keeps images out of editable vector colors and states that explicitly', () => {
    const image = {
      ...makeShapeNode('image', { kind: 'rect', x: 0, y: 0, w: 100, h: 80 }),
      fills: [imageFill('data:image/png;base64,AA')],
    };
    renderSection(withNodes([image]), ['image']);

    expect(screen.queryByRole('button', { name: /paint use/i })).toBeNull();
    expect(screen.getByText('1 image fill — not sampled as editable vector colors.')).toBeTruthy();
  });

  it('limits a large selection until the user asks to show more', () => {
    const nodes = Array.from({ length: 17 }, (_, index) =>
      makeShapeNode(
        `shape-${index}`,
        { kind: 'rect', x: index * 10, y: 0, w: 8, h: 8 },
        { fill: { space: 'rgb', r: index, g: 100, b: 200, a: 255 } },
      ),
    );
    renderSection(
      withNodes(nodes),
      nodes.map((node) => node.id),
    );

    expect(screen.getAllByRole('button', { name: /paint use/i })).toHaveLength(16);
    fireEvent.click(screen.getByRole('button', { name: 'Show 1 more selection colors' }));
    expect(screen.getAllByRole('button', { name: /paint use/i })).toHaveLength(17);
  });
});
