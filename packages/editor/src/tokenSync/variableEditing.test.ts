import { createDocument } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { buildImportPreview, NEW_SOURCE_OPTION, planDocumentImport } from './importWorkflow';
import { parseVariableEdit } from './variableEditing';

function store() {
  const text = JSON.stringify({
    color: { $type: 'color', $value: { colorSpace: 'srgb', components: [0, 0.4, 0.8] } },
    spacing: { $type: 'dimension', $value: { value: 8, unit: 'rem' } },
  });
  const preview = buildImportPreview(
    text,
    { name: 'tokens.json', size: text.length, lastModified: 0 },
    undefined,
  );
  return planDocumentImport(createDocument('Typed edits'), preview, NEW_SOURCE_OPTION)!
    .variableStore;
}

describe('typed imported Variable edits', () => {
  it('keeps source precision and units when the formatted value is unchanged', () => {
    const variables = store();
    const spacing = Object.values(variables.variables).find((entry) => entry.name === 'spacing')!;
    expect(parseVariableEdit(variables, spacing, '8 rem')).toBe(spacing.valuesByMode.default);
    const source = { colorSpace: 'srgb', components: [0.123456789, 0.4, 0.8] };
    const color = {
      ...Object.values(variables.variables).find((entry) => entry.name === 'color')!,
      valuesByMode: { default: source },
    };
    expect(parseVariableEdit(variables, color, '#1f66cc')).toBe(source);
  });
  it('preserves a source dimension unit and zero', () => {
    const variables = store();
    const variable = Object.values(variables.variables).find((entry) => entry.name === 'spacing')!;
    expect(parseVariableEdit(variables, variable, '0')).toEqual({ value: 0, unit: 'rem' });
    expect(parseVariableEdit(variables, variable, '{foundation.spacing}')).toBe(
      '{foundation.spacing}',
    );
  });

  it('accepts explicit color edits with alpha without quantizing the JSON value', () => {
    const variables = store();
    const variable = Object.values(variables.variables).find((entry) => entry.name === 'color')!;
    expect(parseVariableEdit(variables, variable, '#0066cc80')).toEqual({
      colorSpace: 'srgb',
      components: [0, 0.4, 0.8],
      alpha: 128 / 255,
    });
    const value = {
      colorSpace: 'display-p3',
      components: [0.123456789, 0.2, 0.3],
      alpha: 0.123456789,
    };
    expect(parseVariableEdit(variables, variable, JSON.stringify(value))).toEqual(value);
    expect(() => parseVariableEdit(variables, variable, 'not a color')).toThrow(
      'valid typed value',
    );
  });
});
