import { describe, expect, it } from 'vitest';
import { PACKAGE } from './index';

describe('@strata/ui', () => {
  it('exposes its package marker', () => {
    expect(PACKAGE).toBe('@strata/ui');
  });
});
