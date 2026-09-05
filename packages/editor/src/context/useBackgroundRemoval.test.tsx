import { act, renderHook, waitFor } from '@testing-library/react';
import { addNode, createDocument, makeImageShapeNode } from '@varve/scene';
import { describe, expect, it, vi } from 'vitest';
import type { EditorState } from './types';
import { useBackgroundRemoval } from './useBackgroundRemoval';

function setup() {
  const document = addNode(
    createDocument('Mask test', true),
    makeImageShapeNode('image', {
      src: 'source',
      w: 1,
      h: 1,
      imageWidth: 1,
      imageHeight: 1,
    }),
  );
  const stateRef = {
    current: {
      document,
      selection: ['image'],
      backgroundRemovalPreviewSession: {
        nodeId: 'image',
        documentId: document.id,
        sourceLocator: 'source',
        placementRevision: '',
        maskDataUrl:
          'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==',
        width: 1,
        height: 1,
        sourceWidth: 1,
        sourceHeight: 1,
        requestedMethod: 'quick',
        actualMethod: 'quick',
        confidence: 1,
        feather: 0,
        decontaminate: false,
      },
    } as unknown as EditorState,
  };
  const patch = (partial: Partial<EditorState>) => {
    stateRef.current = { ...stateRef.current, ...partial };
  };
  const updateDoc = vi.fn((fn) => patch({ document: fn(stateRef.current.document) }));
  const hook = renderHook(() =>
    useBackgroundRemoval(
      stateRef.current,
      patch,
      vi.fn(),
      stateRef,
      updateDoc,
      { current: null },
      { current: null },
      { current: null },
      { current: new Map() },
    ),
  );
  return { ...hook, stateRef, updateDoc };
}

describe('background removal Apply boundary', () => {
  it('does not erase an unrelated edit queued immediately after Apply', async () => {
    const { result, stateRef } = setup();
    const { computePlacementRevision } = await import(
      '../backgroundRemoval/SubjectIsolationService'
    );
    const { getImageFill } = await import('@varve/scene');
    const image = stateRef.current.document.nodes.image!;
    if (image.kind !== 'shape') throw new Error('Expected an image shape fixture');
    stateRef.current.backgroundRemovalPreviewSession!.placementRevision = computePlacementRevision(
      getImageFill(image)?.image ?? null,
    );
    await act(async () => {
      result.current.applyBackgroundRemovalPreview();
      stateRef.current = {
        ...stateRef.current,
        document: { ...stateRef.current.document, name: 'Unrelated edit' },
      };
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(stateRef.current.document.nodes.image!.mask?.rasterMask).toBeDefined(),
    );
    expect(stateRef.current.document.name).toBe('Unrelated edit');
    expect(stateRef.current.document.nodes.image!.mask?.rasterMask).toBeDefined();
  });
});
