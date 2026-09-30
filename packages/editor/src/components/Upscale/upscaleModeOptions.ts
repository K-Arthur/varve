import { RESTORATION_CAPABILITIES, UPSCALE_MODES } from '@varve/engine';

export function getUpscaleModeOptions() {
  const animeCapability = RESTORATION_CAPABILITIES.find(
    (capability) => capability.id === 'upscale-realesrgan-anime',
  );
  const animeUnavailable =
    animeCapability?.status !== 'available' || animeCapability?.redistribution !== 'verified';

  return UPSCALE_MODES.map((mode) => {
    if (mode.id !== 'illustration') {
      return { value: mode.id, label: mode.label };
    }

    return {
      value: mode.id,
      label: mode.label,
      disabled: animeUnavailable,
      disabledReason: animeUnavailable
        ? (animeCapability?.statusReason ?? 'This model has not completed its qualification.')
        : undefined,
    };
  });
}
