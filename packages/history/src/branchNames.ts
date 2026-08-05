/**
 * Branch and checkpoint naming policy (ADR-0023 core, M9).
 *
 * Branch names are git-ref-safe so the future Git integration (M13) can map
 * them onto refs without rewriting; checkpoint names are human labels and
 * may contain spaces but no control characters.
 */

export interface NameValidation {
  valid: boolean;
  reason?: string;
}

function hasControlCharacter(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

function stripControlCharacters(value: string): string {
  let out = '';
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code >= 0x20 && code !== 0x7f) out += value[i];
  }
  return out;
}

const BRANCH_NAME_RE = /^[A-Za-z0-9._/-]{1,64}$/;

const RESERVED_BRANCH_NAMES = new Set(['.', '..', 'HEAD', 'head']);

/**
 * Validate a branch name. Git-ref-safe charset, 1-64 chars, no control
 * characters, no leading/trailing slash or dot, no reserved names.
 */
export function validateBranchName(name: string): NameValidation {
  if (typeof name !== 'string' || name.length === 0) {
    return { valid: false, reason: 'branch name must not be empty' };
  }
  if (name.length > 64) {
    return { valid: false, reason: 'branch name must be 64 characters or fewer' };
  }
  if (hasControlCharacter(name)) {
    return { valid: false, reason: 'branch name must not contain control characters' };
  }
  if (name.startsWith('/') || name.endsWith('/')) {
    return { valid: false, reason: 'branch name must not start or end with a slash' };
  }
  if (name.startsWith('.') && !name.startsWith('./')) {
    return { valid: false, reason: 'branch name must not start with a dot' };
  }
  if (name.endsWith('.')) {
    return { valid: false, reason: 'branch name must not end with a dot' };
  }
  if (RESERVED_BRANCH_NAMES.has(name)) {
    return { valid: false, reason: `branch name is reserved: ${name}` };
  }
  if (!BRANCH_NAME_RE.test(name)) {
    return {
      valid: false,
      reason: 'branch name may only contain letters, digits, dot, underscore, slash, and hyphen',
    };
  }
  return { valid: true };
}

/**
 * Validate a checkpoint name. Human label: 1-64 chars, no control
 * characters, no leading or trailing whitespace.
 */
export function validateCheckpointName(name: string): NameValidation {
  if (typeof name !== 'string' || name.length === 0) {
    return { valid: false, reason: 'checkpoint name must not be empty' };
  }
  if (name.length > 64) {
    return { valid: false, reason: 'checkpoint name must be 64 characters or fewer' };
  }
  if (hasControlCharacter(name)) {
    return { valid: false, reason: 'checkpoint name must not contain control characters' };
  }
  if (name.trim() !== name) {
    return { valid: false, reason: 'checkpoint name must not have leading or trailing whitespace' };
  }
  return { valid: true };
}

/**
 * Sanitize a free-form string into a valid branch name.
 * Used for automatic divergence branches and imports.
 */
export function suggestBranchName(raw: string, fallback = 'branch'): string {
  let name = stripControlCharacters(raw)
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^A-Za-z0-9._/-]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/\/+/g, '/');
  name = name.replace(/^[./-]+|[./-]+$/g, '');
  if (name.length === 0) name = fallback;
  if (name.length > 64) name = name.slice(0, 64);
  const tail = name.replace(/[.-]+$/g, '');
  name = tail.length > 0 ? tail : name.slice(0, 63);
  if (RESERVED_BRANCH_NAMES.has(name)) name = `${name}-1`;
  return name;
}

/**
 * Suggest a unique branch name against existing branches on the document.
 * Appends a numeric suffix on collision: `name`, `name-2`, `name-3`, ...
 */
export function suggestUniqueBranchName(
  raw: string,
  existingNames: Iterable<string>,
  fallback = 'branch',
): string {
  const taken = new Set(existingNames);
  const base = suggestBranchName(raw, fallback);
  if (!taken.has(base)) return base;
  for (let n = 2; n <= 999; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}-${Math.floor(Date.now() % 100000)}`;
}
