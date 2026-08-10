/**
 * Editor wiring for the raster LOD pyramid (ADR-0214 D10/D15).
 *
 * Lives outside the hub files: a single hook call in EditorProvider. It
 * enables the engine-side spatial path for the editor session, feeds the
 * current viewport size for visible-tile selection, and routes the pyramid
 * residency budget through the existing memory-budget presets so
 * low/medium/high and (later) pressure profiles shrink residency instead of
 * letting the LRU thrash.
 */

import {
  getPyramidResidency,
  setPyramidViewport,
  setRasterPyramidEnabled,
} from '@varve/engine/rasterPyramid';
import { useEffect } from 'react';
import { type PressureProfile, resolvePressureBudgets } from '../canvas/memoryBudget';

/** Pyramid residency budget per memory preset (brief §34-35). */
const PYRAMID_BUDGET_BYTES: Record<'low' | 'medium' | 'high', number> = {
  low: 8 * 1024 * 1024, // 128 tiles
  medium: 32 * 1024 * 1024, // 512 tiles (engine default)
  high: 96 * 1024 * 1024, // 1536 tiles
};

const PRESSURE_MULTIPLIER: Record<PressureProfile, number> = {
  normal: 1,
  '4gb': 0.5,
  '2gb': 0.25,
};

/**
 * Enable the pyramid and keep viewport + budget in sync. Idempotent per
 * mount; disables on unmount so tests and other surfaces keep the default
 * (retained-surface-only) behaviour unless the editor is running.
 */
export function useRasterLod(
  memoryBudget: 'low' | 'medium' | 'high' = 'medium',
  pressure: PressureProfile = 'normal',
): void {
  useEffect(() => {
    setRasterPyramidEnabled(true);
    const syncViewport = () => {
      if (typeof window === 'undefined') return;
      setPyramidViewport(window.innerWidth, window.innerHeight);
    };
    syncViewport();
    window.addEventListener('resize', syncViewport);
    return () => {
      setRasterPyramidEnabled(false);
      window.removeEventListener('resize', syncViewport);
    };
  }, []);

  useEffect(() => {
    const base = PYRAMID_BUDGET_BYTES[memoryBudget] ?? PYRAMID_BUDGET_BYTES.medium;
    // Pressure profiles shrink residency; the resolver mirrors
    // memoryBudget.ts so constrained tiers behave like every other cache.
    const pressureBudgets = resolvePressureBudgets(pressure);
    const multiplier = pressure === 'normal' ? 1 : PRESSURE_MULTIPLIER[pressure];
    const budget = Math.min(
      base * multiplier,
      Math.max(1 * 1024 * 1024, pressureBudgets.workerBitmapBytes),
    );
    getPyramidResidency().setBudget(budget);
  }, [memoryBudget, pressure]);
}
