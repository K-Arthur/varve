import type { MenuContext, MenuItemDef } from './types';

const isDev = typeof process !== 'undefined' && process.env.NODE_ENV === 'development';

export function createTimingGuard(
  label: string,
  fn: ((ctx: MenuContext) => unknown) | undefined,
): ((ctx: MenuContext) => unknown) | undefined {
  if (!isDev || !fn) return fn;
  return (ctx: MenuContext) => {
    const start = performance.now();
    const result = fn(ctx);
    const elapsed = performance.now() - start;
    if (elapsed > 1) {
      const msg = `[menu] Predicate "${label}" took ${elapsed.toFixed(2)}ms — must be <1ms. Predicates must not walk the scene graph or call selectors directly.`;
      if (typeof document !== 'undefined') {
        document.documentElement.setAttribute('data-menu-predicate-violation', label);
      }
      throw new Error(msg);
    }
    return result;
  };
}

let _duplicateAcceleratorsReported = false;

export function assertNoDuplicateAccelerators(menus: MenuItemDef[][]): void {
  if (!isDev || _duplicateAcceleratorsReported) return;
  _duplicateAcceleratorsReported = true;

  const seen = new Map<string, string[]>();

  function walk(items: MenuItemDef[], workspaceLabel: string) {
    for (const item of items) {
      if (item.accelerator) {
        const key = `${item.accelerator.ctrl ? 'Ctrl+' : ''}${item.accelerator.shift ? 'Shift+' : ''}${item.accelerator.alt ? 'Alt+' : ''}${item.accelerator.meta ? 'Meta+' : ''}${item.accelerator.key}`;
        if (!seen.has(key)) seen.set(key, []);
        seen.get(key)!.push(`${workspaceLabel}:${item.id}`);
      }
      if (item.items && Array.isArray(item.items)) {
        walk(item.items, workspaceLabel);
      }
    }
  }

  for (const menu of menus) {
    walk(menu, 'global');
  }

  for (const [key, items] of seen) {
    if (items.length > 1) {
      console.warn(`[menu] Duplicate accelerator "${key}" used by: ${items.join(', ')}`);
    }
  }
}

export function lintSubmenuDepth(items: MenuItemDef[], depth = 0): void {
  if (depth > 2) {
    console.warn(
      `[menu] Submenu exceeds max depth of 2 at depth ${depth + 1}:\n${formatTree(items, '')}`,
    );
    return;
  }
  for (const item of items) {
    if (item.items && Array.isArray(item.items)) {
      lintSubmenuDepth(item.items, depth + 1);
    }
  }
}

function formatTree(items: MenuItemDef[], indent: string): string {
  return items
    .map(
      (i) =>
        `${indent}${i.id} (${i.kind})${i.items && Array.isArray(i.items) ? `\n${formatTree(i.items, `${indent}  `)}` : ''}`,
    )
    .join('\n');
}
