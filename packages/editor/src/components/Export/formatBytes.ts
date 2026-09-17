/**
 * Byte-size label shared by every export surface (job rows, footer summary,
 * results list). One unit style — a space between value and unit — so the same
 * file never reads `63.3KB` in one place and `63.3 KB` in another.
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
