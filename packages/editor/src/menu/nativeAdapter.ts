import type { MenuContext, MenuItemDef } from './types';

export interface NativeMenuItemSpec {
  kind: 'item' | 'check' | 'separator' | 'submenu' | 'predefined';
  id: string;
  label?: string;
  accelerator?: string;
  enabled?: boolean;
  checked?: boolean;
  items?: NativeMenuItemSpec[];
  itemType?: string;
}

export interface NativeSubmenuSpec {
  id: string;
  label: string;
  items: NativeMenuItemSpec[];
}

export interface NativeMenuSpec {
  submenus: NativeSubmenuSpec[];
}

export interface MenuStatePatch {
  id: string;
  enabled?: boolean;
  checked?: boolean;
  label?: string;
}

const PREDEFINED_ITEM_TYPES: Record<string, string> = {
  about: 'about',
  quit: 'quit',
  hide: 'hide',
  hide_others: 'hide_others',
  show_all: 'show_all',
  services: 'services',
  minimize: 'minimize',
  zoom: 'zoom',
  close_window: 'close_window',
};

function acceleratorToTauri(acc: {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  meta?: boolean;
}): string | undefined {
  const parts: string[] = [];
  if (acc.ctrl) parts.push('CmdOrCtrl');
  if (acc.alt) parts.push('Alt');
  if (acc.shift) parts.push('Shift');
  if (acc.meta) parts.push('Command');
  if (parts.length === 0) return undefined;
  const key = acc.key.length === 1 ? acc.key.toUpperCase() : acc.key;
  parts.push(key);
  return parts.join('+');
}

function resolveLabel(
  def: MenuItemDef,
  ctx: MenuContext,
  formatLabel?: (key: string) => string,
): string {
  if (def.label) return def.label(ctx);
  if (def.labelKey && formatLabel) return formatLabel(def.labelKey);
  return def.labelKey ?? def.id;
}

function filterItem(def: MenuItemDef, ctx: MenuContext): boolean {
  if (def.visible && !def.visible(ctx)) return false;
  if (def.capabilities && def.capabilities.length > 0) {
    const hasAll = def.capabilities.every((c) => ctx.platform.capabilities.has(c));
    if (!hasAll) return false;
  }
  if (def.workspaces && def.workspaces.length > 0) {
    if (!def.workspaces.includes(ctx.workspace)) return false;
  }
  return true;
}

function resolveEnabled(def: MenuItemDef, ctx: MenuContext): boolean {
  if (def.enabled) {
    const val = def.enabled(ctx);
    return val === true;
  }
  return true;
}

function resolveChecked(def: MenuItemDef, ctx: MenuContext): boolean {
  if (def.checked) return def.checked(ctx);
  return false;
}

function convertDefToSpec(
  def: MenuItemDef,
  ctx: MenuContext,
  formatLabel?: (key: string) => string,
): NativeMenuItemSpec | null {
  if (!filterItem(def, ctx)) return null;
  if (def.kind === 'separator') {
    return { kind: 'separator', id: def.id };
  }

  const predefined = PREDEFINED_ITEM_TYPES[def.id];
  if (predefined) {
    return {
      kind: 'predefined',
      id: def.id,
      itemType: predefined,
      label: resolveLabel(def, ctx, formatLabel),
    };
  }

  const accelerator = def.accelerator ? acceleratorToTauri(def.accelerator) : undefined;
  const enabled = resolveEnabled(def, ctx);

  if (def.kind === 'submenu') {
    const subDefs = typeof def.items === 'function' ? def.items(ctx) : (def.items ?? []);
    const items: NativeMenuItemSpec[] = [];
    let lastGroup: string | undefined;
    for (const child of subDefs) {
      if (!filterItem(child, ctx)) continue;
      if (child.group && child.group !== lastGroup && items.length > 0) {
        const last = items[items.length - 1];
        if (last && last.kind !== 'separator') {
          items.push({ kind: 'separator', id: `sep-${child.id}` });
        }
      }
      lastGroup = child.group;
      const spec = convertDefToSpec(child, ctx, formatLabel);
      if (spec) items.push(spec);
    }

    return {
      kind: 'submenu',
      id: def.id,
      label: resolveLabel(def, ctx, formatLabel),
      items,
      enabled,
    };
  }

  if (def.kind === 'checkbox' || def.kind === 'radio') {
    return {
      kind: 'check',
      id: def.id,
      label: resolveLabel(def, ctx, formatLabel),
      accelerator,
      enabled,
      checked: resolveChecked(def, ctx),
    };
  }

  return {
    kind: 'item',
    id: def.id,
    label: resolveLabel(def, ctx, formatLabel),
    accelerator,
    enabled,
  };
}

