import { FontRegistry } from '@varve/engine';
import { fontReferenceKey } from '@varve/engine/font';
import type { TextNode } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import {
  fontFamilyChanges,
  fontStyleAvailable,
  fontStyleChanges,
  fontWeightChanges,
  fontWeightOptions,
} from './fontWeight';

function node(
  overrides: Partial<
    Pick<TextNode, 'fontFamily' | 'fontWeight' | 'fontStyle' | 'fontReference' | 'variableAxes'>
  > = {},
) {
  return {
    fontFamily: 'Georgia',
    fontWeight: 400,
    fontStyle: 'normal' as const,
    ...overrides,
  };
}

describe('fontFamilyChanges', () => {
  it('clears an exact face when the user chooses a family-only value', () => {
    expect(fontFamilyChanges('Inter')).toEqual({
      fontFamily: 'Inter',
      fontReference: undefined,
      variableAxes: undefined,
    });
  });

  it('keeps an empty family explicit while clearing the old face', () => {
    expect(fontFamilyChanges(undefined)).toEqual({
      fontFamily: undefined,
      fontReference: undefined,
      variableAxes: undefined,
    });
  });
});

describe('fontWeightOptions', () => {
  it('uses the registered static faces for the selected style', () => {
    const registry = new FontRegistry([
      { family: 'Demo', weight: 400, style: 'normal', source: 'user' },
      { family: 'Demo', weight: 700, style: 'normal', source: 'user' },
      { family: 'Demo', weight: 400, style: 'italic', source: 'user' },
    ]);

    expect(fontWeightOptions(node({ fontFamily: 'Demo' }), registry)).toEqual([
      { value: 400, label: '400' },
      { value: 700, label: '700' },
    ]);
  });

  it('uses the exact wght range for variable faces', () => {
    const registry = new FontRegistry([
      {
        family: 'Variable Demo',
        weight: 400,
        style: 'normal',
        source: 'user',
        axisDefinitions: [{ tag: 'wght', name: 'Weight', min: 350, default: 425, max: 725 }],
      },
    ]);

    expect(fontWeightOptions(node({ fontFamily: 'Variable Demo' }), registry)).toEqual([
      { value: 350, label: '350' },
      { value: 400, label: '400' },
      { value: 425, label: '425' },
      { value: 500, label: '500' },
      { value: 600, label: '600' },
      { value: 700, label: '700' },
      { value: 725, label: '725' },
    ]);
  });

  it('keeps an unavailable persisted value visible and disabled', () => {
    const registry = new FontRegistry([
      { family: 'Demo', weight: 400, style: 'normal', source: 'user' },
    ]);

    expect(fontWeightOptions(node({ fontFamily: 'Demo', fontWeight: 700 }), registry)).toEqual([
      { value: 400, label: '400' },
      { value: 700, label: '700', disabled: true, disabledReason: expect.any(String) },
    ]);
  });

  it('only enables weights shared by every selected face', () => {
    const registry = new FontRegistry([
      { family: 'A', weight: 400, style: 'normal', source: 'user' },
      { family: 'A', weight: 700, style: 'normal', source: 'user' },
      { family: 'B', weight: 400, style: 'normal', source: 'user' },
    ]);

    expect(
      fontWeightOptions([node({ fontFamily: 'A' }), node({ fontFamily: 'B' })], registry),
    ).toEqual([
      { value: 400, label: '400' },
      { value: 700, label: '700', disabled: true, disabledReason: expect.any(String) },
    ]);
  });

  it('scopes static weights to an exact artifact when the registry has face keys', () => {
    const firstReference = { artifactHash: 'a'.repeat(64) };
    const secondReference = { artifactHash: 'b'.repeat(64) };
    const registry = new FontRegistry([
      {
        family: 'Duplicate Family',
        weight: 400,
        style: 'normal',
        source: 'user',
        faceKey: fontReferenceKey(firstReference),
      },
      {
        family: 'Duplicate Family',
        weight: 700,
        style: 'normal',
        source: 'user',
        faceKey: fontReferenceKey(firstReference),
      },
      {
        family: 'Duplicate Family',
        weight: 400,
        style: 'normal',
        source: 'user',
        faceKey: fontReferenceKey(secondReference),
      },
    ]);

    expect(
      fontWeightOptions(
        node({ fontFamily: 'Duplicate Family', fontReference: secondReference }),
        registry,
      ),
    ).toEqual([{ value: 400, label: '400' }]);
  });

  it('uses a matching PostScript name when an older entry lacks a face key', () => {
    const registry = new FontRegistry([
      {
        family: 'Legacy Family',
        weight: 400,
        style: 'normal',
        source: 'user',
        postScriptName: 'Legacy-Regular',
      },
      {
        family: 'Legacy Family',
        weight: 700,
        style: 'normal',
        source: 'user',
        postScriptName: 'Legacy-Bold',
      },
    ]);

    expect(
      fontWeightOptions(
        node({
          fontFamily: 'Legacy Family',
          fontWeight: 700,
          fontReference: {
            artifactHash: 'c'.repeat(64),
            postScriptName: 'Legacy-Bold',
          },
        }),
        registry,
      ),
    ).toEqual([{ value: 700, label: '700' }]);
  });

  it('keeps a face from another artifact unavailable instead of borrowing family weights', () => {
    const registry = new FontRegistry([
      {
        family: 'Duplicate Family',
        weight: 400,
        style: 'normal',
        source: 'user',
        faceKey: fontReferenceKey({ artifactHash: 'a'.repeat(64) }),
      },
      {
        family: 'Duplicate Family',
        weight: 700,
        style: 'normal',
        source: 'user',
        faceKey: fontReferenceKey({ artifactHash: 'b'.repeat(64) }),
      },
    ]);

    expect(
      fontWeightOptions(
        node({
          fontFamily: 'Duplicate Family',
          fontWeight: 400,
          fontReference: { artifactHash: 'c'.repeat(64) },
        }),
        registry,
      ),
    ).toEqual([
      {
        value: 400,
        label: '400',
        disabled: true,
        disabledReason: expect.any(String),
      },
    ]);
  });
});

