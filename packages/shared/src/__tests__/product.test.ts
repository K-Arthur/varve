import { describe, expect, it } from 'vitest';
import { PRODUCT_STATUS } from '../product';

const STAGES = ['pre-alpha', 'alpha', 'beta', 'stable'] as const;

describe('PRODUCT_STATUS', () => {
  it('uses a known maturity stage', () => {
    expect(STAGES).toContain(PRODUCT_STATUS.stage);
  });

  it('keeps label and description in sync with the stage', () => {
    if (PRODUCT_STATUS.stage === 'beta') {
      expect(PRODUCT_STATUS.label).toBe('Public Beta');
      expect(PRODUCT_STATUS.description).toContain('public beta');
    }
  });

  it('has a non-empty, single-line description', () => {
    expect(PRODUCT_STATUS.description.trim().length).toBeGreaterThan(40);
    expect(PRODUCT_STATUS.description).not.toContain('\n');
  });
});
