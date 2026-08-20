import type { ToolId } from '../tools/types';
import { toolDefinition } from '../tools/toolRegistry';
import { formatShortcut, getEffectiveBinding } from './ShortcutManager';

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
