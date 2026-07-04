/**
 * registerAll — one-time registration of all editor actions into the ActionRegistry.
 *
 * Called once at app boot from Shell or EditorProvider. Keeps the registry
 * populated so QuickActionsBar, ShortcutPalette, and future surfaces can
 * discover actions without hardcoded dispatch tables.
 */
import type { EditorContextValue } from '../context';
import { SHORTCUT_DEFS } from '../shortcuts/ShortcutManager';
import { type ActionCategory, getActionRegistry } from './ActionRegistry';

function categoryFromShortcut(cat: string): ActionCategory {
  const lc = cat.toLowerCase();
  if (lc === 'edit') return 'edit';
  if (lc === 'file') return 'file';
  if (lc === 'view') return 'view';
  if (lc === 'object') return 'object';
  if (lc === 'arrange') return 'arrange';
  if (lc === 'tools') return 'tools';
  return 'help';
}

export function registerAllShortcuts(exec: (id: string) => (() => void) | null): void {
  const r = getActionRegistry();
  for (const [id, def] of Object.entries(SHORTCUT_DEFS)) {
    if (!r.has(id)) {
      r.register(
        {
          id,
          label: def.label,
          category: categoryFromShortcut(def.category),
          shortcut: def.binding,
        },
        () => exec(id)?.(),
      );
    }
  }
}

export function registerEditorActions(ctx: EditorContextValue): void {
  const r = getActionRegistry();
  const reg = (id: string, label: string, category: ActionCategory, handler: () => void) => {
    if (!r.has(id)) {
      r.register({ id, label, category }, handler);
    }
  };

  reg('toggleLeftPanel', 'Toggle Layers Panel', 'panel', () => ctx.toggleLeftPanel());
  reg('toggleRightPanel', 'Toggle Inspector Panel', 'panel', () => ctx.toggleRightPanel());
  reg('home', 'Go to Home', 'file', () => {});
  reg('togglePixelGrid', 'Toggle Pixel Grid', 'canvas', () =>
    ctx.setPixelGridEnabled(!ctx.state.pixelGridEnabled),
  );
  reg('enterFrame', 'Enter Frame', 'canvas', () => {});
  reg('editText', 'Edit Text', 'text', () => {});
  reg('resetZoom', 'Reset Zoom', 'view', () => ctx.zoomTo(1));
  reg('fitToScreen', 'Fit to Screen', 'view', () => ctx.fitAll());
  reg('newTab', 'New Tab', 'file', () => ctx.newTab());
  reg('closeTab', 'Close Tab', 'file', () => ctx.closeTab(ctx.state.activeId));
  reg('selectAll', 'Select All', 'edit', () => {
    const nodes = ctx.rootNodes();
    if (nodes.length > 0) {
      ctx.setSelection(nodes[0]?.id ?? null);
      for (let i = 1; i < nodes.length; i++) {
        const n = nodes[i];
        if (n) ctx.toggleSelection(n.id, true);
      }
    }
  });
  reg('nudgeUp', 'Nudge Up', 'object', () => {});
  reg('nudgeDown', 'Nudge Down', 'object', () => {});
  reg('nudgeLeft', 'Nudge Left', 'object', () => {});
  reg('nudgeRight', 'Nudge Right', 'object', () => {});
}
