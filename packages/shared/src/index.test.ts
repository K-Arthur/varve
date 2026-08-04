import { describe, expect, it } from 'vitest';
import { PACKAGE } from './index';

describe('@varve/shared', () => {
  it('exposes its package marker', () => {
    expect(PACKAGE).toBe('@varve/shared');
  });
});
