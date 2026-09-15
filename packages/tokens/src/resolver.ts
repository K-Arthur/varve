/**
 * DTCG 2025.10 Resolver module (ADR-0105).
 *
 * Resolver documents describe conditional token values across contexts
 * (light/dark, brand, platform, density, …) without combinatorial
 * materialization. Stages per the report's resolution logic:
 *
 *   1. input validation      — modifiers/contexts/defaults, string values
 *   2. ordering              — resolutionOrder flattening, last-wins merge
 *   3. aliases               — resolved ONLY after flattening
 *   4. resolution            — final token set for the given input
 *
 * File references ({ "$ref": "path.json" }) are resolved through an
 * injected loader; same-document references are resolved natively.
 * Permutations are never materialized eagerly — this engine evaluates one
 * input at a time (lazy by construction).
 */
import { type JsonSourceResult, parseJsonSource } from './json';
import { type JsonPointerError, resolveJsonPointer } from './jsonPointer';
import { parseFormatDocument, pathKey } from './parse';
import { buildReferenceGraph } from './refGraph';
import { STABLE_DTCG_SPECIFICATION_VERSION } from './spec';
import type { DtcgDocument, DtcgTokenNode, TokenDiagnostic } from './types';

export type ResolverSource = { $ref: string } | Record<string, unknown>;

export interface ResolverSet {
  name: string;
  description?: string;
  sources: ResolverSource[];
  extensions: Record<string, unknown>;
}

export interface ResolverModifier {
  name: string;
  description?: string;
  contexts: Record<string, ResolverSource[]>;
  default?: string;
  extensions: Record<string, unknown>;
}

export type ResolverOrderItem =
  | { kind: 'set'; name: string; source: ResolverSet }
  | { kind: 'modifier'; name: string; source: ResolverModifier };

export interface ResolverDocument {
  name?: string;
  version: string;
  description?: string;
  sets: Record<string, ResolverSet>;
  modifiers: Record<string, ResolverModifier>;
  resolutionOrder: ResolverOrderItem[];
  diagnostics: TokenDiagnostic[];
  sourceFileId: string;
}

export interface ResolverInput {
  [modifierName: string]: string;
}

export interface ResolverPermutation {
  /** Flattened, alias-resolved token document. */
  document: DtcgDocument;
  /** pathKey → resolved value. */
  resolved: Record<string, unknown>;
  /** Number of possible permutations (product of context counts). */
  permutationCount: number;
  diagnostics: TokenDiagnostic[];
}

export interface ResolveOptions {
  /** Loads an external file referenced by $ref. Returns the parsed JSON. */
  loadExternal?: (ref: string) => Record<string, unknown> | undefined;
  maxSources?: number;
}

export const RESOLVER_MAX_SOURCES = 256;

