/**
 * Task classifier — analyzes an image to determine its type and recommend
 * the most appropriate colorization workflow. Deterministic heuristic.
 *
 * Used by the runtime resolver to pick a sensible default workflow and to
 * help the UI surface the right controls. Not a learned classifier — just
 * luminance/statistics thresholds tuned for the design-tool use case.
 */

import type { ImageStats, TaskClassification } from './types';

export function analyzeImageData(imageData: ImageData): ImageStats {
  const { data, width, height } = imageData;
  const pixelCount = width * height;
  if (pixelCount === 0) {
    return {
      meanLuminance: 0,
      saturationStd: 0,
      fractionNearNeutral: 1,
      fractionLowSaturation: 1,
      edgeDensity: 0,
      width,
      height,
    };
  }

  let sumL = 0;
  let satSum = 0;
  let satSumSq = 0;
  let nearNeutral = 0;
  let lowSat = 0;

  for (let i = 0; i < pixelCount; i++) {
    const r = data[i * 4]! / 255;
    const g = data[i * 4 + 1]! / 255;
    const b = data[i * 4 + 2]! / 255;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    const d = max - min;
    const s = l === 0 || l === 1 ? 0 : d / (1 - Math.abs(2 * l - 1));

    sumL += l;
    satSum += s;
    satSumSq += s * s;
    if (d < 0.04) nearNeutral++;
    if (s < 0.08) lowSat++;
  }

  const meanL = sumL / pixelCount;
  const meanSat = satSum / pixelCount;
  const satVariance = Math.max(0, satSumSq / pixelCount - meanSat * meanSat);

  return {
    meanLuminance: meanL,
    saturationStd: Math.sqrt(satVariance),
    fractionNearNeutral: nearNeutral / pixelCount,
    fractionLowSaturation: lowSat / pixelCount,
    edgeDensity: estimateEdgeDensity(data, width, height),
    width,
    height,
  };
}

function estimateEdgeDensity(data: Uint8ClampedArray, width: number, height: number): number {
  if (width < 3 || height < 3) return 0;
  let edges = 0;
  const threshold = 0.15;
  for (let y = 1; y < height - 1; y += 2) {
    for (let x = 1; x < width - 1; x += 2) {
      const idx = (y * width + x) * 4;
      const l = 0.299 * data[idx]! + 0.587 * data[idx + 1]! + 0.114 * data[idx + 2]!;
      const rx = 0.299 * data[idx + 4]! + 0.587 * data[idx + 5]! + 0.114 * data[idx + 6]!;
      const bx =
        0.299 * data[idx + width * 4]! +
        0.587 * data[idx + width * 4 + 1]! +
        0.114 * data[idx + width * 4 + 2]!;
      if (Math.abs(l - rx) > threshold * 255 || Math.abs(l - bx) > threshold * 255) {
        edges++;
      }
    }
  }
  const samples = ((width - 2) >> 1) * ((height - 2) >> 1);
  return samples > 0 ? edges / samples : 0;
}

export function classifyTask(stats: ImageStats): TaskClassification {
  if (stats.fractionLowSaturation > 0.92 && stats.saturationStd < 0.05) {
    const isLineart = stats.edgeDensity > 0.2 && stats.meanLuminance > 0.7;
    return {
      sourceKind: isLineart ? 'lineart' : 'photo',
      recommendedWorkflow: isLineart ? 'lineart-colorize' : 'photo-colorize',
      confidence: 0.9,
    };
  }

  if (stats.fractionLowSaturation > 0.7) {
    return {
      sourceKind: 'illustration',
      recommendedWorkflow: 'palette-colorize',
      confidence: 0.6,
    };
  }

  return {
    sourceKind: 'already-colored',
    recommendedWorkflow: 'selective-recolor',
    confidence: 0.5,
  };
}
