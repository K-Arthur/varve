// @vitest-environment jsdom

import { act, fireEvent, render, screen } from '@testing-library/react';
import {
  addNode,
  createDocument,
  createPatternDefinitionFromSelection,
  makeShapeNode,
} from '@varve/scene';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PatternSourceEditor } from './PatternSourceEditor';

afterEach(() => {
  vi.useRealTimers();
});

describe('PatternSourceEditor', () => {
  it('reports when an accepted source save never commits instead of spinning forever', () => {
    vi.useFakeTimers();
    const motif = makeShapeNode('Motif', { kind: 'rect', x: 0, y: 0, w: 18, h: 12 });
    const document = addNode(createDocument('Source editor test', true), motif);
    const created = createPatternDefinitionFromSelection(document, [motif.id], {
      id: 'source-editor-pattern',
      name: 'Source editor pattern',
    });

    render(
      <PatternSourceEditor
        document={created.document}
        definition={created.definition}
        usageCount={0}
        onCommit={() => true}
        onCommitted={() => {}}
        onCancel={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.getByRole('status')).toHaveTextContent('Saving pattern source');

    act(() => vi.advanceTimersByTime(8000));

    expect(screen.getByRole('alert')).toHaveTextContent(
      'The pattern source was not saved. Reopen the editor and try again.',
    );
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();
  });
});
