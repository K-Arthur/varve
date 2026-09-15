/**
 * Reference graph for parsed DTCG documents (ADR-0104).
 *
 * Nodes are tokens; edges are references (curly-brace and JSON Pointer).
 * The graph detects, with exact locations:
 * - direct/indirect/self cycles
 * - missing targets
 * - references to groups (curly braces target complete tokens only)
 * - invalid JSON Pointers
 * - type mismatches between reference and target
 * - alias chains beyond a safe depth
 *
 * Resolution is lazy: callers resolve on demand; the graph provides the
 * indexes (incoming/outgoing) that make resolution and impact analysis
 * O(1) per token instead of a name scan.
 */
import { type JsonPointerError, resolveJsonPointer } from './jsonPointer';
import { parseCurlyBrace, pathKey } from './parse';
import type { DtcgDocument, DtcgTokenNode, TokenDiagnostic } from './types';

export interface ReferenceEdge {
  from: string; // pathKey of the referencing token
  to?: string; // pathKey of the target token (resolved)
  toPointer?: string; // JSON pointer target when the edge is property-level
  raw: string;
  kind: 'curly-brace' | 'json-pointer';
  /** True when the reference is embedded in a composite value. */
  propertyLevel: boolean;
  missing?: boolean;
  targetsGroup?: boolean;
  typeMismatch?: boolean;
}

export interface ReferenceGraph {
  /** Incoming edges per target token pathKey. */
  incoming: Map<string, ReferenceEdge[]>;
  /** Outgoing edges per referencing token pathKey. */
  outgoing: Map<string, ReferenceEdge[]>;
  /** Tokens in reference cycles (pathKeys). */
  cycleMembers: Set<string>;
  diagnostics: TokenDiagnostic[];
  maxChainDepth: number;
}

export const MAX_ALIAS_CHAIN_DEPTH = 100;

export function buildReferenceGraph(doc: DtcgDocument): ReferenceGraph {
  const incoming = new Map<string, ReferenceEdge[]>();
  const outgoing = new Map<string, ReferenceEdge[]>();
  const diagnostics: TokenDiagnostic[] = [];

  const groupPaths = new Set<string>();
  const collectGroups = (path: string[]): void => {
    groupPaths.add(pathKey(path));
  };
  for (const group of doc.groups) {
    collectGroups(group.path);
  }

  const tokensByKey = doc.tokens;
  const groupPathKeys = new Set([...groupPaths]);

  for (const token of Object.values(tokensByKey)) {
    const edges: ReferenceEdge[] = [];
    for (const ref of token.references) {
      const edge: ReferenceEdge = {
        from: pathKey(token.path),
        raw: ref.raw,
        kind: ref.kind,
        propertyLevel: ref.kind === 'json-pointer',
      };
      if (ref.kind === 'curly-brace') {
        const parsed = parseCurlyBrace(ref.raw);
        if (!parsed) {
          diagnostics.push({
            severity: 'error',
            code: 'ref.invalid-curly',
            message: `Invalid reference "${ref.raw}" on ${token.path.join('.')}`,
            sourceFileId: doc.sourceFileId,
            pointer: token.pointer,
            line: token.line,
            column: token.column,
          });
          continue;
        }
        const targetKey = pathKey(parsed.path);
        if (groupPathKeys.has(targetKey)) {
          edge.targetsGroup = true;
          diagnostics.push({
            severity: 'error',
            code: 'ref.targets-group',
            message: `Reference "${ref.raw}" on ${token.path.join('.')} targets a group, not a token`,
            sourceFileId: doc.sourceFileId,
            pointer: token.pointer,
          });
        } else if (!tokensByKey[targetKey]) {
          edge.missing = true;
          diagnostics.push({
            severity: 'error',
            code: 'ref.missing-target',
            message: `Reference "${ref.raw}" on ${token.path.join('.')} has no target token`,
            sourceFileId: doc.sourceFileId,
            pointer: token.pointer,
          });
        } else {
          edge.to = targetKey;
          addIncoming(incoming, targetKey, edge);
        }
      } else {
        // JSON Pointer: resolve against the document root value.
        try {
          const target = resolveJsonPointer(docSourceRoot(doc), ref.pointer);
          const targetKey = pointerTokenKey(doc, ref.pointer);
          edge.toPointer = ref.pointer;
          if (targetKey) {
            edge.to = targetKey;
            addIncoming(incoming, targetKey, edge);
          } else if (target !== undefined) {
            edge.missing = true;
            diagnostics.push({
              severity: 'warning',
              code: 'ref.pointer-not-token',
              message: `Pointer "${ref.pointer}" on ${token.path.join('.')} does not resolve to a token`,
              sourceFileId: doc.sourceFileId,
              pointer: token.pointer,
            });
          }
        } catch (err) {
          const pointerError = err as JsonPointerError;
          edge.missing = true;
          diagnostics.push({
            severity: 'error',
            code: `ref.invalid-pointer`,
            message: `Invalid JSON Pointer "${ref.pointer}" on ${token.path.join('.')}: ${pointerError.message}`,
            sourceFileId: doc.sourceFileId,
            pointer: token.pointer,
          });
        }
      }
      edges.push(edge);
    }
    if (edges.length > 0) {
      outgoing.set(pathKey(token.path), edges);
    }
  }

  // Type mismatch check: alias types must match target types.
  for (const [fromKey, edges] of outgoing) {
    const from = tokensByKey[fromKey];
    if (!from) continue;
    for (const edge of edges) {
      if (!edge.to) continue;
      const target = tokensByKey[edge.to];
      if (!target) continue;
      if (from.type && target.type && from.type !== target.type && !edge.propertyLevel) {
        edge.typeMismatch = true;
        diagnostics.push({
          severity: 'warning',
          code: 'ref.type-mismatch',
          message: `Token ${fromKey} (${from.type}) references ${edge.to} (${target.type})`,
          sourceFileId: doc.sourceFileId,
          pointer: from.pointer,
        });
      }
    }
  }

  // Cycle detection over the token graph.
  const cycleMembers = detectCycles(outgoing);
  const maxChainDepth = longestChainDepth(outgoing, cycleMembers);

  for (const member of cycleMembers) {
    diagnostics.push({
      severity: 'error',
      code: 'ref.cycle',
      message: `Token reference cycle detected involving ${member}`,
      sourceFileId: doc.sourceFileId,
    });
  }

  return { incoming, outgoing, cycleMembers, diagnostics, maxChainDepth };
}

