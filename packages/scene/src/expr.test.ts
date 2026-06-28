import { describe, expect, it } from 'vitest';
import { evaluate, tokenize, type Token } from './expr';

describe('tokenize', () => {
  it('tokenizes a number', () => {
    expect(tokenize('1.5')).toEqual([{ kind: 'number', value: 1.5 }]);
  });

  it('tokenizes an alias', () => {
    expect(tokenize('{base}')).toEqual([{ kind: 'alias', name: 'base' }]);
  });

  it('tokenizes operators', () => {
    expect(tokenize('1+2')).toEqual([
      { kind: 'number', value: 1 },
      { kind: 'op', op: '+' },
      { kind: 'number', value: 2 },
    ]);
  });

  it('tokenizes parentheses', () => {
    expect(tokenize('(1)')).toEqual([
      { kind: 'paren', value: '(' },
      { kind: 'number', value: 1 },
      { kind: 'paren', value: ')' },
    ]);
  });

  it('tokenizes a full expression', () => {
    const tokens = tokenize('{base} * 1.5 + 3');
    expect(tokens).toEqual([
      { kind: 'alias', name: 'base' },
      { kind: 'op', op: '*' },
      { kind: 'number', value: 1.5 },
      { kind: 'op', op: '+' },
      { kind: 'number', value: 3 },
    ]);
  });

  it('throws on invalid characters', () => {
    expect(() => tokenize('2 @ 3')).toThrow('Unexpected character');
  });
});

describe('evaluate', () => {
  it('evaluates a simple number', () => {
    expect(evaluate('3', {})).toBe(3);
  });

  it('evaluates addition', () => {
    expect(evaluate('1 + 2', {})).toBe(3);
  });

  it('evaluates subtraction', () => {
    expect(evaluate('5 - 3', {})).toBe(2);
  });

  it('evaluates multiplication', () => {
    expect(evaluate('3 * 4', {})).toBe(12);
  });

  it('evaluates division', () => {
    expect(evaluate('10 / 2', {})).toBe(5);
  });

  it('respects operator precedence: * before +', () => {
    expect(evaluate('2 + 3 * 4', {})).toBe(14);
  });

  it('respects parentheses overriding precedence', () => {
    expect(evaluate('(2 + 3) * 4', {})).toBe(20);
  });

  it('evaluates chained operators left-to-right', () => {
    expect(evaluate('8 / 4 / 2', {})).toBe(1);
  });

  it('evaluates chained same-precedence left-to-right', () => {
    expect(evaluate('10 - 3 - 2', {})).toBe(5);
  });

  it('evaluates alias lookup', () => {
    expect(evaluate('{base}', { base: 10 })).toBe(10);
  });

  it('evaluates alias in expression', () => {
    expect(evaluate('{base} * 1.5', { base: 10 })).toBe(15);
  });

  it('evaluates alias with nested name containing hyphen', () => {
    expect(evaluate('{space-2} + 4', { 'space-2': 8 })).toBe(12);
  });

  it('throws on unknown alias', () => {
    expect(() => evaluate('{unknown}', {})).toThrow('Unknown alias: unknown');
  });

  it('throws on division by zero', () => {
    expect(() => evaluate('1 / 0', {})).toThrow('Division by zero');
  });

  it('throws on malformed expression (trailing operator)', () => {
    expect(() => evaluate('1 +', {})).toThrow();
  });

  it('throws on mismatched parentheses', () => {
    expect(() => evaluate('(1 + 2', {})).toThrow();
  });
});
