// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { addNode, createDocument, makeShapeNode } from '@varve/scene';
import { describe, expect, it, vi } from 'vitest';
import { AdjustmentScopeSection } from './AdjustmentScopeSection';

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
});
