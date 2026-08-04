/**
 * ActionRegistry — central, extensible action registry.
 *
 * All actions that can be triggered by keyboard, menu, toolbar, or palette
 * are registered here once. Surfaces (ShortcutManager, Menubar, QuickActionsBar,
 * FloatingToolbar) query the registry rather than maintaining their own lists.
 *
 * Research basis: VS Code ActionRegistry, Figma Command Palette, Penpot Shortcuts.
 */

/**
 * Fuzzy subsequence match: returns true if all chars of `query` appear in
 * `target` in order (not necessarily contiguously).
 */
export function fuzzyMatch(query: string, target: string): boolean {
  if (!query) return true;
  let qi = 0;
  for (let ti = 0; ti < target.length && qi < query.length; ti++) {
    if (target[ti] === query[qi]) qi++;
  }
  return qi === query.length;
}

/**
 * Score how well an action matches a query. Higher is better.
 * Returns 0 for no match.
 *
 * Scoring tiers:
 * - exact label match: 100
 * - label starts with query: 80
 * - label contains query as word boundary: 70
 * - label contains query: 60
 * - id starts with query: 50
 * - id contains query: 40
 * - keyword exact match: 45
 * - keyword contains query: 35
 * - category contains query: 20
 * - fuzzy subsequence on label: 10
 * - fuzzy subsequence on id: 5
 */
function scoreMatch(
  action: { id: string; label: string; category: string; keywords?: string[] },
  query: string,
): number {
  const label = action.label.toLowerCase();
  const id = action.id.toLowerCase();
  const cat = action.category.toLowerCase();

  if (label === query) return 100;
  if (label.startsWith(query)) return 80;
  if (new RegExp(`\\b${escapeRegex(query)}\\b`).test(label)) return 70;
  if (label.includes(query)) return 60;
  if (id === query) return 55;
  if (id.startsWith(query)) return 50;
  if (id.includes(query)) return 40;
  if (action.keywords) {
    for (const kw of action.keywords) {
      const k = kw.toLowerCase();
      if (k === query) return 45;
      if (k.includes(query)) return 35;
    }
  }
  if (cat.includes(query)) return 20;
  if (fuzzyMatch(query, label)) return 10;
  if (fuzzyMatch(query, id)) return 5;
  return 0;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
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
  | 'insert'
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
  private recentIds: string[] = [];
  private frequencyMap = new Map<string, number>();
  private maxRecent = 20;

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

  recordUsage(id: string): void {
    if (!this.actions.has(id)) return;
    this.frequencyMap.set(id, (this.frequencyMap.get(id) ?? 0) + 1);
    this.recentIds = this.recentIds.filter((r) => r !== id);
    this.recentIds.unshift(id);
    if (this.recentIds.length > this.maxRecent) {
      this.recentIds.length = this.maxRecent;
    }
  }

  getRecentIds(): string[] {
    return [...this.recentIds];
  }

  search(query: string): RegisteredAction[] {
    const q = query.toLowerCase().trim();
    if (!q) return this.getAll();
    const results: Array<{ action: RegisteredAction; score: number }> = [];
    for (const a of this.actions.values()) {
      const score = scoreMatch(a, q);
      if (score > 0) {
        const boost = this.computeBoost(a.id);
        results.push({ action: a, score: score + boost });
      }
    }
    results.sort((a, b) => b.score - a.score || a.action.label.localeCompare(b.action.label));
    return results.map((r) => r.action);
  }

  private computeBoost(id: string): number {
    let boost = 0;
    const recentIdx = this.recentIds.indexOf(id);
    if (recentIdx !== -1) {
      boost += Math.max(0, 5 - recentIdx * 0.5);
    }
    const freq = this.frequencyMap.get(id) ?? 0;
    if (freq > 0) {
      boost += Math.min(3, Math.log2(freq + 1));
    }
    return boost;
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
