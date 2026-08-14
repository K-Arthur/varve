import { describe, expect, it, vi } from 'vitest';
import type { WorkerInferResult } from '../../inference/inferenceWorker';
import type { VisionBackend, VisionRequest } from '../types';
import { OnnxFaceBackend, yuNetLandmarksToAnchors } from './onnxFaceBackend';

const IMAGE_DATA = new ImageData(640, 640);

function makeRequest(capabilities: VisionRequest['capabilities']): VisionRequest {
  return {
    source: {
      assetId: 'asset-1',
      sourceRevision: 1,
      width: 1280,
      height: 850,
      orientationNormalized: true,
    },
    capabilities,
    quality: 'balanced',
    priority: 'VISIBLE_UI',
    consumer: 'test',
    input: IMAGE_DATA,
  };
}

/** Plant a single confident face at stride 8 cell (3,5) — box 40,24 w/h 8. */
function buildWorkerOutputs(): Record<string, { data: Float32Array; dims: number[] }> {
  const outputs: Record<string, { data: Float32Array; dims: number[] }> = {};
  for (const stride of [8, 16, 32]) {
    const cells = (640 / stride) ** 2;
    const make = (channels: number) => ({
      data: new Float32Array(cells * channels),
      dims: [1, cells, channels],
    });
    outputs[`cls_${stride}`] = make(1);
    outputs[`obj_${stride}`] = make(1);
    outputs[`bbox_${stride}`] = make(4);
    outputs[`kps_${stride}`] = make(10);
  }
  const cls = outputs.cls_8!.data;
  const obj = outputs.obj_8!.data;
  cls[3 * 80 + 5] = 1;
  obj[3 * 80 + 5] = 1;
  const kps = outputs.kps_8!.data;
  // Keypoints: right eye (0.5,0), left eye (0,0.5), nose (0,0), mouth corners.
  kps[(3 * 80 + 5) * 10 + 0] = 0.5;
  kps[(3 * 80 + 5) * 10 + 1] = 0;
  kps[(3 * 80 + 5) * 10 + 2] = 0;
  kps[(3 * 80 + 5) * 10 + 3] = 0.5;
  return outputs;
}

function makeBackend(overrides: {
  modelPath?: string | null;
  workerOutputs?: () => Record<string, { data: Float32Array; dims: number[] }>;
}): VisionBackend {
  const modelLoader = {
    isModelAvailable: vi.fn().mockResolvedValue(true),
    getModelPath: vi
      .fn()
      .mockResolvedValue(
        overrides.modelPath === undefined ? '/models/yunet.onnx' : overrides.modelPath,
      ),
    downloadModel: vi.fn().mockResolvedValue(undefined),
  };
  const workerHost = {
    infer: vi.fn().mockImplementation(async (): Promise<WorkerInferResult> => {
      return {
        type: 'result',
        requestId: 'x',
        modelType: 'face-detect',
        outputs: {
          ...(overrides.workerOutputs?.() ?? buildWorkerOutputs()),
          letterbox: { offsetX: 0, offsetY: 0 },
          executionProvider: 'wasm',
        },
      };
    }),
  };
  return new OnnxFaceBackend({
    modelLoader: modelLoader as never,
    workerHost: workerHost as never,
  });
}