describe('fontWeightChanges', () => {
  it('moves a collection face reference when the requested weight is another member', () => {
    const regularReference = { artifactHash: 'a'.repeat(64), collectionIndex: 0 };
    const boldReference = { artifactHash: 'a'.repeat(64), collectionIndex: 1 };
    const registry = new FontRegistry([
      {
        family: 'Collection Family',
        weight: 400,
        style: 'normal',
        source: 'user',
        faceKey: fontReferenceKey(regularReference),
        postScriptName: 'Collection-Regular',
      },
      {
        family: 'Collection Family',
        weight: 700,
        style: 'normal',
        source: 'user',
        faceKey: fontReferenceKey(boldReference),
        postScriptName: 'Collection-Bold',
      },
    ]);
    const current = node({
      fontFamily: 'Collection Family',
      fontWeight: 400,
      fontReference: regularReference,
    }) as TextNode;

    expect(fontWeightChanges(current, 700, registry)).toEqual({
      fontWeight: 700,
      fontReference: { ...boldReference, postScriptName: 'Collection-Bold' },
    });
  });

  it('clears an exact reference when no same-artifact static face can satisfy the weight', () => {
    const current = node({
      fontFamily: 'Static Family',
      fontWeight: 400,
      fontReference: { artifactHash: 'a'.repeat(64) },
    }) as TextNode;
    const registry = new FontRegistry([
      {
        family: 'Static Family',
        weight: 400,
        style: 'normal',
        source: 'user',
        faceKey: fontReferenceKey({ artifactHash: 'a'.repeat(64) }),
      },
      {
        family: 'Static Family',
        weight: 700,
        style: 'normal',
        source: 'user',
        faceKey: fontReferenceKey({ artifactHash: 'b'.repeat(64) }),
      },
    ]);

    expect(fontWeightChanges(current, 700, registry)).toEqual({
      fontWeight: 700,
      fontReference: undefined,
    });
  });

  it('does not borrow a wght axis from another same-family artifact', () => {
    const staticHash = 'c'.repeat(64);
    const variableHash = 'd'.repeat(64);
    const registry = new FontRegistry([
      {
        family: 'Colliding Family',
        weight: 400,
        style: 'normal',
        source: 'user',
        faceKey: fontReferenceKey({ artifactHash: staticHash }),
      },
      {
        family: 'Colliding Family',
        weight: 400,
        style: 'normal',
        source: 'user',
        faceKey: fontReferenceKey({ artifactHash: variableHash }),
        axisDefinitions: [{ tag: 'wght', name: 'Weight', min: 300, default: 400, max: 700 }],
      },
    ]);

    expect(
      fontWeightChanges(
        node({ fontFamily: 'Colliding Family', fontReference: { artifactHash: staticHash } }),
        700,
        registry,
      ),
    ).toEqual({ fontWeight: 700, fontReference: undefined });
  });

  it('does not borrow a wght axis from another collection member', () => {
    const artifactHash = '3'.repeat(64);
    const registry = new FontRegistry([
      {
        family: 'Collection Axis Family',
        weight: 400,
        style: 'normal',
        source: 'user',
        faceKey: fontReferenceKey({ artifactHash, collectionIndex: 0 }),
      },
      {
        family: 'Collection Axis Family',
        weight: 400,
        style: 'normal',
        source: 'user',
        faceKey: fontReferenceKey({ artifactHash, collectionIndex: 1 }),
        axisDefinitions: [{ tag: 'wght', name: 'Weight', min: 300, default: 400, max: 700 }],
      },
    ]);

    expect(
      fontWeightChanges(
        node({
          fontFamily: 'Collection Axis Family',
          fontReference: { artifactHash, collectionIndex: 0 },
        }),
        700,
        registry,
      ),
    ).toEqual({ fontWeight: 700, fontReference: undefined });
  });
});

