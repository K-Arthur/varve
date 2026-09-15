/**
 * YuNet ONNX face backend — the first concrete VisionBackend.
 *
 * Provides FACE_BOUNDS and FACE_KEYPOINTS through the shared ONNX inference
 * worker (model type 'face-detect', opencv/face_detection_yunet_2023mar,
 * 233 KB, MIT). The worker runs the 640x640 letterboxed blob and returns the
 * raw stride-8/16/32 tensors; this backend decodes them (OpenCV-parity math in
 * models/faceDetect.ts) into source-pixel detections.
 *
 * Detection runs as a bounded two-tier pyramid (vision/faceWindows.ts):
 *   - tier A letterboxes the whole source into 640 — correct boxes for large
 *     faces, one inference;
 *   - tier B runs native-scale windows to recover faces the letterbox
 *     downscale pushes below the model's ~10 px band. It is skipped when
 *     tier A already runs at >= 75% of native pixels, and its window count is
 *     capped, so a box-only consumer never pays for a tile grid it cannot use.
 * An oracle comparison against the upstream OpenCV predictor and the measured
 * recall table live in docs/audits/face-detection-refinement-2026-09-15.md.
 *
 * `request.input` must be a decoded ImageData at source resolution (the
 * canonical media decoder's orientation-normalized output). Coordinates in
 * the returned outputs are source-pixel, letterbox undone, and clipped to the
 * source frame; degenerate off-frame boxes are dropped, never reported as
 * zero-size faces.
 *
 * Keypoints are honest: only anchors the model genuinely provides are set
 * (eyes, nose tip, mouth corners + derived FACE_CENTER/MOUTH_CENTER). CHIN
 * and FOREHEAD_CENTER are left undefined — no fabricated heuristics — and a
 * landmark outside the source frame is reported with presence 0 rather than
 * clamped onto the border.
 */
import { getModelLoader } from '../../backgroundRemoval/modelLoader';
import { getInferenceWorkerHost } from '../../inference/inferenceWorkerHost';
import {
  type DecodeFaceOptions,
  decodeFaceDetections,
  type FaceOutputTensors,
  YU_NET_INPUT_SIZE,
  type YuNetFaceDetection,
} from '../../inference/models/faceDetect';
import {
  cropWindowRgba,
  mapWindowDetectionToSource,
  mergeFaceDetections,
  planFaceWindows,
} from '../faceWindows';
import type {
  FaceAnchorName,
  FaceBoundsOutput,
  FaceDetection,
  FaceKeypointsOutput,
  VisionBackend,
  VisionCapability,
  VisionOutputMap,
  VisionPoint,
  VisionRequest,
} from '../types';

export const ONNX_FACE_BACKEND_ID = 'onnx-yunet-face';
export const ONNX_FACE_BACKEND_VERSION = '2.0.0';
export const YU_NET_MODEL_ID = 'yunet-face-detect';

/**
 * Score floor for product detections. OpenCV's demo defaults to 0.9 and the
 * opencv_zoo demo to 0.6; 0.5 is the value the fixture evaluation used (zero
 * false positives on landscape/glass controls, all real faces on the portrait
 * corpus). Lower it deliberately — a lower floor trades recall for
 * borderline texture false positives.
 */
export const YU_NET_DEFAULT_SCORE_THRESHOLD = 0.5;
export const YU_NET_DEFAULT_NMS_THRESHOLD = 0.3;
export const YU_NET_DEFAULT_TOP_K = 5000;

const DEFAULT_DECODE_OPTIONS: DecodeFaceOptions = {
  scoreThreshold: YU_NET_DEFAULT_SCORE_THRESHOLD,
  nmsThreshold: YU_NET_DEFAULT_NMS_THRESHOLD,
  topK: YU_NET_DEFAULT_TOP_K,
};

const CAPABILITIES: readonly VisionCapability[] = ['FACE_BOUNDS', 'FACE_KEYPOINTS'];

/** Session + worker overhead; the graph itself is only ~233 KB. */
const ESTIMATED_RESIDENT_BYTES = 8 * 1024 * 1024;

function asImageData(input: unknown): ImageData {
  if (input instanceof ImageData) return input;
  throw new Error('onnx-yunet-face requires request.input to be an ImageData');
}

/**
 * Map YuNet's five keypoints (subject perspective: right eye, left eye,
 * nose tip, right mouth corner, left mouth corner) into the vision anchor
 * vocabulary. Only anchors backed by real detections are produced.
 */