export function buildNativeMenuSpec(
  allDefs: MenuItemDef[],
  ctx: MenuContext,
  platform: 'mac' | 'windows' | 'linux',
  formatLabel?: (key: string) => string,
): NativeMenuSpec {
  const submenus: NativeSubmenuSpec[] = [];

  for (const menuDef of allDefs) {
    if (menuDef.kind !== 'submenu' || !menuDef.items) continue;
    const menuId = menuDef.id;

    const isNative =
      platform === 'mac'
        ? menuId === 'edit' || menuId === 'help'
        : menuId === 'edit' || menuId === 'help';

    if (!isNative) continue;

    const rawItems = typeof menuDef.items === 'function' ? menuDef.items(ctx) : menuDef.items;

    if (menuId === 'edit') {
      const editItems = buildEditSpec(rawItems, ctx, formatLabel);
      if (editItems.length > 0) {
        submenus.push({
          id: 'edit',
          label: resolveLabel(menuDef, ctx, formatLabel),
          items: editItems,
        });
      }
    } else if (menuId === 'help') {
      const helpItems = buildHelpSpec(rawItems, ctx, platform, formatLabel);
      if (helpItems.length > 0) {
        submenus.push({
          id: 'help',
          label: resolveLabel(menuDef, ctx, formatLabel),
          items: helpItems,
        });
      }
    }
  }

  if (platform === 'mac') {
    submenus.unshift(buildAppMenuSpec(formatLabel));
    submenus.push(buildWindowMenuSpec());
  }

  return { submenus };
}

function buildAppMenuSpec(formatLabel?: (key: string) => string): NativeSubmenuSpec {
  const items: NativeMenuItemSpec[] = [
    {
      kind: 'predefined',
      id: 'about',
      itemType: 'about',
      label: formatLabel ? formatLabel('menu.help.about') : 'About Strata',
    },
    { kind: 'separator', id: 'sep-app-1' },
    {
      kind: 'item',
      id: 'settings',
      label: formatLabel ? formatLabel('menu.file.settings') : 'Settings\u2026',
      accelerator: 'CmdOrCtrl+,',
    },
    { kind: 'separator', id: 'sep-app-2' },
    { kind: 'predefined', id: 'services', itemType: 'services' },
    { kind: 'separator', id: 'sep-app-3' },
    { kind: 'predefined', id: 'hide', itemType: 'hide' },
    { kind: 'predefined', id: 'hide_others', itemType: 'hide_others' },
    { kind: 'predefined', id: 'show_all', itemType: 'show_all' },
    { kind: 'separator', id: 'sep-app-4' },
    { kind: 'predefined', id: 'quit', itemType: 'quit' },
  ];

  const appName = 'Strata';
  return { id: 'app', label: appName, items };
}

function buildWindowMenuSpec(): NativeSubmenuSpec {
  return {
    id: 'window',
    label: 'Window',
    items: [
      { kind: 'predefined', id: 'minimize', itemType: 'minimize' },
      { kind: 'predefined', id: 'zoom', itemType: 'zoom' },
      { kind: 'separator', id: 'sep-window' },
      { kind: 'predefined', id: 'close_window', itemType: 'close_window' },
    ],
  };
}

function buildEditSpec(
  defs: MenuItemDef[],
  ctx: MenuContext,
  formatLabel?: (key: string) => string,
): NativeMenuItemSpec[] {
  const items: NativeMenuItemSpec[] = [];
  let lastGroup: string | undefined;

  for (const def of defs) {
    if (def.kind === 'separator') {
      items.push({ kind: 'separator', id: def.id });
      continue;
    }
    if (!filterItem(def, ctx)) continue;

    if (def.group && def.group !== lastGroup && items.length > 0) {
      const last = items[items.length - 1];
      if (last && last.kind !== 'separator') {
        items.push({ kind: 'separator', id: `sep-${def.id}` });
      }
    }
    lastGroup = def.group;

    const spec = convertDefToSpec(def, ctx, formatLabel);
    if (spec) items.push(spec);
  }

  return items;
}

