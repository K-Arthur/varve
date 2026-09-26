/**
 * Deterministic value resolution for tokens in a DTCG Format document.
 *
 * Resolves whole-token curly aliases, token-level `$ref` aliases, and
 * references embedded in composite values. JSON Pointer traversal is shared
 * with the parser/reference graph so escaping and array-index behavior stay
 * consistent across the package.
 */
import { JsonPointerError, parseJsonPointer, resolveJsonPointer } from './jsonPointer';
import { parseCurlyBrace, pathKey } from './parse';
import type { DtcgDocument, DtcgTokenNode } from './types';

/** Maximum number of reference hops, aligned with the reference graph limit. */
export const FORMAT_TOKEN_RESOLUTION_MAX_DEPTH = 100;

/**
 * Input forms accepted by {@link resolveFormatTokenValue}.
 * String paths use the canonical dot-joined path key from `DtcgDocument.tokens`.
 */
export type FormatTokenIdentifier = DtcgTokenNode | string | readonly string[];

export interface ResolveFormatTokenValueOptions {
  /** Maximum alias / pointer hops. Defaults to 100. */
  maxDepth?: number;
}

export type FormatTokenResolutionErrorCode =
  | 'token-not-found'
  | 'pointer-source-unavailable'
  | 'pointer-invalid'
  | 'pointer-target-not-found'
  | 'cycle'
  | 'max-depth';

export interface FormatTokenResolutionErrorDetails {
  tokenPath?: readonly string[];
  reference?: string;
  pointerErrorCode?: JsonPointerError['code'];
  chain?: readonly string[];
}

/** Stable, structured failure raised when a token value cannot be resolved. */
export class FormatTokenResolutionError extends Error {
  readonly tokenPath?: readonly string[];
  readonly reference?: string;
  readonly pointerErrorCode?: JsonPointerError['code'];
  readonly chain?: readonly string[];

  constructor(
    readonly code: FormatTokenResolutionErrorCode,
    message: string,
    details: FormatTokenResolutionErrorDetails = {},
  ) {
    super(message);
    this.name = 'FormatTokenResolutionError';
    this.tokenPath = details.tokenPath ? [...details.tokenPath] : undefined;
    this.reference = details.reference;
    this.pointerErrorCode = details.pointerErrorCode;
    this.chain = details.chain ? [...details.chain] : undefined;
  }
}

const MAX_VALUE_NESTING_DEPTH = 512;
const TOKEN_REFERENCE_PROPERTIES = new Set([
  '$ref',
  '$type',
  '$description',
  '$deprecated',
  '$extensions',
]);

/**
 * Resolve a token to its value, following complete curly aliases and
 * same-document JSON Pointers. Composite objects and arrays are copied while
 * nested references are resolved; the source document is never mutated.
 *
 * Throws {@link FormatTokenResolutionError} with a stable `code` for missing
 * tokens/targets, malformed pointers, cycles, or an exceeded depth limit.
 */
