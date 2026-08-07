import type { Document } from '@varve/scene';

export interface ImportResult {
  document: Document;
  nodeIds: string[];
  warnings: string[];
  /**
   * Honest capability report (M14): what this import actually preserved.
   * UI must surface this rather than implying full fidelity.
   */
  capabilities?: ImportCapabilities;
}

/**
 * Per-format capability record (M14): which source constructs were
 * preserved, approximated, or dropped. Filled by each parser; consumers
 * (import dialog, preflight) surface it as a structured summary instead of
 * fabricating editability.
 */
export interface ImportCapabilities {
  /** Source format this record describes. */
  format: string;
  /** True when the source's page geometry was mapped to Varve pages. */
  multipage: boolean;
  /** True when page dimensions/boxes were preserved. */
  pageDimensions: boolean;
  /** True when vector paths were preserved as editable vectors. */
  vectors: boolean;
  /** True when text was preserved as editable text (not outlined). */
  text: boolean;
  /** True when embedded images were preserved. */
  images: boolean;
  /** True when master-page constructs were mapped to Varve masters. */
  masters: boolean;
  /** True when linked text threads were preserved. */
  textThreads: boolean;
  /** Free-form notes on approximations or dropped constructs. */
  notes: string[];
}

export interface ImportOptions {
  embedImages: boolean;
  scale: number;
  center: boolean;
  keepPosition: boolean;
}

export interface ImportParser {
  format: string;
  parse(data: string | Uint8Array, options?: Partial<ImportOptions>): ImportResult;
  supportedExtensions(): string[];
  canParse(data: string | Uint8Array): boolean;
}

export interface BatchFileResult {
  name: string;
  success: boolean;
  warnings: string[];
  nodeIds: string[];
}
