/**
 * DTCG 2025.10 structural parser and validator (format module).
 *
 * Pipeline stages 3-6: structural parse → version validation → semantic
 * validation → reference extraction. Deterministic; never uses AI.
 *
 * Implements the normative rules from the 2025.10 format report:
 * - $value marks tokens; objects without $value are groups
 * - a token with both $value and children is an error (6.1)
 * - names must not start with $ and must not contain { } . (5.1.1)
 * - $root is a reserved root-token name; paths include .$root (6.2, 6.7.2)
 * - $type inherits from the closest typed parent group (6.7.3)
 * - $extends deep-merges groups like JSON Schema $ref (6.4), no cycles
 * - curly-brace references target complete tokens (7.1.1)
 * - $ref JSON Pointer references (7.1.2), property-level (7.3)
 */
import { type JsonSourceResult, parseJsonSource } from './json';
import {
  type DtcgSpecificationVersion,
  isStableTokenType,
  STABLE_DTCG_SPECIFICATION_VERSION,
} from './spec';
import type {
  CurlyBraceReference,
  DtcgDocument,
  DtcgGroupNode,
  DtcgTokenNode,
  JsonPointerReference,
  ParseJsonOptions,
  TokenDiagnostic,
  TokenReference,
} from './types';

const RESERVED_TOKEN_NAME = '$root';

const NAME_FORBIDDEN = /[{}.]/;

/** Known $ properties per the format report. Anything else is preserved but
 * warned (never silently dropped). */
const KNOWN_TOKEN_PROPERTIES = new Set([
  '$value',
  '$type',
  '$description',
  '$deprecated',
  '$extensions',
  '$ref',
]);
const KNOWN_GROUP_PROPERTIES = new Set([
  '$type',
  '$description',
  '$deprecated',
  '$extensions',
  '$extends',
]);

export interface ParseFormatOptions extends ParseJsonOptions {
  specificationVersion?: DtcgSpecificationVersion;
  /** Compatibility import mode: relax name/type strictness with warnings
   * instead of errors. Never silently rewrites input. */
  compatibility?: boolean;
}

