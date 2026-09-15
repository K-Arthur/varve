/**
 * Cache-key contract shared by the inference worker and its host.
 *
 * The host can only release a session by the same key the worker cached it
 * under; keeping the format in one module prevents the two from drifting.
 */
export function workerSessionKey(modelType: string, modelPath: string): string {
  return `${modelType}:${modelPath}`;
}