export function yuNetLandmarksToAnchors(
  landmarks: readonly { x: number; y: number }[],
  faceBox: { x: number; y: number; width: number; height: number },
): Partial<Record<FaceAnchorName, VisionPoint>> {
  const [rightEye, leftEye, noseTip, rightMouth, leftMouth] = landmarks;
  const anchors: Partial<Record<FaceAnchorName, VisionPoint>> = {};
  if (rightEye) anchors.RIGHT_EYE = { x: rightEye.x, y: rightEye.y };
  if (leftEye) anchors.LEFT_EYE = { x: leftEye.x, y: leftEye.y };
  if (noseTip) anchors.NOSE_TIP = { x: noseTip.x, y: noseTip.y };
  if (rightMouth) anchors.RIGHT_MOUTH_CORNER = { x: rightMouth.x, y: rightMouth.y };
  if (leftMouth) anchors.LEFT_MOUTH_CORNER = { x: leftMouth.x, y: leftMouth.y };
  if (rightMouth && leftMouth) {
    anchors.MOUTH_CENTER = {
      x: (rightMouth.x + leftMouth.x) / 2,
      y: (rightMouth.y + leftMouth.y) / 2,
    };
  }
  anchors.FACE_CENTER = {
    x: faceBox.x + faceBox.width / 2,
    y: faceBox.y + faceBox.height / 2,
  };
  return anchors;
}

export interface YuNetFaceBackendOptions {
  modelLoader?: ReturnType<typeof getModelLoader>;
  workerHost?: ReturnType<typeof getInferenceWorkerHost>;
  onDownloadProgress?: (loaded: number, total: number) => void;
  /** Overrides the product score floor (see YU_NET_DEFAULT_SCORE_THRESHOLD). */
  scoreThreshold?: number;
  /** Overrides the window budget for the native-scale tier. */
  maxWindows?: number;
}

/**
 * Download (if needed) the YuNet model and resolve a runnable model path.
 * Returns null when the loader reports the model is unavailable.
 */
export async function ensureYuNetModel(
  options: YuNetFaceBackendOptions = {},
  signal?: AbortSignal,
): Promise<string | null> {
  const loader = options.modelLoader ?? getModelLoader();
  if (!(await loader.isModelAvailable(YU_NET_MODEL_ID, signal))) {
    await loader.downloadModel(YU_NET_MODEL_ID, options.onDownloadProgress, signal);
  }
  return loader.getModelPath(YU_NET_MODEL_ID, signal);
}

type WorkerHost = ReturnType<typeof getInferenceWorkerHost>;

function decodeWorkerOutput(
  outputs: Record<string, unknown>,
  width: number,
  height: number,
  options: DecodeFaceOptions,
): YuNetFaceDetection[] {
  const letterbox = outputs.letterbox as { offsetX: number; offsetY: number } | undefined;
  return decodeFaceDetections(
    outputs as FaceOutputTensors,
    width,
    height,
    letterbox ?? { offsetX: 0, offsetY: 0 },
    options,
  );
}

async function inferWindow(
  host: WorkerHost,
  modelPath: string,
  imageData: ImageData,
  options: DecodeFaceOptions,
  signal?: AbortSignal,
): Promise<YuNetFaceDetection[]> {
  const result = await host.infer(
    {
      type: 'infer',
      modelType: 'face-detect',
      modelPath,
      modelId: YU_NET_MODEL_ID,
      imageData,
      reuseSession: true,
    },
    { signal, timeoutMs: 30_000 },
  );
  return decodeWorkerOutput(
    result.outputs as Record<string, unknown>,
    imageData.width,
    imageData.height,
    options,
  );
}

export class OnnxFaceBackend implements VisionBackend {
  readonly id = ONNX_FACE_BACKEND_ID;
  readonly version = ONNX_FACE_BACKEND_VERSION;
  readonly capabilities: readonly VisionCapability[] = CAPABILITIES;
  readonly estimatedResidentBytes = ESTIMATED_RESIDENT_BYTES;

  constructor(private readonly options: YuNetFaceBackendOptions = {}) {}

  supports(capabilities: readonly VisionCapability[]): boolean {
    return capabilities.every((c) => CAPABILITIES.includes(c));
  }

