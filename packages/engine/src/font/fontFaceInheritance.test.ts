import { describe, expect, it } from 'vitest';
import { inheritedFontReference } from './fontFaceInheritance';

const reference = { artifactHash: 'a'.repeat(64), collectionIndex: 1 };

describe('inheritedFontReference', () => {
  it('inherits an exact face when a run keeps the parent family', () => {
    expect(inheritedFontReference('Inter', reference, undefined, undefined)).toEqual(reference);
    expect(inheritedFontReference('Inter', reference, ' inter ', undefined)).toEqual(reference);
  });

  it('prefers a run face when the family is unchanged', () => {
    const replacement = { artifactHash: 'b'.repeat(64), collectionIndex: 0 };
    expect(inheritedFontReference('Inter', reference, 'Inter', replacement)).toEqual(replacement);
  });

  it('clears the parent face when a run changes family', () => {
    expect(inheritedFontReference('Inter', reference, 'Roboto', undefined)).toBeUndefined();
  });
});
