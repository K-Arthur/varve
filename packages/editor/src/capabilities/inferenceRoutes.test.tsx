/**
 * Every route into on-device inference must honour both deployment capability
 * restrictions and the user AI master switch. These go through the real
 * EditorProvider guardInference wrapper around removeBackground — not a clone.
 */
// @vitest-environment jsdom

import { act, cleanup, render, waitFor } from '@testing-library/react';
import { addNode, createDocument, DocumentCodec, makeImageShapeNode } from '@varve/scene';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorProvider, useEditor } from '../context';
import { setCapabilityRestrictions } from './restrictions';

const controls = vi.hoisted(() => ({
  load: vi.fn(),
  warm: vi.fn(),
  isolate: vi.fn(),
  finalize: vi.fn(),
}));

vi.mock('@varve/engine', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@varve/engine')>()),
  getImageCache: () => ({ load: controls.load }),
  finalizeMaskResult: (result: unknown, options: unknown) => controls.finalize(result, options),
}));
vi.mock('../backgroundRemoval/maskRenderCache', () => ({
  warmMaskRenderCache: (...args: unknown[]) => controls.warm(...args),
}));

import { SubjectIsolationService } from '../backgroundRemoval/SubjectIsolationService';

const IMAGE_ID = 'inference-route-image';
const SOURCE = 'data:image/png;base64,AA==';

function mountEditor() {
  const document = addNode(
    createDocument('Inference routes', true),
    makeImageShapeNode(IMAGE_ID, {
      src: SOURCE,
      w: 1,
      h: 1,
      imageWidth: 1,
      imageHeight: 1,
    }),
  );
  let editor: ReturnType<typeof useEditor> | undefined;
  function Consumer() {
    editor = useEditor();
    return null;
  }
  render(
    <EditorProvider initialDocumentJson={DocumentCodec.encode(document)}>
      <Consumer />
    </EditorProvider>,
  );
  return () => {
    if (!editor) throw new Error('editor not ready');
    return editor;
  };
}

describe('inference gating via EditorProvider.removeBackground', () => {
  beforeEach(() => {
    localStorage.clear();
    setCapabilityRestrictions(null);
    controls.load.mockReset().mockResolvedValue({ width: 1, height: 1 });
    controls.warm.mockReset().mockResolvedValue(undefined);
    controls.finalize.mockReset().mockImplementation(async (result: Record<string, unknown>) => ({
      ...result,
      components: undefined,
      needsSubjectPicker: false,
    }));
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
      getImageData: () => new ImageData(1, 1),
    } as unknown as ReturnType<HTMLCanvasElement['getContext']>);
    controls.isolate.mockReset().mockResolvedValue({
      request: {
        requestId: 'test',
        documentId: 'doc',
        nodeId: IMAGE_ID,
        sourceFingerprint: 'fp',
        sourceLocator: SOURCE,
        placementRevision: 0,
        sourceWidth: 1,
        sourceHeight: 1,
        imageData: new ImageData(1, 1),
        options: { method: 'ai-balanced', feather: 0.5, decontaminate: false },
      },
      maskDataUrl: 'data:image/png;base64,result',
      maskWidth: 1,
      maskHeight: 1,
      provenance: {
        method: 'ai-balanced',
        requestedMethod: 'ai-balanced',
        runtime: '1ms',
        generatedAt: 1,
      },
      confidence: 0.8,
    });
    vi.spyOn(SubjectIsolationService.prototype, 'isolate').mockImplementation(controls.isolate);
  });

  afterEach(() => {
    cleanup();
    setCapabilityRestrictions(null);
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('blocks removeBackground when the user AI master switch is off', async () => {
    localStorage.setItem('varve-editor-settings', JSON.stringify({ ai: { enabled: false } }));
    const get = mountEditor();
    await waitFor(() => expect(get()).toBeDefined());
    act(() => get().setSelection(IMAGE_ID));

    await act(async () => {
      await get().removeBackground('ai-balanced');
    });

    expect(controls.isolate).not.toHaveBeenCalled();
    expect(get().state.backgroundRemovalPreviewSession).toBeNull();
  });

  it('runs removeBackground when the user AI master switch is on', async () => {
    localStorage.setItem('varve-editor-settings', JSON.stringify({ ai: { enabled: true } }));
    const get = mountEditor();
    await waitFor(() => expect(get()).toBeDefined());
    act(() => get().setSelection(IMAGE_ID));

    await act(async () => {
      await get().removeBackground('ai-balanced');
    });

    expect(controls.isolate).toHaveBeenCalled();
    await waitFor(() => expect(get().state.backgroundRemovalPreviewSession).not.toBeNull());
  });

  it('never reaches inference when the deployment withholds it', async () => {
    setCapabilityRestrictions({ restricted: new Set(['inference']), workspaceModes: null });
    const get = mountEditor();
    await waitFor(() => expect(get()).toBeDefined());
    act(() => get().setSelection(IMAGE_ID));

    await act(async () => {
      await get().removeBackground('ai-balanced');
    });

    expect(controls.isolate).not.toHaveBeenCalled();
  });
});
