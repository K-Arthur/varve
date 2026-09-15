import { describe, expect, it } from 'vitest';
import { formatModelBytes, modelRequirementLabel } from './modelRequirements';

describe('model resource requirements', () => {
  it('formats decimal storage and working-memory sizes', () => {
    expect(formatModelBytes(4_574_861)).toBe('5 MB');
    expect(formatModelBytes(1_300_000_000)).toBe('1.3 GB');
    expect(modelRequirementLabel(224_005_088, 7_000_000_000)).toBe(
      'Download/storage ~224 MB · estimated peak working memory ~7.0 GB',
    );
  });

  it('does not turn missing measurements into a false zero-byte claim', () => {
    expect(modelRequirementLabel(0)).toBe(
      'Download/storage ~unknown · estimated peak working memory ~unknown',
    );
  });
});
