/**
 * DTCG 2025.10 AST and diagnostics types.
 */
import type { DtcgSpecificationVersion } from './spec';

export type TokenTypeKind =
  | 'color'
  | 'dimension'
  | 'number'
  | 'duration'
  | 'cubicBezier'
  | 'fontFamily'
  | 'fontWeight'
  | 'strokeStyle'
  | 'border'
  | 'transition'
  | 'shadow'
  | 'gradient'
  | 'typography';

export interface TokenDiagnosticLocation {
  sourceFileId: string;
  pointer?: string;
  line?: number;
  column?: number;
}

export interface TokenDiagnostic {
  severity: 'info' | 'warning' | 'error';
  code: string;
  message: string;
  sourceFileId: string;
  pointer?: string;
  line?: number;
  column?: number;
  related?: TokenDiagnosticLocation[];
  /** Safe repair suggestion, when one exists. Never applied silently. */
  repair?: string;
}

/** A curly-brace token reference like {color.brand.primary}. */
export interface CurlyBraceReference {
  kind: 'curly-brace';
  raw: string;
  path: string[];
}

/** A JSON Pointer $ref like #/color/brand/primary/$value. */
export interface JsonPointerReference {
  kind: 'json-pointer';
  raw: string;
  pointer: string;
}

export type TokenReference = CurlyBraceReference | JsonPointerReference;

export interface DtcgTokenNode {
  kind: 'token';
  /** Full path including group names and $root where present. */
  path: string[];
  /** Token name (last path segment). */
  name: string;
  /** $type after inheritance resolution; undefined when undeterminable. */
  type?: TokenTypeKind | string;
  /** Explicit $type on this token (before inheritance). */
  explicitType?: string;
  /** The $value payload (or the resolved reference for $ref-only tokens). */
  value: unknown;
  /** Raw reference forms found in the value. */
  references: TokenReference[];
  /** True when the value is a pure reference (alias). */
  isReference: boolean;
  /** JSON Pointer to this token in the document ($value included). */
  pointer: string;
  /** Pointer to the value payload ($value object / string / number). */
  valuePointer: string;
  description?: string;
  deprecated?: boolean | string;
  /** Unknown $extensions preserved verbatim. */
  extensions: Record<string, unknown>;
  line?: number;
  column?: number;
  /** Set when the token's $extends source could not be merged. */
  unresolvedExtends?: boolean;
  /** Path of the group this token was inherited from via $extends. */
  inheritedFrom?: string[];
}

export interface DtcgGroupNode {
  kind: 'group';
  path: string[];
  name: string;
  /** Closest inherited $type from this group's own $type or parent. */
  type?: string;
  explicitType?: string;
  description?: string;
  deprecated?: boolean | string;
  extensions: Record<string, unknown>;
  extendsRef?: string;
  children: Array<DtcgTokenNode | DtcgGroupNode>;
  pointer: string;
  line?: number;
  column?: number;
}

export interface DtcgDocument {
  /** Flat token index keyed by pathKey ('.'-joined path). */
  tokens: Record<string, DtcgTokenNode>;
  groups: DtcgGroupNode[];
  diagnostics: TokenDiagnostic[];
  specificationVersion: DtcgSpecificationVersion;
  /** File id this document was parsed from. */
  sourceFileId: string;
}

export interface ParseJsonOptions {
  /** File id for diagnostics and provenance. Defaults per call site. */
  sourceFileId?: string;
  /** Bytes limit for the raw text (resource limits). */
  maxBytes?: number;
  /** Max structural depth. */
  maxDepth?: number;
  maxTokens?: number;
  /** Strict stable-spec mode (default true). Compatibility mode relaxes
   * name restrictions and unknown-type handling with warnings. */
  strict?: boolean;
}
