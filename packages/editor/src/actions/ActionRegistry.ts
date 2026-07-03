/**
 * ActionRegistry — central, extensible action registry.
 *
 * All actions that can be triggered by keyboard, menu, toolbar, or palette
 * are registered here once. Surfaces (ShortcutManager, Menubar, QuickActionsBar,
 * FloatingToolbar) query the registry rather than maintaining their own lists.
 *
 * Research basis: VS Code ActionRegistry, Figma Command Palette, Penpot Shortcuts.
 */
export type ActionCategory =
  | 'file'
  | 'edit'
  | 'view'
  | 'object'
  | 'arrange'
  | 'tools'
  | 'text'
  | 'component'
  | 'canvas'
  | 'panel'
  | 'help';

export interface ActionDef {
  id: string;
  label: string;
  category: ActionCategory;
  keywords?: string[];
  context?: 'always' | 'selection' | 'textEdit' | 'multiSelect' | 'canvas';
  shortcut?: { key: string; ctrl?: boolean; shift?: boolean; alt?: boolean };
}

export type ActionHandler = (ctx: unknown) => void;

export interface RegisteredAction extends ActionDef {
  handler: ActionHandler;
}

export class ActionRegistry {
  private actions = new Map<string, RegisteredAction>();

  register(def: ActionDef, handler: ActionHandler): void {
    if (this.actions.has(def.id)) {
      if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'development') {
        console.warn(`ActionRegistry: duplicate action "${def.id}" — overwriting`);
      }
    }
    this.actions.set(def.id, { ...def, handler });
  }

  get(id: string): RegisteredAction | undefined {
    return this.actions.get(id);
  }

  getAll(): RegisteredAction[] {
    return Array.from(this.actions.values());
  }

  getByCategory(category: ActionCategory): RegisteredAction[] {
    return this.getAll().filter((a) => a.category === category);
  }

  search(query: string): RegisteredAction[] {
    const q = query.toLowerCase().trim();
    if (!q) return this.getAll();
    return this.getAll().filter(
      (a) =>
        a.label.toLowerCase().includes(q) ||
        a.id.toLowerCase().includes(q) ||
        a.keywords?.some((k) => k.toLowerCase().includes(q)) ||
        a.category.toLowerCase().includes(q),
    );
  }

  has(id: string): boolean {
    return this.actions.has(id);
  }

  remove(id: string): void {
    this.actions.delete(id);
  }

  clear(): void {
    this.actions.clear();
  }

  get size(): number {
    return this.actions.size;
  }
}

let _instance: ActionRegistry | null = null;

export function getActionRegistry(): ActionRegistry {
  if (!_instance) {
    _instance = new ActionRegistry();
  }
  return _instance;
}

export function resetActionRegistryForTesting(): void {
  _instance = null;
}
