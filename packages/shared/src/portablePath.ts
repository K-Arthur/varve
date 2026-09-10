/**
 * A path stored inside a portable Varve document.
 *
 * This is deliberately not a native filesystem path and not a URL. It uses
 * `/` as its document-format separator on every OS, and is resolved against
 * the document/project location only at the native filesystem boundary.
 */
export type PortableProjectPath = string & { readonly __portableProjectPath: unique symbol };

export type PortablePathErrorCode =
  | 'empty'
  | 'absolute'
  | 'drive-prefix'
  | 'unc-prefix'
  | 'traversal'
  | 'invalid-separator'
  | 'invalid-character';

export interface PortablePathValidation {
  readonly ok: boolean;
  readonly code?: PortablePathErrorCode;
  readonly path?: PortableProjectPath;
}

const DRIVE_PREFIX = /^[A-Za-z]:/;
const SCHEME_PREFIX = /^[A-Za-z][A-Za-z\d+.-]*:/;

/** Validate without applying host-native parsing or URL decoding. */
export function validatePortableProjectPath(raw: string): PortablePathValidation {
  if (raw.length === 0) return { ok: false, code: 'empty' };
  if (raw.startsWith('//')) return { ok: false, code: 'unc-prefix' };
  if (raw.startsWith('/') || raw.startsWith('\\')) {
    return { ok: false, code: raw.startsWith('\\') ? 'invalid-separator' : 'absolute' };
  }
  if (DRIVE_PREFIX.test(raw)) return { ok: false, code: 'drive-prefix' };
  if (raw.includes('\\')) return { ok: false, code: 'invalid-separator' };
  if (raw.includes('\0') || [...raw].some((character) => character.charCodeAt(0) < 0x20)) {
    return { ok: false, code: 'invalid-character' };
  }

  const parts = raw.split('/');
  if (parts.some((part) => part.length === 0)) return { ok: false, code: 'invalid-character' };
  if (parts.some((part) => part === '.' || part === '..')) return { ok: false, code: 'traversal' };
  // A colon is not portable in a generated project reference and would be a
  // drive prefix or stream syntax on Windows. URLs are rejected as a result;
  // percent-encoded text is intentionally not decoded here.
  if (parts.some((part) => SCHEME_PREFIX.test(part) || part.includes(':'))) {
    return { ok: false, code: 'invalid-character' };
  }
  return { ok: true, path: raw as PortableProjectPath };
}

export function portableProjectPath(raw: string): PortableProjectPath {
  const result = validatePortableProjectPath(raw);
  if (!result.ok || !result.path) {
    throw new Error(`Invalid portable project path: ${result.code ?? 'unknown'}`);
  }
  return result.path;
}

export function joinPortableProjectPath(
  directory: PortableProjectPath | '',
  name: string,
): PortableProjectPath {
  return portableProjectPath(directory ? `${directory}/${name}` : name);
}

export function portableProjectBasename(path: PortableProjectPath): string {
  return path.slice(path.lastIndexOf('/') + 1);
}
