import { describe, expect, it } from 'vitest';
import { formatVariableValue } from './variableValueFormat';

describe('formatVariableValue', () => {
  it('shows managed colors with their source profile and floating precision', () => {
    expect(
      formatVariableValue({
        space: 'rgb',
        bitDepth: 'float32',
        profile: 'display-p3',
        r: 0.123456789,
        g: 0.4,
        b: 0.8,
        a: 0.25,
      }),
    ).toBe('display-p3(0.123456789 0.4 0.8 / 0.25)');
  });
  it('renders primitives as-is', () => {
    expect(formatVariableValue('hello')).toBe('hello');
    expect(formatVariableValue(8)).toBe('8');
    expect(formatVariableValue(true)).toBe('true');
    expect(formatVariableValue(null)).toBe('');
    expect(formatVariableValue(undefined)).toBe('');
  });

  it('renders dimension objects with their unit', () => {
    expect(formatVariableValue({ value: 8, unit: 'px' })).toBe('8 px');
    expect(formatVariableValue({ value: 1.5, unit: 'rem' })).toBe('1.5 rem');
  });

  it('renders srgb colors as hex and other spaces by name', () => {
    expect(formatVariableValue({ colorSpace: 'srgb', components: [0, 0.4, 0.8] })).toBe('#0066cc');
    expect(formatVariableValue({ colorSpace: 'srgb', components: [1, 1, 1], alpha: 0.5 })).toBe(
      '#ffffff80',
    );
    expect(formatVariableValue({ colorSpace: 'oklch', components: [0.7, 0.12, 180] })).toBe(
      'oklch(0.7 0.12 180)',
    );
  });

  it('never throws on parser-produced null-prototype objects', () => {
    const nullProto = Object.create(null) as Record<string, unknown>;
    nullProto.colorSpace = 'srgb';
    nullProto.components = [1, 0, 0];
    expect(formatVariableValue(nullProto)).toBe('#ff0000');
  });

  it('falls back to JSON for unknown structures', () => {
    expect(formatVariableValue({ custom: 1 })).toBe('{"custom":1}');
    expect(formatVariableValue([1, 2])).toBe('1, 2');
  });
});
