import { act, renderHook, waitFor } from '@testing-library/react';
import { addNode, createDocument, makeImageShapeNode } from '@varve/scene';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EditorState } from './types';
import { useBackgroundRemoval } from './useBackgroundRemoval';

const controls = vi.hoisted(() => ({ load: vi.fn(), warm: vi.fn() }));
vi.mock('@varve/engine', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@varve/engine')>()),
  getImageCache: () => ({ load: controls.load }),
  finalizeMaskResult: vi.fn(),
}));
vi.mock('../backgroundRemoval/maskRenderCache', () => ({ warmMaskRenderCache: controls.warm }));

import { SubjectIsolationService } from '../backgroundRemoval/SubjectIsolationService';

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
      sectionVisibility: {},
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

describe('background removal asynchronous review', () => {
  beforeEach(() => {
    controls.load.mockReset().mockResolvedValue({ width: 1, height: 1 });
    controls.warm.mockReset().mockResolvedValue(undefined);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
      getImageData: () => new ImageData(1, 1),
    } as unknown as ReturnType<HTMLCanvasElement['getContext']>);
    vi.spyOn(SubjectIsolationService.prototype, 'isolate').mockImplementation(async (request) => ({
      request,
      maskDataUrl: 'data:image/png;base64,result',
      maskWidth: 1,
      maskHeight: 1,
      confidence: 0.42,
      provenance: { method: 'quick', requestedMethod: 'quick', runtime: '1ms', generatedAt: 1 },
    }));
  });
  afterEach(() => vi.restoreAllMocks());

  it('cancels while decoding without starting inference or publishing a review', async () => {
    let finish!: (image: unknown) => void;
    controls.load.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { result, stateRef } = setup();
    let pending!: Promise<void>;
    await act(async () => {
      pending = result.current.removeBackground('quick');
    });
    await waitFor(() => expect(controls.load).toHaveBeenCalled());
    await act(async () => {
      result.current.cancelBackgroundRemoval();
      finish({ width: 1, height: 1 });
      await pending;
    });
    expect(SubjectIsolationService.prototype.isolate).not.toHaveBeenCalled();
    expect(stateRef.current.backgroundRemovalPreviewSession).toBeNull();
  });

  it('does not resurrect a cancelled result after render-cache warming', async () => {
    let finish!: () => void;
    controls.warm.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const { result, stateRef } = setup();
    let pending!: Promise<void>;
    await act(async () => {
      pending = result.current.removeBackground('quick');
    });
    await waitFor(() => expect(controls.warm).toHaveBeenCalled());
    await act(async () => {
      result.current.cancelBackgroundRemoval();
      finish();
      await pending;
    });
    expect(stateRef.current.backgroundRemovalPreviewSession).toBeNull();
  });

  it('uses measured confidence and opt-in edge contraction in the shared entry path', async () => {
    const { result, stateRef } = setup();
    await act(async () => {
      await result.current.removeBackground('quick');
    });
    expect(stateRef.current.backgroundRemovalPreviewSession).toMatchObject({
      confidence: 0.42,
      decontaminate: false,
    });
  });
});
