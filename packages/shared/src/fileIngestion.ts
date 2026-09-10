/**
 * Small, browser-safe rules shared by file pickers and drop surfaces.
 *
 * These checks improve feedback before a feature parser runs. They are not a
 * security boundary: format parsers and content sniffers remain authoritative.
 */

export interface IngestFileLike {
  name: string;
  type?: string;
  size: number;
}

export type FileRejectionCode = 'empty-file' | 'unsupported-type' | 'too-large' | 'too-many-files';

export interface FileRejection<T extends IngestFileLike = IngestFileLike> {
  file: T;
  code: FileRejectionCode;
  reason: string;
}

export interface FileSelectionResult<T extends IngestFileLike> {
  accepted: T[];
  rejected: FileRejection<T>[];
}

export interface FileSelectionOptions {
  /** HTML accept syntax: extensions, exact MIME types, or MIME wildcards. */
  accept?: string | readonly string[];
  /** Whether a picker may return more than one file. */
  multiple?: boolean;
  /** Maximum accepted files in this selection. Extra files are rejected. */
  maxFiles?: number;
  /** Maximum encoded bytes per file. */
  maxSize?: number;
  /** Minimum encoded bytes per file. Defaults to one byte. */
  minSize?: number;
}

function acceptTokens(accept: FileSelectionOptions['accept']): string[] {
  if (!accept) return [];
  const values = typeof accept === 'string' ? accept.split(',') : Array.from(accept);
  return values.map((value) => value.trim().toLowerCase()).filter(Boolean);
}

export function fileExtension(name: string): string {
  const basename = name.replace(/\\/g, '/').split('/').pop() ?? name;
  const dot = basename.lastIndexOf('.');
  return dot > 0 ? basename.slice(dot + 1).toLowerCase() : '';
}

/** Match the browser's accept vocabulary without treating it as validation. */
export function fileMatchesAccept(
  file: IngestFileLike,
  accept?: FileSelectionOptions['accept'],
): boolean {
  const tokens = acceptTokens(accept);
  if (tokens.length === 0) return true;

  const extension = fileExtension(file.name);
  const mime = file.type?.trim().toLowerCase() ?? '';
  return tokens.some((token) => {
    if (token.startsWith('.')) return extension === token.slice(1);
    if (token.endsWith('/*')) return mime.startsWith(token.slice(0, -1));
    return mime === token;
  });
}

function formatLimit(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

/**
 * Apply cheap, deterministic selection checks while preserving input order.
 * Same-named files are deliberately retained; a filename is not an identity.
 */
export function validateFileSelection<T extends IngestFileLike>(
  files: readonly T[],
  options: FileSelectionOptions = {},
): FileSelectionResult<T> {
  const accepted: T[] = [];
  const rejected: FileRejection<T>[] = [];
  const minSize = Math.max(0, options.minSize ?? 1);
  const requestedMaxFiles =
    options.maxFiles !== undefined ? Math.max(0, Math.floor(options.maxFiles)) : null;
  const maxFiles =
    requestedMaxFiles !== null ? requestedMaxFiles : options.multiple === false ? 1 : null;

  for (const file of files) {
    if (maxFiles !== null && accepted.length >= maxFiles) {
      rejected.push({
        file,
        code: 'too-many-files',
        reason: `Only ${maxFiles} file${maxFiles === 1 ? '' : 's'} can be selected at a time.`,
      });
      continue;
    }
    if (file.size < minSize) {
      rejected.push({
        file,
        code: 'empty-file',
        reason: 'The file is empty and cannot be imported.',
      });
      continue;
    }
    if (options.maxSize !== undefined && file.size > options.maxSize) {
      rejected.push({
        file,
        code: 'too-large',
        reason: `The file is larger than ${formatLimit(options.maxSize)}.`,
      });
      continue;
    }
    if (!fileMatchesAccept(file, options.accept)) {
      rejected.push({
        file,
        code: 'unsupported-type',
        reason: 'This file type is not supported here.',
      });
      continue;
    }
    accepted.push(file);
  }

  return { accepted, rejected };
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}
