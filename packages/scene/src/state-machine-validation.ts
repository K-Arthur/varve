/**
 * State-machine validation — reachability, cycles, ambiguity, dead-ends.
 *
 * Pure functions that diagnose configuration issues without mutating the
 * document. The inspector surfaces these as warnings; the export pipeline uses
 * them to generate "unsupported-features" diagnostics.
 *
 * Research basis: UML state diagram validation, SPIN model-checker reachability.
 */

import type { Document } from './document';
import { findSMTransitions, getStateMachine } from './state-machine';
import type { SMTransition, StateMachine } from './state-machine-types';

export type SMValidationSeverity = 'error' | 'warning' | 'info';

export interface SMValidationIssue {
  severity: SMValidationSeverity;
  code: string;
  message: string;
  stateId?: string;
  transitionId?: string;
}

export interface SMValidationResult {
  issues: SMValidationIssue[];
  /** States reachable from the entry state. */
  reachableStates: Set<string>;
  /** States that can reach any terminal state. */
  canReachTerminal: Set<string>;
}

export function validateStateMachine(doc: Document, smId: string): SMValidationResult {
  const sm = getStateMachine(doc, smId);
  const issues: SMValidationIssue[] = [];
  const reachableStates = new Set<string>();
  const canReachTerminal = new Set<string>();

  if (!sm) {
    return { issues: [], reachableStates, canReachTerminal };
  }

  // Rule: no initial state / no states at all.
  if (sm.states.length === 0) {
    issues.push({ severity: 'error', code: 'no-states', message: 'State machine has no states.' });
    return { issues, reachableStates, canReachTerminal };
  }

  const entry = sm.states.find((s) => s.isEntryState) ?? sm.states[0];
  if (entry && !entry.isEntryState && sm.states.length > 1) {
    issues.push({
      severity: 'warning',
      code: 'no-entry-state',
      message: `No entry state set; defaulting to "${entry.name}".`,
    });
  }

  // Rule: duplicate state identifiers.
  const idCounts = new Map<string, number>();
  for (const s of sm.states) idCounts.set(s.id, (idCounts.get(s.id) ?? 0) + 1);
  for (const [id, count] of idCounts) {
    if (count > 1) {
      issues.push({
        severity: 'error',
        code: 'duplicate-state-id',
        message: `Duplicate state ID "${id}".`,
        stateId: id,
      });
    }
  }

  // Rule: duplicate state names (warning, not error).
  const nameCounts = new Map<string, number>();
  for (const s of sm.states) nameCounts.set(s.name, (nameCounts.get(s.name) ?? 0) + 1);
  for (const [name, count] of nameCounts) {
    if (count > 1) {
      issues.push({
        severity: 'warning',
        code: 'duplicate-state-name',
        message: `Multiple states named "${name}"; transitions may be ambiguous.`,
      });
    }
  }

  // Rule: missing transition targets.
  for (const t of sm.transitions) {
    if (!sm.states.some((s) => s.id === t.fromStateId)) {
      issues.push({
        severity: 'error',
        code: 'missing-from-state',
        message: `Transition "${t.id}" references missing source state "${t.fromStateId}".`,
        transitionId: t.id,
      });
    }
    if (!sm.states.some((s) => s.id === t.toStateId)) {
      issues.push({
        severity: 'error',
        code: 'missing-to-state',
        message: `Transition "${t.id}" references missing target state "${t.toStateId}".`,
        transitionId: t.id,
      });
    }
  }

  // Reachability via BFS from entry state.
  if (entry) bfsReachable(sm, entry.id, reachableStates);
  for (const s of sm.states) {
    if (!reachableStates.has(s.id)) {
      issues.push({
        severity: 'warning',
        code: 'unreachable-state',
        message: `State "${s.name}" is not reachable from the entry state.`,
        stateId: s.id,
      });
    }
  }

  // States that can reach a terminal state (one with no outgoing transitions).
  const terminalStates = new Set<string>();
  for (const s of sm.states) {
    const outgoing = findSMTransitions(doc, smId, s.id);
    if (outgoing.length === 0) terminalStates.add(s.id);
  }
  for (const s of sm.states) {
    if (canReachAnyTerminal(sm, s.id, terminalStates)) {
      canReachTerminal.add(s.id);
    }
  }

  // Rule: transitions that can never fire — unresolved or malformed guards.
  for (const t of sm.transitions) {
    if (t.condition && isMalformedGuard(t.condition)) {
      issues.push({
        severity: 'warning',
        code: 'malformed-guard',
        message: `Transition guard "${t.condition}" may be malformed.`,
        transitionId: t.id,
      });
    }
  }

  // Rule: ambiguous transitions — same trigger, equal priority, no condition to disambiguate.
  for (const state of sm.states) {
    const outgoing = findSMTransitions(doc, smId, state.id);
    const byTrigger = new Map<string, SMTransition[]>();
    for (const t of outgoing) {
      const list = byTrigger.get(t.trigger) ?? [];
      list.push(t);
      byTrigger.set(t.trigger, list);
    }
    for (const [trigger, list] of byTrigger) {
      if (list.length < 2) continue;
      // Check if any pair has equal priority and no distinguishing condition.
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i]!;
          const b = list[j]!;
          if ((a.priority ?? 0) === (b.priority ?? 0) && !a.condition && !b.condition) {
            issues.push({
              severity: 'warning',
              code: 'ambiguous-transition',
              message: `State "${state.name}" has ${list.length} "${trigger}" transitions with equal priority; first defined wins.`,
              stateId: state.id,
            });
          }
        }
      }
    }
  }

  // Rule: uncontrolled cycles (warn on simple self-loops without conditions).
  for (const t of sm.transitions) {
    if (t.fromStateId === t.toStateId && !t.condition) {
      issues.push({
        severity: 'info',
        code: 'self-loop',
        message: `State "${sm.states.find((s) => s.id === t.fromStateId)?.name}" has an unconditional self-loop.`,
        transitionId: t.id,
      });
    }
  }

  return { issues, reachableStates, canReachTerminal };
}

export function bfsReachable(sm: StateMachine, fromId: string, out: Set<string>): void {
  const queue = [fromId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (out.has(id)) continue;
    out.add(id);
    for (const t of sm.transitions) {
      if (t.fromStateId === id && !out.has(t.toStateId)) {
        queue.push(t.toStateId);
      }
    }
  }
}

function canReachAnyTerminal(sm: StateMachine, fromId: string, terminals: Set<string>): boolean {
  const visited = new Set<string>();
  const queue = [fromId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (terminals.has(id)) return true;
    if (visited.has(id)) continue;
    visited.add(id);
    for (const t of sm.transitions) {
      if (t.fromStateId === id && !visited.has(t.toStateId)) {
        queue.push(t.toStateId);
      }
    }
  }
  return false;
}

function isMalformedGuard(condition: string): boolean {
  // Heuristic: balanced parentheses, and at least one comparison operator.
  let depth = 0;
  for (const ch of condition) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (depth < 0) return true;
  }
  if (depth !== 0) return true;
  const hasComparison = /[<>=!]/.test(condition);
  return !hasComparison;
}
