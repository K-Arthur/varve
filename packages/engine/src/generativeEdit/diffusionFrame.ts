import { resampleImageData } from '../exportPipeline/resample';
import { computeLetterboxGeometry } from '../inference/letterboxGeometry';

/**
 * The input-frame contract for one diffusion inpainting profile.
 *
 * Diffusion checkpoints do not all share a working resolution. Some are
 * trained around a square 512px frame, while newer profiles commonly use a
 * square 1024px frame or a runtime-approved rectangular frame. Keeping this
 * contract beside the frame transform makes the model's requirement explicit
 * and prevents callers from silently stretching a photograph into whatever
 * dimensions happen to be convenient for the UI.
 */
export interface DiffusionFrameContract {
  /** Stable preprocessing identity recorded with model qualification. */
  id: string;
  /** Explicit revision for resize, padding, mask, and color handling. */
  preprocessingVersion: string;
  /** Whether the provider consumes an explicit editable mask. */
  inputKind: DiffusionInputKind;
  /** How the provider interprets the mask bytes supplied with the frame. */
  maskConvention: DiffusionMaskConvention;
  /**
   * How the provider receives the image/mask conditioning. Polarity does not
   * describe tensor shape: some high-level pipelines accept image + mask and
   * derive the masked image internally, while low-level graphs need the
   * already-masked image (or a concatenated tensor) explicitly.
   */
  maskInput: DiffusionMaskInputContract;
  /** Exact frame dimensions sent to the provider. */
  frameWidth: number;
  frameHeight: number;
  /** Required model-dimension granularity, usually 8 or 64. */
  dimensionMultiple?: number;
}

/** The two provider families that can otherwise look interchangeable in a UI. */
export type DiffusionInputKind = 'masked-inpainting' | 'reference-edit';

/** Canonical Varve coverage is 0 = preserve and 255 = edit. */
export type DiffusionMaskConvention = 'white-edit-black-preserve' | 'white-preserve-black-edit';

/**
 * Model-facing mask tensor contract. This is intentionally separate from
 * `DiffusionMaskConvention`, because two providers can use the same polarity
 * while requiring different image/mask tensors.
 */
export type DiffusionMaskInputContract =
  | 'image-and-mask'
  | 'masked-image-and-mask'
  | 'masked-image-plus-mask'
  | 'none';

/** SD 1.5 inpainting's reference working frame. */
export const SD15_INPAINTING_FRAME_SIZE = 512;
export const SD15_INPAINTING_FRAME_CONTRACT = {
  id: 'sd15-inpainting-512-square-v1',
  preprocessingVersion: 'varve-diffusion-letterbox-linear-srgb-v1',
  inputKind: 'masked-inpainting',
  maskConvention: 'white-edit-black-preserve',
  // diffusion-rs accepts the source image and mask and builds the masked
  // image inside its SD inpainting pipeline.
  maskInput: 'image-and-mask',
  frameWidth: SD15_INPAINTING_FRAME_SIZE,
  frameHeight: SD15_INPAINTING_FRAME_SIZE,
  dimensionMultiple: 64,
} as const satisfies DiffusionFrameContract;

/**
 * SD 2 inpainting's documented 512px crop contract. This is a research
 * contract only: Varve has no SD 2 production adapter or quality certificate.
 * Keeping it separate from SD 1.5 prevents a future profile from inheriting
 * the wrong text-encoder/runtime assumptions by accident.
 */
export const SD2_INPAINTING_FRAME_CONTRACT = {
  id: 'sd2-inpainting-512-square-v1',
  preprocessingVersion: 'varve-diffusion-letterbox-linear-srgb-v1',
  inputKind: 'masked-inpainting',
  maskConvention: 'white-edit-black-preserve',
  maskInput: 'image-and-mask',
  frameWidth: 512,
  frameHeight: 512,
  dimensionMultiple: 64,
} as const satisfies DiffusionFrameContract;

/**
 * Reference contract for a future SDXL inpainting profile.
 *
 * This is a transform contract only. The current SDXL candidate has not
 * passed Varve's semantic, memory, cancellation, and platform qualification
 * gates and is therefore not exposed as an installed provider.
 */
