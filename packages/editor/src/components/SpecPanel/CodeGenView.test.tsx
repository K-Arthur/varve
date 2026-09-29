// @vitest-environment jsdom

import { fireEvent, render, within } from '@testing-library/react';
import {
  addChild,
  addNode,
  createDocument,
  type Document,
  imageFill,
  makeFrameNode,
  makeShapeNode,
  makeTextNode,
} from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { CodeGenView } from './CodeGenView';

function card(): { doc: Document; frameId: string } {
  let doc = createDocument('Card');
  const frame = makeFrameNode('card', { name: 'Card', w: 320, h: 200 });
  doc = addNode(doc, frame);
  doc = addChild(
    doc,
    'card',
    makeShapeNode('badge', { kind: 'rect', x: 8, y: 8, w: 40, h: 20 }, { name: 'Badge-2' }),
  );
  doc = addChild(
    doc,
    'card',
    makeTextNode('label', 'A & B <tag>', { name: 'Label', fontSize: 14 }),
  );
  return { doc, frameId: 'card' };
}

function openTab(container: HTMLElement, name: string) {
  fireEvent.click(within(container).getByRole('tab', { name }));
}

describe('CodeGenView', () => {
  it('labels the deliverable truthfully per target', () => {
    const { doc, frameId } = card();
    const { container } = render(<CodeGenView node={doc.nodes[frameId]!} doc={doc} />);

    // CSS is a stylesheet fragment, not a page.
    expect(container.querySelector('.spec-codegen__badge')?.textContent).toBe('snippet');
    expect(container.querySelector('.spec-codegen__deliverable')?.textContent).toContain(
      'stylesheet fragment',
    );

    openTab(container, 'SVG');
    expect(container.querySelector('.spec-codegen__badge')?.textContent).toBe('asset');
  });

  it('separates the CSS Modules component from its stylesheet', () => {
    const { doc, frameId } = card();
    const { container } = render(<CodeGenView node={doc.nodes[frameId]!} doc={doc} />);
    openTab(container, 'Modules');

    const fileTabs = within(container).getAllByRole('tab');
    const fileNames = fileTabs.map((tab) => tab.textContent ?? '');
    expect(fileNames).toContain('card.tsx');
    expect(fileNames).toContain('card.module.css');

    // The default file is the component, and it does not contain the CSS.
    // Highlighting runs for real (Prism) so this also checks that the viewer's
    // escaping round-trips markup characters instead of swallowing them.
    const code = container.querySelector('.spec-codegen__pre code')?.textContent ?? '';
    expect(code).toContain('export function Card()');
    expect(code).not.toContain('position: absolute');
    expect(code).toContain('{"A & B <tag>"}');
    // The injected markup is escaped, not parsed: no <tag> element exists.
    expect(container.querySelector('tag')).toBeNull();
  });

  it('shows the stylesheet when its file tab is selected', () => {
    const { doc, frameId } = card();
    const { container } = render(<CodeGenView node={doc.nodes[frameId]!} doc={doc} />);
    openTab(container, 'Modules');
    fireEvent.click(within(container).getByRole('tab', { name: 'card.module.css' }));

    const code = container.querySelector('.spec-codegen__pre code')?.textContent ?? '';
    expect(code).toContain('position: absolute');
    expect(code).toContain('.badge-2');
    expect(code).not.toContain('export function');
  });

  it('surfaces conversion diagnostics instead of hiding them', () => {
    let doc = createDocument('Blob');
    const node = makeShapeNode(
      'img',
      { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
      { name: 'Photo' },
    );
    doc = addNode(doc, {
      ...node,
      fills: [imageFill('blob:http://localhost/abc', { fit: 'fill' })],
    });

    const { container } = render(<CodeGenView node={doc.nodes.img!} doc={doc} />);
    openTab(container, 'Modules');

    const diagnostics = container.querySelectorAll('.spec-codegen__diagnostic');
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(Array.from(diagnostics).some((item) => item.textContent?.includes('blob:'))).toBe(true);
  });

  it('keeps the code region keyboard reachable', () => {
    const { doc, frameId } = card();
    const { container } = render(<CodeGenView node={doc.nodes[frameId]!} doc={doc} />);
    const region = container.querySelector('.spec-codegen__pre');
    expect(region?.getAttribute('tabindex')).toBe('0');
    expect(region?.getAttribute('aria-label')).toContain('generated code');
  });
});
