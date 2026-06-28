import { describe, expect, it } from 'vitest';
import { PACKAGE } from './index';

describe('@strata/shared', () => {
  it('exposes its package marker', () => {
    expect(PACKAGE).toBe('@strata/shared');
  });
});