export function parseFormatDocument(text: string, options: ParseFormatOptions = {}): DtcgDocument {
  const sourceFileId = options.sourceFileId ?? 'untitled';
  const specVersion = options.specificationVersion ?? STABLE_DTCG_SPECIFICATION_VERSION;
  const strict = options.strict ?? true;
  const compatibility = options.compatibility ?? false;
  const diagnostics: TokenDiagnostic[] = [];
  const tokens: Record<string, DtcgTokenNode> = {};

  let source: JsonSourceResult;
  try {
    source = parseJsonSource(text, { maxBytes: options.maxBytes, maxDepth: options.maxDepth });
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
    return { tokens, groups: [], diagnostics, specificationVersion: specVersion, sourceFileId };
  }

  for (const d of source.diagnostics) {
    diagnostics.push({
      severity: 'warning',
      code: `json.${d.code}`,
      message: d.message,
      sourceFileId,
      line: d.line,
      column: d.column,
    });
  }

  if (source.value === null || typeof source.value !== 'object' || Array.isArray(source.value)) {
    diagnostics.push({
      severity: 'error',
      code: 'dtcg.root-object',
      message: 'A DTCG document must be a JSON object',
      sourceFileId,
    });
    return {
      tokens,
      groups: [],
      diagnostics,
      specificationVersion: specVersion,
      sourceFileId,
      sourceRoot: undefined,
    };
  }

  const root = source.value as Record<string, unknown>;
  const maxTokens = options.maxTokens ?? 100_000;
  let tokenCount = 0;

  const pointerOf = (path: string[]): string =>
    path.length === 0 ? '' : `/${path.map(escapeSegment).join('/')}`;

  const locationFor = (pointer: string): { line?: number; column?: number } => {
    const loc = source.keyLocations.get(pointer);
    if (!loc) return {};
    return { line: loc.line, column: loc.column };
  };

  /** Resolve $extends deep merge with cycle detection. */
  const resolveGroup = (
    raw: Record<string, unknown>,
    path: string[],
    visiting: Set<string>,
    visited: Map<string, Record<string, unknown>>,
  ): Record<string, unknown> | undefined => {
    const key = pathKey(path);
    if (visiting.has(key)) {
      diagnostics.push({
        severity: 'error',
        code: 'dtcg.extends-cycle',
        message: `Circular $extends chain involving group ${path.join('.')}`,
        sourceFileId,
        pointer: pointerOf(path),
        related: [...visiting].map((p) => ({ sourceFileId, pointer: pathKeyToPointer(p) })),
      });
      return undefined;
    }
    if (visited.has(key)) return visited.get(key);

    const extendsRef = typeof raw.$extends === 'string' ? raw.$extends : undefined;
    if (
      extendsRef !== undefined &&
      raw.$extends !== undefined &&
      typeof raw.$extends !== 'string'
    ) {
      diagnostics.push({
        severity: 'error',
        code: 'dtcg.extends-type',
        message: `$extends on ${path.join('.')} must be a string reference`,
        sourceFileId,
        pointer: pointerOf([...path, '$extends']),
      });
    }
    if (extendsRef) {
      const parsed = parseCurlyBrace(extendsRef);
      if (!parsed) {
        diagnostics.push({
          severity: 'error',
          code: 'dtcg.extends-invalid-ref',
          message: `Invalid $extends reference "${extendsRef}" on ${path.join('.')}`,
          sourceFileId,
          pointer: pointerOf([...path, '$extends']),
        });
        return undefined;
      }
      const target = lookupRaw(root, parsed.path);
      if (
        target === undefined ||
        target === null ||
        typeof target !== 'object' ||
        Array.isArray(target)
      ) {
        diagnostics.push({
          severity: 'error',
          code: 'dtcg.extends-missing-target',
          message: `$extends target ${parsed.path.join('.')} not found (referenced from ${path.join('.')})`,
          sourceFileId,
          pointer: pointerOf([...path, '$extends']),
        });
        return undefined;
      }
      if ('$value' in (target as Record<string, unknown>)) {
        diagnostics.push({
          severity: 'error',
          code: 'dtcg.extends-target-token',
          message: `$extends target ${parsed.path.join('.')} is a token, not a group`,
          sourceFileId,
          pointer: pointerOf([...path, '$extends']),
        });
        return undefined;
      }
      visiting.add(key);
      const inherited = resolveGroup(
        target as Record<string, unknown>,
        parsed.path,
        visiting,
        visited,
      );
      visiting.delete(key);
      if (!inherited) return undefined;
      const merged = deepMergeGroups(inherited, raw, path, sourceFileId, diagnostics, pointerOf);
      // The merged group inherits the target's $type when it does not
      // declare one locally (6.7.3: resolved group's $type after extension
      // resolution).
      if (merged.$type === undefined && inherited.$type !== undefined) {
        merged.$type = inherited.$type;
      }
      visited.set(key, merged);
      return merged;
    }
    visited.set(key, raw);
    return raw;
  };

  const walk = (
    raw: Record<string, unknown>,
    path: string[],
    inheritedType: string | undefined,
    inheritedDeprecated: boolean | string | undefined,
  ): Array<DtcgTokenNode | DtcgGroupNode> => {
    const children: Array<DtcgTokenNode | DtcgGroupNode> = [];
    for (const [name, rawValue] of Object.entries(raw)) {
      if (name.startsWith('$')) {
        // $root is the reserved root-token name INSIDE groups (6.2); it is
        // treated as a token there. Other $ properties are metadata handled
        // at their owning level; unknown ones are warned.
        if (name === '$root' && path.length > 0) {
          // fall through to token handling below
        } else {
          if (name === '$root' || !KNOWN_GROUP_PROPERTIES.has(name)) {
            diagnostics.push({
              severity: 'warning',
              code: 'dtcg.unknown-property',
              message: `Unknown property "${name}"`,
              sourceFileId,
              pointer: pointerOf([...path, name]),
            });
          }
          continue;
        }
      }
      if (rawValue === null || typeof rawValue !== 'object' || Array.isArray(rawValue)) {
        diagnostics.push({
          severity: 'error',
          code: 'dtcg.invalid-node',
          message: `"${name}" must be an object (token or group)`,
          sourceFileId,
          pointer: pointerOf([...path, name]),
        });
        continue;
      }
      const node = rawValue as Record<string, unknown>;
      const childPath = [...path, name];
      const childPointer = pointerOf(childPath);
      const loc = locationFor(childPointer);

      if ('$value' in node || '$ref' in node) {
        if (Object.keys(node).some((k) => !k.startsWith('$'))) {
          diagnostics.push({
            severity: 'error',
            code: 'dtcg.token-with-children',
            message: `Token "${name}" cannot also contain child tokens or groups`,
            sourceFileId,
            pointer: childPointer,
          });
          continue;
        }
        tokenCount += 1;
        if (tokenCount > maxTokens) {
          diagnostics.push({
            severity: 'error',
            code: 'dtcg.max-tokens',
            message: `Token count exceeds the limit (${maxTokens})`,
            sourceFileId,
            pointer: childPointer,
          });
          break;
        }
        const token = buildToken(
          node,
          childPath,
          name,
          inheritedType,
          inheritedDeprecated,
          sourceFileId,
          strict,
          compatibility,
          diagnostics,
          pointerOf,
          loc,
        );
        if (token) children.push(token);
      } else {
        const groupType = typeof node.$type === 'string' ? node.$type : undefined;
        const groupDeprecated = readDeprecated(node, childPointer, sourceFileId, diagnostics);
        const resolved = resolveGroup(node, childPath, new Set(), new Map());
        if (!resolved) continue;
        const resolvedGroupType = typeof resolved.$type === 'string' ? resolved.$type : undefined;
        const groupChildren = walk(
          resolved,
          childPath,
          groupType ?? resolvedGroupType ?? inheritedType,
          groupDeprecated ?? inheritedDeprecated,
        );
        const group: DtcgGroupNode = {
          kind: 'group',
          path: childPath,
          name,
          type: groupType ?? inheritedType,
          explicitType: groupType,
          description: typeof node.$description === 'string' ? node.$description : undefined,
          deprecated: groupDeprecated ?? inheritedDeprecated,
          extensions: readExtensions(node, sourceFileId, diagnostics, childPointer),
          extendsRef: typeof node.$extends === 'string' ? node.$extends : undefined,
          children: groupChildren,
          pointer: childPointer,
          line: loc.line,
          column: loc.column,
        };
        children.push(group);
      }
    }
    return children;
  };

  const rootChildren = walk(root, [], undefined, undefined) as Array<DtcgTokenNode | DtcgGroupNode>;
  const groups = rootChildren.filter((node): node is DtcgGroupNode => node.kind === 'group');
  for (const node of rootChildren) {
    collectTokens(node, tokens, sourceFileId, diagnostics);
  }

  // Final pass: ensure every token has a determinable type (6.7.3 rule 4).
  for (const token of Object.values(tokens)) {
    if (!token.type && !token.isReference) {
      diagnostics.push({
        severity: 'error',
        code: 'dtcg.undeterminable-type',
        message: `Token ${token.path.join('.')} has no determinable $type`,
        sourceFileId,
        pointer: token.pointer,
        line: token.line,
        column: token.column,
        repair: 'Add an explicit $type or a $type on a parent group',
      });
    }
  }

  return {
    tokens,
    groups,
    diagnostics,
    specificationVersion: specVersion,
    sourceFileId,
    sourceRoot: root,
  };
}