export const SDXL_INPAINTING_FRAME_CONTRACT = {
  id: 'sdxl-inpainting-1024-square-v1',
  preprocessingVersion: 'varve-diffusion-letterbox-linear-srgb-v1',
  inputKind: 'masked-inpainting',
  maskConvention: 'white-edit-black-preserve',
  maskInput: 'image-and-mask',
  frameWidth: 1024,
  frameHeight: 1024,
  dimensionMultiple: 64,
} as const satisfies DiffusionFrameContract;

/**
 * MI-GAN's low-level input is `[keepMask, maskedRgb]`. The official
 * vision.cpp conversion accepts a white edit mask at its CLI boundary and
 * inverts it before constructing that tensor, so the Varve profile retains
 * the canonical provider polarity separately from the tensor shape.
 */
export const MIGAN_INPAINTING_FRAME_CONTRACT = {
  id: 'migan-places2-512-square-v1',
  preprocessingVersion: 'migan-vision-cpp-mask-first-rgb-v1',
  inputKind: 'masked-inpainting',
  maskConvention: 'white-preserve-black-edit',
  maskInput: 'masked-image-plus-mask',
  frameWidth: 512,
  frameHeight: 512,
} as const satisfies DiffusionFrameContract;

/**
 * Moebius exposes its low-level ONNX denoiser rather than a high-level
 * pipeline. Its 9-channel latent is `[noisyLatent, mask, maskedImageLatent]`,
 * so an adapter must zero the edit coverage before VAE encoding.
 */
export const MOEBIUS_INPAINTING_FRAME_CONTRACT = {
  id: 'moebius-512-square-v1',
  preprocessingVersion: 'moebius-onnx-masked-latent-ddim-v1',
  inputKind: 'masked-inpainting',
  maskConvention: 'white-edit-black-preserve',
  maskInput: 'masked-image-and-mask',
  frameWidth: 512,
  frameHeight: 512,
  dimensionMultiple: 8,
} as const satisfies DiffusionFrameContract;

export interface DiffusionFrame {
  imageData: ImageData;
  mask: Uint8Array;
  width: number;
  height: number;
  contractId: string;
  preprocessingVersion: string;
  inputKind: DiffusionInputKind;
  maskConvention: DiffusionMaskConvention;
  maskInput: DiffusionMaskInputContract;
  contentX: number;
  contentY: number;
  contentWidth: number;
  contentHeight: number;
  /** Map a model frame back to the unscaled context used by the compositor. */
  restore: (imageData: ImageData) => ImageData;
}

function assertDimensions(width: number, height: number, label: string): void {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new Error(`${label} dimensions are invalid`);
  }
}

function validateContract(contract: DiffusionFrameContract): void {
  if (typeof contract.id !== 'string' || contract.id.trim().length === 0) {
    throw new Error('Diffusion frame contract must have a stable id');
  }
  if (contract.inputKind !== 'masked-inpainting' && contract.inputKind !== 'reference-edit') {
    throw new Error('Diffusion frame contract has an unsupported input kind');
  }
  if (
    contract.maskConvention !== 'white-edit-black-preserve' &&
    contract.maskConvention !== 'white-preserve-black-edit'
  ) {
    throw new Error('Diffusion frame contract has an unsupported mask convention');
  }
  if (
    contract.maskInput !== 'image-and-mask' &&
    contract.maskInput !== 'masked-image-and-mask' &&
    contract.maskInput !== 'masked-image-plus-mask' &&
    contract.maskInput !== 'none'
  ) {
    throw new Error('Diffusion frame contract has an unsupported mask input contract');
  }
  if (contract.inputKind === 'masked-inpainting' && contract.maskInput === 'none') {
    throw new Error('Masked inpainting contracts must require an explicit mask input');
  }
  if (contract.inputKind === 'reference-edit' && contract.maskInput !== 'none') {
    throw new Error('Reference-edit contracts cannot claim a masked input contract');
  }
  if (
    typeof contract.preprocessingVersion !== 'string' ||
    contract.preprocessingVersion.trim().length === 0
  ) {
    throw new Error('Diffusion frame contract must have a preprocessing version');
  }
  assertDimensions(contract.frameWidth, contract.frameHeight, 'Diffusion model frame');
  if (contract.frameWidth > 4096 || contract.frameHeight > 4096) {
    throw new Error('Diffusion model frame exceeds the supported working limit');
  }
  if (contract.dimensionMultiple !== undefined) {
    if (
      !Number.isSafeInteger(contract.dimensionMultiple) ||
      contract.dimensionMultiple <= 0 ||
      contract.frameWidth % contract.dimensionMultiple !== 0 ||
      contract.frameHeight % contract.dimensionMultiple !== 0
    ) {
      throw new Error('Diffusion model frame does not satisfy its dimension multiple');
    }
  }
}