export function resolveFormatTokenValue(
  document: DtcgDocument,
  tokenOrPath: FormatTokenIdentifier,
  options: ResolveFormatTokenValueOptions = {},
): unknown {
  const maxDepth = options.maxDepth ?? FORMAT_TOKEN_RESOLUTION_MAX_DEPTH;
  if (!Number.isInteger(maxDepth) || maxDepth < 0) {
    throw new RangeError('maxDepth must be a non-negative integer');
  }

  const token = findToken(document, tokenOrPath);
  if (!token) {
    const path = identifierPath(tokenOrPath);
    const key = pathKey(path);
    throw new FormatTokenResolutionError('token-not-found', `Token "${key}" was not found`, {
      tokenPath: path,
    });
  }

  const active = new Map<string, number>();
  const chain: string[] = [];

  const enter = (
    identity: string,
    tokenPath: readonly string[],
    reference?: string,
  ): (() => void) => {
    const activeAt = active.get(identity);
    if (activeAt !== undefined) {
      const cycle = [...chain.slice(activeAt), identity];
      throw new FormatTokenResolutionError(
        'cycle',
        `Circular token reference: ${cycle.join(' -> ')}`,
        { tokenPath, reference, chain: cycle },
      );
    }
    active.set(identity, chain.length);
    chain.push(identity);
    return () => {
      chain.pop();
      active.delete(identity);
    };
  };

  const checkReferenceDepth = (
    depth: number,
    tokenPath: readonly string[],
    reference?: string,
  ): void => {
    if (depth > maxDepth) {
      throw new FormatTokenResolutionError(
        'max-depth',
        `Token reference depth exceeds ${maxDepth} while resolving ${pathKey(tokenPath)}`,
        { tokenPath, reference, chain },
      );
    }
  };

  const resolvePointer = (
    pointer: string,
    ownerPath: readonly string[],
    depth: number,
    nestingDepth: number,
  ): unknown => {
    checkReferenceDepth(depth, ownerPath, pointer);
    const leave = enter(`pointer:${pointer}`, ownerPath, pointer);
    try {
      const sourceRoot = document.resolvedSourceRoot ?? document.sourceRoot;
      if (sourceRoot === undefined) {
        throw new FormatTokenResolutionError(
          'pointer-source-unavailable',
          `Cannot resolve JSON Pointer "${pointer}" for ${pathKey(ownerPath)}: parsed source is unavailable`,
          { tokenPath: ownerPath, reference: pointer },
        );
      }

      let target: unknown;
      try {
        target = resolveJsonPointer(sourceRoot, pointer);
      } catch (error) {
        if (error instanceof JsonPointerError) {
          const missing =
            error.code === 'property-not-found' || error.code === 'index-out-of-range';
          throw new FormatTokenResolutionError(
            missing ? 'pointer-target-not-found' : 'pointer-invalid',
            `JSON Pointer "${pointer}" referenced from ${pathKey(ownerPath)} ${missing ? 'has no target' : 'is invalid'}: ${error.message}`,
            {
              tokenPath: ownerPath,
              reference: pointer,
              pointerErrorCode: error.code,
            },
          );
        }
        throw new FormatTokenResolutionError(
          'pointer-invalid',
          `JSON Pointer "${pointer}" referenced from ${pathKey(ownerPath)} is invalid: ${error instanceof Error ? error.message : String(error)}`,
          { tokenPath: ownerPath, reference: pointer },
        );
      }

      const targetToken = tokenForPointer(document, pointer);
      if (targetToken) return resolveToken(targetToken, depth, nestingDepth + 1);
      return resolveValue(target, ownerPath, depth, nestingDepth + 1);
    } finally {
      leave();
    }
  };

  const resolveCurly = (
    raw: string,
    ownerPath: readonly string[],
    depth: number,
    nestingDepth: number,
  ): unknown => {
    const reference = parseCurlyBrace(raw);
    if (!reference) return raw;
    checkReferenceDepth(depth + 1, ownerPath, raw);
    const key = pathKey(reference.path);
    if (!Object.hasOwn(document.tokens, key)) {
      throw new FormatTokenResolutionError(
        'token-not-found',
        `Curly reference "${raw}" on ${pathKey(ownerPath)} has no target token`,
        { tokenPath: ownerPath, reference: raw },
      );
    }
    return resolveToken(document.tokens[key]!, depth + 1, nestingDepth + 1);
  };

  const resolveValue = (
    value: unknown,
    ownerPath: readonly string[],
    referenceDepth: number,
    nestingDepth: number,
  ): unknown => {
    if (nestingDepth > MAX_VALUE_NESTING_DEPTH) {
      throw new FormatTokenResolutionError(
        'max-depth',
        `Composite value nesting exceeds ${MAX_VALUE_NESTING_DEPTH} while resolving ${pathKey(ownerPath)}`,
        { tokenPath: ownerPath },
      );
    }
    if (typeof value === 'string') {
      return parseCurlyBrace(value)
        ? resolveCurly(value, ownerPath, referenceDepth, nestingDepth)
        : value;
    }
    if (Array.isArray(value)) {
      return value.map((item) => resolveValue(item, ownerPath, referenceDepth, nestingDepth + 1));
    }
    if (!isRecord(value)) return value;

    if (isNestedPointerReference(value)) {
      return resolvePointer(value.$ref, ownerPath, referenceDepth + 1, nestingDepth + 1);
    }
    if (isTokenPointerReference(value)) {
      return resolvePointer(value.$ref, ownerPath, referenceDepth + 1, nestingDepth + 1);
    }

    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      Object.defineProperty(result, key, {
        value: resolveValue(child, ownerPath, referenceDepth, nestingDepth + 1),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    return result;
  };

  const resolveToken = (
    current: DtcgTokenNode,
    referenceDepth: number,
    nestingDepth: number,
  ): unknown => {
    const currentPath = current.path;
    const key = pathKey(currentPath);
    checkReferenceDepth(referenceDepth, currentPath);
    const leave = enter(`token:${key}`, currentPath);
    try {
      // A token-level `$ref` has no `$value`; the parser records it as the
      // token's sole JSON Pointer reference. `$value` aliases are handled by
      // resolveValue below, including their complete-curly-only semantics.
      if (current.value === undefined && current.isReference) {
        const reference = current.references[0];
        if (reference?.kind !== 'json-pointer') {
          throw new FormatTokenResolutionError(
            'pointer-invalid',
            `Token ${key} has an invalid token-level reference`,
            { tokenPath: currentPath, reference: reference?.raw },
          );
        }
        return resolvePointer(reference.pointer, currentPath, referenceDepth + 1, nestingDepth);
      }
      return resolveValue(current.value, currentPath, referenceDepth, nestingDepth + 1);
    } finally {
      leave();
    }
  };

  return resolveToken(token, 0, 0);
}

/**
 * Find a token directly from its canonical token/value pointer. The token
 * index is already keyed by path, so rebuilding a pointer index for every
 * resolution would turn resolving a document into O(tokens²) work.
 */
function tokenForPointer(document: DtcgDocument, pointer: string): DtcgTokenNode | undefined {
  const segments = parseJsonPointer(pointer).map(({ value }) => value);
  if (segments.at(-1) === '$value') segments.pop();
  const token = document.tokens[pathKey(segments)];
  return token && (`#${token.pointer}` === pointer || `#${token.valuePointer}` === pointer)
    ? token
    : undefined;
}

function findToken(
  document: DtcgDocument,
  identifier: FormatTokenIdentifier,
): DtcgTokenNode | undefined {
  const path = identifierPath(identifier);
  const key = pathKey(path);
  return Object.hasOwn(document.tokens, key) ? document.tokens[key] : undefined;
}

function identifierPath(identifier: FormatTokenIdentifier): string[] {
  if (typeof identifier === 'string') return identifier.length === 0 ? [] : identifier.split('.');
  if ('path' in identifier) return [...identifier.path];
  return [...identifier];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNestedPointerReference(value: Record<string, unknown>): value is { $ref: string } {
  return typeof value.$ref === 'string' && Object.keys(value).length === 1;
}

function isTokenPointerReference(value: Record<string, unknown>): value is { $ref: string } {
  return (
    typeof value.$ref === 'string' &&
    !Object.hasOwn(value, '$value') &&
    Object.keys(value).every((key) => TOKEN_REFERENCE_PROPERTIES.has(key))
  );
}
