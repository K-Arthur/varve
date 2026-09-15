/**
 * YuNet ONNX face backend — the first concrete VisionBackend.
 *
 * Provides FACE_BOUNDS and FACE_KEYPOINTS through the shared ONNX inference
 * worker (model type 'face-detect', opencv/face_detection_yunet_2023mar,
 * 233 KB, MIT). The worker runs the 640x640 letterboxed blob and returns the
 * raw stride-8/16/32 tensors; this backend decodes them (OpenCV-parity math
 * in models/faceDetect.ts) into source-pixel detections.
 *
 * `request.input` must be a decoded ImageData at source resolution (the
 * canonical media decoder's orientation-normalized output). Coordinates in
 * the returned outputs are source-pixel, letterbox undone.
 *
 * Keypoints are honest: only anchors the model genuinely provides are set
 * (eyes, nose tip, mouth corners + derived FACE_CENTER/MOUTH_CENTER). CHIN
 * and FOREHEAD_CENTER are left undefined — no fabricated heuristics.
 */
import { getModelLoader } from '../../backgroundRemoval/modelLoader';
import { getInferenceWorkerHost } from '../../inference/inferenceWorkerHost';
import { decodeFaceDetections } from '../../inference/models/faceDetect';
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
export const ONNX_FACE_BACKEND_VERSION = '1.0.0';
export const YU_NET_MODEL_ID = 'yunet-face-detect';

const CAPABILITIES: readonly VisionCapability[] = ['FACE_BOUNDS', 'FACE_KEYPOINTS'];

/** Session + worker overhead; the graph itself is only ~233 KB. */
const ESTIMATED_RESIDENT_BYTES = 8 * 1024 * 1024;

interface InferenceOutput {
  data: Float32Array;
  dims: number[];
}

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
    const result = await host.infer(
      {
        type: 'infer',
        modelType: 'face-detect',
        modelPath,
        modelId: YU_NET_MODEL_ID,
        imageData,
        reuseSession: true,
      },
      { signal: request.signal, timeoutMs: 30_000 },
    );

    const outputs = result.outputs as Record<string, InferenceOutput | undefined>;
    const letterbox = result.outputs.letterbox as { offsetX: number; offsetY: number } | undefined;

    const detections = decodeFaceDetections(
      outputs as Record<string, InferenceOutput>,
      imageData.width,
      imageData.height,
      letterbox ?? { offsetX: 0, offsetY: 0 },
    );

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
        landmarks: detection.landmarks.map((lm) => ({ x: lm.x, y: lm.y, presence: 1 })),
        confidence: detection.score,
        anchors: yuNetLandmarksToAnchors(detection.landmarks, detection.box),
      }));
      const keypointsOutput: FaceKeypointsOutput = { kind: 'FACE_KEYPOINTS', faces: faceKeypoints };
      outputsMap.FACE_KEYPOINTS = keypointsOutput;
    }

    return outputsMap;
  }

  async dispose(): Promise<void> {
    // The shared worker host is owned by the editor, not the backend.
  }
}
