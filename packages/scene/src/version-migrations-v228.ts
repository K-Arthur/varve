/**
 * v2.27 → v2.28 migration: give the isometric grid an explicit, canonical
 * geometry contract.
 *
 * Before v2.28 `spacing` was consumed as a *perpendicular line gap* applied
 * to every family independently, which does not produce a consistent lattice
 * (the three families crossed at a different step than the authored number).
 * From v2.28 `spacing` is the projected length of one lattice step along each
 * axis.
 *
 * The conversion `axisStep = lineGap / sin θ` (θ = angle between the first two
 * visible axis directions) preserves the drawn geometry for the standard
 * preset exactly (`2/√3`) and is the honest best effort for custom sets, whose
 * legacy rendering was not lattice-consistent in the first place. The
 * `spacingMode: 'axis-step'` marker records that the value was converted, so
 * no future reader has to guess.
 */

const DEFAULT_SPACING = 24;
const MIN_CONDITIONING = 0.1;

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function normaliseAngle(angle: number): number {
  return ((angle % 360) + 360) % 360;
}

function axisSeparationDegrees(a: number, b: number): number {
  const diff = Math.abs(normaliseAngle(a) - normaliseAngle(b)) % 180;
  return Math.min(diff, 180 - diff);
}

interface MigratedAxis {
  angle: number;
  visible: boolean;
  label?: string;
  color?: string;
  opacity?: number;
  spacing?: number;
}

function migrateAxis(value: unknown): MigratedAxis | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const axis = value as Record<string, unknown>;
  const angle = finiteOr(axis.angle, Number.NaN);
  if (!Number.isFinite(angle)) return null;
  const migrated: MigratedAxis = {
    angle: normaliseAngle(angle),
    visible: axis.visible !== false,
  };
  if (typeof axis.label === 'string') migrated.label = axis.label;
  if (typeof axis.color === 'string') migrated.color = axis.color;
  if (typeof axis.opacity === 'number' && Number.isFinite(axis.opacity)) {
    migrated.opacity = Math.max(0, Math.min(1, axis.opacity));
  }
  if (typeof axis.spacing === 'number' && Number.isFinite(axis.spacing) && axis.spacing > 0) {
    migrated.spacing = Math.max(0.01, Math.min(100000, axis.spacing));
  }
  return migrated;
}

function migrateIsometricGrid(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const grid = value as Record<string, unknown>;
  const axes = Array.isArray(grid.axes)
    ? grid.axes
        .map(migrateAxis)
        .filter((axis): axis is MigratedAxis => axis !== null)
        .slice(0, 3)
    : [];
  if (axes.length < 2) return null;

  const legacySpacing = Math.max(0.01, Math.min(100000, finiteOr(grid.spacing, DEFAULT_SPACING)));
  const alreadyConverted = grid.spacingMode === 'axis-step';
  const visible = axes.filter((axis) => axis.visible !== false);
  const separation =
    visible.length >= 2 ? axisSeparationDegrees(visible[0]!.angle, visible[1]!.angle) : 120;
  const sin = Math.abs(Math.sin((separation * Math.PI) / 180));
  // Re-running the migration on an already-converted grid must not convert
  // twice; `spacingMode` is the explicit marker.
  const axisStep = alreadyConverted || sin < MIN_CONDITIONING ? legacySpacing : legacySpacing / sin;

  return {
    ...grid,
    type: 'isometric',
    axes,
    spacing: Math.max(0.01, Math.min(100000, axisStep)),
    spacingMode: 'axis-step',
    originX: Math.max(-1e7, Math.min(1e7, finiteOr(grid.originX, 0))),
    originY: Math.max(-1e7, Math.min(1e7, finiteOr(grid.originY, 0))),
    rotation: ((finiteOr(grid.rotation, 0) % 360) + 360) % 360,
    activePlaneId:
      grid.activePlaneId === 'front' || grid.activePlaneId === 'side' ? grid.activePlaneId : 'top',
    majorEvery: Number.isInteger(grid.majorEvery)
      ? Math.max(1, Math.min(64, grid.majorEvery as number))
      : 4,
    snapToSubdivisions: grid.snapToSubdivisions !== false,
    snapToLines: grid.snapToLines === true,
    version: 3,
  };
}

export function migrateV227ToV228(raw: Record<string, unknown>): Record<string, unknown> {
  const gridSettings = raw.gridSettings;
  if (!gridSettings || typeof gridSettings !== 'object' || Array.isArray(gridSettings)) {
    return { ...raw, formatVersion: '2.28' };
  }
  const settings = gridSettings as Record<string, unknown>;
  const source = settings.isometricGrids;
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    return { ...raw, formatVersion: '2.28' };
  }

  const isometricGrids: Record<string, unknown> = {};
  for (const [id, value] of Object.entries(source as Record<string, unknown>)) {
    const migrated = migrateIsometricGrid(value);
    if (migrated) {
      isometricGrids[id] = { ...migrated, id };
    }
  }

  return {
    ...raw,
    gridSettings: {
      ...settings,
      ...(Object.keys(isometricGrids).length > 0 ? { isometricGrids } : {}),
    },
    formatVersion: '2.28',
  };
}
