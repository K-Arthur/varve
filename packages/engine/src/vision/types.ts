/**
 * Model-independent visual-awareness contracts.
 *
 * Vision consumers ask for capabilities, never for a runtime or model name.
 * Coordinates in these result types are source-pixel coordinates unless the
 * field explicitly says normalized. Results are derived data and must not be
 * sent to analytics or treated as document content by default.
 */

export const VISION_CAPABILITIES = [
  'FACE_BOUNDS',
  'FACE_KEYPOINTS',
  'HAND_LANDMARKS',
  'POSE_LANDMARKS',
  'OBJECT_BOUNDS',
  'PERSON_MASK',
  'GENERAL_SEGMENTATION',
] as const;

export type VisionCapability = (typeof VISION_CAPABILITIES)[number];

export type VisionQuality = 'preview' | 'balanced' | 'final';
export type VisionPriority = 'INTERACTIVE' | 'VISIBLE_UI' | 'BACKGROUND' | 'PREFETCH';

export interface VisionSource {
  /** Stable content identity. A node id is not a valid replacement. */
  assetId: string;
  /** Increment when source pixels meaningfully change. */
  sourceRevision: string | number;
  width: number;
  height: number;
  /** Input is already orientation-normalized by the canonical media decoder. */
  orientationNormalized?: boolean;
}

export interface VisionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface VisionPoint {
  x: number;
  y: number;
  z?: number;
  visibility?: number;
  presence?: number;
}

export interface VisionBox extends VisionRect {
  score: number;
  /** Optional deterministic identity supplied by a backend adapter. */
  id?: string;
  /** Optional product-level importance, distinct from model confidence. */
  importance?: number;
}

export interface FaceDetection {
  id: string;
  box: VisionBox;
  confidence: number;
  /** Optional product-level importance, distinct from model confidence. */
  importance?: number;
}

export type FaceAnchorName =
  | 'FACE_CENTER'
  | 'FOREHEAD_CENTER'
  | 'LEFT_EYE'
  | 'RIGHT_EYE'
  | 'NOSE_TIP'
  | 'MOUTH_CENTER'
  | 'LEFT_MOUTH_CORNER'
  | 'RIGHT_MOUTH_CORNER'
  | 'CHIN';

export interface FaceBoundsOutput {
  kind: 'FACE_BOUNDS';
  faces: readonly FaceDetection[];
}

export interface FaceKeypointsOutput {
  kind: 'FACE_KEYPOINTS';
  faces: readonly {
    id: string;
    landmarks: readonly VisionPoint[];
    confidence: number;
    anchors?: Partial<Record<FaceAnchorName, VisionPoint>>;
  }[];
}

export interface HandLandmarksOutput {
  kind: 'HAND_LANDMARKS';
  hands: readonly {
    id: string;
    handedness?: 'left' | 'right' | 'unknown';
    landmarks: readonly VisionPoint[];
    confidence: number;
  }[];
}

export interface PoseLandmarksOutput {
  kind: 'POSE_LANDMARKS';
  poses: readonly {
    id: string;
    landmarks: readonly VisionPoint[];
    confidence: number;
  }[];
}

export interface ObjectBoundsOutput {
  kind: 'OBJECT_BOUNDS';
  objects: readonly {
    id: string;
    box: VisionBox;
    category?: string;
    confidence: number;
  }[];
}

export interface SegmentationOutput {
  kind: 'PERSON_MASK' | 'GENERAL_SEGMENTATION';
  width: number;
  height: number;
  /** Scalar coverage, row-major, normalized to [0, 1]. */
  values: Uint8Array | Float32Array;
  confidence?: number;
}

export type VisionOutput =
  | FaceBoundsOutput
  | FaceKeypointsOutput
  | HandLandmarksOutput
  | PoseLandmarksOutput
  | ObjectBoundsOutput
  | SegmentationOutput;

export type VisionOutputMap = Partial<Record<VisionCapability, VisionOutput>>;

export interface VisionRequest {
  source: VisionSource;
  capabilities: readonly VisionCapability[];
  quality: VisionQuality;
  priority: VisionPriority;
  consumer: string;
  /** Backend-specific decoded image handle or preprocessing input. */
  input?: unknown;
  signal?: AbortSignal;
}

export interface VisionBackend {
  readonly id: string;
  readonly version: string;
  readonly capabilities: readonly VisionCapability[];
  /** Estimated resident model/session bytes used by the scheduler budget. */
  readonly estimatedResidentBytes: number;
  supports(capabilities: readonly VisionCapability[]): boolean;
  run(request: VisionRequest): Promise<VisionOutputMap>;
  dispose?(): void | Promise<void>;
}

export function visionSourceKey(source: VisionSource): string {
  return `${source.assetId}@${String(source.sourceRevision)}:${source.width}x${source.height}`;
}

export function assertVisionOutput(output: VisionOutput, capability: VisionCapability): void {
  if (output.kind !== capability) {
    throw new Error(`Vision backend returned ${output.kind} for ${capability}`);
  }
}
