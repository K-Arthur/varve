/**
 * Deterministic identifier derivation for code generation.
 *
 * Design-layer names are user input: they may be empty, start with a digit,
 * contain punctuation, whitespace, emoji, or non-Latin scripts, collide
 * case-insensitively, or match a JavaScript reserved word. Every one of those
 * cases previously produced invalid or non-compiling output
 * (`export function Hero-Card()`, `styles.hero-card`, `undefined.module.css`).
 *
 * The rules here are intentionally *lossy but stable*: the same input always
 * produces the same identifier, unrelated code is never renamed, and a
 * collision inside one generated unit appends a numeric suffix rather than
 * silently merging two different nodes.
 *
 * Research basis: CSS Syntax Module Level 3 (identifiers, `--` escapes) and
 * ECMAScript identifier grammar (`IdentifierStart`/`IdentifierPart`).
 */

/** ECMAScript reserved words that cannot be used as a binding identifier. */
const RESERVED_WORDS = new Set([
  'await',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'debugger',
  'default',
  'delete',
  'do',
  'else',
  'enum',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'function',
  'if',
  'implements',
  'import',
  'in',
  'instanceof',
  'interface',
  'let',
  'new',
  'null',
  'package',
  'private',
  'protected',
  'public',
  'return',
  'static',
  'super',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'typeof',
  'var',
  'void',
  'while',
  'with',
  'yield',
]);

const IDENTIFIER_START = /[A-Za-z_$]/;
const IDENTIFIER_PART = /[A-Za-z0-9_$]/;

/** True when `value` can be written as a bare JS identifier (`obj.value`). */
export function isSafeIdentifier(value: string): boolean {
  if (value.length === 0) return false;
  if (!IDENTIFIER_START.test(value[0]!)) return false;
  for (const ch of value) {
    if (!IDENTIFIER_PART.test(ch)) return false;
  }
  return true;
}

/**
 * Split a design-layer name into ASCII alphanumeric words.
 *
 * Boundaries are any non-alphanumeric character and lower→upper transitions
 * (`heroCard` → `hero`, `Card`). Non-ASCII letters and emoji are treated as
 * boundaries: CSS Modules class names and generated file names must survive
 * every downstream toolchain without escaping, so the ASCII subset is the
 * safe target. A name with no ASCII alphanumerics yields `[]`.
 */
function asciiWords(name: string): string[] {
  const normalized = name.normalize('NFC');
  const words: string[] = [];
  let current = '';
  for (const ch of normalized) {
    if (/[A-Za-z0-9]/.test(ch)) {
      if (current.length > 0 && /[a-z0-9]/.test(current[current.length - 1]!) && /[A-Z]/.test(ch)) {
        words.push(current);
        current = ch;
      } else {
        current += ch;
      }
    } else if (current.length > 0) {
      words.push(current);
      current = '';
    }
  }
  if (current.length > 0) words.push(current);
  return words;
}

/**
 * CSS class name for a node: lowercase kebab-case, guaranteed to be a valid
 * CSS identifier (never empty, never starting with a digit or `-`).
 */
export function toCssClassName(name: string, fallback = 'node'): string {
  const words = asciiWords(name);
  let out = words
    .map((word) => word.toLowerCase())
    .join('-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  if (out.length === 0) out = fallback;
  if (!/^[a-z_]/.test(out)) out = `n-${out}`;
  return out;
}

/**
 * React component name for a node: PascalCase, guaranteed to be a valid and
 * non-reserved JS binding identifier.
 */
export function toComponentName(name: string, fallback = 'Component'): string {
  const words = asciiWords(name);
  let out = words.map((word) => word[0]!.toUpperCase() + word.slice(1)).join('');
  if (out.length === 0) out = fallback;
  if (!/^[A-Za-z_$]/.test(out)) out = `C${out}`;
  // Reserved words are lowercase in ECMAScript and `out` is PascalCase, so
  // this can only trigger for a fallback a caller passes in.
  if (RESERVED_WORDS.has(out)) out = `${out}Component`;
  return out;
}

/**
 * Kebab-case file stem for a node (`card-2`). Same rules as the class name so
 * the emitted `<Card-2>.module.css` reference can never drift from the file.
 */
export function toFileStem(name: string, fallback = 'component'): string {
  return toCssClassName(name, fallback);
}

/**
 * Access expression for a CSS Modules class key.
 *
 * A kebab-case key cannot be read as `styles.hero-card` (that is a
 * subtraction expression). Emit bracket access with a JSON-escaped key so the
 * JSX compiles and the key cannot terminate the string literal.
 */
export function styleKeyAccess(stylesVar: string, key: string): string {
  if (isSafeIdentifier(key) && !RESERVED_WORDS.has(key)) return `${stylesVar}.${key}`;
  return `${stylesVar}[${JSON.stringify(key)}]`;
}

/**
 * Return `base`, or `base-2`, `base-3`, … until the value is unused, and
 * record it. Deterministic for a stable walk order.
 */
export function uniqueName(base: string, used: Set<string>): string {
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  let suffix = 2;
  while (used.has(`${base}-${suffix}`)) suffix += 1;
  const out = `${base}-${suffix}`;
  used.add(out);
  return out;
}
