/**
 * Unified model catalog — merges manifest.json entries with runtime-only
 * models (future intelligence models) and provides helper functions for
 * model selection, INT8 resolution, and compatibility checks.
 *
 * This is the single API surface for model management:
 * - Background removal models (segmentation)
 * - Upscaling models (Real-ESRGAN)
 * - Future intelligence models
 * - Quantized variants
 */

import { ModelRegistry } from './ModelRegistry';
import { getInt8Variant, loadModelCatalog } from './manifest';
import type { ModelManifestEntry, ModelState } from './types';

const FALLBACK_ENTRIES: ModelManifestEntry[] = [
  {
    id: 'u2netp',
    name: 'U\u00B2-Net Light (FP32)',
    description: 'Fast preview quality segmentation. Bundled with the app.',
    sizeBytes: 4_574_861,
    remoteUrl: 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx',
    checksum: '309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8',
    bundled: true,
    inputSpec: null,
    quality: 3,
    precision: 'fp32',
    category: 'segmentation',
    peakMemoryBytes: 18_800_000,
    gpuRecommended: false,
  },
  {
    id: 'u2netp-int8',
    name: 'U\u00B2-Net Light (INT8)',
    description: 'INT8 quantized variant of U\u00B2-Net Light. Bundled with the app.',
    sizeBytes: 1_200_000,
    remoteUrl: '',
    checksum: '7b3355af9c9f76d75c3ad263f711c4ef20f812bae426b798d89c80e098b9edf3',
    bundled: true,
    inputSpec: null,
    quality: 2.5,
    precision: 'int8',
    category: 'segmentation',
    sourceModelId: 'u2netp',
    sourceSha256: '309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8',
    peakMemoryBytes: 3_000_000,
    gpuRecommended: false,
    qualityValidation: {
      passed: false,
      meanMae: 0.2091,
      meanPsnrDb: 30.88,
      validatedAt: '2026-07-21T00:00:00Z',
      ortVersion: '1.27.0',
      failureReasons: [
        'MAE 0.4177 > 0.05 on synthetic portrait',
        'PSNR 3.8dB < 25.0 on synthetic portrait',
        'Correlation loss 1.0034 > 0.03 on synthetic portrait',
        'Correlation loss 0.9986 > 0.03 on synthetic random',
      ],
    },
  },
  {
    id: 'isnet-general-use',
    name: 'IS-Net General Use',
    description: 'Enhanced balanced quality segmentation.',
    sizeBytes: 178_648_008,
    remoteUrl:
      'https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-general-use.onnx',
    checksum: '60920e99c45464f2ba57bee2ad08c919a52bbf852739e96947fbb4358c0d964a',
    bundled: false,
    inputSpec: null,
    quality: 4,
    precision: 'fp32',
    category: 'segmentation',
    peakMemoryBytes: 714_600_000,
    gpuRecommended: true,
  },
  {
    id: 'birefnet-general-lite',
    name: 'BiRefNet Lite',
    description: 'High quality segmentation for complex edges.',
    sizeBytes: 224_005_088,
    remoteUrl:
      'https://github.com/danielgatis/rembg/releases/download/v0.0.0/BiRefNet-general-bb_swin_v1_tiny-epoch_232.onnx',
    checksum: '5600024376f572a557870a5eb0afb1e5961636bef4e1e22132025467d0f03333',
    bundled: false,
    inputSpec: null,
    quality: 4.5,
    precision: 'fp32',
    category: 'segmentation',
    peakMemoryBytes: 896_000_000,
    gpuRecommended: true,
  },
  {
    id: 'birefnet-general',
    name: 'BiRefNet Full',
    description:
      'Best quality segmentation for hair, fur, transparency, and fine detail. ' +
      '~973MB download. Requires ~3.7GB peak memory. Not recommended on systems with less than 8GB RAM. ' +
      'SHA-256 verified from the rembg release archive.',
    sizeBytes: 972_666_916,
    remoteUrl:
      'https://github.com/danielgatis/rembg/releases/download/v0.0.0/BiRefNet-general-epoch_244.onnx',
    checksum: '58f621f00f5d756097615970a88a791584600dcf7c45b18a0a6267535a1ebd3c',
    bundled: false,
    inputSpec: null,
    quality: 5,
    precision: 'fp32',
    category: 'segmentation',
    peakMemoryBytes: 3_890_000_000,
    gpuRecommended: true,
    // ~973MB download, ~3.9GB peak. Use with caution on <8GB systems.
  },
  {
    id: 'upscale-realesr-general',
    name: 'Real-ESRGAN x4 (FP32)',
    description: 'Real-ESRGAN general-purpose x4 upscaling. Bundled.',
    sizeBytes: 4_866_438,
    remoteUrl: '',
    checksum: '856e1f4d77f553e8871302f1782b58e315a12dac52bb0b856dde2dde149b96f7',
    bundled: true,
    inputSpec: null,
    quality: 4,
    precision: 'fp32',
    category: 'upscaling',
    peakMemoryBytes: 17_032_533,
    gpuRecommended: false,
  },
  {
    id: 'upscale-realesr-general-int8',
    name: 'Real-ESRGAN x4 (INT8)',
    description: 'INT8 quantized Real-ESRGAN general-purpose x4 upscaling. Bundled.',
    sizeBytes: 1_300_000,
    remoteUrl: '',
    checksum: '357ebd6732007dbb0d663931e8a7f923baaf9f20a4ca38511fbcd90a1fa06711',
    bundled: true,
    inputSpec: null,
    quality: 3.5,
    precision: 'int8',
    category: 'upscaling',
    sourceModelId: 'upscale-realesr-general',
    sourceSha256: '856e1f4d77f553e8871302f1782b58e315a12dac52bb0b856dde2dde149b96f7',
    peakMemoryBytes: 4_550_000,
    gpuRecommended: false,
    qualityValidation: {
      passed: false,
      meanMae: 0.0377,
      meanPsnrDb: 26.44,
      validatedAt: '2026-07-21T00:00:00Z',
      ortVersion: '1.27.0',
      failureReasons: [
        'Correlation loss 0.2201 > 0.05 on synthetic upscale',
        'Correlation loss 0.2269 > 0.05 on synthetic random',
      ],
    },
  },
  {
    id: 'scunet',
    name: 'SCUNet Denoise',
    description:
      'Real-world blind image denoising (SCUNet PSNR variant). Removes sensor noise, JPEG artifacts, and grain while preserving detail. Fully convolutional (H,W divisible by 8), identity normalization (pixel/255). Verified end-to-end.',
    sizeBytes: 76_936_854,
    remoteUrl:
      'https://huggingface.co/Heliosoph/scunet-onnx/resolve/main/scunet_color_real_psnr.onnx',
    remoteDataUrl:
      'https://huggingface.co/Heliosoph/scunet-onnx/resolve/main/scunet_color_real_psnr.onnx.data',
    checksum: '231be201ab413dbc999d7951caa9844846b93a12a40a41e037d6b5888ed4e88c',
    bundled: false,
    inputSpec: null,
    quality: 4,
    precision: 'fp32',
    category: 'denoising',
    peakMemoryBytes: 280_000_000,
    gpuRecommended: false,
    source: 'Heliosoph/scunet-onnx',
    sourceLicense: 'Apache-2.0',
    components: [
      {
        id: 'scunet-graph',
        role: 'graph',
        filename: 'scunet_color_real_psnr.onnx',
        sizeBytes: 3_798_678,
        remoteUrl:
          'https://huggingface.co/Heliosoph/scunet-onnx/resolve/main/scunet_color_real_psnr.onnx',
        checksum: '231be201ab413dbc999d7951caa9844846b93a12a40a41e037d6b5888ed4e88c',
      },
      {
        id: 'scunet-weights',
        role: 'weights',
        filename: 'scunet_color_real_psnr.onnx.data',
        sizeBytes: 73_138_176,
        remoteUrl:
          'https://huggingface.co/Heliosoph/scunet-onnx/resolve/main/scunet_color_real_psnr.onnx.data',
      },
    ],
  },
  {
    id: 'nafnet-deblur-gopro',
    name: 'NAFNet Deblur (GoPro)',
    description:
      'Task-specific motion/defocus deblurring (NAFNet-GoPro-width64). BGR float32 input in [0,1], H/W divisible by 16 (padder_size), dynamic shape. Reproducible fp16 conversion of the official checkpoint, parity-verified against the trusted PyTorch reference.',
    sizeBytes: 138_050_767,
    remoteUrl:
      'https://github.com/K-Arthur/varve/releases/download/varve-models-v1/nafnet-gopro-width64-fp16b-embed.onnx',
    checksum: 'e9b82a578b6ddf47a3f22118da65d13a4459b53e6c0e5fcf41f5615eadf92f5e',
    bundled: false,
    inputSpec: null,
    quality: 4,
    precision: 'fp16',
    category: 'deblurring',
    peakMemoryBytes: 420_000_000,
    gpuRecommended: false,
    source: 'megvii-research/NAFNet (official checkpoint, nyanko7 mirror)',
    sourceLicense: 'MIT',
    components: [],
  },
  {
    id: 'sam2-hiera-tiny',
    name: 'SAM2 Tiny',
    description:
      'SAM2.1-Hiera-Tiny — interactive object segmentation via point/box prompts. Two-stage: image encoder (1024x1024) + prompt/mask decoder. Click foreground/background points, drag boxes, iteratively refine. Embedding cached per image.',
    sizeBytes: 154_902_201,
    remoteUrl: '',
    checksum: '',
    bundled: false,
    inputSpec: null,
    quality: 3.5,
    precision: 'fp32',
    category: 'segmentation',
    peakMemoryBytes: 312_000_000,
    gpuRecommended: false,
    multiComponent: true,
    source: 'vietanhdev/segment-anything-2-onnx-models',
    sourceLicense: 'Apache-2.0',
    components: [
      {
        id: 'sam2-hiera-tiny-encoder',
        role: 'encoder',
        filename: 'sam2_hiera_tiny.encoder.onnx',
        sizeBytes: 134_261_315,
        remoteUrl:
          'https://huggingface.co/vietanhdev/segment-anything-2-onnx-models/resolve/main/sam2_hiera_tiny.encoder.onnx',
        checksum: '4cc015ee18520e93f8c7ddfeaca7436039daaaaf19721b4b96a8810a805e82f7',
      },
      {
        id: 'sam2-hiera-tiny-decoder',
        role: 'decoder',
        filename: 'sam2_hiera_tiny.decoder.onnx',
        sizeBytes: 20_640_886,
        remoteUrl:
          'https://huggingface.co/vietanhdev/segment-anything-2-onnx-models/resolve/main/sam2_hiera_tiny.decoder.onnx',
        checksum: 'f5a4bd656c143899fb7f52d64ed81e6f6aeb37d477a0b6da50146ac7cf2187bf',
      },
    ],
  },
  {
    id: 'sam2-hiera-tiny-encoder',
    name: 'Select Subject — Image Encoder',
    description:
      'Runs once per image to produce embeddings for interactive selection. Verified source: vietanhdev/segment-anything-2-onnx-models (Apache-2.0). SHA-256 computed from verified download.',
    sizeBytes: 134_261_315,
    remoteUrl:
      'https://huggingface.co/vietanhdev/segment-anything-2-onnx-models/resolve/main/sam2_hiera_tiny.encoder.onnx',
    checksum: '4cc015ee18520e93f8c7ddfeaca7436039daaaaf19721b4b96a8810a805e82f7',
    bundled: false,
    inputSpec: null,
    quality: 3.5,
    precision: 'fp32',
    category: 'segmentation',
    peakMemoryBytes: 700_000_000,
    gpuRecommended: true,
  },
  {
    id: 'sam2-hiera-tiny-decoder',
    name: 'Select Subject — Prompt Decoder',
    description:
      'Runs per click/drag using the cached encoder output. Verified source: vietanhdev/segment-anything-2-onnx-models (Apache-2.0). SHA-256 computed from verified download.',
    sizeBytes: 20_640_886,
    remoteUrl:
      'https://huggingface.co/vietanhdev/segment-anything-2-onnx-models/resolve/main/sam2_hiera_tiny.decoder.onnx',
    checksum: 'f5a4bd656c143899fb7f52d64ed81e6f6aeb37d477a0b6da50146ac7cf2187bf',
    bundled: false,
    inputSpec: null,
    quality: 3.5,
    precision: 'fp32',
    category: 'segmentation',
    peakMemoryBytes: 90_000_000,
    gpuRecommended: false,
  },
  {
    id: 'sam2-hiera-small',
    name: 'SAM2 Small',
    description:
      'SAM2.1-Hiera-Small — higher quality interactive segmentation. Two-stage: image encoder (1024x1024) + prompt/mask decoder. Encoder: ~163MB, Decoder: ~21MB. SHA-256 pinned from verified download via vietanhdev. Better detail preservation than Tiny.',
    sizeBytes: 183_000_000,
    remoteUrl: '',
    checksum: '',
    bundled: false,
    inputSpec: null,
    quality: 4,
    precision: 'fp32',
    category: 'segmentation',
    peakMemoryBytes: 940_000_000,
    gpuRecommended: true,
    multiComponent: true,
    source: 'vietanhdev/segment-anything-2-onnx-models',
    sourceLicense: 'Apache-2.0',
    components: [
      {
        id: 'sam2-hiera-small-encoder',
        role: 'encoder',
        filename: 'sam2_hiera_small.encoder.onnx',
        sizeBytes: 162_703_493,
        remoteUrl:
          'https://huggingface.co/vietanhdev/segment-anything-2-onnx-models/resolve/main/sam2_hiera_small.encoder.onnx',
        checksum: 'f6a7c74dee5b2e71cce3f0475b778f0f28fa3e6c3646c79027302123d2197f40',
      },
      {
        id: 'sam2-hiera-small-decoder',
        role: 'decoder',
        filename: 'sam2_hiera_small.decoder.onnx',
        sizeBytes: 20_640_886,
        remoteUrl:
          'https://huggingface.co/vietanhdev/segment-anything-2-onnx-models/resolve/main/sam2_hiera_small.decoder.onnx',
        checksum: 'e07f799d2afe8640ef21f47096ad154d9289bb53041191499ebbea8933ef047b',
      },
    ],
  },
  {
    id: 'sam2-hiera-small-encoder',
    name: 'Select Subject — Image Encoder (SAM2 Small)',
    description:
      'Runs once per image to produce embeddings for interactive selection. ~163MB. Verified source: vietanhdev/segment-anything-2-onnx-models (Apache-2.0). SHA-256 computed from verified download.',
    sizeBytes: 162_703_493,
    remoteUrl:
      'https://huggingface.co/vietanhdev/segment-anything-2-onnx-models/resolve/main/sam2_hiera_small.encoder.onnx',
    checksum: 'f6a7c74dee5b2e71cce3f0475b778f0f28fa3e6c3646c79027302123d2197f40',
    bundled: false,
    inputSpec: null,
    quality: 4,
    speed: 3,
    peakMemoryBytes: 850_000_000,
    gpuRecommended: true,
    maxSessions: 1,
    precision: 'fp32',
    category: 'segmentation',
  },
  {
    id: 'sam2-hiera-small-decoder',
    name: 'Select Subject — Prompt Decoder (SAM2 Small)',
    description:
      'Runs per click/drag using the cached encoder output. ~21MB. Verified source: vietanhdev/segment-anything-2-onnx-models (Apache-2.0). SHA-256 computed from verified download.',
    sizeBytes: 20_640_886,
    remoteUrl:
      'https://huggingface.co/vietanhdev/segment-anything-2-onnx-models/resolve/main/sam2_hiera_small.decoder.onnx',
    checksum: 'e07f799d2afe8640ef21f47096ad154d9289bb53041191499ebbea8933ef047b',
    bundled: false,
    inputSpec: null,
    quality: 4,
    speed: 4,
    peakMemoryBytes: 90_000_000,
    gpuRecommended: false,
    maxSessions: 1,
    precision: 'fp32',
    category: 'segmentation',
  },
  {
    id: 'depth-anything-v2-small',
    name: 'Depth-Anything-V2 Small (INT8)',
    description:
      'Monocular depth estimation — enables lens blur, 3D parallax, depth-aware masking, and lighting effects. Input: 518x518 RGB (multiple of 14). Output: relative depth map. Verified source: onnx-community/depth-anything-v2-small (Apache-2.0). SHA-256 computed from verified download.',
    sizeBytes: 27_258_801,
    remoteUrl:
      'https://huggingface.co/onnx-community/depth-anything-v2-small/resolve/main/onnx/model_int8.onnx',
    checksum: '01aa7a23de3f4a0ee1a2bb9997e6918104c85a9f95dea46d27b9b3fb0c6b9001',
    bundled: false,
    inputSpec: null,
    quality: 4.5,
    precision: 'int8',
    category: 'depth',
    peakMemoryBytes: 100_000_000,
    gpuRecommended: false,
  },
  {
    id: 'lineart',
    name: 'Line Art Extraction',
    description:
      'Converts a photo into a clean line drawing — a starting point for tracing in Draw mode. Verified source: rocca/informative-drawings-line-art-onnx, model MIT-licensed (Chan/Durand/Isola, CVPR 2022). SHA-256 computed from verified download.',
    sizeBytes: 17_193_338,
    remoteUrl:
      'https://huggingface.co/rocca/informative-drawings-line-art-onnx/resolve/main/model.onnx',
    checksum: '1fef40b8f7126d827e30fbebccf95ae9b0b391795df926bf9366a821bad4f498',
    bundled: false,
    inputSpec: null,
    quality: 4,
    precision: 'fp32',
    category: 'lineart',
    peakMemoryBytes: 70_000_000,
    gpuRecommended: false,
  },
  {
    id: 'tr-ocr-base-printed',
    name: 'TrOCR (Printed Text)',
    description:
      'Microsoft TrOCR-base-printed — OCR for printed Latin text in images, screenshots, and scanned documents. Two-component: vision encoder (344MB) + text decoder (INT8, 250MB). SHA-256 pinned from verified download via Xenova.',
    sizeBytes: 594_000_000,
    remoteUrl: '',
    checksum: '',
    bundled: false,
    inputSpec: null,
    quality: 4,
    precision: 'int8',
    category: 'ocr',
    peakMemoryBytes: 2_400_000_000,
    gpuRecommended: true,
    multiComponent: true,
    source: 'Xenova/trocr-base-printed',
    sourceLicense: 'MIT',
    components: [
      {
        id: 'trocr-encoder',
        role: 'encoder',
        filename: 'encoder_model.onnx',
        sizeBytes: 344_487_712,
        remoteUrl:
          'https://huggingface.co/Xenova/trocr-base-printed/resolve/main/onnx/encoder_model.onnx',
        checksum: '31e9b9a2950c4b0d5d884665414ec3dec36186237955463c07a30e5f3fcd8ea0',
      },
      {
        id: 'trocr-decoder',
        role: 'decoder',
        filename: 'decoder_model_merged_quantized.onnx',
        sizeBytes: 249_597_124,
        remoteUrl:
          'https://huggingface.co/Xenova/trocr-base-printed/resolve/main/onnx/decoder_model_merged_quantized.onnx',
        checksum: 'b5f7d6080d4b73256e3364a56e6fe2b558ffc389cb7f0b9166747b126b25a0cd',
      },
    ],
  },
  {
    id: 'detr-resnet-50',
    name: 'Detect Objects',
    description:
      'Finds people and objects in a photo with bounding boxes — powers subject-aware crop/resize and a standalone detection overlay across 80 everyday categories. Verified source: Xenova/detr-resnet-50 (Apache-2.0, INT8 quantized export). SHA-256 computed from verified download.',
    sizeBytes: 43_102_531,
    remoteUrl:
      'https://huggingface.co/Xenova/detr-resnet-50/resolve/main/onnx/model_quantized.onnx',
    checksum: 'cae09a307ed9247da7e2ce8bcf81522a6817f1ea2e82b9c4dde59f5964b62b4f',
    tensorContract: {
      version: 1,
      inputs: [
        { name: 'pixel_values', dims: [1, 3, 800, 800], dtype: 'float32' },
        { name: 'pixel_mask', dims: [1, 64, 64], dtype: 'int64' },
      ],
      outputs: [
        { name: 'logits', dims: [1, 100, 92], dtype: 'float32' },
        { name: 'pred_boxes', dims: [1, 100, 4], dtype: 'float32' },
      ],
      normalization: {
        mean: [0.485, 0.456, 0.406],
        std: [0.229, 0.224, 0.225],
        channelOrder: 'rgb',
      },
      outputActivation: 'none',
    },
    bundled: false,
    inputSpec: null,
    quality: 4,
    precision: 'int8',
    category: 'detection',
    peakMemoryBytes: 180_000_000,
    gpuRecommended: false,
  },
  {
    id: 'yunet-face-detect',
    name: 'Detect Faces',
    description:
      'Detects faces with bounding boxes and five facial keypoints each — powers face-aware crop ("Protect Faces"), person selection anchors, and face keypoints. 233 KB, runs on-device. Verified source: opencv/face_detection_yunet_2023mar (MIT). SHA-256 computed from verified download. Decode verified bit-for-bit against OpenCV FaceDetectorYN.',
    sizeBytes: 232_589,
    remoteUrl:
      'https://huggingface.co/opencv/face_detection_yunet/resolve/main/face_detection_yunet_2023mar.onnx',
    checksum: '8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4',
    tensorContract: {
      version: 1,
      inputs: [{ name: 'input', dims: [1, 3, 640, 640], dtype: 'float32' }],
      outputs: [
        { name: 'cls_8', dims: [1, 6400, 1], dtype: 'float32' },
        { name: 'cls_16', dims: [1, 1600, 1], dtype: 'float32' },
        { name: 'cls_32', dims: [1, 400, 1], dtype: 'float32' },
        { name: 'obj_8', dims: [1, 6400, 1], dtype: 'float32' },
        { name: 'obj_16', dims: [1, 1600, 1], dtype: 'float32' },
        { name: 'obj_32', dims: [1, 400, 1], dtype: 'float32' },
        { name: 'bbox_8', dims: [1, 6400, 4], dtype: 'float32' },
        { name: 'bbox_16', dims: [1, 1600, 4], dtype: 'float32' },
        { name: 'bbox_32', dims: [1, 400, 4], dtype: 'float32' },
        { name: 'kps_8', dims: [1, 6400, 10], dtype: 'float32' },
        { name: 'kps_16', dims: [1, 1600, 10], dtype: 'float32' },
        { name: 'kps_32', dims: [1, 400, 10], dtype: 'float32' },
      ],
      normalization: { mean: [0, 0, 0], std: [1 / 255, 1 / 255, 1 / 255], channelOrder: 'rgb' },
      outputActivation: 'none',
    },
    bundled: true,
    inputSpec: null,
    quality: 4,
    precision: 'fp32',
    category: 'detection',
    peakMemoryBytes: 8_000_000,
    gpuRecommended: false,
    source: 'opencv/face_detection_yunet',
    sourceLicense: 'MIT',
  },
  {
    id: 'efficientnet-lite4',
    name: 'Auto-Tag Image',
    description:
      "Classifies a photo's content (subject, scene, object type) for automatic tagging and organization. Verified source: onnx/models EfficientNet-Lite4 (MIT, official ONNX Model Zoo export). SHA-256 computed from verified download.",
    sizeBytes: 51_946_641,
    remoteUrl:
      'https://github.com/onnx/models/raw/main/validated/vision/classification/efficientnet-lite4/model/efficientnet-lite4-11.onnx',
    checksum: 'd111689907c06eea7c82e4833ddef758da6453b9d4cf60b7e99ca05c7cbd9c12',
    bundled: false,
    inputSpec: null,
    quality: 3.5,
    precision: 'fp32',
    tensorContract: {
      version: 1,
      inputs: [{ name: 'input', dims: [1, 224, 224, 3], dtype: 'float32' }],
      outputs: [{ name: 'Softmax:0', dims: [1, 1000], dtype: 'float32' }],
      normalization: { mean: [0, 0, 0], std: [1, 1, 1], channelOrder: 'rgb' },
      outputActivation: 'softmax',
    },
    category: 'classification',
    gpuRecommended: false,
  },
  {
    id: 'lama-inpainting',
    name: 'Content-Aware Fill',
    description:
      'Removes an unwanted object or blemish and fills the gap with plausible generated content, guided by a mask you paint. Verified source: Carve/LaMa-ONNX (Apache-2.0, saic-mdal/lama / Samsung AI). SHA-256 computed from verified download.',
    sizeBytes: 208_044_816,
    remoteUrl: 'https://huggingface.co/Carve/LaMa-ONNX/resolve/main/lama_fp32.onnx',
    checksum: '1faef5301d78db7dda502fe59966957ec4b79dd64e16f03ed96913c7a4eb68d6',
    bundled: false,
    inputSpec: null,
    quality: 4,
    precision: 'fp32',
    tensorContract: {
      version: 1,
      inputs: [
        { name: 'image', dims: [1, 3, 512, 512], dtype: 'float32' },
        { name: 'mask', dims: [1, 1, 512, 512], dtype: 'float32' },
      ],
      outputs: [{ name: 'output', dims: [1, 3, 512, 512], dtype: 'float32' }],
      normalization: { mean: [0, 0, 0], std: [1, 1, 1], channelOrder: 'rgb' },
      outputActivation: 'none',
    },
    category: 'inpainting',
    gpuRecommended: true,
  },
  {
    id: 'rife-frame-interpolation',
    name: 'Smooth Motion (Frame Interpolation)',
    description:
      'Generates an in-between frame from two keyframes for smoother Motion-mode playback and timeline scrubbing. Verified source: hzwer/ECCV2022-RIFE v4 (MIT), ONNX export FuryTMP/RIFE_fp32. SHA-256 computed from verified download.',
    sizeBytes: 21_604_631,
    remoteUrl: 'https://huggingface.co/FuryTMP/RIFE_fp32/resolve/main/RIFE_fp32.onnx',
    checksum: '6a31074c0f588648982b5e828aee6c27e005015a712a46ea63da48c65fa9a26b',
    bundled: false,
    inputSpec: null,
    quality: 3,
    precision: 'fp32',
    tensorContract: {
      version: 1,
      inputs: [{ name: 'input', dims: [1, 6, -1, -1], dtype: 'float32' }],
      outputs: [{ name: 'output', dims: [1, 3, -1, -1], dtype: 'float32' }],
      normalization: { mean: [0, 0, 0], std: [1, 1, 1], channelOrder: 'rgb' },
      outputActivation: 'none',
    },
    category: 'frame-interpolation',
    peakMemoryBytes: 90_000_000,
    gpuRecommended: false,
  },
  {
    id: 'siglip-base-patch16-224',
    name: 'Find Similar Images',
    description:
      'Embeds an image so visually/semantically similar assets can be ranked and surfaced (image-to-image search). Text search is not yet available. Verified source: Xenova/siglip-base-patch16-224 (Apache-2.0, INT8 quantized export). SHA-256 computed from verified download.',
    sizeBytes: 210_977_441,
    remoteUrl:
      'https://huggingface.co/Xenova/siglip-base-patch16-224/resolve/main/onnx/model_quantized.onnx',
    checksum: '9171eb00c38b9ec82f924877356d008b79e3285dbac7cd10965827bee30c9a99',
    bundled: false,
    inputSpec: null,
    quality: 4,
    precision: 'int8',
    peakMemoryBytes: 750_000_000,
    tensorContract: {
      version: 2,
      inputs: [
        { name: 'pixel_values', dims: [1, 3, 224, 224], dtype: 'float32' },
        { name: 'input_ids', dims: [1, 1], dtype: 'int64' },
      ],
      outputs: [{ name: 'image_embeds', dims: [1, 768], dtype: 'float32' }],
      normalization: { mean: [0.5, 0.5, 0.5], std: [0.5, 0.5, 0.5], channelOrder: 'rgb' },
      outputActivation: 'none',
    },
    category: 'embedding',
    gpuRecommended: true,
  },
  {
    id: 'paddleocr-det-v4',
    name: 'Detect Text Regions',
    description:
      'Highlights where text appears in an image — useful for redaction, accessibility review, and as a first stage toward full OCR. Detection only (no text recognition yet). Verified source: deepghs/paddleocr, PP-OCRv4 detector (Apache-2.0, PaddlePaddle/Baidu). SHA-256 computed from verified download.',
    sizeBytes: 4_745_517,
    remoteUrl:
      'https://huggingface.co/deepghs/paddleocr/resolve/main/det/ch_PP-OCRv4_det/model.onnx',
    checksum: '30a86f5731181461d08021402766601e4302a9b9b9666be8aff402696339cdff',
    bundled: false,
    inputSpec: null,
    quality: 3.5,
    precision: 'fp32',
    peakMemoryBytes: 40_000_000,
    tensorContract: {
      version: 1,
      inputs: [{ name: 'x', dims: [1, 3, -1, -1], dtype: 'float32' }],
      outputs: [{ name: 'sigmoid_0.tmp_0', dims: [1, 1, -1, -1], dtype: 'float32' }],
      normalization: { mean: [0, 0, 0], std: [1, 1, 1], channelOrder: 'rgb' },
      outputActivation: 'sigmoid',
    },
    category: 'ocr',
    gpuRecommended: false,
  },
  {
    id: 'ddcolor-tiny',
    name: 'DDColor Tiny (AI Colorize)',
    description:
      'Fast AI colorization for grayscale photos and line art. ConvNeXt-tiny, 256x256 input. Bundled with the app (Apache-2.0).',
    sizeBytes: 220_524_460,
    remoteUrl: 'https://github.com/K-Arthur/varve/releases/download/models-v1/ddcolor-tiny.onnx',
    checksum: 'cb8996efe193140d536d338cad429ac74330dda3d49d57aa53c5b6131c3a3aa8',
    bundled: false,
    inputSpec: null,
    quality: 3,
    precision: 'fp32',
    category: 'colorization',
    peakMemoryBytes: 200_000_000,
    gpuRecommended: false,
    source: 'piddnad/ddcolor_paper_tiny',
    sourceLicense: 'Apache-2.0',
    tensorContract: {
      version: 1,
      inputs: [{ name: 'input', dims: [1, 3, 256, 256], dtype: 'float32' }],
      outputs: [{ name: 'output', dims: [1, 2, 256, 256], dtype: 'float32' }],
      normalization: { mean: [0, 0, 0], std: [1, 1, 1], channelOrder: 'rgb' },
      outputActivation: 'none',
    },
    acquisition: {
      kind: 'remote',
      sources: [
        {
          url: 'https://github.com/K-Arthur/varve/releases/download/models-v1/ddcolor-tiny.onnx',
          sha256: 'cb8996efe193140d536d338cad429ac74330dda3d49d57aa53c5b6131c3a3aa8',
        },
      ],
      sha256: 'cb8996efe193140d536d338cad429ac74330dda3d49d57aa53c5b6131c3a3aa8',
    },
  },
  {
    id: 'ddcolor',
    name: 'DDColor (AI Colorize)',
    description:
      'Photo-realistic AI colorization for grayscale photos. ConvNeXt-large, 512x512 input. Bundled with the app (Apache-2.0).',
    sizeBytes: 980_082_799,
    remoteUrl: 'https://github.com/K-Arthur/varve/releases/download/models-v1/ddcolor.onnx',
    checksum: '69ba2e3d20ec79290d2056e46b1810e3518d4ba8707dd7e964d1518a18fec812',
    bundled: false,
    inputSpec: null,
    quality: 4,
    precision: 'fp32',
    category: 'colorization',
    peakMemoryBytes: 624_000_000,
    gpuRecommended: false,
    source: 'piddnad/ddcolor_modelscope',
    sourceLicense: 'Apache-2.0',
    tensorContract: {
      version: 1,
      inputs: [{ name: 'input', dims: [1, 3, 512, 512], dtype: 'float32' }],
      outputs: [{ name: 'output', dims: [1, 2, 512, 512], dtype: 'float32' }],
      normalization: { mean: [0, 0, 0], std: [1, 1, 1], channelOrder: 'rgb' },
      outputActivation: 'none',
    },
    acquisition: {
      kind: 'remote',
      sources: [
        {
          url: 'https://github.com/K-Arthur/varve/releases/download/models-v1/ddcolor.onnx',
          sha256: '69ba2e3d20ec79290d2056e46b1810e3518d4ba8707dd7e964d1518a18fec812',
        },
      ],
      sha256: '69ba2e3d20ec79290d2056e46b1810e3518d4ba8707dd7e964d1518a18fec812',
    },
  },
  {
    id: 'font-classify',
    name: 'Font Classifier',
    description:
      'Identifies font families from text region images. EfficientNet B3 finetuned on 3473 Google Fonts (MIT license). Returns top-k candidates matched against installed and downloadable fonts.',
    sizeBytes: 64_100_000,
    remoteUrl: 'https://huggingface.co/storia/font-classify-onnx/resolve/main/model.onnx',
    checksum: '44aa3d46804aa55b7841a0eb6dcc9bb72badd6d01645e5c7448a70525655b7b6',
    bundled: false,
    inputSpec: null,
    quality: 4,
    precision: 'fp32',
    category: 'classification',
    peakMemoryBytes: 260_000_000,
    gpuRecommended: false,
    source: 'storia/font-classify-onnx',
    sourceLicense: 'MIT',
    tensorContract: {
      version: 1,
      inputs: [{ name: 'input', dims: [1, 3, 320, 320], dtype: 'float32' }],
      outputs: [{ name: 'output', dims: [1, 3473], dtype: 'float32' }],
      normalization: {
        mean: [0.485, 0.456, 0.406],
        std: [0.229, 0.224, 0.225],
        channelOrder: 'rgb',
      },
      outputActivation: 'none',
    },
    acquisition: {
      kind: 'remote',
      sources: [
        {
          url: 'https://huggingface.co/storia/font-classify-onnx/resolve/main/model.onnx',
          sha256: '44aa3d46804aa55b7841a0eb6dcc9bb72badd6d01645e5c7448a70525655b7b6',
        },
      ],
      sha256: '44aa3d46804aa55b7841a0eb6dcc9bb72badd6d01645e5c7448a70525655b7b6',
    },
  },
];