function collectTokens(
  node: DtcgTokenNode | DtcgGroupNode,
  tokens: Record<string, DtcgTokenNode>,
  sourceFileId: string,
  diagnostics: TokenDiagnostic[],
): void {
  if (node.kind === 'token') {
    const key = pathKey(node.path);
    if (tokens[key]) {
      diagnostics.push({
        severity: 'error',
        code: 'dtcg.duplicate-path',
        message: `Token path ${key} is defined more than once`,
        sourceFileId,
        pointer: node.pointer,
      });
      return;
    }
    tokens[key] = node;
    return;
  }
  for (const child of node.children) {
    collectTokens(child, tokens, sourceFileId, diagnostics);
  }
}

function buildToken(
  node: Record<string, unknown>,
  path: string[],
  name: string,
  inheritedType: string | undefined,
  inheritedDeprecated: boolean | string | undefined,
  sourceFileId: string,
  strict: boolean,
  compatibility: boolean,
  diagnostics: TokenDiagnostic[],
  pointerOf: (path: string[]) => string,
  loc: { line?: number; column?: number },
): DtcgTokenNode | undefined {
  const pointer = pointerOf([name]);
  const validName = validateName(
    name,
    sourceFileId,
    diagnostics,
    pointer,
    strict,
    compatibility,
    name === RESERVED_TOKEN_NAME,
    loc.line,
    loc.column,
  );
  if (!validName && !compatibility) return undefined;

  for (const prop of Object.keys(node)) {
    if (!KNOWN_TOKEN_PROPERTIES.has(prop)) {
      diagnostics.push({
        severity: 'warning',
        code: 'dtcg.unknown-property',
        message: `Unknown property "${prop}" on token ${path.join('.')}`,
        sourceFileId,
        pointer: pointerOf([...path, prop]),
      });
    }
  }

  const explicitType = typeof node.$type === 'string' ? node.$type : undefined;
  const type = explicitType ?? inheritedType;
  if (type !== undefined && !isStableTokenType(type)) {
    if (strict) {
      diagnostics.push({
        severity: 'error',
        code: 'dtcg.unknown-type',
        message: `Unknown token type "${type}" on ${path.join('.')}`,
        sourceFileId,
        pointer: pointerOf([...path, '$type']),
      });
    } else {
      diagnostics.push({
        severity: 'warning',
        code: 'dtcg.unknown-type',
        message: `Unknown token type "${type}" on ${path.join('.')} — preserved, not editable`,
        sourceFileId,
        pointer: pointerOf([...path, '$type']),
      });
    }
  }

  const references: TokenReference[] = [];
  let value: unknown;
  let isReference = false;

  const rawValue = node.$value;
  if ('$ref' in node && rawValue === undefined) {
    if (typeof node.$ref !== 'string') {
      diagnostics.push({
        severity: 'error',
        code: 'dtcg.ref-type',
        message: `$ref on ${path.join('.')} must be a JSON Pointer string`,
        sourceFileId,
        pointer: pointerOf([...path, '$ref']),
      });
      return undefined;
    }
    isReference = true;
    references.push({
      kind: 'json-pointer',
      raw: node.$ref as string,
      pointer: node.$ref as string,
    });
  } else {
    if (typeof rawValue === 'string') {
      const curly = extractCurlyBraceReferences(rawValue, path, sourceFileId, diagnostics, pointer);
      references.push(...curly.references);
      const trimmed = rawValue.trim();
      if (/^\{[^{}]+\}$/.test(trimmed)) {
        isReference = true;
      }
    }
    extractNestedRefs(rawValue, path, sourceFileId, diagnostics, pointer, references, 0);
    value = rawValue;
  }

  const deprecated =
    readDeprecated(node, pointer, sourceFileId, diagnostics) ?? inheritedDeprecated;

  const token: DtcgTokenNode = {
    kind: 'token',
    path,
    name,
    type: type as DtcgTokenNode['type'],
    explicitType,
    value,
    references,
    isReference,
    pointer,
    valuePointer: `${pointer}/$value`,
    description: typeof node.$description === 'string' ? node.$description : undefined,
    deprecated,
    extensions: readExtensions(node, sourceFileId, diagnostics, pointer),
    line: loc.line,
    column: loc.column,
  };
  return token;
}

