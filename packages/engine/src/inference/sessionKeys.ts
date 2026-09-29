/**
 * Cache-key contract shared by the inference worker and its host.
 *
 * The two-argument form preserves the original key for callers that only know
 * a model type and path. Production inference supplies a complete identity so
 * a session cannot be reused across different model artifacts, precision,
 * provider/runtime configuration, sidecar layout, or worker generations.
 */
export interface WorkerSessionIdentity {
  artifactRevision?: string;
  precision?: string;
  /** Requested provider profile; the actual provider is recorded by the registry. */
  providerConfiguration?: string;
  runtimeConfiguration?: string;
  deviceGeneration?: number;
  externalDataPath?: string;
  externalDataRevision?: string;
}

export function workerSessionKey(
  modelType: string,
  modelPath: string,
  options?: WorkerSessionIdentity & { modelId?: string },
): string {
  if (!options) return `${modelType}:${modelPath}`;
  const identity = [
    options.modelId ?? '',
    options.artifactRevision ?? modelPath,
    options.externalDataPath ?? '',
    options.externalDataRevision ?? '',
    options.precision ?? 'default',
    options.providerConfiguration ?? 'runtime-managed',
    options.runtimeConfiguration ?? 'worker-default',
    options.deviceGeneration ?? 0,
  ];
  return `${modelType}:${modelPath}:${encodeURIComponent(JSON.stringify(identity))}`;
}
