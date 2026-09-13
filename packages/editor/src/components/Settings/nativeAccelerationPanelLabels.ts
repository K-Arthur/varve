import type { InferenceProviderStatus, UnavailableReason } from '@varve/engine/nativeAcceleration';

export function reasonLabel(reason: UnavailableReason | null): string {
  switch (reason) {
    case null:
      return 'available';
    case 'notPresent':
      return 'no device present';
    case 'driverMissing':
      return 'driver missing';
    case 'runtimeMissing':
      return 'runtime missing';
    case 'artifactMissing':
      return 'component not bundled';
    case 'permissionDenied':
      return 'permission denied';
    case 'softwareOnly':
      return 'software renderer only';
    case 'unsupportedPlatform':
      return 'unsupported platform';
    case 'unsupportedOperator':
      return 'unsupported operators';
    case 'initFailed':
      return 'initialization failed';
    case 'timeout':
      return 'probe timed out';
    case 'deviceLost':
      return 'device lost';
    case 'userDisabled':
      return 'disabled in settings';
    default:
      return 'unavailable';
  }
}

export function inferencePlacementLabel(providers: InferenceProviderStatus[] | undefined): string {
  if (!providers) return 'Not checked yet';

  const verified = providers.find((provider) => provider.stage === 'executionVerified');
  if (verified) return `${verified.label} — execution placement verified for a completed result`;

  const ready = providers.find(
    (provider) =>
      provider.deviceKind === 'gpu' &&
      (provider.stage === 'deviceUsable' || provider.stage === 'runtimeLoadable'),
  );
  if (ready) {
    return `${ready.label} is ready; placement is verified only after a real model run`;
  }

  const npu = providers.find((provider) => provider.deviceKind === 'npu');
  if (npu?.reason) {
    return `No usable NPU provider — ${reasonLabel(npu.reason)}; CPU fallback remains available`;
  }
  return 'No verified accelerator provider; CPU execution remains available';
}

export function npuPlacementLabel(providers: InferenceProviderStatus[] | undefined): string {
  if (!providers) return 'Not checked yet';
  const npuProviders = providers.filter((provider) => provider.deviceKind === 'npu');
  const verified = npuProviders.find((provider) => provider.stage === 'executionVerified');
  if (verified) return `${verified.label} — execution placement verified`;
  const ready = npuProviders.find((provider) => provider.stage !== 'unavailable');
  if (ready) return `${ready.label} is available; placement is not verified yet`;
  return 'No supported NPU provider is installed in this build; CPU fallback remains available';
}
