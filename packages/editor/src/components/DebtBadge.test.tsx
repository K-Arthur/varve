// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { createDocument, type Document, type SceneNode } from '@strata/scene';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DebtBadge } from './DebtBadge';

const setInspectorTab = vi.fn();
let mockDocument: Document = createDocument('Clean');

vi.mock('../context', () => ({
  useEditor: () => ({
    state: { document: mockDocument },
    setInspectorTab,
  }),
}));

function docWithUnnamedShape(): Document {
  const doc = createDocument('Debtor');
  const node: SceneNode = {
    id: 'shape-unnamed',
    name: 'Rectangle 1',
    kind: 'shape',
    fill: { space: 'rgb', r: 10, g: 20, b: 30, a: 255 },
    shape: { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
    transform: [1, 0, 0, 1, 0, 0],
    strokes: [],
    effects: [],
    order: 'a0',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    rotation: 0,
  } as unknown as SceneNode;
  return {
    ...doc,
    nodes: { ...doc.nodes, [node.id]: node },
    rootChildren: [...doc.rootChildren, node.id],
  };
}

describe('DebtBadge', () => {
  it('renders an issue count badge when debt is present', () => {
    mockDocument = docWithUnnamedShape();
    render(<DebtBadge />);
    const badge = screen.getByRole('button');
    expect(badge).toBeInTheDocument();
    expect(badge.textContent).toMatch(/\d+/);
  });

  it('opens the debt tab in the inspector when clicked', () => {
    mockDocument = docWithUnnamedShape();
    setInspectorTab.mockClear();
    render(<DebtBadge />);
    fireEvent.click(screen.getByRole('button'));
    expect(setInspectorTab).toHaveBeenCalledWith('audit', 'debt');
  });
});
