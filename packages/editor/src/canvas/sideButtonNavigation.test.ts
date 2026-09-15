import { describe, expect, it } from 'vitest';
import { resolveSideButtonAction } from './sideButtonNavigation';

describe('resolveSideButtonAction', () => {
  it('maps button 3 to previous-selection', () => {
    expect(resolveSideButtonAction(3)).toBe('previous-selection');
  });

  it('maps button 4 to next-selection', () => {
    expect(resolveSideButtonAction(4)).toBe('next-selection');
  });

  it('returns null for all other buttons', () => {
    for (const button of [0, 1, 2, 5, -1, 99]) {
      expect(resolveSideButtonAction(button)).toBeNull();
    }
  });
});
