import { toolDefinition } from '../tools/toolRegistry';
import type { ToolId } from '../tools/types';
import { formatShortcut, getEffectiveBinding, isMac } from './ShortcutManager';

/** Registry action id that carries a tool's shortcut, if the tool has one. */
export function toolShortcutId(id: ToolId): string | undefined {
  return toolDefinition(id).shortcutId;
}

export function toolShortcutLabel(id: ToolId): string | undefined {
  const sid = toolShortcutId(id);
  if (!sid) return undefined;
  const binding = getEffectiveBinding(sid);
  return binding?.key ? formatShortcut(binding) : undefined;
}

/**
 * `aria-keyshortcuts` value for a tool, or undefined when it has no binding.
 *
 * `toolShortcutLabel` returns a *display* string ("V", "Ctrl+G", "⌘G"). That is
 * not a valid aria-keyshortcuts token list: modifiers must be Alt / Control /
 * Meta / Shift, and the mac glyphs are decorative. Assistive technology needs
 * the machine-readable form, so derive it from the same effective binding —
 * user remaps and layout changes stay in sync with the tooltip.
 */
export function toolAriaKeyShortcut(id: ToolId): string | undefined {
  const sid = toolShortcutId(id);
  if (!sid) return undefined;
  const binding = getEffectiveBinding(sid);
  if (!binding?.key) return undefined;
  const parts: string[] = [];
  // The registry's `ctrl` flag is the primary modifier: ⌘ on mac, Ctrl elsewhere.
  if (binding.ctrl) parts.push(isMac() ? 'Meta' : 'Control');
  if (binding.shift) parts.push('Shift');
  if (binding.alt) parts.push('Alt');
  const key = binding.key.length === 1 ? binding.key.toUpperCase() : binding.key;
  parts.push(key);
  return parts.join('+');
}
