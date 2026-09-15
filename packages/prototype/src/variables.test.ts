import { describe, expect, it, vi } from 'vitest';
import {
  createVariable,
  evaluatePrototypeExpression,
  getVariableValue,
  type PrototypeVariableStore,
  resolvePrototypeVariable,
  setVariableValue,
} from './variables';

describe('Prototype variables', () => {
  describe('createVariable', () => {
    it('creates a number variable', () => {
      const v = createVariable('count', 'number', 0);
      expect(v.id).toBe('count');
      expect(v.type).toBe('number');
      expect(v.value).toBe(0);
    });

    it('creates a boolean variable', () => {
      const v = createVariable('isOpen', 'boolean', false);
      expect(v.type).toBe('boolean');
      expect(v.value).toBe(false);
    });

    it('creates a string variable', () => {
      const v = createVariable('name', 'string', 'Varve');
      expect(v.value).toBe('Varve');
    });
  });

  describe('getVariableValue / setVariableValue', () => {
    it('gets and sets variable values', () => {
      const store: PrototypeVariableStore = { variables: {} };
      setVariableValue(store, 'count', 5);
      expect(getVariableValue(store, 'count')).toBe(5);
    });

    it('overwrites existing value', () => {
      const store: PrototypeVariableStore = { variables: {} };
      setVariableValue(store, 'count', 1);
      setVariableValue(store, 'count', 10);
      expect(getVariableValue(store, 'count')).toBe(10);
    });

    it('returns undefined for missing variable', () => {
      const store: PrototypeVariableStore = { variables: {} };
      expect(getVariableValue(store, 'missing')).toBeUndefined();
    });
  });

  describe('evaluatePrototypeExpression', () => {
    it('evaluates simple arithmetic', () => {
      expect(evaluatePrototypeExpression('count + 1', { count: 5 })).toBe(6);
    });

    it('evaluates subtraction', () => {
      expect(evaluatePrototypeExpression('score - 10', { score: 100 })).toBe(90);
    });

    it('evaluates multiplication', () => {
      expect(evaluatePrototypeExpression('width * 2', { width: 50 })).toBe(100);
    });

    it('evaluates division', () => {
      expect(evaluatePrototypeExpression('total / 4', { total: 100 })).toBe(25);
    });

    it('handles string concatenation', () => {
      const result = evaluatePrototypeExpression('firstName + " " + lastName', {
        firstName: 'John',
        lastName: 'Doe',
      });
      expect(result).toBe('John Doe');
    });

    it('handles boolean comparison', () => {
      expect(evaluatePrototypeExpression('score >= 100', { score: 100 })).toBe(true);
      expect(evaluatePrototypeExpression('score > 100', { score: 50 })).toBe(false);
    });

    it('handles complex expression', () => {
      expect(evaluatePrototypeExpression('(count + 1) * 2', { count: 5 })).toBe(12);
    });

    it('returns string for unknown variables', () => {
      expect(evaluatePrototypeExpression('greeting', { greeting: 'Hello' })).toBe('Hello');
    });
  });

  describe('evaluateArithmetic (safe parser)', () => {
    it('does not use Function constructor for evaluation', () => {
      const fnSpy = vi.spyOn(globalThis, 'Function');
      evaluatePrototypeExpression('count + 1', { count: 5 });
      expect(fnSpy).not.toHaveBeenCalled();
      fnSpy.mockRestore();
    });

    it('handles operator precedence: multiplication before addition', () => {
      expect(evaluatePrototypeExpression('2 + 3 * 4', {})).toBe(14);
    });

    it('handles parentheses overriding precedence', () => {
      expect(evaluatePrototypeExpression('(2 + 3) * 4', {})).toBe(20);
    });

    it('handles nested parentheses', () => {
      expect(evaluatePrototypeExpression('((2 + 3) * (4 - 1))', {})).toBe(15);
    });

    it('handles division', () => {
      expect(evaluatePrototypeExpression('10 / 2', {})).toBe(5);
    });

    it('handles subtraction', () => {
      expect(evaluatePrototypeExpression('100 - 25', {})).toBe(75);
    });

    it('handles variable references in expressions', () => {
      expect(evaluatePrototypeExpression('width + 10', { width: 50 })).toBe(60);
    });

    it('handles multiple variables', () => {
      expect(evaluatePrototypeExpression('x + y * 2', { x: 5, y: 10 })).toBe(25);
    });

    it('handles complex expression with all operators', () => {
      expect(evaluatePrototypeExpression('(count + 1) * 2 - 5 / 2', { count: 5 })).toBe(9.5);
    });

    it('handles negative numbers', () => {
      expect(evaluatePrototypeExpression('-5 + 3', {})).toBe(-2);
    });
  });

  describe('resolvePrototypeVariable', () => {
    it('resolves a variable binding', () => {
      const store: PrototypeVariableStore = {
        variables: {
          count: { id: 'count', name: 'Count', type: 'number', value: 5 },
        },
      };
      expect(resolvePrototypeVariable(store, 'count')).toBe(5);
    });

    it('resolves with expression', () => {
      const store: PrototypeVariableStore = {
        variables: {
          count: { id: 'count', name: 'Count', type: 'number', value: 5 },
        },
      };
      expect(resolvePrototypeVariable(store, 'count', 'count + 1')).toBe(6);
    });

    it('returns undefined for missing variable', () => {
      const store: PrototypeVariableStore = { variables: {} };
      expect(resolvePrototypeVariable(store, 'missing')).toBeUndefined();
    });
  });
});