describe('fontStyleChanges', () => {
  it('recognizes only styles supplied by the selected artifact', () => {
    const artifactHash = 'f'.repeat(64);
    const registry = new FontRegistry([
      {
        family: 'Duplicate Style Family',
        weight: 400,
        style: 'normal',
        source: 'user',
        faceKey: fontReferenceKey({ artifactHash }),
      },
      {
        family: 'Duplicate Style Family',
        weight: 400,
        style: 'italic',
        source: 'user',
        faceKey: fontReferenceKey({ artifactHash: '0'.repeat(64) }),
      },
    ]);

    expect(
      fontStyleAvailable(
        node({
          fontFamily: 'Duplicate Style Family',
          fontReference: { artifactHash },
        }),
        'italic',
        registry,
      ),
    ).toBe(false);
  });

  it('recognizes an italic variation axis as a real style', () => {
    const registry = new FontRegistry([
      {
        family: 'Italic Variable',
        weight: 400,
        style: 'normal',
        source: 'user',
        axisDefinitions: [{ tag: 'ital', name: 'Italic', min: 0, default: 0, max: 1 }],
      },
    ]);

    expect(fontStyleAvailable(node({ fontFamily: 'Italic Variable' }), 'italic', registry)).toBe(
      true,
    );
  });

  it('does not treat another collection member axis as the selected style', () => {
    const artifactHash = '5'.repeat(64);
    const registry = new FontRegistry([
      {
        family: 'Collection Italic Family',
        weight: 400,
        style: 'normal',
        source: 'user',
        faceKey: fontReferenceKey({ artifactHash, collectionIndex: 0 }),
      },
      {
        family: 'Collection Italic Family',
        weight: 400,
        style: 'normal',
        source: 'user',
        faceKey: fontReferenceKey({ artifactHash, collectionIndex: 1 }),
        axisDefinitions: [{ tag: 'ital', name: 'Italic', min: 0, default: 0, max: 1 }],
      },
    ]);

    expect(
      fontStyleAvailable(
        node({
          fontFamily: 'Collection Italic Family',
          fontReference: { artifactHash, collectionIndex: 0 },
        }),
        'italic',
        registry,
      ),
    ).toBe(false);
  });

  it('couples variable italic changes to the ital axis', () => {
    const registry = new FontRegistry([
      {
        family: 'Italic Variable',
        weight: 400,
        style: 'normal',
        source: 'user',
        axisDefinitions: [{ tag: 'ital', name: 'Italic', min: 0, default: 0, max: 1 }],
      },
    ]);

    expect(
      fontStyleChanges(
        node({ fontFamily: 'Italic Variable', variableAxes: { wdth: 90 } }),
        'italic',
        registry,
      ),
    ).toEqual({ fontStyle: 'italic', variableAxes: { wdth: 90, ital: 1 } });
  });

  it('moves an exact static face to a matching italic sibling', () => {
    const artifactHash = 'd'.repeat(64);
    const registry = new FontRegistry([
      {
        family: 'Styled Family',
        weight: 400,
        style: 'normal',
        source: 'user',
        faceKey: fontReferenceKey({ artifactHash }),
        postScriptName: 'Styled-Regular',
      },
      {
        family: 'Styled Family',
        weight: 400,
        style: 'italic',
        source: 'user',
        faceKey: fontReferenceKey({ artifactHash, collectionIndex: 1 }),
        postScriptName: 'Styled-Italic',
      },
    ]);

    const changes = fontStyleChanges(
      node({
        fontFamily: 'Styled Family',
        fontReference: { artifactHash },
      }),
      'italic',
      registry,
    );

    expect(changes).toEqual({
      fontStyle: 'italic',
      fontReference: {
        artifactHash,
        collectionIndex: 1,
        postScriptName: 'Styled-Italic',
      },
    });
  });

  it('clears an exact reference when the requested style is unavailable', () => {
    const artifactHash = 'e'.repeat(64);
    const registry = new FontRegistry([
      {
        family: 'Regular Only',
        weight: 400,
        style: 'normal',
        source: 'user',
        faceKey: fontReferenceKey({ artifactHash }),
      },
    ]);

    expect(
      fontStyleChanges(
        node({ fontFamily: 'Regular Only', fontReference: { artifactHash } }),
        'italic',
        registry,
      ),
    ).toEqual({ fontStyle: 'italic', fontReference: undefined });
  });

  it('does not borrow an ital axis from another same-family artifact', () => {
    const staticHash = '1'.repeat(64);
    const variableHash = '2'.repeat(64);
    const registry = new FontRegistry([
      {
        family: 'Colliding Style Family',
        weight: 400,
        style: 'normal',
        source: 'user',
        faceKey: fontReferenceKey({ artifactHash: staticHash }),
      },
      {
        family: 'Colliding Style Family',
        weight: 400,
        style: 'normal',
        source: 'user',
        faceKey: fontReferenceKey({ artifactHash: variableHash }),
        axisDefinitions: [{ tag: 'ital', name: 'Italic', min: 0, default: 0, max: 1 }],
      },
    ]);

    expect(
      fontStyleChanges(
        node({ fontFamily: 'Colliding Style Family', fontReference: { artifactHash: staticHash } }),
        'italic',
        registry,
      ),
    ).toEqual({ fontStyle: 'italic', fontReference: undefined });
  });

  it('does not borrow an ital axis from another collection member', () => {
    const artifactHash = '4'.repeat(64);
    const registry = new FontRegistry([
      {
        family: 'Collection Style Family',
        weight: 400,
        style: 'normal',
        source: 'user',
        faceKey: fontReferenceKey({ artifactHash, collectionIndex: 0 }),
      },
      {
        family: 'Collection Style Family',
        weight: 400,
        style: 'normal',
        source: 'user',
        faceKey: fontReferenceKey({ artifactHash, collectionIndex: 1 }),
        axisDefinitions: [{ tag: 'ital', name: 'Italic', min: 0, default: 0, max: 1 }],
      },
    ]);

    expect(
      fontStyleChanges(
        node({
          fontFamily: 'Collection Style Family',
          fontReference: { artifactHash, collectionIndex: 0 },
        }),
        'italic',
        registry,
      ),
    ).toEqual({ fontStyle: 'italic', fontReference: undefined });
  });
});