export function parseResolverDocument(
  text: string,
  sourceFileId = 'resolver.json',
): ResolverDocument {
  const diagnostics: TokenDiagnostic[] = [];
  let source: JsonSourceResult;
  try {
    source = parseJsonSource(text);
  } catch (err) {
    const error = err as { code?: string; message?: string; line?: number; column?: number };
    diagnostics.push({
      severity: 'error',
      code: error.code ?? 'json.syntax',
      message: error.message ?? 'Invalid JSON',
      sourceFileId,
      line: error.line,
      column: error.column,
    });
    return { version: '', sets: {}, modifiers: {}, resolutionOrder: [], diagnostics, sourceFileId };
  }

  const root = source.value;
  if (root === null || typeof root !== 'object' || Array.isArray(root)) {
    diagnostics.push({
      severity: 'error',
      code: 'resolver.root-object',
      message: 'Resolver document must be a JSON object',
      sourceFileId,
    });
    return { version: '', sets: {}, modifiers: {}, resolutionOrder: [], diagnostics, sourceFileId };
  }
  const raw = root as Record<string, unknown>;

  const version = raw.version;
  if (version !== '2025.10') {
    diagnostics.push({
      severity: 'error',
      code: 'resolver.version',
      message: `Resolver version must be 2025.10, got ${String(version)}`,
      sourceFileId,
      pointer: '/version',
    });
  }

  const sets: Record<string, ResolverSet> = {};
  if (raw.sets !== undefined) {
    if (!isRecord(raw.sets)) {
      diagnostics.push({
        severity: 'error',
        code: 'resolver.sets-type',
        message: 'sets must be an object of named sets',
        sourceFileId,
        pointer: '/sets',
      });
    } else {
      for (const [name, value] of Object.entries(raw.sets)) {
        if (!isRecord(value)) {
          diagnostics.push({
            severity: 'error',
            code: 'resolver.set-type',
            message: `set "${name}" must be an object`,
            sourceFileId,
            pointer: `/sets/${name}`,
          });
          continue;
        }
        const sources = parseSources(
          value.sources,
          `/sets/${name}/sources`,
          sourceFileId,
          diagnostics,
        );
        sets[name] = {
          name,
          description: typeof value.description === 'string' ? value.description : undefined,
          sources,
          extensions: readExtensions(value, `/sets/${name}`, sourceFileId, diagnostics),
        };
      }
    }
  }

  const modifiers: Record<string, ResolverModifier> = {};
  if (raw.modifiers !== undefined) {
    if (!isRecord(raw.modifiers)) {
      diagnostics.push({
        severity: 'error',
        code: 'resolver.modifiers-type',
        message: 'modifiers must be an object of named modifiers',
        sourceFileId,
        pointer: '/modifiers',
      });
    } else {
      for (const [name, value] of Object.entries(raw.modifiers)) {
        if (!isRecord(value)) {
          diagnostics.push({
            severity: 'error',
            code: 'resolver.modifier-type',
            message: `modifier "${name}" must be an object`,
            sourceFileId,
            pointer: `/modifiers/${name}`,
          });
          continue;
        }
        const contexts = value.contexts;
        if (!isRecord(contexts)) {
          diagnostics.push({
            severity: 'error',
            code: 'resolver.contexts-type',
            message: `modifier "${name}" must declare a contexts map`,
            sourceFileId,
            pointer: `/modifiers/${name}/contexts`,
          });
          continue;
        }
        const contextCount = Object.keys(contexts).length;
        if (contextCount === 0) {
          diagnostics.push({
            severity: 'error',
            code: 'resolver.contexts-empty',
            message: `modifier "${name}" must not have an empty contexts map`,
            sourceFileId,
            pointer: `/modifiers/${name}/contexts`,
          });
        } else if (contextCount === 1) {
          diagnostics.push({
            severity: 'warning',
            code: 'resolver.contexts-single',
            message: `modifier "${name}" has only one context; this is equivalent to a set`,
            sourceFileId,
            pointer: `/modifiers/${name}/contexts`,
          });
        }
        const parsedContexts: Record<string, ResolverSource[]> = {};
        for (const [contextName, contextValue] of Object.entries(contexts)) {
          parsedContexts[contextName] = parseSources(
            contextValue,
            `/modifiers/${name}/contexts/${contextName}`,
            sourceFileId,
            diagnostics,
          );
        }
        const modifierDefault = value.default;
        let declaredDefault: string | undefined;
        if (modifierDefault !== undefined) {
          if (typeof modifierDefault !== 'string' || !(modifierDefault in parsedContexts)) {
            diagnostics.push({
              severity: 'error',
              code: 'resolver.default-mismatch',
              message: `modifier "${name}" default "${String(modifierDefault)}" must match a context key`,
              sourceFileId,
              pointer: `/modifiers/${name}/default`,
            });
          } else {
            declaredDefault = modifierDefault;
          }
        }
        modifiers[name] = {
          name,
          description: typeof value.description === 'string' ? value.description : undefined,
          contexts: parsedContexts,
          default: declaredDefault,
          extensions: readExtensions(value, `/modifiers/${name}`, sourceFileId, diagnostics),
        };
      }
    }
  }

  // resolutionOrder validation + resolution.
  const resolutionOrder: ResolverOrderItem[] = [];
  const orderNames = new Set<string>();
  if (!Array.isArray(raw.resolutionOrder)) {
    diagnostics.push({
      severity: 'error',
      code: 'resolver.order-required',
      message: 'resolutionOrder is required and must be an array',
      sourceFileId,
      pointer: '/resolutionOrder',
    });
  } else {
    raw.resolutionOrder.forEach((item, index) => {
      const pointer = `/resolutionOrder/${index}`;
      if (!isRecord(item)) {
        diagnostics.push({
          severity: 'error',
          code: 'resolver.order-item-type',
          message: 'resolutionOrder items must be reference objects or inline sets/modifiers',
          sourceFileId,
          pointer,
        });
        return;
      }
      const isInline = item.type === 'set' || item.type === 'modifier';
      const isRef = typeof item.$ref === 'string';
      const looksInline = item.sources !== undefined || item.contexts !== undefined;
      if (looksInline && !isInline) {
        diagnostics.push({
          severity: 'error',
          code: 'resolver.order-inline-shape',
          message:
            'inline resolutionOrder items must declare a string name and a "set" or "modifier" type',
          sourceFileId,
          pointer,
        });
        return;
      }
      if (isInline) {
        const name = item.name;
        if (typeof name !== 'string' || (item.type !== 'set' && item.type !== 'modifier')) {
          diagnostics.push({
            severity: 'error',
            code: 'resolver.order-inline-shape',
            message:
              'inline resolutionOrder items must declare a string name and a "set" or "modifier" type',
            sourceFileId,
            pointer,
          });
          return;
        }
        if (orderNames.has(name)) {
          diagnostics.push({
            severity: 'error',
            code: 'resolver.order-duplicate-name',
            message: `duplicate name "${name}" in resolutionOrder`,
            sourceFileId,
            pointer,
          });
          return;
        }
        orderNames.add(name);
        if (item.type === 'set') {
          const sources = parseSources(
            item.sources,
            `${pointer}/sources`,
            sourceFileId,
            diagnostics,
          );
          resolutionOrder.push({
            kind: 'set',
            name,
            source: {
              name,
              sources,
              extensions: readExtensions(item, pointer, sourceFileId, diagnostics),
            },
          });
        } else {
          const contexts = item.contexts;
          if (!isRecord(contexts) || Object.keys(contexts).length === 0) {
            diagnostics.push({
              severity: 'error',
              code: 'resolver.order-modifier-contexts',
              message: `inline modifier "${name}" must declare a non-empty contexts map`,
              sourceFileId,
              pointer: `${pointer}/contexts`,
            });
            return;
          }
          const parsedContexts: Record<string, ResolverSource[]> = {};
          for (const [contextName, contextValue] of Object.entries(contexts)) {
            parsedContexts[contextName] = parseSources(
              contextValue,
              `${pointer}/contexts/${contextName}`,
              sourceFileId,
              diagnostics,
            );
          }
          resolutionOrder.push({
            kind: 'modifier',
            name,
            source: {
              name,
              contexts: parsedContexts,
              extensions: readExtensions(item, pointer, sourceFileId, diagnostics),
            },
          });
        }
      } else if (isRef) {
        const ref = item.$ref as string;
        if (ref.startsWith('#/resolutionOrder/')) {
          diagnostics.push({
            severity: 'error',
            code: 'resolver.order-ref-resolution-order',
            message: 'reference objects must not point into resolutionOrder',
            sourceFileId,
            pointer,
          });
          return;
        }
        if (ref.startsWith('#/modifiers/')) {
          const name = ref.slice('#/modifiers/'.length);
          if (!modifiers[name]) {
            diagnostics.push({
              severity: 'error',
              code: 'resolver.order-ref-missing',
              message: `resolutionOrder references missing modifier "${name}"`,
              sourceFileId,
              pointer,
            });
            return;
          }
          if (orderNames.has(name)) {
            diagnostics.push({
              severity: 'error',
              code: 'resolver.order-duplicate-name',
              message: `duplicate name "${name}" in resolutionOrder`,
              sourceFileId,
              pointer,
            });
            return;
          }
          orderNames.add(name);
          resolutionOrder.push({ kind: 'modifier', name, source: modifiers[name]! });
          return;
        }
        if (ref.startsWith('#/sets/')) {
          const name = ref.slice('#/sets/'.length);
          if (!sets[name]) {
            diagnostics.push({
              severity: 'error',
              code: 'resolver.order-ref-missing',
              message: `resolutionOrder references missing set "${name}"`,
              sourceFileId,
              pointer,
            });
            return;
          }
          if (orderNames.has(name)) {
            diagnostics.push({
              severity: 'error',
              code: 'resolver.order-duplicate-name',
              message: `duplicate name "${name}" in resolutionOrder`,
              sourceFileId,
              pointer,
            });
            return;
          }
          orderNames.add(name);
          resolutionOrder.push({ kind: 'set', name, source: sets[name]! });
          return;
        }
        diagnostics.push({
          severity: 'error',
          code: 'resolver.order-ref-target',
          message: `resolutionOrder references must point to #/sets/… or #/modifiers/… (got "${ref}")`,
          sourceFileId,
          pointer,
        });
      } else {
        diagnostics.push({
          severity: 'error',
          code: 'resolver.order-item-shape',
          message: 'resolutionOrder items must be inline sets/modifiers or $ref objects',
          sourceFileId,
          pointer,
        });
      }
    });
  }

  return {
    name: typeof raw.name === 'string' ? raw.name : undefined,
    version: typeof version === 'string' ? version : '',
    description: typeof raw.description === 'string' ? raw.description : undefined,
    sets,
    modifiers,
    resolutionOrder,
    diagnostics,
    sourceFileId,
  };
}

