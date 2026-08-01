/**
 * Physical-key resolution — layout- and NumLock-independent key matching.
 *
 * Browsers report `KeyboardEvent.key` as the *printed* character, which
 * depends on layout and Shift: on a US layout `Shift+1` yields `key='!'`
 * (Playwright synthesizes `key='1'`, which hides this class of bug in E2E),
 * and numpad keys read as `Insert`/`End`/arrows when NumLock is off. The
 * physical `KeyboardEvent.code` (`Digit1`, `NumpadAdd`, ...) is stable across
 * all of those, so shortcut matching for digits and numpad must run on
 * `code`-derived keys.
 *
 * This module is the single implementation for both the global shortcut
 * registry (`ShortcutManager`) and the canvas-local keyboard handler, so a
 * `Shift+1` Fit All and a numpad `+` zoom resolve identically everywhere.
 */

/** Map a `KeyboardEvent.code` to the physical key it represents. */
export function physicalKeyFromEvent(e: { key?: string; code?: string }): string {
  const code = e.code ?? '';
  if (code.startsWith('Digit')) return code.slice('Digit'.length); // 'Digit1' -> '1'
  if (code.startsWith('Numpad')) {
    const rest = code.slice('Numpad'.length);
    if (rest === 'Add') return '+';
    if (rest === 'Subtract') return '-';
    if (rest === 'Multiply') return '*';
    if (rest === 'Divide') return '/';
    if (rest === 'Decimal') return '.';
    if (rest === 'Enter') return 'Enter';
    return rest; // 'Numpad0'..'Numpad9'
  }
  return e.key ?? '';
}

/**
 * Resolve the digit (0-9) from a key event regardless of layout or NumLock.
 * Returns null when the event is not a digit key.
 */
export function physicalDigit(e: { key?: string; code?: string }): string | null {
  const physical = physicalKeyFromEvent(e);
  if (physical.length === 1 && physical >= '0' && physical <= '9') return physical;
  return null;
}

/**
 * Canonicalize a shortcut key so `+` and `=` are interchangeable. On most
 * layouts `+` is `Shift+=` (a single physical key), and zoom-in shortcuts are
 * declared against `=`; accepting both makes `Ctrl+=`, `Ctrl++`, and
 * numpad `+` resolve to the same action.
 */
export function canonicalShortcutKey(key: string): string {
  return key === '+' ? '=' : key;
}
