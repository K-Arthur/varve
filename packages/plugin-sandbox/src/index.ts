/** @strata/plugin-sandbox — sandboxed plugin runtime (later phase). */
export const PACKAGE = '@strata/plugin-sandbox' as const;

// ── Types ─────────────────────────────────────────────────────────

export interface StrataPlugin {
  id: string;
  name: string;
  description: string;
  version: string;
  icon: string;
  permissions: string[];
  enabled: boolean;
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  permissions: string[];
  main: string;
}

// ── Stub data ─────────────────────────────────────────────────────

const STUB_INSTALLED: StrataPlugin[] = [
  {
    id: 'plugin-svg-export',
    name: 'SVG Export Pro',
    description: 'Advanced SVG export with compression, scaling, and CSS-inlining options.',
    version: '1.2.0',
    icon: 'FileUp',
    permissions: ['document:read', 'file:write'],
    enabled: true,
  },
  {
    id: 'plugin-color-blindness',
    name: 'Color Blindness Simulator',
    description: 'Simulates how your design appears to users with common color vision deficiencies.',
    version: '0.4.1',
    icon: 'Eye',
    permissions: ['document:read'],
    enabled: false,
  },
];

const STUB_MARKETPLACE: StrataPlugin[] = [
  {
    id: 'plugin-icons',
    name: 'Icon Library',
    description: 'Browse and insert 100,000+ open-source icons directly into your designs.',
    version: '2.0.0',
    icon: 'Image',
    permissions: ['document:read', 'document:write', 'network:fetch'],
    enabled: false,
  },
  {
    id: 'plugin-grid-maker',
    name: 'Grid Maker',
    description: 'Create complex CSS / flexbox / masonry grids with a visual builder.',
    version: '1.1.0',
    icon: 'LayoutGrid',
    permissions: ['document:read', 'document:write'],
    enabled: false,
  },
  {
    id: 'plugin-accessibility',
    name: 'Accessibility Checker',
    description: 'WCAG 2.2 audit — contrast ratios, heading structure, focus order, and more.',
    version: '0.9.0',
    icon: 'Accessibility',
    permissions: ['document:read'],
    enabled: false,
  },
];

// ── Stub functions (will be replaced with Tauri IPC) ──────────────

export async function listInstalledPlugins(): Promise<StrataPlugin[]> {
  await Promise.resolve();
  return STUB_INSTALLED;
}

export async function listMarketplacePlugins(): Promise<StrataPlugin[]> {
  await Promise.resolve();
  return STUB_MARKETPLACE;
}

export async function togglePlugin(id: string, enabled: boolean): Promise<void> {
  const plugin = [...STUB_INSTALLED, ...STUB_MARKETPLACE].find((p) => p.id === id);
  if (plugin) plugin.enabled = enabled;
}

export async function removePlugin(_id: string): Promise<void> {
  await Promise.resolve();
}

export async function installPlugin(_id: string): Promise<void> {
  await Promise.resolve();
}
