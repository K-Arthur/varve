import { describe, expect, it } from 'vitest';
import {
  getGuideClipboardMemory,
  parseGuideClipboard,
  serializeGuideClipboard,
  setGuideClipboardMemory,
} from './guideClipboard';

describe('guideClipboard', () => {
  it('round-trips guides through JSON', () => {
    const guides = [{ id: 'g1', axis: 'vertical' as const, position: 120, pageId: 'p1' }];
    const parsed = parseGuideClipboard(serializeGuideClipboard(guides));
    expect(parsed).toEqual(guides);
  });

  it('stores guides in memory fallback', () => {
    const guides = [{ id: 'g2', axis: 'horizontal' as const, position: 80 }];
    setGuideClipboardMemory(guides);
    expect(getGuideClipboardMemory()).toEqual(guides);
  });
});
