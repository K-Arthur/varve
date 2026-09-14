/**
 * Capability-based routing for prompted object selection.
 *
 * This function deliberately knows nothing about React, the editor, or model
 * downloads. It takes observed availability/runtime facts and returns a
 * decision record that can be shown in diagnostics. Automatic foreground
 * estimates are a different capability and must never be substituted here.
 */

export const MOBILE_SAM_PROVIDER_ID = 'mobile-sam';
export const SAM2_PROVIDER_ID = 'sam2-hiera-tiny';

export const MOBILE_SAM_ENCODER_ID = 'mobile-sam-encoder';
export const MOBILE_SAM_DECODER_ID = 'mobile-sam-decoder';
export const SAM2_ENCODER_ID = 'sam2-hiera-tiny-encoder';
export const SAM2_DECODER_ID = 'sam2-hiera-tiny-decoder';

export type PromptedSelectionPreference = 'auto' | 'fast' | 'quality';
export type PromptedSelectionExecutionProvider = 'wasm' | 'webgpu' | 'native' | 'cpu';

export interface PromptedProviderFact {
  id: typeof MOBILE_SAM_PROVIDER_ID | typeof SAM2_PROVIDER_ID;
  label: string;
  encoderId: string;
  decoderId: string;
  installed: boolean;
  /** Measured or conservatively audited peak working set for encoder + decode. */
  workingSetBytes: number;
  /** Lower is preferred when the user asks for speed. */
  speedRank: number;
  /** Higher is preferred when the user asks for quality. */
  qualityRank: number;
  supportedExecutionProviders: readonly PromptedSelectionExecutionProvider[];
}

export interface PromptedRoutingRequest {
  preference: PromptedSelectionPreference;
  sourceWidth: number;
  sourceHeight: number;
  executionProvider: PromptedSelectionExecutionProvider;
  /** Runtime's safe reservation ceiling, when measured/reported. */
  safeWorkingSetBytes?: number;
  /** A warm embedding avoids re-paying the encoder cost. */
  cachedEmbeddingProvider?: string;
  providers: readonly PromptedProviderFact[];
}

export interface PromptedRoutingRejection {
  providerId: string;
  reason: string;
}

export interface PromptedRoutingDecision {
  providerId: string | null;
  providerLabel: string | null;
  encoderId: string | null;
  decoderId: string | null;
  reason: string;
  rejected: PromptedRoutingRejection[];
  sourceBytes: number;
  /** Used by the admission gate and recorded for diagnostics. */
  estimatedWorkingSetBytes: number | null;
}

export function routePromptedSelection(request: PromptedRoutingRequest): PromptedRoutingDecision {
  const sourceBytes = request.sourceWidth * request.sourceHeight * 4;
  const rejected: PromptedRoutingRejection[] = [];
  const eligible = request.providers.filter((provider) => {
    if (!provider.installed) {
      rejected.push({
        providerId: provider.id,
        reason: `${provider.label} is not installed locally.`,
      });
      return false;
    }
    if (!provider.supportedExecutionProviders.includes(request.executionProvider)) {
      rejected.push({
        providerId: provider.id,
        reason: `${provider.label} is not validated for ${request.executionProvider}.`,
      });
      return false;
    }
    const estimatedWorkingSetBytes = provider.workingSetBytes + sourceBytes;
    if (
      request.safeWorkingSetBytes != null &&
      estimatedWorkingSetBytes > request.safeWorkingSetBytes
    ) {
      rejected.push({
        providerId: provider.id,
        reason: `${provider.label} needs about ${formatBytes(estimatedWorkingSetBytes)}, above the current ${formatBytes(request.safeWorkingSetBytes)} working-set budget.`,
      });
      return false;
    }
    return true;
  });

  const ordered = [...eligible].sort((left, right) => {
    if (request.cachedEmbeddingProvider) {
      const leftWarm = left.id === request.cachedEmbeddingProvider ? 1 : 0;
      const rightWarm = right.id === request.cachedEmbeddingProvider ? 1 : 0;
      if (leftWarm !== rightWarm) return rightWarm - leftWarm;
    }
    if (request.preference === 'fast') return left.speedRank - right.speedRank;
    if (request.preference === 'quality') return right.qualityRank - left.qualityRank;
    return left.speedRank - right.speedRank;
  });

  const selected = ordered[0];
  if (!selected) {
    return {
      providerId: null,
      providerLabel: null,
      encoderId: null,
      decoderId: null,
      reason:
        'Prompted object selection is unavailable for this runtime and source size. Install a validated local model or use the model-free selection and brush tools.',
      rejected,
      sourceBytes,
      estimatedWorkingSetBytes: null,
    };
  }

  const estimatedWorkingSetBytes = selected.workingSetBytes + sourceBytes;
  const routeReason = buildReason(request, selected, estimatedWorkingSetBytes);
  return {
    providerId: selected.id,
    providerLabel: selected.label,
    encoderId: selected.encoderId,
    decoderId: selected.decoderId,
    reason: routeReason,
    rejected,
    sourceBytes,
    estimatedWorkingSetBytes,
  };
}

function buildReason(
  request: PromptedRoutingRequest,
  provider: PromptedProviderFact,
  estimatedWorkingSetBytes: number,
): string {
  const warm = request.cachedEmbeddingProvider === provider.id;
  const preference =
    request.preference === 'fast'
      ? 'speed preference'
      : request.preference === 'quality'
        ? 'quality preference'
        : 'automatic capability routing';
  const runtime =
    request.executionProvider === 'wasm'
      ? 'WASM'
      : request.executionProvider === 'webgpu'
        ? 'WebGPU'
        : request.executionProvider === 'native'
          ? 'native'
          : 'CPU';
  return `Selected ${provider.label}: ${preference}; ${runtime} runtime; estimated working set ${formatBytes(estimatedWorkingSetBytes)}${warm ? '; warm embedding available' : ''}.`;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GiB`;
  return `${Math.round(bytes / (1024 * 1024))} MiB`;
}
