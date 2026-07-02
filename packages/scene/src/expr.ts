/**
 * Safe arithmetic expression evaluator (Pratt parser).
 *
 * Grammar:
 *   expr     -> term (('+' | '-') term)*
 *   term     -> factor (('*' | '/') factor)*
 *   factor   -> NUMBER | ALIAS | FUNC '(' args ')' | '(' expr ')'
 *   args     -> expr (',' expr)*
 *
 * Functions: min(…), max(…), round(…), ceil(…), floor(…)
 * Aliases: `{name}` — resolved via a lookup map.
 * No `eval()`, no `Function()`, no assignment.
 *
 * Research basis: Pratt parsing (Vaughan Pratt, 1973) — the standard approach
 * for safe expression evaluation without code generation.
 */

export type Token =
  | { kind: 'number'; value: number }
  | { kind: 'alias'; name: string }
  | { kind: 'op'; op: string }
  | { kind: 'paren'; value: string }
  | { kind: 'func'; name: string }
  | { kind: 'comma' };

type BinOp = (a: number, b: number) => number;

const PRECEDENCE: Record<string, number> = {
  '+': 1,
  '-': 1,
  '*': 2,
  '/': 2,
};

const BINARY_OPS: Record<string, BinOp> = {
  '+': (a, b) => a + b,
  '-': (a, b) => a - b,
  '*': (a, b) => a * b,
  '/': (a, b) => {
    if (b === 0) throw new Error('Division by zero');
    return a / b;
  },
};

const FUNCTIONS: Record<string, (...args: number[]) => number> = {
  min: (...args) => Math.min(...args),
  max: (...args) => Math.max(...args),
  round: (x) => Math.round(x),
  ceil: (x) => Math.ceil(x),
  floor: (x) => Math.floor(x),
};

export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (!ch) break;
    if (ch === ' ' || ch === '\t' || ch === '\n') {
      i++;
      continue;
    }
    if (ch === '{') {
      const end = input.indexOf('}', i);
      if (end < 0) throw new Error('Unclosed alias');
      tokens.push({ kind: 'alias', name: input.slice(i + 1, end) });
      i = end + 1;
      continue;
    }
    if (ch >= '0' && ch <= '9') {
      let j = i;
      while (j < input.length) {
        const cj = input[j];
        if (cj === undefined) break;
        if (!((cj >= '0' && cj <= '9') || cj === '.')) break;
        j++;
      }
      tokens.push({ kind: 'number', value: Number.parseFloat(input.slice(i, j)) });
      i = j;
      continue;
    }
    if (ch === ',') {
      tokens.push({ kind: 'comma' });
      i++;
      continue;
    }
    if ('+-*/'.includes(ch)) {
      tokens.push({ kind: 'op', op: ch });
      i++;
      continue;
    }
    if (ch === '(' || ch === ')') {
      tokens.push({ kind: 'paren', value: ch });
      i++;
      continue;
    }
    // Function names are alpha sequences followed by '('
    if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_') {
      let j = i;
      while (j < input.length) {
        const cj = input[j];
        if (cj === undefined) break;
        if (
          !(
            (cj >= 'a' && cj <= 'z') ||
            (cj >= 'A' && cj <= 'Z') ||
            (cj >= '0' && cj <= '9') ||
            cj === '_'
          )
        )
          break;
        j++;
      }
      const name = input.slice(i, j);
      // Check if followed by '(' - it's a function call
      // Skip whitespace to check
      let k = j;
      while (k < input.length && (input[k] === ' ' || input[k] === '\t' || input[k] === '\n')) k++;
      if (k < input.length && input[k] === '(') {
        tokens.push({ kind: 'func', name });
        i = j;
        continue;
      }
      throw new Error(`Unexpected identifier: '${name}'`);
    }
    throw new Error(`Unexpected character: '${ch}'`);
  }
  return tokens;
}

/**
 * Evaluate an arithmetic expression string with alias resolution.
 * `aliases` provides resolved numeric values for `{name}` references.
 * Throws on syntax errors, unknown aliases, or division by zero.
 */
export function evaluate(input: string, aliases: Record<string, number>): number {
  const tokens = tokenize(input);
  let pos = 0;

  function peek(): Token | null {
    return tokens[pos] ?? null;
  }

  function consume(): Token {
    const t = peek();
    if (!t) throw new Error('Unexpected end of expression');
    pos++;
    return t;
  }

  function parseExpr(minPrec: number): number {
    let left = parseFactor();

    while (true) {
      const t = peek();
      if (t?.kind !== 'op') break;
      const prec = PRECEDENCE[t.op] ?? 0;
      if (prec < minPrec) break;
      consume();
      const right = parseExpr(prec + 1);
      const op = BINARY_OPS[t.op];
      if (!op) throw new Error(`Unknown operator: ${t.op}`);
      left = op(left, right);
    }

    return left;
  }

  function parseArgs(): number[] {
    const args: number[] = [];
    // Check if no args (closing paren immediately)
    if (peek()?.kind === 'paren' && peek()?.value === ')') {
      return args;
    }
    args.push(parseExpr(0));
    while (peek()?.kind === 'comma') {
      consume(); // eat comma
      args.push(parseExpr(0));
    }
    return args;
  }

  function parseFactor(): number {
    // Unary minus
    if (peek()?.kind === 'op' && peek()?.op === '-') {
      consume(); // eat '-'
      const val = parseFactor();
      return -val;
    }
    const t = consume();
    if (t.kind === 'number') return t.value;
    if (t.kind === 'alias') {
      const val = aliases[t.name];
      if (val === undefined) throw new Error(`Unknown alias: ${t.name}`);
      return val;
    }
    if (t.kind === 'func') {
      const open = peek();
      if (open?.kind !== 'paren' || open.value !== '(') {
        throw new Error(`Expected '(' after function '${t.name}'`);
      }
      consume();
      const args = parseArgs();
      const close = peek();
      if (close?.kind !== 'paren' || close.value !== ')') {
        throw new Error('Mismatched parentheses in function call');
      }
      consume();
      const fn = FUNCTIONS[t.name];
      if (!fn) throw new Error(`Unknown function: ${t.name}`);
      return fn(...args);
    }
    if (t.kind === 'paren' && t.value === '(') {
      const val = parseExpr(0);
      const close = peek();
      if (close?.kind !== 'paren' || close.value !== ')') {
        throw new Error('Mismatched parentheses');
      }
      consume();
      return val;
    }
    throw new Error(`Unexpected token: ${JSON.stringify(t)}`);
  }

  const result = parseExpr(0);

  // Ensure no trailing tokens
  if (peek() !== null) {
    throw new Error('Unexpected trailing tokens');
  }

  return result;
}
