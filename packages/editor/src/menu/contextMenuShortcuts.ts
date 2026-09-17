/**
 * Shortcut display text for hand-built context menus.
 *
 * Contextual menus must show the key that actually executes, so the display
 * text resolves through the same effective-binding registry as the menubar
 * (`getEffectiveBinding`): user keymap overrides and platform differences
 * stay in sync with what the command runs. Returns undefined when the action
 * has no binding — never a guessed key.
 */
import { formatShortcut, getEffectiveBinding } from '../shortcuts/ShortcutManager';

export function menuShortcutForAction(actionId: string): string | undefined {
  const binding = getEffectiveBinding(actionId);
  return binding?.key ? formatShortcut(binding) : undefined;
}
