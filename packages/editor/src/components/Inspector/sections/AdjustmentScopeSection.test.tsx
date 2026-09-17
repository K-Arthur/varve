// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { addChild, addNode, createDocument, makeGroupNode, makeShapeNode } from '@varve/scene';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdjustmentScopeSection } from './AdjustmentScopeSection';

beforeEach(() => {
  // jsdom does not implement the native modal methods the shared Dialog uses.
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
      this.open = true;
    };
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
      this.open = false;
    };
  }
});

describe('AdjustmentScopeSection', () => {
  it('lets users add and remove stable explicit target ids', () => {
    let doc = createDocument('scope test', true);
    doc = addNode(
      doc,
      makeShapeNode('target-a', { kind: 'rect', x: 0, y: 0, w: 20, h: 20 }, { name: 'Target A' }),
    );
    doc = addNode(
      doc,
      makeShapeNode('target-b', { kind: 'rect', x: 30, y: 0, w: 20, h: 20 }, { name: 'Target B' }),
    );
    const onChangeScope = vi.fn();

    const { rerender } = render(
      <AdjustmentScopeSection
        nodeId="adjustment"
        doc={doc}
        scope={{ mode: 'explicit-targets', targetNodeIds: ['target-a'] }}
        onChangeScope={onChangeScope}
      />,
    );

    fireEvent.click(screen.getByRole('checkbox', { name: 'Apply adjustment to Target B' }));
    expect(onChangeScope).toHaveBeenLastCalledWith({
      mode: 'explicit-targets',
      targetNodeIds: ['target-a', 'target-b'],
    });

    rerender(
      <AdjustmentScopeSection
        nodeId="adjustment"
        doc={doc}
        scope={{ mode: 'explicit-targets', targetNodeIds: ['target-a', 'target-b'] }}
        onChangeScope={onChangeScope}
      />,
    );
    fireEvent.click(screen.getByRole('checkbox', { name: 'Apply adjustment to Target A' }));
    expect(onChangeScope).toHaveBeenLastCalledWith({
      mode: 'explicit-targets',
      targetNodeIds: ['target-b'],
    });
  });

  it('does not offer children hidden by an ancestor as targets', () => {
    let doc = createDocument('hidden scope test', true);
    doc = addNode(doc, makeGroupNode('hidden-group', { name: 'Hidden group', visible: false }));
    doc = addChild(
      doc,
      'hidden-group',
      makeShapeNode(
        'hidden-child',
        { kind: 'rect', x: 0, y: 0, w: 20, h: 20 },
        { name: 'Hidden child' },
      ),
    );

    render(
      <AdjustmentScopeSection
        nodeId="adjustment"
        doc={doc}
        scope={{ mode: 'explicit-targets', targetNodeIds: [] }}
        onChangeScope={vi.fn()}
      />,
    );

    expect(screen.queryByRole('checkbox', { name: 'Apply adjustment to Hidden child' })).toBeNull();
  });

  it('previews a document-wide scope in a modal dialog and commits only on Apply', async () => {
    let doc = createDocument('scope impact test', true);
    doc = addNode(
      doc,
      makeShapeNode('target-a', { kind: 'rect', x: 0, y: 0, w: 20, h: 20 }, { name: 'Target A' }),
    );
    const onChangeScope = vi.fn();

    render(
      <AdjustmentScopeSection
        nodeId="adjustment"
        doc={doc}
        scope={{ mode: 'explicit-targets', targetNodeIds: ['target-a'] }}
        onChangeScope={onChangeScope}
      />,
    );

    fireEvent.click(screen.getByRole('combobox', { name: 'Adjustment scope mode' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Document (global)' }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('This adjustment will affect:');
    // Counts read as sentences; the old "1 target(s)" phrasing is gone.
    expect(dialog).toHaveTextContent('1 target');
    expect(dialog.textContent).not.toContain('target(s)');
    expect(onChangeScope).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(onChangeScope).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('combobox', { name: 'Adjustment scope mode' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Document (global)' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Apply' }));
    expect(onChangeScope).toHaveBeenCalledWith({ mode: 'document' });
  });
});
