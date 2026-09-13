import { FontRegistry } from '@varve/engine';
import type { TextNode } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { fontFamilyChanges, fontWeightOptions } from './fontWeight';

function node(overrides: Partial<Pick<TextNode, 'fontFamily' | 'fontWeight' | 'fontStyle'>> = {}) {
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
    });
  });

  it('keeps an empty family explicit while clearing the old face', () => {
    expect(fontFamilyChanges(undefined)).toEqual({
      fontFamily: undefined,
      fontReference: undefined,
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
});
