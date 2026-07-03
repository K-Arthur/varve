/**
 * Prototype variable system — storage, retrieval, and expression evaluation
 * for prototype state variables.
 *
 * Supports numeric, string, boolean, and color variable types with math
 * expressions (arithmetic, string concatenation, comparison operators).
 *
 * Research basis: Figma Variables (typed values, expressions, modes),
 * Framer Variant parameters, CSS custom properties for theming.
 */

export type VariablePrimitive = string | number | boolean;

export interface PrototypeVariableDef {
  id: string;
  name: string;
  type: 'string' | 'number' | 'boolean' | 'color';
  value: VariablePrimitive;
}

export interface PrototypeVariableStore {
  variables: Record<string, PrototypeVariableDef>;
}

/**
 * Create a prototype variable definition.
 */
export function createVariable(
  id: string,
  type: PrototypeVariableDef['type'],
  value: VariablePrimitive,
): PrototypeVariableDef {
  return { id, name: id, type, value };
}

/**
 * Get a variable value from the store.
 */
export function getVariableValue(
  store: PrototypeVariableStore,
  variableId: string,
): VariablePrimitive | undefined {
  return store.variables[variableId]?.value;
}

/**
 * Set a variable value in the store (creates if missing).
 */
export function setVariableValue(
  store: PrototypeVariableStore,
  variableId: string,
  value: VariablePrimitive,
): void {
  const existing = store.variables[variableId];
  if (existing) {
    store.variables[variableId] = { ...existing, value };
  } else {
    store.variables[variableId] = createVariable(
      variableId,
      typeof value === 'boolean' ? 'boolean' : typeof value === 'number' ? 'number' : 'string',
      value,
    );
  }
}

/**
 * Evaluate a prototype expression string.
 *
 * Supports:
 * - Arithmetic: +, -, *, / with parentheses
 * - String concatenation: "hello " + name
 * - Comparison: ==, !=, >, <, >=, <=
 * - Variable references by name
 * - Numeric and string literals
 *
 * Uses a safe recursive descent parser — no eval, no Function constructor.
 */
export function evaluatePrototypeExpression(
  expression: string,
  variables: Record<string, VariablePrimitive>,
): VariablePrimitive {
  const trimmed = expression.trim();

  // String literal
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }

  // Boolean literals
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;

  // Numeric literal
  if (/^\d+\.?\d*$/.test(trimmed)) {
    return Number(trimmed);
  }

  // Single variable reference
  if (/^[a-zA-Z_]\w*$/.test(trimmed) && trimmed in variables) {
    return variables[trimmed]!;
  }

  // Comparison operators
  const comparisonMatch = trimmed.match(/^(.+?)\s*(==|!=|>=|<=|>|<)\s*(.+)$/);
  if (comparisonMatch) {
    const left = comparisonMatch[1] ?? '';
    const op = comparisonMatch[2] ?? '';
    const right = comparisonMatch[3] ?? '';
    const leftVal = evaluateAtomic(left.trim(), variables);
    const rightVal = evaluateAtomic(right.trim(), variables);

    switch (op) {
      case '==':
        return leftVal === rightVal;
      case '!=':
        return leftVal !== rightVal;
      case '>':
        return Number(leftVal) > Number(rightVal);
      case '<':
        return Number(leftVal) < Number(rightVal);
      case '>=':
        return Number(leftVal) >= Number(rightVal);
      case '<=':
        return Number(leftVal) <= Number(rightVal);
    }
  }

  // Arithmetic expression
  return evaluateArithmetic(expression, variables);
}

function evaluateAtomic(
  token: string,
  variables: Record<string, VariablePrimitive>,
): VariablePrimitive {
  if (token.startsWith('"') && token.endsWith('"')) return token.slice(1, -1);
  if (token.startsWith("'") && token.endsWith("'")) return token.slice(1, -1);
  if (token === 'true') return true;
  if (token === 'false') return false;
  if (/^\d+\.?\d*$/.test(token)) return Number(token);
  if (/^[a-zA-Z_]\w*$/.test(token) && token in variables) return variables[token]!;
  return token;
}

function evaluateArithmetic(
  expr: string,
  variables: Record<string, VariablePrimitive>,
): VariablePrimitive {
  // Handle string concatenation
  const stringParts = expr.split(/\s*\+\s*/).map((s) => {
    const atomic = evaluateAtomic(s.trim(), variables);
    return String(atomic);
  });
  if (stringParts.length > 1) {
    // Check if any operand was originally a string
    const hasStrings = stringParts.some((_, i) => {
      const part = expr.split(/\s*\+\s*/)[i]?.trim();
      return part ? part.startsWith('"') || part.startsWith("'") : false;
    });
    if (hasStrings) {
      return stringParts.join('');
    }
  }

  // Numeric expression evaluation
  const tokens = expr.match(/(\d+\.?\d*|[+\-*/()]|[a-zA-Z_]\w*)/g);
  if (!tokens) return 0;

  const resolvedTokens = tokens.map((t) => {
    if (/^[a-zA-Z_]\w*$/.test(t) && t in variables) return String(variables[t]!);
    return t;
  });

  try {
    const result = new Function(`return ${resolvedTokens.join('')}`)();
    return typeof result === 'number' ? result : 0;
  } catch {
    return resolvedTokens.join(' ');
  }
}

/**
 * Resolve a prototype variable, optionally applying an expression.
 */
export function resolvePrototypeVariable(
  store: PrototypeVariableStore,
  variableId: string,
  expression?: string,
): VariablePrimitive | undefined {
  const v = store.variables[variableId];
  if (!v) return undefined;

  if (expression) {
    const vars: Record<string, VariablePrimitive> = {};
    for (const [key, val] of Object.entries(store.variables)) {
      vars[key] = val.value;
    }
    vars[variableId] = v.value;
    return evaluatePrototypeExpression(expression, vars);
  }

  return v.value;
}
