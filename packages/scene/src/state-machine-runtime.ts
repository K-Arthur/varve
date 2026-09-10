/**
 * Pure state machine runtime for interactive motion.
 *
 * Evaluates transitions, conditions, and inputs without touching rendering or
 * timeline playback. This keeps the runtime testable and reusable across the
 * editor, prototype player, and export pipeline.
 *
 * Research basis: Rive State Machine (blend states + input-driven transitions),
 * Figma prototype interactions, W3C SCXML state-machine data model.
 */

import type { Document } from './document';
import { findEntryState, findSMTransitions, getStateMachine } from './state-machine';
import type { SMAction, SMState, SMTransition, StateMachine } from './state-machine-types';

export interface SMRuntime {
  doc: Document;
  smId: string;
  currentStateId: string;
  /** Current input values keyed by input id. */
  inputs: Record<string, boolean | number>;
  /** Active transition, or null when idle. */
  activeTransition: SMTransition | null;
  /** Active transition progress [0,1], or null when idle. */
  transitionProgress: number | null;
  /** Actions queued for execution after the current transition resolves. */
  pendingActions: SMAction[];
}

export function createStateMachineRuntime(doc: Document, smId: string): SMRuntime {
  const sm = getStateMachine(doc, smId);
  if (!sm) throw new Error(`State machine not found: ${smId}`);
  const entry = findEntryState(doc, smId);
  if (!entry) throw new Error(`State machine has no entry state: ${smId}`);
  const inputs: Record<string, boolean | number> = {};
  for (const input of sm.inputs) {
    inputs[input.id] = input.defaultValue ?? (input.type === 'boolean' ? false : 0);
  }
  return {
    doc,
    smId,
    currentStateId: entry.id,
    inputs,
    activeTransition: null,
    transitionProgress: null,
    pendingActions: [],
  };
}

export function getStateMachineFromRuntime(runtime: SMRuntime): StateMachine | undefined {
  return getStateMachine(runtime.doc, runtime.smId);
}

export function getCurrentState(runtime: SMRuntime): SMState | undefined {
  const sm = getStateMachineFromRuntime(runtime);
  return sm?.states.find((s) => s.id === runtime.currentStateId);
}

export function getCurrentStateTimelineId(runtime: SMRuntime): string | undefined {
  return getCurrentState(runtime)?.timelineId;
}

export function getSMInputValue(runtime: SMRuntime, inputId: string): boolean | number | undefined {
  return runtime.inputs[inputId];
}

export function setSMInput(
  runtime: SMRuntime,
  inputId: string,
  value: boolean | number,
): SMRuntime {
  const sm = getStateMachineFromRuntime(runtime);
  if (!sm) return runtime;
  const input = sm.inputs.find((i) => i.id === inputId);
  if (!input) return runtime;

  const nextInputs = { ...runtime.inputs, [inputId]: value };
  const next: SMRuntime = { ...runtime, inputs: nextInputs };

  // Auto-evaluate transitions triggered by input changes.
  return evaluateTransition(next, 'onVariableChange');
}

export function triggerSMEvent(runtime: SMRuntime, trigger: SMTransition['trigger']): SMRuntime {
  return evaluateTransition(runtime, trigger);
}

export function advanceSMTransition(runtime: SMRuntime, deltaMs: number): SMRuntime {
  if (!runtime.activeTransition || runtime.transitionProgress === null) return runtime;
  const duration = runtime.activeTransition.duration ?? 0;
  if (duration <= 0) {
    return { ...runtime, activeTransition: null, transitionProgress: null };
  }
  const nextProgress = Math.min(1, runtime.transitionProgress + deltaMs / duration);
  if (nextProgress >= 1) {
    return { ...runtime, activeTransition: null, transitionProgress: null };
  }
  return { ...runtime, transitionProgress: nextProgress };
}

function evaluateTransition(runtime: SMRuntime, trigger: SMTransition['trigger']): SMRuntime {
  const sm = getStateMachineFromRuntime(runtime);
  if (!sm) return runtime;

  const transitions = findSMTransitions(runtime.doc, runtime.smId, runtime.currentStateId);
  const candidates: SMTransition[] = [];
  for (const transition of transitions) {
    if (transition.trigger !== trigger) continue;
    if (transition.condition && !evaluateCondition(transition.condition, runtime)) continue;
    candidates.push(transition);
  }

  if (candidates.length === 0) return runtime;

  // Transition does not fire while an active transition is in progress
  // UNLESS the candidate explicitly opts in via canInterrupt.
  if (runtime.activeTransition && runtime.transitionProgress !== null) {
    const interrupters = candidates.filter((t) => t.canInterrupt !== false);
    if (interrupters.length === 0) return runtime;
    interrupters.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
    return applyTransition(runtime, interrupters[0]!);
  }

  // Sort by priority descending; highest priority wins.
  candidates.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  return applyTransition(runtime, candidates[0]!);
}