function parseSources(
  raw: unknown,
  pointer: string,
  sourceFileId: string,
  diagnostics: TokenDiagnostic[],
): ResolverSource[] {
  if (!Array.isArray(raw)) {
    diagnostics.push({
      severity: 'error',
      code: 'resolver.sources-type',
      message: `sources at ${pointer} must be an array`,
      sourceFileId,
      pointer,
    });
    return [];
  }
  const sources: ResolverSource[] = [];
  for (const [index, item] of raw.entries()) {
    if (isRecord(item) && typeof item.$ref === 'string') {
      sources.push({ $ref: item.$ref });
    } else if (isRecord(item)) {
      sources.push(item as Record<string, unknown>);
    } else {
      diagnostics.push({
        severity: 'error',
        code: 'resolver.source-type',
        message: `source at ${pointer}/${index} must be an object`,
        sourceFileId,
        pointer: `${pointer}/${index}`,
      });
    }
  }
  return sources;
}

function readExtensions(
  value: Record<string, unknown>,
  pointer: string,
  sourceFileId: string,
  diagnostics: TokenDiagnostic[],
): Record<string, unknown> {
  const raw = value.$extensions;
  if (raw === undefined) return {};
  if (!isRecord(raw)) {
    diagnostics.push({
      severity: 'error',
      code: 'resolver.extensions-type',
      message: `$extensions at ${pointer} must be an object`,
      sourceFileId,
      pointer: `${pointer}/$extensions`,
    });
    return {};
  }
  return raw;
}

