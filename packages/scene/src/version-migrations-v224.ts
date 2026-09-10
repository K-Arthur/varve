/** v2.23 → v2.24 migration: allow multiple layout guides per frame. */
export function migrateV223ToV224(raw: Record<string, unknown>): Record<string, unknown> {
  const settings = raw.gridSettings;
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    return { ...raw, formatVersion: '2.24' };
  }

  const gridSettings = settings as Record<string, unknown>;
  const source = gridSettings.layoutGrids;
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    return { ...raw, formatVersion: '2.24' };
  }

  const layoutGrids: Record<string, unknown[]> = {};
  for (const [frameId, value] of Object.entries(source as Record<string, unknown>)) {
    if (Array.isArray(value)) {
      layoutGrids[frameId] = value;
    } else if (value && typeof value === 'object') {
      layoutGrids[frameId] = [value];
    }
  }

  return {
    ...raw,
    formatVersion: '2.24',
    gridSettings: {
      ...gridSettings,
      ...(Object.keys(layoutGrids).length > 0 ? { layoutGrids } : { layoutGrids: undefined }),
    },
  };
}