function addIncoming(
  incoming: Map<string, ReferenceEdge[]>,
  target: string,
  edge: ReferenceEdge,
): void {
  const list = incoming.get(target) ?? [];
  list.push(edge);
  incoming.set(target, list);
}

function docSourceRoot(doc: DtcgDocument): unknown {
  return (doc as unknown as { sourceRoot?: unknown }).sourceRoot;
}

function pointerTokenKey(doc: DtcgDocument, pointer: string): string | undefined {
  // A pointer resolves to a token when its longest path prefix matches a
  // token path (with or without a trailing /$value segment).
  const segments = pointer.replace(/^#\//, '').split('/');
  for (let length = segments.length; length >= 1; length -= 1) {
    const candidate = segments.slice(0, length);
    if (candidate[candidate.length - 1] === '$value') {
      const trimmed = candidate.slice(0, -1);
      const key = trimmed.join('.');
      if (doc.tokens[key]) return key;
      continue;
    }
    const key = candidate.join('.');
    if (doc.tokens[key]) return key;
  }
  return undefined;
}

function detectCycles(outgoing: Map<string, ReferenceEdge[]>): Set<string> {
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  const cycleMembers = new Set<string>();

  const visit = (key: string, stack: Set<string>): void => {
    color.set(key, GRAY);
    stack.add(key);
    const edges = outgoing.get(key);
    if (edges) {
      for (const edge of edges) {
        if (!edge.to) continue;
        const next = edge.to;
        const nextColor = color.get(next) ?? WHITE;
        if (nextColor === GRAY) {
          // Found a cycle: mark all nodes on the current stack.
          for (const member of stack) cycleMembers.add(member);
        } else if (nextColor === WHITE) {
          visit(next, stack);
        }
      }
    }
    stack.delete(key);
    color.set(key, BLACK);
  };

  for (const key of outgoing.keys()) {
    if ((color.get(key) ?? WHITE) === WHITE) visit(key, new Set());
  }
  return cycleMembers;
}

function longestChainDepth(
  outgoing: Map<string, ReferenceEdge[]>,
  cycleMembers: Set<string>,
): number {
  const memo = new Map<string, number>();
  const depthOf = (key: string, visited: Set<string>): number => {
    if (cycleMembers.has(key)) return MAX_ALIAS_CHAIN_DEPTH;
    if (visited.has(key)) return MAX_ALIAS_CHAIN_DEPTH;
    const cached = memo.get(key);
    if (cached !== undefined) return cached;
    visited.add(key);
    const edges = outgoing.get(key);
    let max = 1;
    if (edges) {
      for (const edge of edges) {
        if (!edge.to) continue;
        max = Math.max(max, 1 + depthOf(edge.to, visited));
      }
    }
    visited.delete(key);
    memo.set(key, max);
    return max;
  };
  let max = 0;
  for (const key of outgoing.keys()) {
    max = Math.max(max, depthOf(key, new Set()));
  }
  return max;
}

/** Paths of tokens that alias the given token (direct + transitive). */
export function aliasDependants(graph: ReferenceGraph, targetKey: string): Set<string> {
  const dependants = new Set<string>();
  const visit = (key: string): void => {
    const edges = graph.incoming.get(key);
    if (!edges) return;
    for (const edge of edges) {
      if (dependants.has(edge.from)) continue;
      dependants.add(edge.from);
      visit(edge.from);
    }
  };
  visit(targetKey);
  return dependants;
}

/** Paths of tokens reachable by following references from a token. */
export function referenceTargets(graph: ReferenceGraph, fromKey: string): Set<string> {
  const targets = new Set<string>();
  const visit = (key: string): void => {
    const edges = graph.outgoing.get(key);
    if (!edges) return;
    for (const edge of edges) {
      if (!edge.to || targets.has(edge.to)) continue;
      targets.add(edge.to);
      visit(edge.to);
    }
  };
  visit(fromKey);
  return targets;
}

export function tokenByPath(doc: DtcgDocument, path: readonly string[]): DtcgTokenNode | undefined {
  return doc.tokens[pathKey(path)];
}