function validateName(
  name: string,
  sourceFileId: string,
  diagnostics: TokenDiagnostic[],
  pointer: string,
  strict: boolean,
  compatibility: boolean,
  allowRoot: boolean,
  line?: number,
  column?: number,
): boolean {
  if (name.length === 0) {
    diagnostics.push({
      severity: 'error',
      code: 'dtcg.empty-name',
      message: 'Empty token/group name',
      sourceFileId,
      pointer,
      line,
      column,
    });
    return false;
  }
  if (name.startsWith('$') && !allowRoot) {
    diagnostics.push({
      severity: strict || !compatibility ? 'error' : 'warning',
      code: 'dtcg.reserved-prefix',
      message: `"${name}" must not begin with $ (reserved property prefix)`,
      sourceFileId,
      pointer,
      line,
      column,
    });
    return false;
  }
  if (NAME_FORBIDDEN.test(name)) {
    diagnostics.push({
      severity: strict || !compatibility ? 'error' : 'warning',
      code: 'dtcg.forbidden-characters',
      message: `"${name}" must not contain { } or .`,
      sourceFileId,
      pointer,
      line,
      column,
    });
    return false;
  }
  return true;
}

function readDeprecated(
  node: Record<string, unknown>,
  pointer: string,
  sourceFileId: string,
  diagnostics: TokenDiagnostic[],
): boolean | string | undefined {
  const raw = node.$deprecated;
  if (raw === undefined) return undefined;
  if (typeof raw === 'boolean' || typeof raw === 'string') return raw;
  diagnostics.push({
    severity: 'error',
    code: 'dtcg.deprecated-type',
    message: '$deprecated must be true, false, or a string',
    sourceFileId,
    pointer,
  });
  return undefined;
}