describe('OnnxFaceBackend', () => {
  it('advertises FACE_BOUNDS and FACE_KEYPOINTS only', () => {
    const backend = makeBackend({});
    expect(backend.capabilities).toEqual(['FACE_BOUNDS', 'FACE_KEYPOINTS']);
    expect(backend.supports(['FACE_BOUNDS'])).toBe(true);
    expect(backend.supports(['FACE_BOUNDS', 'FACE_KEYPOINTS'])).toBe(true);
    expect(backend.supports(['PERSON_MASK'])).toBe(false);
  });

  it('downloads the model on first use', async () => {
    const modelLoader = {
      isModelAvailable: vi.fn().mockResolvedValue(false),
      getModelPath: vi.fn().mockResolvedValue('/models/yunet.onnx'),
      downloadModel: vi.fn().mockResolvedValue(undefined),
    };
    const workerHost = {
      infer: vi.fn().mockResolvedValue({
        type: 'result',
        requestId: 'x',
        modelType: 'face-detect',
        outputs: { ...buildWorkerOutputs(), letterbox: { offsetX: 0, offsetY: 0 } },
      }),
    };
    const backend = new OnnxFaceBackend({
      modelLoader: modelLoader as never,
      workerHost: workerHost as never,
    });
    await backend.run(makeRequest(['FACE_BOUNDS']));
    expect(modelLoader.isModelAvailable).toHaveBeenCalledWith('yunet-face-detect', undefined);
    expect(modelLoader.downloadModel).toHaveBeenCalledTimes(1);
  });

  it('throws when the model is unavailable', async () => {
    const backend = makeBackend({ modelPath: null });
    await expect(backend.run(makeRequest(['FACE_BOUNDS']))).rejects.toThrow(
      'Face detection model is not available',
    );
  });

  it('produces FACE_BOUNDS in source pixel space with scores', async () => {
    const backend = makeBackend({});
    const result = await backend.run(makeRequest(['FACE_BOUNDS']));
    const bounds = result.FACE_BOUNDS;
    expect(bounds?.kind).toBe('FACE_BOUNDS');
    if (bounds?.kind !== 'FACE_BOUNDS') throw new Error('expected FACE_BOUNDS');
    expect(bounds.faces).toHaveLength(1);
    const face = bounds.faces[0]!;
    expect(face.confidence).toBe(1);
    // Model-space box (40-4, 24-4, 8, 8) at scale 1 in a square source.
    expect(face.box.x).toBeCloseTo(36, 0);
    expect(face.box.y).toBeCloseTo(20, 0);
    expect(face.box.width).toBeCloseTo(8, 0);
    expect(face.box.height).toBeCloseTo(8, 0);
  });

  it('produces FACE_KEYPOINTS with honest anchors', async () => {
    const backend = makeBackend({});
    const result = await backend.run(makeRequest(['FACE_KEYPOINTS']));
    const kp = result.FACE_KEYPOINTS;
    expect(kp?.kind).toBe('FACE_KEYPOINTS');
    if (kp?.kind !== 'FACE_KEYPOINTS') throw new Error('expected FACE_KEYPOINTS');
    expect(kp.faces).toHaveLength(1);
    const face = kp.faces[0]!;
    expect(face.landmarks).toHaveLength(5);
    const anchors = face.anchors!;
    // right eye from kps (0.5+5)*8=44, (0+3)*8=24
    expect(anchors.RIGHT_EYE!.x).toBeCloseTo(44, 0);
    expect(anchors.RIGHT_EYE!.y).toBeCloseTo(24, 0);
    // left eye from kps (0+5)*8=40, (0.5+3)*8=28
    expect(anchors.LEFT_EYE!.x).toBeCloseTo(40, 0);
    expect(anchors.LEFT_EYE!.y).toBeCloseTo(28, 0);
    // nose tip at (0+5)*8=40, (0+3)*8=24
    expect(anchors.NOSE_TIP!.x).toBeCloseTo(40, 0);
    expect(anchors.NOSE_TIP!.y).toBeCloseTo(24, 0);
    // FACE_CENTER is derived from the box (36+4, 20+4)
    expect(anchors.FACE_CENTER!.x).toBeCloseTo(40, 0);
    expect(anchors.FACE_CENTER!.y).toBeCloseTo(24, 0);
    // CHIN / FOREHEAD_CENTER are NOT fabricated.
    expect(anchors.CHIN).toBeUndefined();
    expect(anchors.FOREHEAD_CENTER).toBeUndefined();
  });

  it('returns both capabilities in one request when requested together', async () => {
    const backend = makeBackend({});
    const result = await backend.run(makeRequest(['FACE_BOUNDS', 'FACE_KEYPOINTS']));
    expect(result.FACE_BOUNDS?.kind).toBe('FACE_BOUNDS');
    expect(result.FACE_KEYPOINTS?.kind).toBe('FACE_KEYPOINTS');
  });

  it('maps landmarks to anchors without fabricated points', () => {
    const anchors = yuNetLandmarksToAnchors(
      [
        { x: 10, y: 20 },
        { x: 30, y: 20 },
        { x: 20, y: 30 },
        { x: 15, y: 45 },
        { x: 25, y: 45 },
      ],
      { x: 0, y: 0, width: 40, height: 60 },
    );
    expect(anchors.RIGHT_EYE).toEqual({ x: 10, y: 20 });
    expect(anchors.LEFT_EYE).toEqual({ x: 30, y: 20 });
    expect(anchors.NOSE_TIP).toEqual({ x: 20, y: 30 });
    expect(anchors.MOUTH_CENTER).toEqual({ x: 20, y: 45 });
    expect(anchors.FACE_CENTER).toEqual({ x: 20, y: 30 });
    expect(anchors.CHIN).toBeUndefined();
    expect(anchors.FOREHEAD_CENTER).toBeUndefined();
  });
});
