import { act, render } from '@testing-library/react';
import { createDocument, makeFrameNode, resolveEditorSceneScope } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import type { TransformPreviewSnapshot, TransformPreviewStore } from '../context/ViewportContext';
import { CanvasNameLabels } from './CanvasNameLabels';

describe('CanvasNameLabels transform preview', () => {
  it('moves frame labels with the current drag snapshot', () => {
    const frame = makeFrameNode('frame', {
      name: 'Board',
      transform: [1, 0, 0, 1, 20, 30],
      w: 120,
      h: 90,
    });
    const doc = {
      ...createDocument('name-label-preview', true),
      rootChildren: ['frame'],
      nodes: { frame },
    };
    const scope = resolveEditorSceneScope(doc, { workspaceMode: 'design' });
    let snapshot: TransformPreviewSnapshot | null = null;
    const listeners = new Set<() => void>();
    const transformPreviewStore: TransformPreviewStore = {
      getSnapshot: () => snapshot,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      preview: (baseDocument, document, changedNodeIds) => {
        snapshot = { baseDocument, document, changedNodeIds, revision: 1 };
        for (const listener of listeners) listener();
        return snapshot;
      },
      clear: () => {
        snapshot = null;
        for (const listener of listeners) listener();
      },
    };
    const props = {
      doc,
      zoom: 1,
      pan: { x: 0, y: 0 },
      cameraRotation: 0,
      selection: ['frame'],
      scope,
      viewport: { width: 400, height: 300 },
      transformPreviewStore,
    };
    const { container } = render(<CanvasNameLabels {...props} />);
    const label = () => container.querySelector<SVGTextElement>('[data-node-id="frame"]');
    const initialX = Number(label()?.getAttribute('x'));

    const moved = {
      ...doc,
      nodes: {
        ...doc.nodes,
        frame: { ...frame, transform: [1, 0, 0, 1, 70, 80] as const },
      },
    };
    act(() => transformPreviewStore.preview(doc, moved, ['frame']));

    expect(Number(label()?.getAttribute('x')) - initialX).toBe(50);
  });
});
