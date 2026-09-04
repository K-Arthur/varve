import type {
  MenuEntry,
  MenuItemCheckbox,
  MenuItemRadio,
  SubmenuItem,
  MenuItem as UiMenuItem,
} from '@varve/ui';
import { formatLabel as defaultFormatLabel } from './localization';
import { timeMenuOperation } from './perfFlags';
import type { MenuContext, MenuContextId, MenuItemDef } from './types';

export interface RenderOptions {
  ctx: MenuContext;
  run: (id: string) => void | Promise<void>;
  formatLabel?: (key: string) => string;
  contexts?: MenuContextId[];
  platformOs?: 'mac' | 'windows' | 'linux' | 'unknown';
  showAllMenuItems?: boolean;
}

/** Display accelerators in the same compact platform-aware form as the menubar. */
export function formatMenuShortcut(
  accelerator: MenuItemDef['accelerator'],
  os: MenuContext['platform']['os'],
): string | undefined {
  if (!accelerator?.key) return undefined;
  const key =
    accelerator.key.length === 1
      ? accelerator.key.toUpperCase()
      : accelerator.key === 'Backspace'
        ? '⌫'
        : accelerator.key === 'Delete'
          ? 'Del'
          : accelerator.key;
  if (os === 'mac') {
    return `${accelerator.ctrl ? '⌘' : ''}${accelerator.shift ? '⇧' : ''}${accelerator.alt ? '⌥' : ''}${key}`;
  }
  return `${accelerator.ctrl ? 'Ctrl+' : ''}${accelerator.shift ? 'Shift+' : ''}${accelerator.alt ? 'Alt+' : ''}${key}`;
}

function ariaMenuShortcut(
  accelerator: MenuItemDef['accelerator'],
  os: MenuContext['platform']['os'],
): string | undefined {
  if (!accelerator?.key) return undefined;
  const modifiers = [
    accelerator.ctrl ? (os === 'mac' ? 'Meta' : 'Control') : '',
    accelerator.shift ? 'Shift' : '',
    accelerator.alt ? 'Alt' : '',
  ].filter(Boolean);
  const key = accelerator.key.length === 1 ? accelerator.key.toUpperCase() : accelerator.key;
  return [...modifiers, key].join('+');
}

function menuVisuals(def: MenuItemDef, ctx: MenuContext) {
  const shortcut = formatMenuShortcut(def.accelerator, ctx.platform.os);
  return {
    ...(def.icon ? { icon: def.icon } : {}),
    ...(def.description ? { description: def.description } : {}),
    ...(def.destructive ? { destructive: true } : {}),
    ...(shortcut
      ? { shortcut, ariaKeyshortcuts: ariaMenuShortcut(def.accelerator, ctx.platform.os) }
      : {}),
  };
}

function matchesContext(def: MenuItemDef, contexts?: MenuContextId[]): boolean {
  if (!contexts || contexts.length === 0) return true;
  if (!def.contexts || def.contexts.length === 0) return true;
  return def.contexts.some((c) => contexts.includes(c));
}

function filterItems(items: MenuItemDef[], ctx: MenuContext, opts: RenderOptions): MenuItemDef[] {
  const skipWorkspaceFilter = opts.showAllMenuItems === true;
  return items.filter((def) => {
    if (!matchesContext(def, opts.contexts)) return false;
    if (def.visible && !def.visible(ctx)) return false;
    if (def.capabilities && def.capabilities.length > 0) {
      const hasAll = def.capabilities.every((c) => ctx.platform.capabilities.has(c));
      if (!hasAll) return false;
    }
    if (!skipWorkspaceFilter && def.workspaces && def.workspaces.length > 0) {
      if (!def.workspaces.includes(ctx.workspace)) return false;
    }
    return true;
  });
}

