/**
 * workspaceShortcutLabel — resolve the effective keyboard shortcut for a
 * workspace mode from the shortcut registry.
 *
 * Display must never drift from execution: the registry (ShortcutManager) is
 * the single source of truth for what actually fires on keypress. Hard-coded
 * "Ctrl+Shift+D" style strings rot (see WORKSPACE_SHORTCUTS, which no longer
 * matches the live bindings — workspace switching actually uses Ctrl+Shift+1..9).
 */
import { formatShortcut, getEffectiveBinding } from '../shortcuts/ShortcutManager';
import type { WorkspaceMode } from './workspaceTypes';

const WORKSPACE_SHORTCUT_IDS: Record<WorkspaceMode, string> = {
  design: 'workspaceDesign',
  print: 'workspacePrint',
  drawing: 'workspaceDrawing',
  image: 'workspaceImage',
  motion: 'workspaceMotion',
  codegen: 'workspaceCodegen',
  logo: 'workspaceLogo',
};

/** Effective shortcut label for a workspace mode (e.g. "Ctrl+Shift+2"). */
export function workspaceShortcutLabel(mode: WorkspaceMode): string {
  const id = WORKSPACE_SHORTCUT_IDS[mode];
  if (!id) return '';
  return formatShortcut(getEffectiveBinding(id));
}