let registry: ModelRegistry | null = null;

function getRegistry(entries?: ModelManifestEntry[]): ModelRegistry {
  if (!registry) {
    registry = new ModelRegistry(entries ?? FALLBACK_ENTRIES);
  }
  return registry;
}

export async function initializeModelCatalog(signal?: AbortSignal): Promise<ModelRegistry> {
  const manifest = await loadModelCatalog(signal);
  registry = getRegistry(manifest ?? undefined);
  return registry;
}

export function getModelRegistry(): ModelRegistry {
  return getRegistry();
}

export async function resolveBestModel(
  primaryId: string,
  preferPerformance: boolean,
  signal?: AbortSignal,
): Promise<{ modelId: string; isInt8: boolean }> {
  if (preferPerformance) {
    let int8Entry: ModelManifestEntry | null = null;
    try {
      int8Entry = await getInt8Variant(primaryId, signal);
    } catch {
      // manifest unavailable
    }
    if (!int8Entry) {
      int8Entry =
        FALLBACK_ENTRIES.find((e) => e.sourceModelId === primaryId && e.precision === 'int8') ??
        null;
    }
    if (int8Entry) {
      const reg = getModelRegistry();
      if (!reg.knows(int8Entry.id)) {
        reg.register(int8Entry);
      }
      if (reg.isReady(int8Entry.id)) {
        return { modelId: int8Entry.id, isInt8: true };
      }
      if (int8Entry.bundled) {
        return { modelId: int8Entry.id, isInt8: true };
      }
    }
  }

  return { modelId: primaryId, isInt8: false };
}

