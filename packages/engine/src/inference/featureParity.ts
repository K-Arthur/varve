export type RuntimeSupport = 'browser' | 'browser-worker' | 'native' | 'unavailable' | 'planned';

export interface FeatureParityEntry {
  feature: string;
  modelId: string;
  browser: RuntimeSupport;
  browserWorker: RuntimeSupport;
  native: RuntimeSupport;
  executionProviders: string[];
  platformRestrictions: string[];
  fallback: string;
  notes: string;
}

export const FEATURE_PARITY_MATRIX: FeatureParityEntry[] = [
  {
    feature: 'Background Removal (quick)',
    modelId: 'u2netp',
    browser: 'browser',
    browserWorker: 'browser-worker',
    native: 'native',
    executionProviders: ['wasm', 'webgl', 'webgpu', 'native'],
    platformRestrictions: [],
    fallback: 'heuristic (non-AI)',
    notes: 'Bundled FP32 and INT8 models. Native path via Tauri + ort.',
  },
  {
    feature: 'Background Removal (balanced)',
    modelId: 'isnet-general-use',
    browser: 'browser',
    browserWorker: 'browser-worker',
    native: 'native',
    executionProviders: ['wasm', 'webgl', 'webgpu', 'native'],
    platformRestrictions: [],
    fallback: 'u2netp bundled fallback',
    notes: 'Requires download. SHA-256 verified.',
  },
  {
    feature: 'Background Removal (high quality)',
    modelId: 'birefnet-general-lite',
    browser: 'browser',
    browserWorker: 'browser-worker',
    native: 'native',
    executionProviders: ['wasm', 'webgl', 'webgpu', 'native'],
    platformRestrictions: [],
    fallback: 'isnet or u2netp',
    notes: 'Requires download. SHA-256 verified.',
  },
  {
    feature: 'Background Removal (maximum quality)',
    modelId: 'birefnet-general',
    browser: 'browser',
    browserWorker: 'browser-worker',
    native: 'native',
    executionProviders: ['wasm', 'webgpu', 'native'],
    platformRestrictions: ['Not recommended on <8GB RAM systems'],
    fallback: 'birefnet-general-lite',
    notes:
      '973MB download, ~3.9GB peak. SHA-256 verified. WASM path may exceed 4GB memory ceiling.',
  },
  {
    feature: 'AI Upscaling (x4)',
    modelId: 'upscale-realesr-general',
    browser: 'browser',
    browserWorker: 'browser-worker',
    native: 'native',
    executionProviders: ['wasm', 'webgl', 'webgpu', 'native'],
    platformRestrictions: [],
    fallback: 'CPU bicubic upscale',
    notes: 'Bundled FP32 and INT8 models. Native path with tiled execution.',
  },
  {
    feature: 'Denoising (SCUNet)',
    modelId: 'scunet',
    browser: 'browser',
    browserWorker: 'browser-worker',
    native: 'planned',
    executionProviders: ['wasm', 'webgpu'],
    platformRestrictions: [],
    fallback: 'none',
    notes: 'Browser-worker only. No native Rust path yet.',
  },
  {
    feature: 'Colorization (DDColor)',
    modelId: 'ddcolor-tiny',
    browser: 'browser',
    browserWorker: 'browser-worker',
    native: 'unavailable',
    executionProviders: ['wasm', 'webgl', 'webgpu'],
    platformRestrictions: ['DDColor ONNX exports unavailable (404)'],
    fallback: 'none',
    notes:
      'native_colorize_infer command removed. Only browser path. Models need ONNX export from PyTorch.',
  },
  {
    feature: 'Interactive Segmentation (SAM2)',
    modelId: 'sam2-hiera-tiny',
    browser: 'browser',
    browserWorker: 'browser-worker',
    native: 'planned',
    executionProviders: ['wasm', 'webgpu'],
    platformRestrictions: [],
    fallback: 'none',
    notes: 'Two-stage encoder/decoder with atomic multi-component downloads. Native path planned.',
  },
  {
    feature: 'Depth Estimation',
    modelId: 'depth-anything-v2-small',
    browser: 'browser',
    browserWorker: 'browser-worker',
    native: 'planned',
    executionProviders: ['wasm', 'webgpu'],
    platformRestrictions: [],
    fallback: 'none',
    notes: 'Browser-worker only. No native Rust path yet.',
  },
  {
    feature: 'Object Detection (DETR)',
    modelId: 'detr-resnet-50',
    browser: 'browser',
    browserWorker: 'browser-worker',
    native: 'planned',
    executionProviders: ['wasm', 'webgpu'],
    platformRestrictions: [],
    fallback: 'none',
    notes: 'INT8 quantized. SHA-256 verified.',
  },
  {
    feature: 'Face Detection (YuNet)',
    modelId: 'yunet-face-detect',
    browser: 'browser',
    browserWorker: 'browser-worker',
    native: 'planned',
    executionProviders: ['wasm', 'webgpu'],
    platformRestrictions: [],
    fallback: 'none',
    notes:
      '233 KB MIT. 5 keypoints per face. Decode verified bit-for-bit against OpenCV FaceDetectorYN.',
  },
  {
    feature: 'Image Classification',
    modelId: 'efficientnet-lite4',
    browser: 'browser',
    browserWorker: 'browser-worker',
    native: 'planned',
    executionProviders: ['wasm', 'webgpu'],
    platformRestrictions: [],
    fallback: 'none',
    notes: 'SHA-256 verified.',
  },
  {
    feature: 'Image Search (SigLIP)',
    modelId: 'siglip-base-patch16-224',
    browser: 'browser',
    browserWorker: 'browser-worker',
    native: 'planned',
    executionProviders: ['wasm', 'webgpu'],
    platformRestrictions: [],
    fallback: 'none',
    notes: 'Image-to-image embedding only. Text search not yet wired.',
  },
  {
    feature: 'Line Art Extraction',
    modelId: 'lineart',
    browser: 'browser',
    browserWorker: 'browser-worker',
    native: 'planned',
    executionProviders: ['wasm', 'webgpu'],
    platformRestrictions: [],
    fallback: 'none',
    notes: 'SHA-256 verified.',
  },
  {
    feature: 'Inpainting (LaMa)',
    modelId: 'lama-inpainting',
    browser: 'browser',
    browserWorker: 'browser-worker',
    native: 'native',
    executionProviders: ['wasm', 'webgpu'],
    platformRestrictions: [],
    fallback: 'none',
    notes: '208MB download. SHA-256 verified. Native path exists in strata-bgremove.',
  },
  {
    feature: 'Frame Interpolation (RIFE)',
    modelId: 'rife-frame-interpolation',
    browser: 'browser',
    browserWorker: 'browser-worker',
    native: 'planned',
    executionProviders: ['wasm', 'webgpu'],
    platformRestrictions: [],
    fallback: 'none',
    notes: 'SHA-256 verified.',
  },
  {
    feature: 'Text Detection (PaddleOCR)',
    modelId: 'paddleocr-det-v4',
    browser: 'browser',
    browserWorker: 'browser-worker',
    native: 'planned',
    executionProviders: ['wasm', 'webgpu'],
    platformRestrictions: [],
    fallback: 'none',
    notes: 'Detection only. Recognition not yet wired.',
  },
];

export function getFeatureParity(featureName: string): FeatureParityEntry | undefined {
  return FEATURE_PARITY_MATRIX.find((f) => f.feature === featureName);
}

export function getModelParity(modelId: string): FeatureParityEntry | undefined {
  return FEATURE_PARITY_MATRIX.find((f) => f.modelId === modelId);
}
