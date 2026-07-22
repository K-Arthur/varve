import { gaussianBlurSeparable } from './blur';

function clampByte(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

function depthToRadius(
  depthNorm: number,
  focalDepth: number,
  transitionRange: number,
  blurAmount: number,
  invert: boolean,
): number {
  const d = invert ? 1 - depthNorm : depthNorm;
  const diff = Math.abs(d - focalDepth);
  const inFocusRange = transitionRange * 0.5;
  if (diff <= inFocusRange) return 0;
  const t = Math.min(1, (diff - inFocusRange) / Math.max(0.001, 1 - inFocusRange));
  return t * blurAmount;
}

export function applyLensBlur(
  imageData: ImageData,
  depthMap: Uint8Array,
  options: {
    blurAmount: number;
    focalDepth: number;
    transitionRange: number;
    invert: boolean;
  },
): ImageData {
  const { blurAmount, focalDepth, transitionRange, invert } = options;
  const w = imageData.width;
  const h = imageData.height;

  if (blurAmount <= 0 || depthMap.length !== w * h) {
    return new ImageData(new Uint8ClampedArray(imageData.data), w, h);
  }

  const numLevels = 5;
  const levelRadius = blurAmount / (numLevels - 1 || 1);

  const blurredLevels: ImageData[] = [];
  for (let i = 0; i < numLevels; i++) {
    const radius = i * levelRadius;
    if (i === 0) {
      blurredLevels.push(new ImageData(new Uint8ClampedArray(imageData.data), w, h));
    } else {
      blurredLevels.push(
        gaussianBlurSeparable(
          new ImageData(new Uint8ClampedArray(imageData.data), w, h),
          Math.round(radius),
        ),
      );
    }
  }

  const output = new Uint8ClampedArray(imageData.data.length);
  const len = depthMap.length;

  for (let i = 0; i < len; i++) {
    const depthNorm = depthMap[i]! / 255;
    const desired = depthToRadius(depthNorm, focalDepth, transitionRange, blurAmount, invert);

    if (desired <= 0) {
      const px = i * 4;
      output[px] = imageData.data[px]!;
      output[px + 1] = imageData.data[px + 1]!;
      output[px + 2] = imageData.data[px + 2]!;
      output[px + 3] = imageData.data[px + 3]!;
      continue;
    }

    const lowerLevel = Math.min(
      numLevels - 2,
      Math.max(0, Math.floor(desired / (levelRadius || 1))),
    );
    const upperLevel = lowerLevel + 1;

    const lowerDesired = lowerLevel * levelRadius;
    const upperDesired = upperLevel * levelRadius;
    const range = upperDesired - lowerDesired || 1;
    const t = (desired - lowerDesired) / range;

    const px = i * 4;
    const lData = blurredLevels[lowerLevel]!.data;
    const uData = blurredLevels[upperLevel]!.data;

    output[px] = clampByte(lData[px]! * (1 - t) + uData[px]! * t);
    output[px + 1] = clampByte(lData[px + 1]! * (1 - t) + uData[px + 1]! * t);
    output[px + 2] = clampByte(lData[px + 2]! * (1 - t) + uData[px + 2]! * t);
    output[px + 3] = clampByte(lData[px + 3]! * (1 - t) + uData[px + 3]! * t);
  }

  return new ImageData(output, w, h);
}

export function depthToHeatmapImageData(
  depthMap: Uint8Array,
  width: number,
  height: number,
  alpha = 160,
): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < depthMap.length; i++) {
    const d = depthMap[i]! / 255;
    const px = i * 4;
    let r: number;
    let g: number;
    let b: number;
    if (d < 0.25) {
      const t = d / 0.25;
      r = 0;
      g = Math.round(t * 255);
      b = 255;
    } else if (d < 0.5) {
      const t = (d - 0.25) / 0.25;
      r = 0;
      g = 255;
      b = Math.round((1 - t) * 255);
    } else if (d < 0.75) {
      const t = (d - 0.5) / 0.25;
      r = Math.round(t * 255);
      g = 255;
      b = 0;
    } else {
      const t = (d - 0.75) / 0.25;
      r = 255;
      g = Math.round((1 - t) * 255);
      b = 0;
    }
    data[px] = r;
    data[px + 1] = g;
    data[px + 2] = b;
    data[px + 3] = alpha;
  }
  return new ImageData(data, width, height);
}

export function depthToBlurWeight(
  depthNorm: number,
  focalDepth: number,
  transitionRange: number,
  invert: boolean,
): number {
  const d = invert ? 1 - depthNorm : depthNorm;
  const diff = Math.abs(d - focalDepth);
  const inFocusRange = transitionRange * 0.5;
  if (diff <= inFocusRange) return 0;
  return Math.min(1, (diff - inFocusRange) / Math.max(0.001, 1 - inFocusRange));
}
