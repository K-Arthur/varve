import { describe, expect, it } from 'vitest';
import { evaluate } from './expr';

describe('evaluate — basic arithmetic', () => {
  it('adds two numbers', () => expect(evaluate('2 + 3', {})).toBe(5));
  it('subtracts', () => expect(evaluate('10 - 3', {})).toBe(7));
  it('multiplies', () => expect(evaluate('4 * 3', {})).toBe(12));
  it('divides', () => expect(evaluate('10 / 2', {})).toBe(5));
  it('handles operator precedence', () => expect(evaluate('2 + 3 * 4', {})).toBe(14));
  it('handles parentheses', () => expect(evaluate('(2 + 3) * 4', {})).toBe(20));
  it('evaluates decimal numbers', () => expect(evaluate('3.5 * 2', {})).toBe(7));
});

describe('evaluate — aliases', () => {
  it('resolves {name} alias', () => expect(evaluate('{base} * 2', { base: 5 })).toBe(10));
  it('resolves multiple aliases', () => expect(evaluate('{a} + {b}', { a: 3, b: 7 })).toBe(10));
  it('throws on unknown alias', () => expect(() => evaluate('{x}', {})).toThrow('Unknown alias'));
  it('throws on division by zero', () => expect(() => evaluate('5 / 0', {})).toThrow('Division by zero'));
});

describe('evaluate — functions: min, max', () => {
  it('min returns the smallest value', () => {
    expect(evaluate('min(3, 7, 1, 9)', {})).toBe(1);
  });
  it('min with two args', () => {
    expect(evaluate('min(10, 5)', {})).toBe(5);
  });
  it('min with aliases', () => {
    expect(evaluate('min({a}, {b})', { a: 100, b: 50 })).toBe(50);
  });
  it('max returns the largest value', () => {
    expect(evaluate('max(3, 7, 1, 9)', {})).toBe(9);
  });
  it('max with aliases', () => {
    expect(evaluate('max({a}, {b})', { a: 100, b: 50 })).toBe(100);
  });
  it('nested min/max', () => {
    expect(evaluate('min(10, max(5, 8))', {})).toBe(8);
  });
});

describe('evaluate — functions: round, ceil, floor', () => {
  it('round rounds to nearest integer', () => {
    expect(evaluate('round(3.4)', {})).toBe(3);
    expect(evaluate('round(3.6)', {})).toBe(4);
  });
  it('round with negative', () => {
    expect(evaluate('round(-1.5)', {})).toBe(-1);
  });
  it('ceil rounds up', () => {
    expect(evaluate('ceil(3.2)', {})).toBe(4);
    expect(evaluate('ceil(-1.5)', {})).toBe(-1);
  });
  it('floor rounds down', () => {
    expect(evaluate('floor(3.8)', {})).toBe(3);
    expect(evaluate('floor(-1.5)', {})).toBe(-2);
  });
  it('round with expression arg', () => {
    expect(evaluate('round(2.5 * 1.3)', {})).toBe(3);
  });
});

describe('evaluate — mixed functions and arithmetic', () => {
  it('min in expression', () => {
    expect(evaluate('min(10, 20) * 2', {})).toBe(20);
  });
  it('nested function calls', () => {
    expect(evaluate('round(min(3.7, 5.2))', {})).toBe(4);
  });
  it('function with alias args', () => {
    expect(evaluate('max({a}, {b}) * 2', { a: 5, b: 10 })).toBe(20);
  });
});

describe('evaluate — error cases', () => {
  it('throws on unexpected character', () => {
    expect(() => evaluate('2 $ 3', {})).toThrow('Unexpected character');
  });
  it('throws on mismatched parentheses', () => {
    expect(() => evaluate('(2 + 3', {})).toThrow('Mismatched parentheses');
  });
});