export function renderMenuItems(
  defs: MenuItemDef[],
  ctx: MenuContext,
  opts: RenderOptions,
): MenuEntry[] {
  return timeMenuOperation('renderMenuItems', () => {
    const filtered = filterItems(defs, ctx, opts);
    const entries: MenuEntry[] = [];
    let lastGroup: string | undefined;

    for (const def of filtered) {
      if (def.kind === 'separator') {
        entries.push({ id: def.id, separator: true });
        continue;
      }

      const isDisabled = resolveEnabled(def, ctx);
      const disabled = isDisabled !== true;

      if (def.group && def.group !== lastGroup && entries.length > 0) {
        const last = entries[entries.length - 1]!;
        if (!('separator' in last && last.separator === true)) {
          entries.push({ id: `sep-after-${lastGroup ?? ''}`, separator: true });
        }
      }
      lastGroup = def.group;

      const badge = resolveBadge(def, ctx);
      const visuals = menuVisuals(def, ctx);

      if (def.kind === 'submenu' && def.items) {
        const subDefs = typeof def.items === 'function' ? def.items(ctx) : def.items;
        const subEntries = renderMenuItems(subDefs, ctx, opts);
        const sm: SubmenuItem = {
          id: def.id,
          label: resolveLabel(def, ctx, opts),
          submenu: subEntries,
          disabled,
          type: 'submenu',
          badge,
          ...visuals,
        };
        entries.push(sm);
      } else if (def.kind === 'checkbox') {
        const cb: MenuItemCheckbox = {
          id: def.id,
          label: resolveLabel(def, ctx, opts),
          checked: def.checked ? def.checked(ctx) : false,
          onToggle: () => {
            void opts.run(def.id);
          },
          disabled,
          type: 'checkbox',
          badge,
          ...visuals,
        };
        entries.push(cb);
      } else if (def.kind === 'radio') {
        const rb: MenuItemRadio = {
          id: def.id,
          label: resolveLabel(def, ctx, opts),
          checked: def.checked ? def.checked(ctx) : false,
          onToggle: () => {
            void opts.run(def.id);
          },
          disabled,
          type: 'radio',
          group: def.radioGroup ?? '',
          badge,
          ...visuals,
        };
        entries.push(rb);
      } else {
        const mi: UiMenuItem = {
          id: def.id,
          label: resolveLabel(def, ctx, opts),
          onAction: () => {
            void opts.run(def.id);
          },
          disabled,
          badge,
          ...visuals,
        };
        entries.push(mi);
      }
    }

    return entries;
  });
}

function resolveEnabled(def: MenuItemDef, ctx: MenuContext): true | { reason: string } {
  if (def.enabled) return def.enabled(ctx);
  return true;
}

function resolveBadge(def: MenuItemDef, ctx: MenuContext): string | undefined {
  if (def.badge) return def.badge(ctx);
  return undefined;
}

function resolveLabel(def: MenuItemDef, ctx: MenuContext, opts: RenderOptions): string {
  if (def.label) return def.label(ctx);
  if (def.labelKey) {
    // Default resolver guarantees a display string — raw label keys must
    // never reach the UI even when a caller omits formatLabel.
    return (opts.formatLabel ?? defaultFormatLabel)(def.labelKey);
  }
  return '';
}

export function renderMenubarItems(
  defs: MenuItemDef[],
  ctx: MenuContext,
  opts: RenderOptions,
): { id: string; items: MenuEntry[] }[] {
  return timeMenuOperation('renderMenubarItems', () => {
    const groups: { id: string; items: MenuEntry[] }[] = [];
    for (const def of defs) {
      if (def.kind !== 'submenu' || !def.items) continue;
      const subDefs = typeof def.items === 'function' ? def.items(ctx) : def.items;
      const rendered = renderMenuItems(subDefs, ctx, { ...opts, contexts: ['menubar'] });
      if (rendered.length === 0) continue;
      groups.push({ id: def.id, items: rendered });
    }
    return groups;
  });
}
