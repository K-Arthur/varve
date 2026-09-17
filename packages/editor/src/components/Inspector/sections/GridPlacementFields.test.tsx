/** @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react';
import { addChild, addNode, createDocument, makeFrameNode, makeShapeNode } from '@varve/scene';
import { afterEach, describe, expect, it } from 'vitest';
import { EditorProvider } from '../../../context';
import { GridPlacementFields } from './GridPlacementFields';

afterEach(cleanup);

const GRID_STYLE = {
  mode: 'grid' as const,
  direction: 'row' as const,
  gap: 8,
  wrap: false,
  padding: [0, 0, 0, 0] as [number, number, number, number],
  grow: 0,
  shrink: 1,
  gridTemplateColumns: '1fr 1fr',
};

function documentWithNodes(
  parentOverrides: Partial<ReturnType<typeof makeFrameNode>> = {},
  childOverrides: Partial<ReturnType<typeof makeShapeNode>> = {},
) {
  let document = createDocument('grid-placement-fields');
  const parent = makeFrameNode('parent', {
    name: 'Grid parent',
    ...parentOverrides,
  });
  // `makeShapeNode` intentionally exposes only the creation-time shape opts;
  // placement is a node-level field, so spread it after construction to model
  // an authored document faithfully.
  const child = {
    ...makeShapeNode('child', { kind: 'rect', x: 0, y: 0, w: 40, h: 40 }, childOverrides),
    ...childOverrides,
  };
  // Keep the fixture's root simple. `addChild` owns the parent-child list and
  // should not have to reconcile a hand-authored child id before the child is
  // in the document map.
  document = addNode(document, parent);
  document = addChild(document, parent.id, child);
  return { document, parent, child };
}

describe('GridPlacementFields', () => {
  it('shows readable two-up fields for a real grid child', () => {
    const { document: sceneDocument, child } = documentWithNodes({ layoutStyle: GRID_STYLE });

    const { container } = render(
      <EditorProvider initialDocumentJson={JSON.stringify(sceneDocument)}>
        <GridPlacementFields nodes={[child]} />
      </EditorProvider>,
    );

    expect(screen.getByText('Grid placement')).toBeInTheDocument();
    for (const label of ['Column start', 'Column end', 'Row start', 'Row end']) {
      expect(screen.getByRole('spinbutton', { name: label })).toBeInTheDocument();
    }
    expect(container.querySelector('.insp-grid-placement__fields')).toHaveClass(
      'insp-field-group--columns-2',
    );
  });

  it('does not mount placement controls for an ordinary frame', () => {
    const { document: sceneDocument, parent } = documentWithNodes();

    render(
      <EditorProvider initialDocumentJson={JSON.stringify(sceneDocument)}>
        <GridPlacementFields nodes={[parent]} />
      </EditorProvider>,
    );

    expect(screen.queryByText('Grid placement')).not.toBeInTheDocument();
  });

  it('keeps authored placement discoverable after the layer leaves a grid', () => {
    const { document: sceneDocument, child } = documentWithNodes(
      {},
      { gridPlacement: { gridColumnStart: 2 } },
    );

    render(
      <EditorProvider initialDocumentJson={JSON.stringify(sceneDocument)}>
        <GridPlacementFields nodes={[child]} />
      </EditorProvider>,
    );

    expect(screen.getByText(/stored on the layer/i)).toBeInTheDocument();
    expect(screen.getByRole('spinbutton', { name: 'Column start' })).toHaveValue('2');
  });
});
