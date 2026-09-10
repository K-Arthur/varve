/**
 * Untitled-name generation and filename sanitization for the new-document
 * flow. Pure helpers shared by the home screen and the editor so both
 * produce identical names ("Untitled 1", "Untitled 2", ...) without
 * collisions against documents that already exist in the active project.
 */

/** Strip ASCII control characters (C0 block), which are invalid in
 *  filenames on every filesystem. Regex-based stripping trips Biome's
 *  control-character-in-regex rule, so scan char codes instead. */
function stripControlChars(name: string): string {
  if (![...name].some((c) => c.charCodeAt(0) < 32)) return name;
  return [...name].filter((c) => c.charCodeAt(0) >= 32).join('');
}
/** Characters that are invalid in filenames on Windows and problematic on
 *  POSIX filesystems. Kept conservative: Unicode letters/digits/space and
 *  common punctuation survive; only characters that a target filesystem
 *  rejects (or that would be ambiguous in a shell) are stripped. */
const INVALID_FILENAME_CHARS = /[<>:"/\\|?*]/g;
/** Windows reserved device names (case-insensitive, with optional
 *  extension). */
const WINDOWS_RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
/** Trailing dots/spaces are stripped on Windows filesystems. */
const TRAILING_DOT_OR_SPACE = /[. ]+$/;

export const DEFAULT_UNTITLED_BASE = 'Untitled';

/**
 * Generate the next untitled name that does not collide with any name in
 * `usedNames` (compared case-insensitively, since the target filesystem may
 * be case-insensitive). Examples:
 *
 *   nextUntitledName([])                      -> 'Untitled 1'
 *   nextUntitledName(['Untitled 1'])          -> 'Untitled 2'
 *   nextUntitledName(['Untitled 1','Untitled 3']) -> 'Untitled 2'
 *   nextUntitledName(['Untitled 1'], 'Draft') -> 'Draft 1'
 *
 * Names passed in `usedNames` may include or omit the file extension; both
 * are normalized before comparison.
 */
export function nextUntitledName(
  usedNames: readonly string[],
  base: string = DEFAULT_UNTITLED_BASE,
): string {
  const used = new Set(usedNames.map((n) => normalizeForComparison(n)));
  let i = 1;
  for (;;) {
    const candidate = `${base} ${i}`;
    if (!used.has(normalizeForComparison(candidate))) return candidate;
    i += 1;
  }
}

function normalizeForComparison(name: string): string {
  const trimmed = stripExtension(name.trim());
  return trimmed.toLowerCase();
}

/** Strip a trailing `.varve` / `.strata` / `.json`-style extension for
 *  collision checks without touching the rest of the name. */
export function stripExtension(name: string): string {
  return name.replace(/\.(varve|strata|json|fig|svg|png|jpg|jpeg|webp|gif|pdf|ai|eps|psd)$/i, '');
}

/**
 * Sanitize a document name into a safe filename stem. Only filesystem-hostile
 * characters are removed; Unicode, spaces, and most punctuation are
 * preserved. Returns the sanitized stem without any file extension — the
 * extension is appended by the persistence layer.
 */
export function sanitizeFileName(name: string, fallback = 'Untitled'): string {
  let cleaned = stripControlChars(name)
    .trim()
    .replace(INVALID_FILENAME_CHARS, '')
    .replace(TRAILING_DOT_OR_SPACE, '');
  if (!cleaned) cleaned = fallback;
  if (WINDOWS_RESERVED_NAMES.test(cleaned)) cleaned = `_${cleaned}`;
  return cleaned;
}

/** Whether a document name survives sanitization to a non-empty stem
 *  without needing the fallback (i.e. the user actually typed something
 *  filesystem-safe). */
export function isValidFileName(name: string): boolean {
  const cleaned = stripControlChars(name)
    .trim()
    .replace(INVALID_FILENAME_CHARS, '')
    .replace(TRAILING_DOT_OR_SPACE, '');
  return cleaned.length > 0;
}
