import type { EditorContextValue } from '../context';
import { SHORTCUT_DEFS } from '../shortcuts/ShortcutManager';
import { type ActionCategory, getActionRegistry } from './ActionRegistry';
import { type ActionHandlerCallbacks, createActionHandlers } from './createActionHandlers';

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

export function registerEditorActions(
  ctx: EditorContextValue,
  callbacks?: ActionHandlerCallbacks,
): void {
  const r = getActionRegistry();
  const handlers = createActionHandlers(ctx, callbacks);

  const reg = (id: string, label: string, category: ActionCategory, handler: () => void) => {
    if (!r.has(id)) {
      r.register({ id, label, category }, handler);
    }
  };

  for (const [id, handler] of Object.entries(handlers)) {
    const def = SHORTCUT_DEFS[id];
    if (def) {
      r.register(
        {
          id,
          label: def.label,
          category: categoryFromShortcut(def.category),
          shortcut: def.binding,
        },
        handler,
      );
    }
  }

  reg('toggleLeftPanel', 'Toggle Layers Panel', 'panel', () => ctx.toggleLeftPanel());
  reg('toggleRightPanel', 'Toggle Inspector Panel', 'panel', () => ctx.toggleRightPanel());
  reg('home', 'Go to Home', 'file', () => {});
  reg('togglePixelGrid', 'Toggle Pixel Grid', 'canvas', () =>
    ctx.setPixelGridEnabled(!ctx.state.pixelGridEnabled),
  );
  reg('enterFrame', 'Enter Frame', 'canvas', () => {});
  reg('editText', 'Edit Text', 'text', () => {});
  reg('nudgeUp', 'Nudge Up', 'object', () => {});
  reg('nudgeDown', 'Nudge Down', 'object', () => {});
  reg('nudgeLeft', 'Nudge Left', 'object', () => {});
  reg('nudgeRight', 'Nudge Right', 'object', () => {});
}
