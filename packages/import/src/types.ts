import type { Document } from '@strata/scene';

export interface ImportResult {
  document: Document;
  nodeIds: string[];
  warnings: string[];
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
