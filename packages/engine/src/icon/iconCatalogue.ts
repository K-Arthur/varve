/**
 * Curated icon catalogue — the reviewed default set of packs surfaced by the
 * Icons panel. Every entry was verified against live Iconify metadata
 * (collections endpoint) on 2026-08-04; the policy conclusions come from the
 * reviewed licence table in `iconLicence.ts`, never from the pack name.
 *
 * Brand icons are explicitly flagged: an open licence on the SVG files does
 * not grant trademark rights for the depicted logos.
 */

export type IconCatalogueGroupId = 'general-ui' | 'platform-design' | 'brands';

export interface IconCatalogueGroup {
  id: IconCatalogueGroupId;
  label: string;
  description: string;
  /** Verified pack prefixes in display order. */
  packs: string[];
}

export interface IconCatalogueEntry {
  prefix: string;
  /** Verified SPDX id of the pack licence (2026-08-04). */
  spdx: string;
  /** Pack name from provider metadata. */
  name: string;
  /** Vendor/author. */
  vendor: string;
  /** Grid size hint. */
  grid: string;
  brand?: boolean;
}

export const ICON_CATALOGUE_GROUPS: IconCatalogueGroup[] = [
  {
    id: 'general-ui',
    label: 'General UI',
    description: 'Core UI/UX packs for interfaces, dashboards, and apps.',
    packs: [
      'material-symbols',
      'mdi',
      'lucide',
      'phosphor',
      'tabler',
      'heroicons',
      'iconoir',
      'bi',
      'radix-icons',
    ],
  },
  {
    id: 'platform-design',
    label: 'Platform design systems',
    description: 'Design-system icon sets for specific platforms and products.',
    packs: ['material-symbols', 'fluent', 'carbon', 'ri', 'heroicons', 'bi'],
  },
  {
    id: 'brands',
    label: 'Brands and logos',
    description: 'Trademarked logos (files are freely licensed, trademark rights are separate).',
    packs: ['simple-icons'],
  },
];

/**
 * Verified catalogue entries keyed by pack prefix. `spdx` reflects the
 * provider-reported licence as of 2026-08-04; treat edits as a policy change.
 */
export const ICON_CATALOGUE: Readonly<Record<string, IconCatalogueEntry>> = {
  'material-symbols': {
    prefix: 'material-symbols',
    spdx: 'Apache-2.0',
    name: 'Material Symbols',
    vendor: 'Google',
    grid: '24px',
  },
  mdi: {
    prefix: 'mdi',
    spdx: 'Apache-2.0',
    name: 'Material Design Icons',
    vendor: 'Pictogrammers',
    grid: '24px',
  },
  lucide: {
    prefix: 'lucide',
    spdx: 'ISC',
    name: 'Lucide',
    vendor: 'Lucide Contributors',
    grid: '24px',
  },
  ph: {
    prefix: 'ph',
    spdx: 'MIT',
    name: 'Phosphor',
    vendor: 'Phosphor Icons',
    grid: '256px',
  },
  tabler: {
    prefix: 'tabler',
    spdx: 'MIT',
    name: 'Tabler Icons',
    vendor: 'Paweł Kuna',
    grid: '24px',
  },
  heroicons: {
    prefix: 'heroicons',
    spdx: 'MIT',
    name: 'Heroicons',
    vendor: 'Refactoring UI Inc',
    grid: '24px',
  },
  fluent: {
    prefix: 'fluent',
    spdx: 'MIT',
    name: 'Fluent UI System Icons',
    vendor: 'Microsoft',
    grid: 'Mixed',
  },
  carbon: {
    prefix: 'carbon',
    spdx: 'Apache-2.0',
    name: 'Carbon Icons',
    vendor: 'IBM',
    grid: '16/32px',
  },
  bi: {
    prefix: 'bi',
    spdx: 'MIT',
    name: 'Bootstrap Icons',
    vendor: 'Bootstrap',
    grid: '16/32px',
  },
  ri: {
    prefix: 'ri',
    spdx: 'Apache-2.0',
    name: 'Remix Icon',
    vendor: 'Remix Design',
    grid: '24px',
  },
  'radix-icons': {
    prefix: 'radix-icons',
    spdx: 'MIT',
    name: 'Radix Icons',
    vendor: 'Radix',
    grid: '15px',
  },
  iconoir: {
    prefix: 'iconoir',
    spdx: 'MIT',
    name: 'Iconoir',
    vendor: 'Iconoir',
    grid: '24px',
  },
  'simple-icons': {
    prefix: 'simple-icons',
    spdx: 'CC0-1.0',
    name: 'Simple Icons',
    vendor: 'Simple Icons',
    grid: '24px',
    brand: true,
  },
};

/** The default pack prefixes surfaced in the Icons panel, in display order. */
export const DEFAULT_CATALOGUE_PREFIXES: string[] = [
  'material-symbols',
  'mdi',
  'lucide',
  'ph',
  'tabler',
  'heroicons',
  'fluent',
  'carbon',
  'bi',
  'ri',
  'radix-icons',
  'iconoir',
  'simple-icons',
];

/** True when the pack is flagged as a brand/trademark collection. */
export function isBrandPack(prefix: string): boolean {
  return ICON_CATALOGUE[prefix]?.brand === true;
}
