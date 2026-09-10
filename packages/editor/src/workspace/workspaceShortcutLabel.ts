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
import { toolShortcutId } from '../shortcuts/toolShortcutLabel';
import { getHiddenTools, type WorkspaceConfig, type WorkspaceMode } from './workspaceTypes';

const WORKSPACE_SHORTCUT_IDS: Record<WorkspaceMode, string> = {
  design: 'workspaceDesign',
  print: 'workspacePrint',
  drawing: 'workspaceDrawing',
  image: 'workspaceImage',
  motion: 'workspaceMotion',
  codegen: 'workspaceCodegen',
  logo: 'workspaceLogo',
  email: 'workspaceEmail',
};

/** Effective shortcut label for a workspace mode (e.g. "Ctrl+Shift+2"). */
export function workspaceShortcutLabel(mode: WorkspaceMode): string {
  const id = WORKSPACE_SHORTCUT_IDS[mode];
  if (!id) return '';
  return formatShortcut(getEffectiveBinding(id));
}

/**
 * Shortcut ids the tip recommender should not surface in this workspace.
 *
 * Derived from the workspace's own toolbar rather than declared: a tip for a
 * tool the workspace doesn't show is noise, and deriving it means adding or
 * removing a tool from a toolbar keeps the tips correct automatically. This
 * replaces `WorkspaceConfig.shortcuts.disabled`, a hand-maintained list that
 * was empty in every built-in workspace and so suppressed nothing.
 */
export function suppressedTipShortcutIds(mode: WorkspaceMode, config?: WorkspaceConfig): string[] {
  const ids: string[] = [];
  for (const tool of getHiddenTools(mode, config)) {
    const id = toolShortcutId(tool);
    if (id) ids.push(id);
  }
  return ids;
}