  async run(request: VisionRequest): Promise<VisionOutputMap> {
    const imageData = asImageData(request.input);
    const modelPath = await ensureYuNetModel(this.options, request.signal);
    if (!modelPath) throw new Error('Face detection model is not available');

    const host = this.options.workerHost ?? getInferenceWorkerHost();
    const decodeOptions: DecodeFaceOptions = {
      scoreThreshold: Number.isFinite(this.options.scoreThreshold)
        ? this.options.scoreThreshold
        : DEFAULT_DECODE_OPTIONS.scoreThreshold,
      nmsThreshold: DEFAULT_DECODE_OPTIONS.nmsThreshold,
      topK: DEFAULT_DECODE_OPTIONS.topK,
    };

    // Tier A: whole-image letterbox. Always runs — it is the only tier that
    // produces intact boxes for faces larger than a window.
    const primary = await inferWindow(host, modelPath, imageData, decodeOptions, request.signal);

    // Tier B: native-scale windows, skipped when tier A is already native
    // enough or a single window would add nothing.
    const plan = planFaceWindows(imageData.width, imageData.height, {
      tileSize: YU_NET_INPUT_SIZE,
      ...(Number.isFinite(this.options.maxWindows) ? { maxWindows: this.options.maxWindows } : {}),
    });

    let detections = primary;
    if (plan.windows.length > 0) {
      detections = mergeFaceDetections(
        primary,
        await this.runWindowTier(host, modelPath, imageData, plan, decodeOptions, request.signal),
      );
    }

    const outputsMap: VisionOutputMap = {};

    if (request.capabilities.includes('FACE_BOUNDS')) {
      const faces: FaceDetection[] = detections.map((detection, index) => ({
        id: `${ONNX_FACE_BACKEND_ID}:${index}`,
        box: {
          ...detection.box,
          score: detection.score,
          importance: 1,
        },
        confidence: detection.score,
        importance: 1,
      }));
      const faceOutput: FaceBoundsOutput = { kind: 'FACE_BOUNDS', faces };
      outputsMap.FACE_BOUNDS = faceOutput;
    }

    if (request.capabilities.includes('FACE_KEYPOINTS')) {
      const faceKeypoints: FaceKeypointsOutput['faces'] = detections.map((detection, index) => ({
        id: `${ONNX_FACE_BACKEND_ID}:${index}`,
        landmarks: detection.landmarks.map((lm, landmarkIndex) => ({
          x: lm.x,
          y: lm.y,
          presence: detection.landmarksInFrame[landmarkIndex] ? 1 : 0,
        })),
        confidence: detection.score,
        anchors: yuNetLandmarksToAnchors(detection.landmarks, detection.box),
      }));
      const keypointsOutput: FaceKeypointsOutput = { kind: 'FACE_KEYPOINTS', faces: faceKeypoints };
      outputsMap.FACE_KEYPOINTS = keypointsOutput;
    }

    return outputsMap;
  }

  /**
   * Run the native-scale window tier. At scale 1 windows are cropped straight
   * out of the source pixels (no canvas, no resampling, no full-resolution
   * duplicate). When the window budget forces a downscale the source is
   * resampled once and windows are read back at exactly the model input size,
   * so each window reaches the worker with an identity letterbox.
   */
  private async runWindowTier(
    host: WorkerHost,
    modelPath: string,
    imageData: ImageData,
    plan: ReturnType<typeof planFaceWindows>,
    decodeOptions: DecodeFaceOptions,
    signal?: AbortSignal,
  ): Promise<YuNetFaceDetection[]> {
    const nativeCrops = plan.scale === 1;
    let scaledCtx: OffscreenCanvasRenderingContext2D | null = null;
    if (!nativeCrops) {
      const scaledWidth = Math.max(1, Math.round(imageData.width * plan.scale));
      const scaledHeight = Math.max(1, Math.round(imageData.height * plan.scale));
      const scaledCanvas = new OffscreenCanvas(scaledWidth, scaledHeight);
      scaledCtx = scaledCanvas.getContext('2d')!;
      scaledCtx.imageSmoothingEnabled = true;
      scaledCtx.imageSmoothingQuality = 'high';
      if (typeof createImageBitmap === 'function') {
        const bitmap = await createImageBitmap(imageData);
        try {
          scaledCtx.drawImage(bitmap, 0, 0, scaledWidth, scaledHeight);
        } finally {
          bitmap.close();
        }
      } else {
        const sourceCanvas = new OffscreenCanvas(imageData.width, imageData.height);
        sourceCanvas.getContext('2d')!.putImageData(imageData, 0, 0);
        scaledCtx.drawImage(sourceCanvas, 0, 0, scaledWidth, scaledHeight);
      }
    }

    const collected: YuNetFaceDetection[] = [];
    for (const window of plan.windows) {
      if (signal?.aborted) {
        throw new Error('Face detection cancelled');
      }
      const windowImage = nativeCrops
        ? (() => {
            const crop = cropWindowRgba(imageData, window);
            // cropWindowRgba always allocates a fresh Uint8ClampedArray; the
            // cast narrows the ArrayBufferLike generic ImageData requires.
            return new ImageData(
              crop.data as Uint8ClampedArray<ArrayBuffer>,
              crop.width,
              crop.height,
            );
          })()
        : scaledCtx!.getImageData(window.x, window.y, window.width, window.height);
      const local = await inferWindow(host, modelPath, windowImage, decodeOptions, signal);
      for (const detection of local) {
        const mapped = mapWindowDetectionToSource(
          detection,
          window,
          plan.scale,
          imageData.width,
          imageData.height,
        );
        if (mapped) collected.push(mapped);
      }
    }
    return collected;
  }

  async dispose(): Promise<void> {
    // The shared worker host is owned by the editor, not the backend.
  }
}
