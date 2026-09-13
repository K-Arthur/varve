import { describe, expect, it } from 'vitest';
import { fontFamilyChanges } from './fontWeight';

describe('fontFamilyChanges', () => {
  it('clears an exact face when the user chooses a family-only value', () => {
    expect(fontFamilyChanges('Inter')).toEqual({
      fontFamily: 'Inter',
      fontReference: undefined,
    });
  });

  it('keeps an empty family explicit while clearing the old face', () => {
    expect(fontFamilyChanges(undefined)).toEqual({
      fontFamily: undefined,
      fontReference: undefined,
    });
  });
});