function encodeMaskForProvider(mask: Uint8Array, convention: DiffusionMaskConvention): Uint8Array {
  if (convention === 'white-edit-black-preserve') {
    return new Uint8Array(mask);
  }
  const encoded = new Uint8Array(mask.length);
  for (let index = 0; index < mask.length; index += 1) {
    encoded[index] = 255 - (mask[index] ?? 0);
  }
  return encoded;
}

function resizeMaskBilinear(
  mask: Uint8Array,
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
): Uint8Array {
  if (mask.length !== sourceWidth * sourceHeight) {
    throw new Error('Diffusion mask dimensions do not match the source context');
  }
  const resized = new Uint8Array(targetWidth * targetHeight);
  const xScale = sourceWidth / targetWidth;
  const yScale = sourceHeight / targetHeight;
  for (let y = 0; y < targetHeight; y += 1) {
    const sourceY = (y + 0.5) * yScale - 0.5;
    const y0 = Math.max(0, Math.floor(sourceY));
    const y1 = Math.min(sourceHeight - 1, y0 + 1);
    const yWeight = Math.max(0, Math.min(1, sourceY - y0));
    for (let x = 0; x < targetWidth; x += 1) {
      const sourceX = (x + 0.5) * xScale - 0.5;
      const x0 = Math.max(0, Math.floor(sourceX));
      const x1 = Math.min(sourceWidth - 1, x0 + 1);
      const xWeight = Math.max(0, Math.min(1, sourceX - x0));
      const top =
        (mask[y0 * sourceWidth + x0] ?? 0) * (1 - xWeight) +
        (mask[y0 * sourceWidth + x1] ?? 0) * xWeight;
      const bottom =
        (mask[y1 * sourceWidth + x0] ?? 0) * (1 - xWeight) +
        (mask[y1 * sourceWidth + x1] ?? 0) * xWeight;
      resized[y * targetWidth + x] = Math.round(top * (1 - yWeight) + bottom * yWeight);
    }
  }
  return resized;
}

function copyIntoLetterbox(
  target: ImageData,
  source: ImageData,
  offsetX: number,
  offsetY: number,
): void {
  for (let y = 0; y < source.height; y += 1) {
    const sourceOffset = y * source.width * 4;
    const targetOffset = ((offsetY + y) * target.width + offsetX) * 4;
    target.data.set(
      source.data.subarray(sourceOffset, sourceOffset + source.width * 4),
      targetOffset,
    );
  }
}

function copyMaskIntoLetterbox(
  target: Uint8Array,
  source: Uint8Array,
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  offsetX: number,
  offsetY: number,
): void {
  for (let y = 0; y < sourceHeight; y += 1) {
    const targetOffset = (offsetY + y) * targetWidth + offsetX;
    target.set(source.subarray(y * sourceWidth, (y + 1) * sourceWidth), targetOffset);
  }
}

function fillLetterbox(imageData: ImageData): void {
  // Neutral opaque padding is part of the model input only. It is cropped
  // before the result reaches the source compositor, so it cannot alter the
  // document's alpha or introduce hidden RGB behind transparent pixels.
  for (let index = 0; index < imageData.data.length; index += 4) {
    imageData.data[index] = 127;
    imageData.data[index + 1] = 127;
    imageData.data[index + 2] = 127;
    imageData.data[index + 3] = 255;
  }
}