function applyTransition(runtime: SMRuntime, transition: SMTransition): SMRuntime {
  const actions = [...(transition.actions ?? [])];
  return {
    ...runtime,
    currentStateId: transition.toStateId,
    activeTransition: transition,
    transitionProgress: 0,
    pendingActions: [...runtime.pendingActions, ...actions],
  };
}

/** Dequeue pending actions (called by the host after applying side effects). */
export function drainPendingActions(runtime: SMRuntime): {
  actions: SMAction[];
  runtime: SMRuntime;
} {
  const actions = runtime.pendingActions;
  return { actions, runtime: { ...runtime, pendingActions: [] } };
}

export function evaluateCondition(condition: string, runtime: SMRuntime): boolean {
  try {
    const inputs = buildInputValues(runtime);
    return evaluateSafeExpression(condition, inputs);
  } catch {
    return false;
  }
}

type ExprToken =
  | { kind: 'num'; value: number }
  | { kind: 'bool'; value: boolean }
  | { kind: 'ident'; value: string }
  | { kind: 'op'; value: string }
  | { kind: 'lparen' }
  | { kind: 'rparen' };

function charAt(s: string, i: number): string {
  return s.charAt(i);
}

function tokenizeExpression(expr: string): ExprToken[] {
  const tokens: ExprToken[] = [];
  const len = expr.length;
  let i = 0;
  while (i < len) {
    const ch = charAt(expr, i);
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i++;
      continue;
    }
    if (ch === '(') {
      tokens.push({ kind: 'lparen' });
      i++;
      continue;
    }
    if (ch === ')') {
      tokens.push({ kind: 'rparen' });
      i++;
      continue;
    }
    if (ch === '=' && charAt(expr, i + 1) === '=' && charAt(expr, i + 2) === '=') {
      tokens.push({ kind: 'op', value: '===' });
      i += 3;
      continue;
    }
    if (ch === '!' && charAt(expr, i + 1) === '=' && charAt(expr, i + 2) === '=') {
      tokens.push({ kind: 'op', value: '!==' });
      i += 3;
      continue;
    }
    if (ch === '>' && charAt(expr, i + 1) === '=') {
      tokens.push({ kind: 'op', value: '>=' });
      i += 2;
      continue;
    }
    if (ch === '<' && charAt(expr, i + 1) === '=') {
      tokens.push({ kind: 'op', value: '<=' });
      i += 2;
      continue;
    }
    if (ch === '!' && charAt(expr, i + 1) === '=') {
      tokens.push({ kind: 'op', value: '!=' });
      i += 2;
      continue;
    }
    if (ch === '=' && charAt(expr, i + 1) === '=') {
      tokens.push({ kind: 'op', value: '==' });
      i += 2;
      continue;
    }
    if (ch === '&' && charAt(expr, i + 1) === '&') {
      tokens.push({ kind: 'op', value: '&&' });
      i += 2;
      continue;
    }
    if (ch === '|' && charAt(expr, i + 1) === '|') {
      tokens.push({ kind: 'op', value: '||' });
      i += 2;
      continue;
    }
    if (ch === '>') {
      tokens.push({ kind: 'op', value: '>' });
      i++;
      continue;
    }
    if (ch === '<') {
      tokens.push({ kind: 'op', value: '<' });
      i++;
      continue;
    }
    if (ch === '!') {
      tokens.push({ kind: 'op', value: '!' });
      i++;
      continue;
    }
    if (ch === '+' || ch === '-' || ch === '*' || ch === '/' || ch === '%') {
      tokens.push({ kind: 'op', value: ch });
      i++;
      continue;
    }
    if (
      (ch >= '0' && ch <= '9') ||
      (ch === '.' && i + 1 < len && charAt(expr, i + 1) >= '0' && charAt(expr, i + 1) <= '9')
    ) {
      let num = '';
      while (i < len) {
        const d = charAt(expr, i);
        if ((d < '0' || d > '9') && d !== '.') break;
        num += d;
        i++;
      }
      tokens.push({ kind: 'num', value: parseFloat(num) });
      continue;
    }
    if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_') {
      let id = '';
      while (i < len) {
        const c = charAt(expr, i);
        if (
          (c < 'a' || c > 'z') &&
          (c < 'A' || c > 'Z') &&
          (c < '0' || c > '9') &&
          c !== '_' &&
          c !== '.'
        ) {
          break;
        }
        id += c;
        i++;
      }
      if (id === 'true') tokens.push({ kind: 'bool', value: true });
      else if (id === 'false') tokens.push({ kind: 'bool', value: false });
      else tokens.push({ kind: 'ident', value: id });
      continue;
    }
    i++;
  }
  return tokens;
}

