/**
 * Human-readable resource requirements for optional on-device models.
 *
 * `sizeBytes` describes the bytes that must be downloaded/stored. It is
 * deliberately kept separate from `peakMemoryBytes`: a compact ONNX file can
 * expand into a much larger tensor/working set during inference.
 */

export function formatModelBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return 'unknown';
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
  if (bytes >= 1_000_000) return `${Math.round(bytes / 1_000_000)} MB`;
  if (bytes >= 1_000) return `${Math.round(bytes / 1_000)} KB`;
  return `${Math.round(bytes)} B`;
}

export function modelRequirementLabel(sizeBytes: number, peakMemoryBytes?: number): string {
  const storage = formatModelBytes(sizeBytes);
  const peak = peakMemoryBytes ? formatModelBytes(peakMemoryBytes) : 'unknown';
  return `Download/storage ~${storage} · estimated peak working memory ~${peak}`;
}