export function isModelAvailable(entry: ModelManifestEntry): boolean {
  const reg = getModelRegistry();
  return reg.isReady(entry.id);
}

export function isModelReady(modelId: string): boolean {
  const reg = getModelRegistry();
  return reg.isReady(modelId);
}

export function getModelById(modelId: string): ModelManifestEntry | undefined {
  const reg = getModelRegistry();
  return reg.getEntry(modelId) ?? FALLBACK_ENTRIES.find((e) => e.id === modelId);
}

export function listAllModels(): ModelManifestEntry[] {
  const reg = getModelRegistry();
  const registered = reg.listEntries();
  if (registered.length > 0) return registered;
  return FALLBACK_ENTRIES;
}

export function listModelsByCategory(
  category: NonNullable<ModelManifestEntry['category']>,
): ModelManifestEntry[] {
  return listAllModels().filter((m) => m.category === category);
}

export function setModelState(modelId: string, state: ModelState): void {
  const reg = getModelRegistry();
  reg.setState(modelId, state);
}

export function subscribeToModel(
  modelId: string,
  fn: (modelId: string, state: ModelState) => void,
): () => void {
  const reg = getModelRegistry();
  return reg.subscribe(modelId, fn);
}

export function resetModelCatalog(): void {
  registry = null;
}

export function estimateModelMemory(modelId: string, batchSize = 1): number {
  const entry = getModelById(modelId);
  if (!entry) return 0;
  return (entry.peakMemoryBytes ?? entry.sizeBytes * 4) * batchSize;
}

export function getRecommendedProvider(modelId: string): 'cpu' | 'gpu' | 'any' {
  const entry = getModelById(modelId);
  if (!entry) return 'cpu';
  if (entry.gpuRecommended) return 'gpu';
  if (entry.precision === 'int8') return 'cpu';
  return 'any';
}
