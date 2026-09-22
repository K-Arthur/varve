/** v2.29 → v2.30 migration for frame-owned guide layouts. */

type RawRecord = Record<string, unknown>;

function record(value: unknown): RawRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as RawRecord) : null;
}

function margins(value: unknown): RawRecord {
  if (Array.isArray(value) && value.length === 4) {
    return { top: value[0], right: value[1], bottom: value[2], left: value[3] };
  }
  const source = record(value);
  return source ?? { top: 0, right: 0, bottom: 0, left: 0 };
}

function modernizeGuide(raw: RawRecord, suffix = ''): RawRecord {
  const mode =
    raw.layoutMode === 'rows' ? 'rows' : raw.layoutMode === 'uniform' ? 'uniform' : 'columns';
  const count = mode === 'rows' ? (raw.rowCount ?? 1) : (raw.columnCount ?? 1);
  const trackSize = mode === 'rows' ? raw.rowHeight : raw.columnWidth;
  const modern = {
    ...raw,
    ...(suffix
      ? {
          id: `${String(raw.id ?? 'layout-guide')}-${suffix}`,
          name: `${String(raw.name ?? 'Layout guide')} ${suffix}`,
        }
      : {}),
    margins: margins(raw.margins ?? raw.margin),
    ...(mode === 'uniform'
      ? {
          cellSize: raw.cellSize ?? trackSize ?? raw.gutter ?? 8,
          offsetX: raw.offsetX ?? 0,
          offsetY: raw.offsetY ?? 0,
        }
      : {
          count,
          sizing: raw.sizing ?? (trackSize === undefined ? 'stretch' : 'fixed'),
          ...(trackSize !== undefined ? { trackSize } : {}),
          alignment:
            raw.alignment === 'left'
              ? 'start'
              : raw.alignment === 'right'
                ? 'end'
                : (raw.alignment ?? 'stretch'),
          offset: raw.offset ?? 0,
        }),
  };
  return modern;
}

/**
 * Legacy `uniform` represented coupled row and column tracks. Splitting it
 * keeps its rendered boundaries stable while reserving `uniform` for the new
 * square lattice contract.
 */
export function migrateV229ToV230(raw: RawRecord): RawRecord {
  const settings = record(raw.gridSettings);
  const source = settings ? record(settings.layoutGrids) : null;
  if (!source) return { ...raw, formatVersion: '2.30' };

  const layoutGrids: Record<string, unknown[]> = {};
  for (const [frameId, value] of Object.entries(source)) {
    const entries = Array.isArray(value) ? value : [value];
    const migrated: RawRecord[] = [];
    for (const candidate of entries) {
      const grid = record(candidate);
      if (!grid) continue;
      if (grid.layoutMode === 'uniform') {
        migrated.push(modernizeGuide({ ...grid, layoutMode: 'columns' }, 'columns'));
        migrated.push(modernizeGuide({ ...grid, layoutMode: 'rows' }, 'rows'));
      } else {
        migrated.push(modernizeGuide(grid));
      }
    }
    if (migrated.length > 0) layoutGrids[frameId] = migrated;
  }

  return {
    ...raw,
    formatVersion: '2.30',
    gridSettings: { ...settings, layoutGrids },
  };
}
