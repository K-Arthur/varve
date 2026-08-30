/**
 * SelectionInfoBar tests — selection feedback strip rendering.
 */

import { render, screen, within } from '@testing-library/react';
import { addChild, createDesignCanvas, createDocument, makeShapeNode } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { EditorProvider } from '../../context';
import {
  countActivePageLayers,
  getDisplayAncestorChain,
  getSelectionAnnouncement,
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
    const region = screen.getByRole('region', { name: 'Selection information' });
    expect(region).toBeInTheDocument();
    expect(within(region).getByRole('status')).toHaveTextContent('No selection.');
  });

  it('announces selection identity without pointer-move geometry', () => {
    const document = createDocument('Announcements');
    const rectangle = makeShapeNode('rectangle', {
      kind: 'rect',
      x: 0,
      y: 0,
      w: 100,
      h: 80,
    });

    expect(getSelectionAnnouncement(document, [rectangle])).toBe(
      `${rectangle.name}, Rectangle selected.`,
    );
    expect(getSelectionAnnouncement(document, [rectangle, rectangle])).toBe('2 objects selected.');
    expect(getSelectionAnnouncement(document, [])).toContain('No selection.');
    expect(getSelectionAnnouncement(document, [rectangle])).not.toMatch(/100|80|X:|Y:/);
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

  it('does not count the Design Canvas content root as a user layer', () => {
    let document = createDesignCanvas(createDocument('Design', true), { name: 'Canvas 1' });
    const canvas = document.designCanvases?.[0];
    if (!canvas) throw new Error('Design Canvas missing');
    const rectangle = makeShapeNode('canvas-rectangle', {
      kind: 'rect',
      x: 0,
      y: 0,
      w: 100,
      h: 80,
    });
    document = addChild(document, canvas.contentRoot, rectangle);

    expect(countActivePageLayers(document)).toBe(1);
  });
});
