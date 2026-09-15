/**
 * Thin adapter that applies a pixel-selection refinement operation from the
 * Inspector's selection sources panel.
 *
 * Keeping the decision logic out of the component makes the arithmetic
 * testable without mounting the editor provider, and gives the panel a single
 * call site for commit-versus-set semantics.
 */
import {
  type AreaSelection,
  type AreaSelectionRefineOperation,
  refineAreaSelection,
} from '@varve/engine';

export const SELECTION_REFINE_OPERATIONS: Array<{
  value: AreaSelectionRefineOperation;
  label: string;
}> = [
  { value: 'feather', label: 'Feather' },
  { value: 'smooth', label: 'Smooth' },
  { value: 'grow', label: 'Grow' },
  { value: 'shrink', label: 'Shrink' },
  { value: 'contrast', label: 'Harden (contrast)' },
  { value: 'threshold', label: 'Threshold' },
  { value: 'antialias', label: 'Antialias' },
  { value: 'border', label: 'Border band' },
  { value: 'shift-edge', label: 'Shift edge' },
  { value: 'cleanup', label: 'Cleanup islands / holes' },
];

export interface SelectionRefineRequest {
  operation: AreaSelectionRefineOperation;
  amount: number;
  sigma: number;
  threshold: number;
  contrast: number;
  placement: 'inside' | 'outside' | 'centered';
  minIslandArea: number;
  maxHoleArea: number;
}

export interface SelectionRefineTarget {
  areaSelection: AreaSelection | null;
  commit?: (selection: AreaSelection) => void;
  set?: (selection: AreaSelection | null) => void;
  announce: (message: string) => void;
}

/**
 * Apply one refinement operation to the current selection and hand the result
 * to the undoable commit path when available. Returns false when there is no
 * selection or the operation produced no result (the previous selection is
 * left untouched in both cases).
 */
export function applySelectionRefine(
  target: SelectionRefineTarget,
  request: SelectionRefineRequest,
): boolean {
  const selection = target.areaSelection;
  if (!selection) {
    target.announce('Create a pixel selection before refining it');
    return false;
  }
  const amount = request.operation === 'shift-edge' ? request.amount : Math.abs(request.amount);
  const next = refineAreaSelection(selection, request.operation, {
    amount,
    sigma: request.sigma,
    threshold: request.threshold,
    contrast: request.contrast,
    placement: request.placement,
    minIslandArea: request.minIslandArea,
    maxHoleArea: request.maxHoleArea,
  });
  if (!next) {
    target.announce('Selection refinement could not be computed');
    return false;
  }
  if (target.commit) target.commit(next);
  else target.set?.(next);
  const label =
    SELECTION_REFINE_OPERATIONS.find((entry) => entry.value === request.operation)?.label ??
    request.operation;
  target.announce(`${label} applied to the pixel selection`);
  return true;
}