class ExprParser {
  private pos = 0;
  constructor(
    private tokens: ExprToken[],
    private scope: Record<string, unknown>,
  ) {}

  parse(): boolean {
    if (this.tokens.length === 0) return false;
    return Boolean(this.parseOr());
  }

  private peek(): ExprToken | undefined {
    return this.tokens[this.pos];
  }

  private consume(): ExprToken {
    return this.tokens[this.pos++]!;
  }

  private parseOr(): unknown {
    let left = this.parseAnd();
    for (;;) {
      const tok = this.peek();
      if (tok?.kind !== 'op' || tok.value !== '||') break;
      this.consume();
      left = Boolean(left) || Boolean(this.parseAnd());
    }
    return left;
  }

  private parseAnd(): unknown {
    let left = this.parseNot();
    for (;;) {
      const tok = this.peek();
      if (tok?.kind !== 'op' || tok.value !== '&&') break;
      this.consume();
      left = Boolean(left) && Boolean(this.parseNot());
    }
    return left;
  }

  private parseNot(): unknown {
    const tok = this.peek();
    if (tok && tok.kind === 'op' && tok.value === '!') {
      this.consume();
      return !this.parseNot();
    }
    return this.parseComparison();
  }

  private parseComparison(): unknown {
    const left = this.parseArithmetic();
    const op = this.peek();
    if (
      op &&
      op.kind === 'op' &&
      ['==', '!=', '===', '!==', '>', '<', '>=', '<='].includes(op.value)
    ) {
      this.consume();
      const right = this.parseArithmetic();
      switch (op.value) {
        case '==':
          return left === right;
        case '!=':
          return left !== right;
        case '===':
          return left === right;
        case '!==':
          return left !== right;
        case '>':
          return Number(left) > Number(right);
        case '<':
          return Number(left) < Number(right);
        case '>=':
          return Number(left) >= Number(right);
        case '<=':
          return Number(left) <= Number(right);
      }
    }
    return left;
  }

  private parseArithmetic(): unknown {
    let left = this.parseTerm();
    for (;;) {
      const tok = this.peek();
      if (tok?.kind !== 'op' || (tok.value !== '+' && tok.value !== '-')) break;
      this.consume();
      const right = this.parseTerm();
      left = tok.value === '+' ? Number(left) + Number(right) : Number(left) - Number(right);
    }
    return left;
  }

  private parseTerm(): unknown {
    let left = this.parseFactor();
    for (;;) {
      const tok = this.peek();
      if (tok?.kind !== 'op' || (tok.value !== '*' && tok.value !== '/' && tok.value !== '%'))
        break;
      this.consume();
      const right = this.parseFactor();
      if (tok.value === '*') left = Number(left) * Number(right);
      else if (tok.value === '/') left = Number(left) / Number(right);
      else left = Number(left) % Number(right);
    }
    return left;
  }

  private parseFactor(): unknown {
    const token = this.peek();
    if (!token) return false;

    if (token.kind === 'num') {
      this.consume();
      return token.value;
    }
    if (token.kind === 'bool') {
      this.consume();
      return token.value;
    }
    if (token.kind === 'lparen') {
      this.consume();
      const val = this.parseComparison();
      if (this.peek()?.kind === 'rparen') this.consume();
      return val;
    }
    if (token.kind === 'ident') {
      this.consume();
      return this.resolvePath(token.value);
    }
    return false;
  }

  private resolvePath(path: string): unknown {
    const parts = path.split('.');
    let value: unknown = this.scope;
    for (const part of parts) {
      if (value != null && typeof value === 'object' && part in value) {
        value = (value as Record<string, unknown>)[part];
      } else {
        return undefined;
      }
    }
    return value;
  }
}

function evaluateSafeExpression(expr: string, scope: Record<string, unknown>): boolean {
  const sanitized = expr.replace(/[^a-zA-Z0-9_.\s\-+*/<>=!&|()]/g, '');
  const tokens = tokenizeExpression(sanitized);
  const parser = new ExprParser(tokens, scope);
  return parser.parse();
}

function buildInputValues(runtime: SMRuntime): Record<string, unknown> {
  const sm = getStateMachineFromRuntime(runtime);
  if (!sm) return {};
  const values: Record<string, boolean | number> = {};
  for (const input of sm.inputs) {
    const val = runtime.inputs[input.id];
    values[input.name] = val ?? input.defaultValue ?? (input.type === 'boolean' ? false : 0);
  }
  return { inputs: values };
}
