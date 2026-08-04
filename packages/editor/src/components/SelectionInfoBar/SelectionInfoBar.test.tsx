/**
 * SelectionInfoBar tests — selection feedback strip rendering.
 */

import { render, screen } from '@testing-library/react';
import { addChild, createDocument, makeShapeNode } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { EditorProvider } from '../../context';
import {
  countActivePageLayers,
  getDisplayAncestorChain,
  SelectionInfoBar,
} from './SelectionInfoBar';

describe('SelectionInfoBar', () => {
  it('renders without crashing', () => {
    function Test() {
      return <SelectionInfoBar />;
    }
    render(
      <EditorProvider>
        <Test />
      </EditorProvider>,
    );
    expect(screen.getByText('0 layers')).toBeInTheDocument();
  });

  it('does not count or expose page content roots as user layers', () => {
    let document = createDocument('Paged');
    const page = document.pages?.[0];
    if (!page) throw new Error('default page missing');
    const rectangle = makeShapeNode('rectangle', {
      kind: 'rect',
      x: 0,
      y: 0,
      w: 100,
      h: 80,
    });
    document = addChild(document, page.contentRoot, rectangle);

    expect(countActivePageLayers(document)).toBe(1);
    expect(getDisplayAncestorChain(document, rectangle.id).map((node) => node.name)).toEqual([
      rectangle.name,
    ]);
  });
});
