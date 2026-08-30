export { contrastRatio, relativeLuminance, wcagLevel } from '@varve/shared';

export function formatContrast(ratio: number): string {
  return `${ratio.toFixed(1)}:1`;
}
