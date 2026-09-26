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

import { validateTokenValue } from './codecs';
import { resolveFormatTokenValue } from './formatTokenResolver';
import { type JsonPointerError, parseJsonPointer, resolveJsonPointer } from './jsonPointer';
import { parseCurlyBrace, pathKey } from './parse';
import type { DtcgDocument, DtcgTokenNode, TokenDiagnostic } from './types';

export interface ReferenceEdge {
  from: string; // pathKey of the referencing token
  to?: string; // pathKey of the target token (resolved)
  toPointer?: string; // JSON pointer target when the edge is property-level
  raw: string;
  kind: 'curly-brace' | 'json-pointer';
  /** True when the reference is embedded in a composite or targets a sub-value. */
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
        propertyLevel: !token.isReference,
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
          const pointerValue = resolveJsonPointer(docSourceRoot(doc), ref.pointer);
          const target = pointerTokenTarget(doc, ref.pointer);
          edge.toPointer = ref.pointer;
          edge.propertyLevel =
            !token.isReference || target === undefined || !target.wholeTokenValue;
          if (target) {
            edge.to = target.key;
            addIncoming(incoming, target.key, edge);
          } else if (pointerValue !== undefined) {
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

  // Explicitly typed whole-token aliases keep their declared type, so a
  // mismatch means the resolved value cannot conform to that type. Implicit
  // aliases inherit their target type during format parsing. Property-level
  // references are intentionally excluded: their source sub-value can have
  // a different type from the containing token.
  for (const [fromKey, edges] of outgoing) {
    const from = tokensByKey[fromKey];
    if (!from) continue;
    for (const edge of edges) {
      if (!edge.to) continue;
      const target = tokensByKey[edge.to];
      if (!target) continue;
      if (
        from.explicitType &&
        target.type &&
        from.explicitType !== target.type &&
        !edge.propertyLevel
      ) {
        edge.typeMismatch = true;
        diagnostics.push({
          severity: 'error',
          code: 'ref.type-mismatch',
          message: `Token ${fromKey} explicitly declares type "${from.explicitType}" but whole-token reference "${edge.raw}" targets ${edge.to} (${target.type}); the resolved value cannot conform to the declared type`,
          sourceFileId: doc.sourceFileId,
          pointer: from.pointer,
        });
      }
    }
  }

  // Cycle detection over the token graph.
  const cycleMembers = detectCycles(outgoing);
  const chainDepth = longestChainDepth(outgoing, cycleMembers);
  const maxChainDepth = chainDepth.depth;

  for (const member of cycleMembers) {
    diagnostics.push({
      severity: 'error',
      code: 'ref.cycle',
      message: `Token reference cycle detected involving ${member}`,
      sourceFileId: doc.sourceFileId,
    });
  }

  if (maxChainDepth > MAX_ALIAS_CHAIN_DEPTH) {
    const token = chainDepth.start ? tokensByKey[chainDepth.start] : undefined;
    diagnostics.push({
      severity: 'error',
      code: 'ref.max-depth',
      message: `Reference chain from ${chainDepth.start ?? '<unknown>'} has depth ${maxChainDepth}, exceeding the limit of ${MAX_ALIAS_CHAIN_DEPTH}`,
      sourceFileId: doc.sourceFileId,
      pointer: token?.pointer,
    });
  }

  return { incoming, outgoing, cycleMembers, diagnostics, maxChainDepth };
}

/**
 * Validate resolved values for reference owners. Literal values are checked
 * during parsing, and whole-token alias type mismatches are reported by the
 * graph. This pass catches property references that leave the containing
 * composite or primitive incompatible with its declared token type.
 */
export function validateResolvedTokenValues(doc: DtcgDocument): TokenDiagnostic[] {
  const diagnostics: TokenDiagnostic[] = [];
  for (const token of Object.values(doc.tokens)) {
    if (!token.type || token.references.length === 0 || !hasPropertyReference(doc, token)) {
      continue;
    }

    let value: unknown;
    try {
      value = resolveFormatTokenValue(doc, token);
    } catch {
      // Missing, malformed, and circular references are reported elsewhere.
      continue;
    }

    const validation = validateTokenValue(token.type, value, {
      sourceFileId: doc.sourceFileId,
      pointer: token.valuePointer,
      path: token.path,
    });
    for (const diagnostic of validation.diagnostics) {
      diagnostics.push({
        ...diagnostic,
        code: 'ref.resolved-value-invalid',
        message: `Resolved value for ${pathKey(token.path)} does not satisfy $type "${token.type}": ${diagnostic.message}`,
        pointer: token.valuePointer,
        line: token.line,
        column: token.column,
      });
    }
  }
  return diagnostics;
}

function hasPropertyReference(doc: DtcgDocument, token: DtcgTokenNode): boolean {
  if (!token.isReference) return true;
  for (const reference of token.references) {
    if (reference.kind === 'curly-brace') continue;
    try {
      if (pointerTokenTarget(doc, reference.pointer)?.wholeTokenValue !== true) return true;
    } catch {
      // The graph reports malformed pointers; resolution below also fails
      // safely, so this diagnostic pass must not turn bad input into a throw.
      return true;
    }
  }
  return false;
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
  return doc.resolvedSourceRoot ?? doc.sourceRoot;
}

function pointerTokenTarget(
  doc: DtcgDocument,
  pointer: string,
): { key: string; wholeTokenValue: boolean } | undefined {
  const segments = parseJsonPointer(pointer).map(({ value }) => value);
  for (let length = segments.length; length >= 1; length -= 1) {
    const candidate = segments.slice(0, length);
    if (candidate[candidate.length - 1] === '$value') {
      const trimmed = candidate.slice(0, -1);
      const key = trimmed.join('.');
      if (Object.hasOwn(doc.tokens, key)) {
        return { key, wholeTokenValue: segments.length === length };
      }
      continue;
    }
    const key = candidate.join('.');
    if (Object.hasOwn(doc.tokens, key)) {
      return { key, wholeTokenValue: segments.length === length };
    }
  }
  return undefined;
}

function detectCycles(outgoing: Map<string, ReferenceEdge[]>): Set<string> {
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  const cycleMembers = new Set<string>();

  for (const key of outgoing.keys()) {
    if ((color.get(key) ?? WHITE) !== WHITE) continue;

    const activePath: string[] = [key];
    const activeIndex = new Map<string, number>([[key, 0]]);
    const frames: Array<{ key: string; nextEdge: number }> = [{ key, nextEdge: 0 }];
    color.set(key, GRAY);

    while (frames.length > 0) {
      const frame = frames[frames.length - 1]!;
      const edges = outgoing.get(frame.key) ?? [];
      if (frame.nextEdge >= edges.length) {
        frames.pop();
        color.set(frame.key, BLACK);
        activePath.pop();
        activeIndex.delete(frame.key);
        continue;
      }

      const edge = edges[frame.nextEdge++]!;
      if (!edge.to) continue;
      const nextColor = color.get(edge.to) ?? WHITE;
      if (nextColor === GRAY) {
        const cycleStart = activeIndex.get(edge.to);
        if (cycleStart !== undefined) {
          for (let index = cycleStart; index < activePath.length; index += 1) {
            cycleMembers.add(activePath[index]!);
          }
        }
      } else if (nextColor === WHITE) {
        color.set(edge.to, GRAY);
        activeIndex.set(edge.to, activePath.length);
        activePath.push(edge.to);
        frames.push({ key: edge.to, nextEdge: 0 });
      }
    }
  }
  return cycleMembers;
}

function longestChainDepth(
  outgoing: Map<string, ReferenceEdge[]>,
  cycleMembers: Set<string>,
): { depth: number; start?: string } {
  const vertices = new Set<string>(outgoing.keys());
  for (const edges of outgoing.values()) {
    for (const edge of edges) if (edge.to) vertices.add(edge.to);
  }

  const depth = new Map<string, number>();
  const remaining = new Map<string, number>();
  const parents = new Map<string, string[]>();
  for (const key of vertices) {
    depth.set(key, cycleMembers.has(key) ? 0 : 1);
    remaining.set(key, 0);
  }

  for (const [from, edges] of outgoing) {
    if (cycleMembers.has(from)) continue;
    for (const edge of edges) {
      if (!edge.to) continue;
      if (cycleMembers.has(edge.to)) continue;
      remaining.set(from, (remaining.get(from) ?? 0) + 1);
      const list = parents.get(edge.to) ?? [];
      list.push(from);
      parents.set(edge.to, list);
    }
  }

  // Kahn's algorithm in reverse reference order computes the longest path
  // without recursive calls, even for 100k-token inputs.
  const ready: string[] = [];
  for (const [key, count] of remaining) {
    if (!cycleMembers.has(key) && count === 0) ready.push(key);
  }
  for (let cursor = 0; cursor < ready.length; cursor += 1) {
    const target = ready[cursor]!;
    for (const parent of parents.get(target) ?? []) {
      depth.set(parent, Math.max(depth.get(parent) ?? 1, (depth.get(target) ?? 1) + 1));
      const pending = (remaining.get(parent) ?? 1) - 1;
      remaining.set(parent, pending);
      if (pending === 0) ready.push(parent);
    }
  }

  let maximum = 0;
  let start: string | undefined;
  for (const [key, value] of depth) {
    if (value > maximum) {
      maximum = value;
      start = key;
    }
  }
  // A cycle already has its own precise error. Preserve the previous bounded
  // depth value without inventing a second max-depth failure for a short cycle.
  if (cycleMembers.size > 0 && maximum < MAX_ALIAS_CHAIN_DEPTH) {
    maximum = MAX_ALIAS_CHAIN_DEPTH;
    start = cycleMembers.values().next().value;
  }
  return { depth: maximum, start };
}

/** Paths of tokens that alias the given token (direct + transitive). */
export function aliasDependants(graph: ReferenceGraph, targetKey: string): Set<string> {
  const dependants = new Set<string>();
  const pending = [targetKey];
  while (pending.length > 0) {
    const key = pending.pop()!;
    for (const edge of graph.incoming.get(key) ?? []) {
      if (dependants.has(edge.from)) continue;
      dependants.add(edge.from);
      pending.push(edge.from);
    }
  }
  return dependants;
}

/** Paths of tokens reachable by following references from a token. */
export function referenceTargets(graph: ReferenceGraph, fromKey: string): Set<string> {
  const targets = new Set<string>();
  const pending = [fromKey];
  while (pending.length > 0) {
    const key = pending.pop()!;
    for (const edge of graph.outgoing.get(key) ?? []) {
      if (!edge.to || targets.has(edge.to)) continue;
      targets.add(edge.to);
      pending.push(edge.to);
    }
  }
  return targets;
}

export function tokenByPath(doc: DtcgDocument, path: readonly string[]): DtcgTokenNode | undefined {
  return doc.tokens[pathKey(path)];
}