/** Validate an input object against a parsed resolver (stage 1). */
export function validateResolverInput(
  doc: ResolverDocument,
  input: ResolverInput,
): TokenDiagnostic[] {
  const diagnostics: TokenDiagnostic[] = [];
  for (const [name, value] of Object.entries(input)) {
    if (typeof value !== 'string') {
      diagnostics.push({
        severity: 'error',
        code: 'resolver.input-type',
        message: `input "${name}" must be a string, got ${typeof value}`,
        sourceFileId: doc.sourceFileId,
      });
      continue;
    }
    const modifier = doc.modifiers[name];
    if (!modifier) {
      diagnostics.push({
        severity: 'error',
        code: 'resolver.input-unknown-modifier',
        message: `unknown modifier "${name}" in input`,
        sourceFileId: doc.sourceFileId,
      });
      continue;
    }
    if (!(value in modifier.contexts)) {
      diagnostics.push({
        severity: 'error',
        code: 'resolver.input-invalid-context',
        message: `invalid context "${value}" for modifier "${name}"`,
        sourceFileId: doc.sourceFileId,
      });
    }
  }
  for (const modifier of Object.values(doc.modifiers)) {
    if (modifier.default === undefined && !(modifier.name in input)) {
      diagnostics.push({
        severity: 'error',
        code: 'resolver.input-missing-modifier',
        message: `missing modifier "${modifier.name}" in input`,
        sourceFileId: doc.sourceFileId,
      });
    }
  }
  return diagnostics;
}

export function permutationCount(doc: ResolverDocument): number {
  let count = 1;
  for (const item of doc.resolutionOrder) {
    if (item.kind === 'modifier') {
      count *= Object.keys(item.source.contexts).length;
    }
  }
  return count;
}

/**
 * Resolve one permutation for a given input (stages 1-4). External file
 * references require a loader; same-document references are native.
 */
