import { describe, expect, it } from 'vitest';

import { FormatTokenResolutionError, resolveFormatTokenValue } from '../formatTokenResolver';
import { parseFormatDocument } from '../parse';
import { buildReferenceGraph } from '../refGraph';
import { parseResolverDocument, resolvePermutation } from '../resolver';
import type { DtcgDocument } from '../types';

function parseDocument(value: Record<string, unknown>): DtcgDocument {
  return parseFormatDocument(JSON.stringify(value), { sourceFileId: 'tokens.json' });
}

function catchResolutionError(callback: () => unknown): FormatTokenResolutionError {
  try {
    callback();
  } catch (error) {
    if (error instanceof FormatTokenResolutionError) return error;
    throw error;
  }
  throw new Error('Expected token resolution to fail');
}

describe('resolveFormatTokenValue', () => {
  it('resolves complete curly aliases and chained aliases to the final token value', () => {
    const document = parseDocument({
      color: {
        $type: 'color',
        blue: { $value: { colorSpace: 'srgb', components: [0.1, 0.2, 0.9] } },
        primary: { $value: '{color.blue}' },
        action: { $value: '{color.primary}' },
      },
    });

    expect(resolveFormatTokenValue(document, 'color.action')).toEqual({
      colorSpace: 'srgb',
      components: [0.1, 0.2, 0.9],
    });
    expect(resolveFormatTokenValue(document, ['color', 'blue'])).toEqual({
      colorSpace: 'srgb',
      components: [0.1, 0.2, 0.9],
    });
    expect(resolveFormatTokenValue(document, document.tokens['color.primary']!)).toEqual({
      colorSpace: 'srgb',
      components: [0.1, 0.2, 0.9],
    });
  });

  it('follows token-level JSON Pointer references and pointers chained through alias tokens', () => {
    const document = parseDocument({
      color: {
        $type: 'color',
        base: { $value: { colorSpace: 'srgb', components: [0.2, 0.4, 0.6] } },
        direct: { $ref: '#/color/base/$value' },
        chained: { $ref: '#/color/direct' },
      },
    });

    expect(resolveFormatTokenValue(document, 'color.direct')).toEqual({
      colorSpace: 'srgb',
      components: [0.2, 0.4, 0.6],
    });
    expect(resolveFormatTokenValue(document, 'color.chained')).toEqual({
      colorSpace: 'srgb',
      components: [0.2, 0.4, 0.6],
    });
  });

  it('resolves nested property pointers inside composites and arrays', () => {
    const document = parseDocument({
      palette: {
        $type: 'color',
        blue: { $value: { colorSpace: 'srgb', components: [0, 0.25, 1] } },
      },
      metrics: {
        spacing: { $type: 'dimension', $value: { value: 8, unit: 'px' } },
      },
      shadow: {
        $type: 'shadow',
        card: {
          $value: {
            color: { $ref: '#/palette/blue/$value' },
            offsetX: { $ref: '#/metrics/spacing/$value/value' },
            samples: [
              { $ref: '#/palette/blue/$value/components/1' },
              { $ref: '#/metrics/spacing/$value/unit' },
            ],
          },
        },
      },
    });

    expect(resolveFormatTokenValue(document, 'shadow.card')).toEqual({
      color: { colorSpace: 'srgb', components: [0, 0.25, 1] },
      offsetX: 8,
      samples: [0.25, 'px'],
    });
  });

  it('uses the shared value resolver for resolved Resolver permutations', () => {
    const resolver = parseResolverDocument(
      JSON.stringify({
        version: '2025.10',
        resolutionOrder: [
          {
            type: 'set',
            name: 'tokens',
            sources: [
              {
                color: {
                  $type: 'color',
                  blue: {
                    $value: { colorSpace: 'srgb', components: [0.2, 0.4, 0.8] },
                  },
                },
                shadow: {
                  $type: 'shadow',
                  card: {
                    $value: {
                      color: { $ref: '#/color/blue/$value' },
                      offsetX: { value: 2, unit: 'px' },
                      offsetY: { value: 2, unit: 'px' },
                      blur: { value: 4, unit: 'px' },
                      spread: { value: 0, unit: 'px' },
                    },
                  },
                },
              },
            ],
          },
        ],
      }),
    );

    const permutation = resolvePermutation(resolver, {});

    expect(permutation.resolved['shadow.card']).toEqual({
      color: { colorSpace: 'srgb', components: [0.2, 0.4, 0.8] },
      offsetX: { value: 2, unit: 'px' },
      offsetY: { value: 2, unit: 'px' },
      blur: { value: 4, unit: 'px' },
      spread: { value: 0, unit: 'px' },
    });
    expect(permutation.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual(
      [],
    );
  });

  it('uses RFC 6901 escaping for group and token names in pointers', () => {
    const document = parseDocument({
      'palette/night': {
        $type: 'color',
        'sun~rise': { $value: { colorSpace: 'srgb', components: [1, 0.5, 0] } },
      },
      alias: { $type: 'color', $ref: '#/palette~1night/sun~0rise/$value' },
    });

    expect(resolveFormatTokenValue(document, 'alias')).toEqual({
      colorSpace: 'srgb',
      components: [1, 0.5, 0],
    });
  });

  it('resolves aliases to a document-root $root token', () => {
    const document = parseDocument({
      $type: 'number',
      $root: { $value: 12 },
      alias: { $value: '{$root}' },
      pointerAlias: { $ref: '#/$root' },
    });

    expect(resolveFormatTokenValue(document, '$root')).toBe(12);
    expect(resolveFormatTokenValue(document, 'alias')).toBe(12);
    expect(resolveFormatTokenValue(document, 'pointerAlias')).toBe(12);
    expect(document.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual(
      [],
    );
  });

  it('inherits an alias type from its resolved token before applying group type', () => {
    const document = parseDocument({
      base: {
        color: {
          $type: 'color',
          $value: { colorSpace: 'srgb', components: [0.3, 0.2, 0.1] },
        },
      },
      aliases: {
        $type: 'dimension',
        curly: { $value: '{base.color}' },
        pointer: { $ref: '#/base/color' },
      },
    });

    expect(document.tokens['aliases.curly']?.type).toBe('color');
    expect(document.tokens['aliases.pointer']?.type).toBe('color');
  });

  it('rejects explicitly mistyped whole-token aliases but permits component references', () => {
    const mismatchDocument = parseDocument({
      base: { $type: 'number', $value: 1 },
      alias: { $type: 'color', $value: '{base}' },
      pointerAlias: { $type: 'color', $ref: '#/base/$value' },
    });
    const mismatches = buildReferenceGraph(mismatchDocument).diagnostics.filter(
      (diagnostic) => diagnostic.code === 'ref.type-mismatch',
    );
    expect(mismatches).toHaveLength(2);
    expect(mismatches.every((diagnostic) => diagnostic.severity === 'error')).toBe(true);
    expect(mismatches[0]?.message).toContain('explicitly declares type "color"');

    const componentDocument = parseDocument({
      base: {
        $type: 'color',
        $value: { colorSpace: 'srgb', components: [0.3, 0.2, 0.1] },
      },
      component: { $type: 'number', $value: { $ref: '#/base/$value/components/0' } },
    });
    expect(
      buildReferenceGraph(componentDocument).diagnostics.some(
        (diagnostic) => diagnostic.code === 'ref.type-mismatch',
      ),
    ).toBe(false);
  });

  it('reports missing token and pointer targets with stable error details', () => {
    const document = parseDocument({
      color: {
        $type: 'color',
        missingToken: { $value: '{color.absent}' },
        missingPointer: { $ref: '#/color/not-there/$value' },
      },
    });

    const tokenError = catchResolutionError(() =>
      resolveFormatTokenValue(document, 'color.missingToken'),
    );
    expect(tokenError).toMatchObject({
      name: 'FormatTokenResolutionError',
      code: 'token-not-found',
      tokenPath: ['color', 'missingToken'],
      reference: '{color.absent}',
    });
    expect(tokenError.message).toContain('color.absent');

    const pointerError = catchResolutionError(() =>
      resolveFormatTokenValue(document, 'color.missingPointer'),
    );
    expect(pointerError).toMatchObject({
      code: 'pointer-target-not-found',
      tokenPath: ['color', 'missingPointer'],
      reference: '#/color/not-there/$value',
      pointerErrorCode: 'property-not-found',
    });
    expect(pointerError.message).toContain('has no target');
  });

  it('detects curly and pointer cycles and reports the traversed chain', () => {
    const curlyCycle = parseDocument({
      color: {
        $type: 'color',
        first: { $value: '{color.second}' },
        second: { $value: '{color.first}' },
      },
    });
    const curlyError = catchResolutionError(() =>
      resolveFormatTokenValue(curlyCycle, 'color.first'),
    );
    expect(curlyError.code).toBe('cycle');
    expect(curlyError.message).toContain('token:color.first');
    expect(curlyError.message).toContain('token:color.second');

    const pointerCycle = parseDocument({
      color: {
        $type: 'color',
        first: { $ref: '#/color/second' },
        second: { $ref: '#/color/first' },
      },
    });
    const pointerError = catchResolutionError(() =>
      resolveFormatTokenValue(pointerCycle, 'color.first'),
    );
    expect(pointerError.code).toBe('cycle');
    expect(pointerError.message).toContain('#/color/first');
    expect(pointerError.message).toContain('#/color/second');
  });

  it('bounds alias chains and reports malformed pointer syntax precisely', () => {
    const chain = parseDocument({
      value: {
        $type: 'number',
        first: { $value: '{value.second}' },
        second: { $value: '{value.third}' },
        third: { $value: '{value.final}' },
        final: { $value: 42 },
      },
    });
    const depthError = catchResolutionError(() =>
      resolveFormatTokenValue(chain, 'value.first', { maxDepth: 1 }),
    );
    expect(depthError.code).toBe('max-depth');
    expect(depthError.message).toContain('exceeds 1');

    const malformedPointer = parseDocument({
      color: {
        $type: 'color',
        invalid: { $ref: 'color/base' },
      },
    });
    const pointerError = catchResolutionError(() =>
      resolveFormatTokenValue(malformedPointer, 'color.invalid'),
    );
    expect(pointerError).toMatchObject({ code: 'pointer-invalid', reference: 'color/base' });
  });
});