function readExtensions(
  node: Record<string, unknown>,
  sourceFileId: string,
  diagnostics: TokenDiagnostic[],
  pointer: string,
): Record<string, unknown> {
  const raw = node.$extensions;
  if (raw === undefined) return {};
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    diagnostics.push({
      severity: 'error',
      code: 'dtcg.extensions-type',
      message: '$extensions must be an object',
      sourceFileId,
      pointer: `${pointer}/$extensions`,
    });
    return {};
  }
  return raw as Record<string, unknown>;
}

export interface CurlyParseResult {
  raw: string;
  path: string[];
}

export function parseCurlyBrace(raw: string): CurlyParseResult | undefined {
  const match = /^\{([^{}]+)\}$/.exec(raw.trim());
  if (!match) return undefined;
  return { raw, path: match[1]!.split('.') };
}

function extractCurlyBraceReferences(
  value: string,
  path: string[],
  sourceFileId: string,
  diagnostics: TokenDiagnostic[],
  pointer: string,
): { references: CurlyBraceReference[] } {
  const references: CurlyBraceReference[] = [];
  const matches = value.matchAll(/\{([^{}]+)\}/g);
  for (const match of matches) {
    references.push({ kind: 'curly-brace', raw: match[0], path: match[1]!.split('.') });
  }
  const trimmed = value.trim();
  const pure = /^\{[^{}]+\}$/.test(trimmed);
  if (!pure && references.length > 0) {
    diagnostics.push({
      severity: 'warning',
      code: 'dtcg.partial-reference',
      message: `Value on ${path.join('.')} mixes a reference with other content; this is not a standards-compliant alias`,
      sourceFileId,
      pointer,
    });
  }
  return { references };
}

function extractNestedRefs(
  value: unknown,
  path: string[],
  sourceFileId: string,
  diagnostics: TokenDiagnostic[],
  pointer: string,
  references: TokenReference[],
  depth: number,
): void {
  if (depth > 32) {
    diagnostics.push({
      severity: 'error',
      code: 'dtcg.ref-depth',
      message: `Reference nesting too deep on ${path.join('.')}`,
      sourceFileId,
      pointer,
    });
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value)
      extractNestedRefs(item, path, sourceFileId, diagnostics, pointer, references, depth + 1);
    return;
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.$ref === 'string' && Object.keys(record).length === 1) {
      references.push({ kind: 'json-pointer', raw: record.$ref, pointer: record.$ref });
      return;
    }
    for (const child of Object.values(record)) {
      extractNestedRefs(child, path, sourceFileId, diagnostics, pointer, references, depth + 1);
    }
  }
}

function deepMergeGroups(
  inherited: Record<string, unknown>,
  local: Record<string, unknown>,
  path: string[],
  sourceFileId: string,
  diagnostics: TokenDiagnostic[],
  pointerOf: (path: string[]) => string,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(inherited)) {
    result[key] = value;
  }
  for (const [key, value] of Object.entries(local)) {
    if (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      !key.startsWith('$') &&
      result[key] !== null &&
      typeof result[key] === 'object' &&
      !Array.isArray(result[key]) &&
      !('$value' in (value as Record<string, unknown>))
    ) {
      result[key] = deepMergeGroups(
        result[key] as Record<string, unknown>,
        value as Record<string, unknown>,
        [...path, key],
        sourceFileId,
        diagnostics,
        pointerOf,
      );
    } else {
      result[key] = value;
    }
  }
  return result;
}

function lookupRaw(root: Record<string, unknown>, path: string[]): unknown {
  let current: unknown = root;
  for (const segment of path) {
    if (current === null || typeof current !== 'object' || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function escapeSegment(segment: string): string {
  return segment.replace(/~/g, '~0').replace(/\//g, '~1');
}

/** Canonical path key ('.'-joined; '.' is forbidden in names). */
export function pathKey(path: readonly string[]): string {
  return path.join('.');
}

/** Convert a path key back to a JSON pointer (best-effort, names cannot
 * contain '.', '~', or '/', so the round trip is exact). */
function pathKeyToPointer(key: string): string {
  return key.length === 0 ? '' : `/${key.split('.').join('/')}`;
}

/** Helper export — JSON-pointer key for a path ('.'-joined). */
export function tokenKey(path: readonly string[]): string {
  return pathKey(path);
}

export type { JsonPointerReference, TokenReference };
