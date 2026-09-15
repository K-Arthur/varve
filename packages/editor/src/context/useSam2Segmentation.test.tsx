import { act, renderHook } from '@testing-library/react';
import { addNode, createDocument, type Document, makeImageShapeNode } from '@varve/scene';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prepareImageMaskMapper } from '../tools/imageMaskCoordinates';
import { fingerprintImageData } from './imageFingerprint';
import { objectSelectionCandidateReviewKey } from './objectSelectionTypes';
import type { EditorState, ObjectSelectionSession } from './types';
import { mapPromptedRoutingFailure, useSam2Segmentation } from './useSam2Segmentation';

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
  const defaultMask = new Uint8Array(size * size);
  const anchorX = Math.min(size - 1, 4);
  const anchorY = Math.min(size - 1, 4);
  defaultMask[anchorY * size + anchorX] = 255;
  const mask = options.mask ?? defaultMask;
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
  const fingerprint = await fingerprintImageData(opaqueImageData(size, size));
  const mappingFingerprint = prepareImageMaskMapper({
    document: doc,
    node: doc.nodes.image!,
    sourceWidth: size,
    sourceHeight: size,
  })?.fingerprint;
  if (!mappingFingerprint) throw new Error('expected image mapping');
  controls.load.mockResolvedValue({ width: size, height: size });
  const candidates = [{ mask, confidence: 0.9, promptContainment: 1 }];
  if (options.alternateMask) {
    candidates.push({ mask: options.alternateMask, confidence: 0.5, promptContainment: 1 });
  }
  const session: ObjectSelectionSession = {
    nodeId: 'image',
    documentId: doc.id,
    candidateSetId: 'candidate-set-1',
    width: size,
    height: size,
    candidates,
    selectedCandidate: options.selectedCandidate ?? 0,
    // Sessions retain world-space prompt markers so the canvas can draw and
    // edit them. The commit path must map these through the image mapper
    // before applying source-space validation.
    points: [{ x: anchorX, y: anchorY, label: 1 }],
    box: null,
    sourceLocator: 'source',
    sourceFingerprint: fingerprint,
    mappingFingerprint,
    confidence: 0.9,
    confidenceSource: 'model-iou',
    status: 'ready',
    modelId: 'sam2-hiera-tiny',
  };
  const reviewKey = objectSelectionCandidateReviewKey(session, session.selectedCandidate);
  if (!reviewKey) throw new Error('expected candidate review key');
  session.reviewedCandidateKey = reviewKey;
  return {
    doc,
    fingerprint,
    session,
  };
}

function opaqueImageData(width: number, height: number): ImageData {
  const imageData = new ImageData(width, height);
  for (let index = 3; index < imageData.data.length; index += 4) imageData.data[index] = 255;
  return imageData;
}