/**
 * Prepare a bounded context for a diffusion inpainting profile.
 *
 * The context is uniformly scaled into the contract's frame. The editable
 * mask is transformed by the same mapping, and `restore` crops the letterbox
 * and resamples the generated frame back to the exact context dimensions.
 * This is deliberately a frame transform rather than a stretch into a square.
 */
export function prepareDiffusionFrame(
  source: ImageData,
  mask: Uint8Array,
  maskWidth: number,
  maskHeight: number,
  contract: DiffusionFrameContract = SD15_INPAINTING_FRAME_CONTRACT,
): DiffusionFrame {
  assertDimensions(source.width, source.height, 'Diffusion source');
  assertDimensions(maskWidth, maskHeight, 'Diffusion mask');
  validateContract(contract);
  if (contract.inputKind !== 'masked-inpainting') {
    throw new Error('Diffusion frame preparation requires a masked-inpainting provider');
  }
  if (mask.length !== maskWidth * maskHeight) {
    throw new Error('Diffusion mask dimensions do not match its pixels');
  }
  if (maskWidth !== source.width || maskHeight !== source.height) {
    throw new Error('Diffusion mask must use source-context dimensions');
  }

  const {
    contentWidth,
    contentHeight,
    offsetX: contentX,
    offsetY: contentY,
  } = computeLetterboxGeometry(
    source.width,
    source.height,
    contract.frameWidth,
    contract.frameHeight,
  );

  const resized =
    contentWidth === source.width && contentHeight === source.height
      ? new ImageData(new Uint8ClampedArray(source.data), source.width, source.height)
      : resampleImageData(source, contentWidth, contentHeight, {
          algorithm: 'bilinear',
          workingSpace: 'linear-srgb',
        }).imageData;
  const resizedMask =
    contentWidth === maskWidth && contentHeight === maskHeight
      ? new Uint8Array(mask)
      : resizeMaskBilinear(mask, maskWidth, maskHeight, contentWidth, contentHeight);

  const modelImage = new ImageData(contract.frameWidth, contract.frameHeight);
  fillLetterbox(modelImage);
  copyIntoLetterbox(modelImage, resized, contentX, contentY);
  const modelMask = new Uint8Array(contract.frameWidth * contract.frameHeight);
  modelMask.fill(contract.maskConvention === 'white-edit-black-preserve' ? 0 : 255);
  const encodedMask = encodeMaskForProvider(resizedMask, contract.maskConvention);
  copyMaskIntoLetterbox(
    modelMask,
    encodedMask,
    contentWidth,
    contentHeight,
    contract.frameWidth,
    contentX,
    contentY,
  );

  return {
    imageData: modelImage,
    mask: modelMask,
    width: contract.frameWidth,
    height: contract.frameHeight,
    contractId: contract.id,
    preprocessingVersion: contract.preprocessingVersion,
    inputKind: contract.inputKind,
    maskConvention: contract.maskConvention,
    maskInput: contract.maskInput,
    contentX,
    contentY,
    contentWidth,
    contentHeight,
    restore(imageData: ImageData): ImageData {
      if (imageData.width !== contract.frameWidth || imageData.height !== contract.frameHeight) {
        throw new Error('Diffusion output does not match the model frame');
      }
      const cropped = new ImageData(contentWidth, contentHeight);
      for (let y = 0; y < contentHeight; y += 1) {
        const sourceOffset = ((contentY + y) * imageData.width + contentX) * 4;
        const targetOffset = y * contentWidth * 4;
        cropped.data.set(
          imageData.data.subarray(sourceOffset, sourceOffset + contentWidth * 4),
          targetOffset,
        );
      }
      if (contentWidth === source.width && contentHeight === source.height) {
        return cropped;
      }
      return resampleImageData(cropped, source.width, source.height, {
        algorithm: 'bilinear',
        workingSpace: 'linear-srgb',
      }).imageData;
    },
  };
}
