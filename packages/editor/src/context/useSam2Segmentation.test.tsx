import { act, renderHook } from '@testing-library/react';
import { addNode, createDocument, type Document, makeImageShapeNode } from '@varve/scene';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fingerprintImageData } from './imageFingerprint';
import type { EditorState, ObjectSelectionSession } from './types';
import { useSam2Segmentation } from './useSam2Segmentation';

const controls = vi.hoisted(() => ({
  infer: vi.fn(),
  load: vi.fn(),
  evict: vi.fn(),
}));

vi.mock('@varve/engine', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@varve/engine')>()),
  getImageCache: () => ({ evict: controls.evict, load: controls.load }),
  cachedImageDims: (image: {
    naturalWidth?: number;
    naturalHeight?: number;
    width?: number;
    height?: number;
  }) => ({
    width: image.naturalWidth ?? image.width ?? 0,
    height: image.naturalHeight ?? image.height ?? 0,
  }),
  getInferenceWorkerHost: () => ({ infer: controls.infer }),
  getModelLoader: () => ({ getModelPath: vi.fn(async () => 'model.onnx') }),
  getRuntimeCapabilitiesSync: () => ({ wasmSafePeakBytes: 4 * 1024 * 1024 * 1024, isTauri: false }),
  assessImageInferenceResources: () => ({ allowed: true, estimatedPeakBytes: 1 }),
  getModelById: () => ({ peakMemoryBytes: 1 }),
  getNativeGenerativeModelStatus: async () => ({ memoryAvailableBytes: undefined }),
}));

const MASK_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==';

interface SetupOptions {
  mask?: Uint8Array;
  alternateMask?: Uint8Array;
  selectedCandidate?: number;
  size?: number;
}

async function sessionFor(options: SetupOptions = {}): Promise<{
  doc: Document;
  session: ObjectSelectionSession;
  fingerprint: string;
}> {
  const size = options.size ?? 8;
  const mask = options.mask ?? new Uint8Array(size * size).fill(255);
  const doc = addNode(
    createDocument('Selection test', true),
    makeImageShapeNode('image', {
      src: 'source',
      w: size,
      h: size,
      imageWidth: size,
      imageHeight: size,
    }),
  );
  const fingerprint = await fingerprintImageData(new ImageData(size, size));
  controls.load.mockResolvedValue({ width: size, height: size });
  const candidates = [{ mask, confidence: 0.9 }];
  if (options.alternateMask) {
    candidates.push({ mask: options.alternateMask, confidence: 0.5 });
  }
  return {
    doc,
    fingerprint,
    session: {
      nodeId: 'image',
      documentId: doc.id,
      width: size,
      height: size,
      candidates,
      selectedCandidate: options.selectedCandidate ?? 0,
      points: [{ x: 4, y: 4, label: 1 }],
      box: null,
      sourceLocator: 'source',
      sourceFingerprint: fingerprint,
      confidence: 0.9,
      confidenceSource: 'model-iou',
      status: 'ready',
      modelId: 'sam2-hiera-tiny',
    },
  };
}

function setup(session: ObjectSelectionSession, doc: Document) {
  const setAreaSelection = vi.fn();
  const announce = vi.fn();
  const stateRef = {
    current: {
      document: doc,
      selection: ['image'],
      objectSelectionSession: session,
      sectionVisibility: {},
    } as unknown as EditorState,
  };
  const setState = (update: React.SetStateAction<EditorState>) => {
    const next =
      typeof update === 'function'
        ? (update as (prev: EditorState) => EditorState)(stateRef.current)
        : update;
    stateRef.current = next;
  };
  const updateDoc = (fn: (current: Document) => Document) => {
    stateRef.current = { ...stateRef.current, document: fn(stateRef.current.document) };
  };
  const hook = renderHook(() =>
    useSam2Segmentation(
      stateRef.current,
      stateRef,
      setState,
      updateDoc,
      { current: { announce } },
      true,
      setAreaSelection,
    ),
  );
  return { ...hook, stateRef, setAreaSelection, announce };
}