export function resolvePermutation(
  doc: ResolverDocument,
  input: ResolverInput,
  options: ResolveOptions = {},
): ResolverPermutation {
  const diagnostics = [...validateResolverInput(doc, input)];
  const merged: Record<string, unknown> = {};
  const maxSources = options.maxSources ?? RESOLVER_MAX_SOURCES;
  let sourceCount = 0;
  const expanding = new Set<string>();

  const expandSources = (sources: ResolverSource[], stack: string[]): void => {
    for (const source of sources) {
      sourceCount += 1;
      if (sourceCount > maxSources) {
        diagnostics.push({
          severity: 'error',
          code: 'resolver.max-sources',
          message: `source count exceeds the limit (${maxSources})`,
          sourceFileId: doc.sourceFileId,
        });
        return;
      }
      if ('$ref' in source) {
        const ref = source.$ref as string;
        if (ref.startsWith('#/')) {
          const key = ref.slice(2);
          const parts = key.split('/').map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'));
          if (parts[0] === 'sets' && parts.length === 2) {
            const set = doc.sets[parts[1]!];
            if (!set) {
              diagnostics.push({
                severity: 'error',
                sourceFileId: doc.sourceFileId,
                code: 'resolver.ref-missing-set',
                message: `reference "${ref}" targets a missing set`,
              });
              continue;
            }
            const signature = `set:${parts[1]}`;
            if (expanding.has(signature)) {
              diagnostics.push({
                severity: 'error',
                sourceFileId: doc.sourceFileId,
                code: 'resolver.ref-cycle',
                message: `circular reference "${ref}"`,
              });
              continue;
            }
            expanding.add(signature);
            expandSources(set.sources, [...stack, ref]);
            expanding.delete(signature);
            continue;
          }
          if (parts[0] === 'modifiers' && parts.length === 2) {
            diagnostics.push({
              severity: 'error',
              sourceFileId: doc.sourceFileId,
              code: 'resolver.ref-modifier-in-set',
              message: `reference "${ref}" points to a modifier; sets and modifiers must not reference modifiers`,
            });
            continue;
          }
          diagnostics.push({
            severity: 'error',
            sourceFileId: doc.sourceFileId,
            code: 'resolver.ref-invalid',
            message: `unsupported same-document reference "${ref}"`,
          });
          continue;
        }
        // External file reference.
        const loaded = options.loadExternal?.(ref);
        if (loaded === undefined) {
          diagnostics.push({
            severity: 'error',
            sourceFileId: doc.sourceFileId,
            code: 'resolver.ref-unresolvable',
            message: `cannot resolve external reference "${ref}" (no loader or missing file)`,
          });
          continue;
        }
        mergeTokenTree(merged, loaded);
        continue;
      }
      mergeTokenTree(merged, source as Record<string, unknown>);
    }
  };

  for (const item of doc.resolutionOrder) {
    if (item.kind === 'set') {
      expandSources(item.source.sources, []);
    } else {
      const modifier = item.source;
      const selected = input[modifier.name] ?? modifier.default;
      if (selected === undefined) {
        diagnostics.push({
          severity: 'error',
          sourceFileId: doc.sourceFileId,
          code: 'resolver.order-missing-input',
          message: `no input for modifier "${modifier.name}"`,
        });
        continue;
      }
      expandSources(modifier.contexts[selected] ?? [], []);
    }
  }

  // Stage 3: aliases resolve only after flattening. Re-parse the merged
  // tree through the format parser so validation is identical to imports.
  const mergedText = JSON.stringify(merged);
  const document = parseFormatDocument(mergedText, {
    sourceFileId: `${doc.sourceFileId} (resolved)`,
  });
  diagnostics.push(...document.diagnostics);
  const graph = buildReferenceGraph(document);
  diagnostics.push(...graph.diagnostics);

  // Stage 4: resolve alias chains with cycle detection.
  const resolved: Record<string, unknown> = {};
  for (const token of Object.values(document.tokens)) {
    try {
      resolved[pathKey(token.path)] = resolveTokenValue(document, token, new Set());
    } catch {
      resolved[pathKey(token.path)] = undefined;
    }
  }

  return { document, resolved, permutationCount: permutationCount(doc), diagnostics };
}

/** Deep last-wins merge of token trees (spec 6.2). */
function mergeTokenTree(target: Record<string, unknown>, source: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(source)) {
    const existing = target[key];
    if (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      existing !== null &&
      typeof existing === 'object' &&
      !Array.isArray(existing)
    ) {
      mergeTokenTree(existing as Record<string, unknown>, value as Record<string, unknown>);
    } else {
      target[key] = value;
    }
  }
}

function resolveTokenValue(
  doc: DtcgDocument,
  token: DtcgTokenNode,
  visiting: Set<string>,
): unknown {
  if (!token.isReference) return token.value;
  const key = pathKey(token.path);
  if (visiting.has(key)) {
    throw new Error(`circular reference: ${key}`);
  }
  visiting.add(key);
  try {
    for (const ref of token.references) {
      if (ref.kind === 'curly-brace') {
        const target = doc.tokens[pathKey(ref.path)];
        if (!target) throw new Error(`missing target: ${ref.path.join('.')}`);
        return resolveTokenValue(doc, target, visiting);
      }
      if (ref.kind === 'json-pointer') {
        try {
          const value = resolveJsonPointer(doc.sourceRoot, ref.pointer);
          return value;
        } catch (err) {
          const pointerError = err as JsonPointerError;
          throw new Error(`invalid pointer ${ref.pointer}: ${pointerError.message}`);
        }
      }
    }
    throw new Error(`unresolvable reference on ${key}`);
  } finally {
    visiting.delete(key);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export type { DtcgTokenNode };
export { STABLE_DTCG_SPECIFICATION_VERSION };
