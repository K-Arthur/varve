import { describe, it, expect } from 'vitest';
import {
  createVariable,
  getVariableValue,
  setVariableValue,
  evaluatePrototypeExpression,
  resolvePrototypeVariable,
  type PrototypeVariableStore,
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
      const v = createVariable('name', 'string', 'Strata');
      expect(v.value).toBe('Strata');
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