function setup(session: ObjectSelectionSession | null, doc: Document) {
  const setAreaSelection = vi.fn();
  const announce = vi.fn();
  const stateRef = {
    current: {
      document: doc,
      selection: ['image'],
      objectSelectionSession: session ?? undefined,
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
      {
        current: { announce } as unknown as import('../canvas/CanvasAnnouncer').CanvasAnnouncer,
      },
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
      getImageData: (_x: number, _y: number, w: number, h: number) => opaqueImageData(w, h),
      createImageData: (w: number, h: number) => new ImageData(w, h),
      putImageData: vi.fn(),
    } as unknown as ReturnType<HTMLCanvasElement['getContext']>);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(MASK_DATA_URL);
  });
  afterEach(() => vi.restoreAllMocks());

  it.each([
    ['exceeds-hard-budget', 'out_of_memory', true],
    ['not-installed', 'model_not_installed', true],
    ['unsupported-runtime', 'unsupported_runtime', false],
    ['below-quality-floor', 'provider_unavailable', true],
  ] as const)('preserves the actionable routing failure for %s', (code, expected, retryable) => {
    expect(
      mapPromptedRoutingFailure({
        reason: 'fallback routing reason',
        rejected: [{ code, reason: `provider rejected: ${code}` }],
      }),
    ).toEqual({
      code: expected,
      message: `provider rejected: ${code}`,
      retryable,
    });
  });

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

  it('does not apply a ready candidate until the visible target is reviewed', async () => {
    const { doc, session } = await sessionFor();
    session.reviewedCandidateKey = undefined;
    const { result, stateRef, setAreaSelection, announce } = setup(session, doc);

    await act(async () => {
      await result.current.applySam2Segmentation({
        nodeId: 'image',
        prompts: { points: session.points },
        operation: 'selection',
      });
    });

    expect(controls.infer).not.toHaveBeenCalled();
    expect(setAreaSelection).not.toHaveBeenCalled();
    expect(stateRef.current.objectSelectionSession?.status).toBe('ready');
    expect(announce).toHaveBeenCalledWith(expect.stringContaining('Review the highlighted'));

    await act(async () => {
      result.current.reviewSam2Candidate(true);
    });
    await act(async () => {
      await result.current.applySam2Segmentation({
        nodeId: 'image',
        prompts: { points: session.points },
        operation: 'selection',
      });
    });

    expect(setAreaSelection).toHaveBeenCalledTimes(1);
  });

  it('pins the candidate index supplied by the output action', async () => {
    const strong = new Uint8Array(64);
    strong[0] = 255;
    strong[4 * 8 + 4] = 255;
    const weak = new Uint8Array(64);
    weak[4 * 8 + 4] = 128;
    const { doc, session } = await sessionFor({
      mask: strong,
      alternateMask: weak,
      selectedCandidate: 1,
    });
    const { result, setAreaSelection } = setup(session, doc);

    await act(async () => {
      result.current.selectSam2Candidate(0);
      result.current.reviewSam2Candidate(true);
    });

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

  it('refuses to commit when the selected image changes after the preview', async () => {
    const { doc, session } = await sessionFor();
    const { result, stateRef, setAreaSelection, announce } = setup(session, doc);
    stateRef.current.selection = ['another-node'];

    await act(async () => {
      await result.current.applySam2Segmentation({
        nodeId: 'image',
        prompts: { points: session.points },
        operation: 'selection',
      });
    });

    expect(controls.infer).not.toHaveBeenCalled();
    expect(setAreaSelection).not.toHaveBeenCalled();
    expect(stateRef.current.objectSelectionSession?.status).toBe('ready');
    expect(announce).toHaveBeenCalledWith(expect.stringContaining('selected image changed'));
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

  it('refuses a reviewed candidate whose mask no longer matches the source dimensions', async () => {
    const { doc, session } = await sessionFor();
    session.candidates[0]!.mask = new Uint8Array(1).fill(255);
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
    expect(stateRef.current.objectSelectionSession?.error?.code).toBe('invalid_mask_geometry');
  });

  it('refuses a reviewed candidate after the image mapping changes', async () => {
    const { doc, session } = await sessionFor();
    const { result, stateRef, setAreaSelection } = setup(session, doc);
    const image = stateRef.current.document.nodes.image!;
    stateRef.current.document = {
      ...stateRef.current.document,
      nodes: {
        ...stateRef.current.document.nodes,
        image: {
          ...image,
          transform: [1, 0, 0, 1, 2, 0],
        },
      },
    };

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
    expect(stateRef.current.objectSelectionSession?.error?.code).toBe('mapping_changed');
  });

  it('uses the actual reviewed mask instead of stale prompt metadata', async () => {
    const { doc, session } = await sessionFor();
    session.candidates[0]!.promptContainment = 0;
    const { result, stateRef, setAreaSelection } = setup(session, doc);

    await act(async () => {
      await result.current.applySam2Segmentation({
        nodeId: 'image',
        prompts: { points: session.points },
        operation: 'selection',
      });
    });

    expect(controls.infer).not.toHaveBeenCalled();
    expect(setAreaSelection).toHaveBeenCalledTimes(1);
    expect(stateRef.current.objectSelectionSession).toBeNull();
  });

  it('fails closed when a fresh prompt is outside the visible image', async () => {
    const size = 8;
    const doc = addNode(
      createDocument('Selection mapping test', true),
      makeImageShapeNode('image', {
        src: 'source',
        w: size,
        h: size,
        imageWidth: size,
        imageHeight: size,
      }),
    );
    const { result, stateRef, announce } = setup(null, doc);

    await act(async () => {
      await result.current.applySam2Segmentation({
        nodeId: 'image',
        prompts: { points: [{ x: -1, y: size / 2, label: 1 }] },
        operation: 'preview',
      });
    });

    expect(controls.infer).not.toHaveBeenCalled();
    expect(stateRef.current.objectSelectionSession?.error?.code).toBe('prompt_out_of_bounds');
    expect(announce).toHaveBeenCalledWith(expect.stringContaining('1 point'));
  });

  it('does not run inference for an exclude-only point request', async () => {
    const { doc } = await sessionFor();
    const { result, stateRef } = setup(null, doc);

    await act(async () => {
      await result.current.applySam2Segmentation({
        nodeId: 'image',
        prompts: { points: [{ x: 4 / 7, y: 4 / 7, label: 0 }] },
        operation: 'preview',
      });
    });

    expect(controls.infer).not.toHaveBeenCalled();
    expect(stateRef.current.objectSelectionSession?.error?.code).toBe('positive_prompt_required');
  });

  it('rechecks the actual reviewed mask instead of trusting stored prompt metadata', async () => {
    const { doc, session } = await sessionFor();
    session.candidates[0]!.mask.fill(0);
    session.candidates[0]!.mask[0] = 255;
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
    expect(stateRef.current.objectSelectionSession?.error?.code).toBe('prompt_not_honored');
  });
});