describe('useSam2Segmentation reviewed-candidate commit', () => {
  beforeEach(() => {
    controls.infer.mockReset();
    controls.load.mockReset().mockResolvedValue({ width: 8, height: 8 });
    controls.evict.mockReset();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
      getImageData: (_x: number, _y: number, w: number, h: number) => new ImageData(w, h),
      createImageData: (w: number, h: number) => new ImageData(w, h),
      putImageData: vi.fn(),
    } as unknown as ReturnType<HTMLCanvasElement['getContext']>);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(MASK_DATA_URL);
  });
  afterEach(() => vi.restoreAllMocks());

  it('commits the reviewed candidate as a selection without running inference', async () => {
    const { doc, session } = await sessionFor();
    const { result, stateRef, setAreaSelection } = setup(session, doc);

    let output: { confidence: number } | null = null;
    await act(async () => {
      output = await result.current.applySam2Segmentation({
        nodeId: 'image',
        prompts: { points: session.points },
        operation: 'selection',
      });
    });

    expect(output).not.toBeNull();
    expect(controls.infer).not.toHaveBeenCalled();
    expect(setAreaSelection).toHaveBeenCalledTimes(1);
    expect(setAreaSelection.mock.calls[0]![0]).not.toBeNull();
    expect(stateRef.current.objectSelectionSession).toBeNull();
  });

  it('commits the reviewed candidate as a mask without running inference', async () => {
    const { doc, session } = await sessionFor({ size: 1 });
    const { result, stateRef } = setup(session, doc);

    await act(async () => {
      await result.current.applySam2Segmentation({
        nodeId: 'image',
        prompts: { points: session.points },
        operation: 'mask',
      });
    });

    expect(controls.infer).not.toHaveBeenCalled();
    expect(stateRef.current.document.nodes.image!.mask?.rasterMask).toBeDefined();
    expect(stateRef.current.objectSelectionSession).toBeNull();
  });

  it('pins the candidate index supplied by the output action', async () => {
    const strong = new Uint8Array(64).fill(255);
    const weak = new Uint8Array(64).fill(128);
    const { doc, session } = await sessionFor({
      mask: strong,
      alternateMask: weak,
      selectedCandidate: 1,
    });
    const { result, setAreaSelection } = setup(session, doc);

    await act(async () => {
      await result.current.applySam2Segmentation({
        nodeId: 'image',
        prompts: { points: session.points },
        operation: 'selection',
        candidateIndex: 0,
      });
    });

    const selection = setAreaSelection.mock.calls[0]![0] as {
      expression: { kind: string; shape?: { data?: Uint8Array } };
    };
    expect(selection.expression.kind).toBe('shape');
    expect(selection.expression.shape?.data?.[0]).toBe(255);
  });

  it('refuses to commit when the source pixels changed after the preview', async () => {
    const { doc, session } = await sessionFor();
    controls.load.mockResolvedValue({ width: 4, height: 4 });
    const { result, stateRef, setAreaSelection } = setup(session, doc);

    await act(async () => {
      await result.current.applySam2Segmentation({
        nodeId: 'image',
        prompts: { points: session.points },
        operation: 'selection',
      });
    });

    expect(controls.infer).not.toHaveBeenCalled();
    expect(setAreaSelection).not.toHaveBeenCalled();
    expect(stateRef.current.objectSelectionSession?.status).toBe('error');
    expect(stateRef.current.objectSelectionSession?.error?.code).toBe('source_changed');
  });

  it('refuses to commit an empty reviewed candidate', async () => {
    const { doc, session } = await sessionFor({ mask: new Uint8Array(64) });
    const { result, stateRef, setAreaSelection } = setup(session, doc);

    await act(async () => {
      await result.current.applySam2Segmentation({
        nodeId: 'image',
        prompts: { points: session.points },
        operation: 'selection',
      });
    });

    expect(controls.infer).not.toHaveBeenCalled();
    expect(setAreaSelection).not.toHaveBeenCalled();
    expect(stateRef.current.objectSelectionSession?.status).toBe('error');
    expect(stateRef.current.objectSelectionSession?.error?.code).toBe('empty_result');
  });
});
