import type { LayoutGrid } from '@varve/scene';

export interface GuideLayoutPreset {
  id: string;
  name: string;
  description: string;
  layouts: LayoutGrid[];
}

const PRESET_STORAGE_KEY = 'varve.guide-layout-presets.v1';
const MAX_PERSONAL_PRESETS = 128;

function base(id: string, name: string): LayoutGrid {
  return {
    id,
    type: 'layout',
    name,
    visible: true,
    snapEnabled: true,
    locked: false,
    color: 'var(--color-accent)',
    opacity: 0.35,
    scope: 'frame',
    layoutMode: 'columns',
    columnCount: 1,
    gutter: 16,
    margin: [24, 24, 24, 24],
    margins: { top: 24, right: 24, bottom: 24, left: 24 },
    alignment: 'stretch',
    count: 1,
    sizing: 'stretch',
    offset: 0,
  };
}

export const BUILT_IN_GUIDE_LAYOUT_PRESETS: readonly GuideLayoutPreset[] = [
  {
    id: 'mobile-four-column',
    name: 'Four-column mobile',
    description: 'Compact four-column layout with generous touch margins.',
    layouts: [
      {
        ...base('mobile-four-column-columns', 'Mobile columns'),
        count: 4,
        columnCount: 4,
        gutter: 16,
        margin: [20, 20, 20, 20],
        margins: { top: 20, right: 20, bottom: 20, left: 20 },
      },
    ],
  },
  {
    id: 'desktop-twelve-column',
    name: 'Twelve-column desktop',
    description: 'A flexible desktop composition grid with independent gutters.',
    layouts: [
      {
        ...base('desktop-twelve-column-columns', 'Desktop columns'),
        count: 12,
        columnCount: 12,
        gutter: 24,
        margin: [48, 48, 48, 48],
        margins: { top: 48, right: 48, bottom: 48, left: 48 },
      },
    ],
  },
  {
    id: 'uniform-eight-unit',
    name: 'Eight-unit uniform grid',
    description: 'True square lattice for spacing and icon alignment.',
    layouts: [
      {
        ...base('uniform-eight-unit-grid', '8-unit lattice'),
        layoutMode: 'uniform',
        cellSize: 8,
        offsetX: 0,
        offsetY: 0,
        count: undefined,
        sizing: undefined,
      },
    ],
  },
  {
    id: 'modular-composition',
    name: 'Modular row / column composition',
    description: 'Independent four-column and six-row modular guides.',
    layouts: [
      {
        ...base('modular-columns', 'Modular columns'),
        count: 4,
        columnCount: 4,
        gutter: 20,
      },
      {
        ...base('modular-rows', 'Modular rows'),
        id: 'modular-rows',
        layoutMode: 'rows',
        count: 6,
        rowCount: 6,
        gutter: 20,
        rowHeight: undefined,
      },
    ],
  },
  {
    id: 'print-six-column',
    name: 'Print six-column',
    description: 'A measured print composition with smaller page margins.',
    layouts: [
      {
        ...base('print-six-column-columns', 'Print columns'),
        count: 6,
        columnCount: 6,
        gutter: 12,
        margin: [36, 36, 36, 36],
        margins: { top: 36, right: 36, bottom: 36, left: 36 },
      },
    ],
  },
];

function cloneLayouts(layouts: readonly LayoutGrid[]): LayoutGrid[] {
  return layouts.map((layout, index) => ({
    ...layout,
    id: `preset-layout-${index + 1}`,
    frameId: undefined,
    margin: [...layout.margin] as [number, number, number, number],
    ...(layout.margins ? { margins: { ...layout.margins } } : {}),
  }));
}

function validPreset(value: unknown): value is GuideLayoutPreset {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as GuideLayoutPreset;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.name === 'string' &&
    typeof candidate.description === 'string' &&
    Array.isArray(candidate.layouts) &&
    candidate.layouts.length > 0 &&
    candidate.layouts.length <= 32 &&
    candidate.layouts.every((layout) => layout && layout.type === 'layout')
  );
}

/** Read personal presets defensively; malformed local storage is ignored. */
export function readPersonalGuideLayoutPresets(storage?: Storage): GuideLayoutPreset[] {
  try {
    const raw = (storage ?? globalThis.localStorage)?.getItem(PRESET_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(validPreset)
      .slice(0, MAX_PERSONAL_PRESETS)
      .map((preset) => ({
        ...preset,
        layouts: cloneLayouts(preset.layouts),
      }));
  } catch {
    return [];
  }
}

export function writePersonalGuideLayoutPresets(
  presets: readonly GuideLayoutPreset[],
  storage?: Storage,
): void {
  try {
    (storage ?? globalThis.localStorage)?.setItem(
      PRESET_STORAGE_KEY,
      JSON.stringify(presets.slice(0, MAX_PERSONAL_PRESETS)),
    );
  } catch {
    // Private browsing and quota errors must not block guide editing.
  }
}

/** Applying a preset always remints layout IDs and never links the preset. */
export function materializeGuideLayoutPreset(preset: GuideLayoutPreset): LayoutGrid[] {
  return cloneLayouts(preset.layouts);
}

export const GUIDE_LAYOUT_PRESET_LIMIT = MAX_PERSONAL_PRESETS;