function buildHelpSpec(
  defs: MenuItemDef[],
  ctx: MenuContext,
  platform: 'mac' | 'windows' | 'linux',
  formatLabel?: (key: string) => string,
): NativeMenuItemSpec[] {
  const items: NativeMenuItemSpec[] = [];
  let lastGroup: string | undefined;

  for (const def of defs) {
    if (def.id === 'about' && platform === 'mac') continue;
    if (def.id === 'installDesktopApp') continue;
    if (def.kind === 'separator') {
      items.push({ kind: 'separator', id: def.id });
      continue;
    }
    if (!filterItem(def, ctx)) continue;

    if (def.group && def.group !== lastGroup && items.length > 0) {
      const last = items[items.length - 1];
      if (last && last.kind !== 'separator') {
        items.push({ kind: 'separator', id: `sep-${def.id}` });
      }
    }
    lastGroup = def.group;

    const spec = convertDefToSpec(def, ctx, formatLabel);
    if (spec) items.push(spec);
  }

  if (platform !== 'mac') {
    if (items.length > 0) {
      const last = items[items.length - 1];
      if (last && last.kind !== 'separator') {
        items.push({ kind: 'separator', id: 'sep-about' });
      }
    }
    items.push({ kind: 'predefined', id: 'about', itemType: 'about', label: 'About Strata' });
  }

  return items;
}

export function diffNativeMenuState(
  previous: NativeMenuSpec | null,
  current: NativeMenuSpec,
): MenuStatePatch[] {
  const prevItems = new Map<string, { enabled?: boolean; checked?: boolean; label?: string }>();
  if (previous) {
    collectItems(previous, prevItems);
  }

  const currItems = new Map<string, { enabled?: boolean; checked?: boolean; label?: string }>();
  collectItems(current, currItems);

  const patches: MenuStatePatch[] = [];
  for (const [id, curr] of currItems) {
    const prev = prevItems.get(id);
    const patch: MenuStatePatch = { id };
    let changed = false;
    if (!prev || prev.enabled !== curr.enabled) {
      patch.enabled = curr.enabled;
      changed = true;
    }
    if (!prev || prev.checked !== curr.checked) {
      patch.checked = curr.checked;
      changed = true;
    }
    if (!prev || prev.label !== curr.label) {
      patch.label = curr.label;
      changed = true;
    }
    if (changed) patches.push(patch);
  }
  return patches;
}

function collectItems(
  spec: NativeMenuSpec,
  map: Map<string, { enabled?: boolean; checked?: boolean; label?: string }>,
): void {
  for (const submenu of spec.submenus) {
    collectItemsRecursive(submenu.items, map);
  }
}

function collectItemsRecursive(
  items: NativeMenuItemSpec[],
  map: Map<string, { enabled?: boolean; checked?: boolean; label?: string }>,
): void {
  for (const item of items) {
    if (item.kind === 'separator' || item.kind === 'predefined') continue;
    map.set(item.id, { enabled: item.enabled, checked: item.checked, label: item.label });
    if (item.kind === 'submenu' && item.items) {
      collectItemsRecursive(item.items, map);
    }
  }
}

let _previousSpec: NativeMenuSpec | null = null;
let _sendTimeout: ReturnType<typeof requestAnimationFrame> | null = null;

export function isNativeMenuAvailable(): boolean {
  if (typeof window === 'undefined') return false;
  const runtimeWindow = window as Window & {
    __TAURI__?: unknown;
    __TAURI_INTERNALS__?: unknown;
  };
  return runtimeWindow.__TAURI__ !== undefined && runtimeWindow.__TAURI_INTERNALS__ !== undefined;
}

export function detectPlatform(): 'mac' | 'windows' | 'linux' {
  if (typeof navigator === 'undefined') return 'linux';
  const p = navigator.platform?.toLowerCase() ?? '';
  if (p.includes('mac')) return 'mac';
  if (p.includes('win')) return 'windows';
  return 'linux';
}

export async function sendNativeMenuSpec(spec: NativeMenuSpec): Promise<void> {
  _previousSpec = spec;
  if (!isNativeMenuAvailable()) return;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('build_native_menu', { spec });
  } catch (err) {
    console.warn('[nativeMenu] Failed to build native menu:', err);
  }
}

export function scheduleNativeMenuUpdate(spec: NativeMenuSpec): void {
  if (!isNativeMenuAvailable()) return;
  if (_sendTimeout !== null) {
    cancelAnimationFrame(_sendTimeout);
  }
  _sendTimeout = requestAnimationFrame(async () => {
    _sendTimeout = null;
    const patches = diffNativeMenuState(_previousSpec, spec);
    if (patches.length === 0) return;
    _previousSpec = spec;
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('update_native_menu_state', { patches });
    } catch (err) {
      console.warn('[nativeMenu] Failed to update native menu state:', err);
    }
  });
}
