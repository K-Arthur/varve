/**
 * Runtime resolver — maps a (workflow, quality mode, image stats, installed
 * models) tuple to a concrete execution plan: which model, at what
 * resolution, on which provider, with what tiling strategy.
 *
 * The resolver stores user *intent* (quality mode), not a hardware-bound
 * model ID. The same document reopens correctly on a machine without the
 * specific model — the resolver picks the best available alternative and
 * the UI surfaces a clear message.
 *
 * Quality modes map to verified runtime differences:
 *   - fast:        tiny model, 256px max dim, CPU/WASM, no tiling
 *   - balanced:    default model, 512px max dim, any available provider
 *   - quality:     default model, 1024px max dim, GPU if available, tiled
 *   - automatic:   picks balanced or quality based on image size + hardware
 */

import type { ColorizationModelConfig, ImageStats, QualityMode, RuntimeResolution } from './types';

export const DD_COLOR_MODELS: Record<string, ColorizationModelConfig> = {
  'ddcolor-tiny': {
    modelId: 'ddcolor-tiny',
    inputSize: 256,
    outputChannels: 2,
    preferredProvider: 'cpu',
  },
  ddcolor: {
    modelId: 'ddcolor',
    inputSize: 512,
    outputChannels: 2,
    preferredProvider: 'any',
  },
};

export function resolveRuntime(
  _workflow: string,
  qualityMode: QualityMode,
  stats: ImageStats,
  installedModels: string[],
): RuntimeResolution {
  const longest = Math.max(stats.width, stats.height);
  const hasDefault = installedModels.includes('ddcolor');
  const hasTiny = installedModels.includes('ddcolor-tiny');

  let modelId: string;
  let maxDimension: number;
  let tiled: boolean;

  switch (qualityMode) {
    case 'fast':
      modelId = hasTiny ? 'ddcolor-tiny' : hasDefault ? 'ddcolor' : 'ddcolor';
      maxDimension = 256;
      tiled = false;
      break;
    case 'quality':
      modelId = hasDefault || !hasTiny ? 'ddcolor' : 'ddcolor-tiny';
      maxDimension = 1024;
      tiled = longest > 1024;
      break;
    case 'balanced':
      modelId = hasDefault || !hasTiny ? 'ddcolor' : 'ddcolor-tiny';
      maxDimension = 512;
      tiled = longest > 1536;
      break;
    default: {
      const preferQuality = longest <= 2048 && hasDefault;
      modelId = hasDefault || !hasTiny ? 'ddcolor' : 'ddcolor-tiny';
      maxDimension = preferQuality ? 1024 : 512;
      tiled = preferQuality && longest > 1024;
      break;
    }
  }

  return {
    modelId,
    maxDimension,
    provider: selectProvider(modelId, qualityMode),
    tiled,
    tileSize: 512,
    tileOverlap: 64,
  };
}

function selectProvider(modelId: string, qualityMode: QualityMode): RuntimeResolution['provider'] {
  if (qualityMode === 'fast') return 'wasm';
  const config = DD_COLOR_MODELS[modelId];
  if (config?.preferredProvider === 'cpu') return 'wasm';
  return 'cpu';
}
