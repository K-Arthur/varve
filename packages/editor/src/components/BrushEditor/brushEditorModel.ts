/**
 * Brush editor state, separated from its rendering.
 *
 * Keeping the model out of the component means the editing rules — what counts
 * as dirty, what "reset" restores, why editing a built-in produces a copy — are
 * testable without a DOM, and the view stays a projection of them rather than
 * the place they live.
 */
import type { BrushPreset } from '@varve/scene';
import { clampBrushPreset, isBuiltInPreset } from '@varve/scene';

export type BrushEditorSection =
  | 'tip'
  | 'shape-dynamics'
  | 'transfer'
  | 'grain'
  | 'wet-media'
  | 'stroke';

export const BRUSH_EDITOR_SECTIONS: ReadonlyArray<{ id: BrushEditorSection; title: string }> = [
  { id: 'tip', title: 'Brush Tip' },
  { id: 'shape-dynamics', title: 'Shape Dynamics' },
  { id: 'transfer', title: 'Transfer' },
  { id: 'grain', title: 'Grain' },
  { id: 'wet-media', title: 'Wet Media' },
  { id: 'stroke', title: 'Stroke' },
];

export interface BrushEditorState {
  /** The preset being edited. Always a working copy. */
  draft: BrushPreset;
  /** What Reset restores to. */
  baseline: BrushPreset;
  /** True when the draft is a new copy that has never been saved. */
  isNewCopy: boolean;
}

/**
 * Begin editing.
 *
 * Editing a built-in produces a customised copy with a fresh id rather than
 * mutating the packaged definition: built-ins ship with the app, so a
 * destructive edit would be unrecoverable and would differ per install.
 */
export function beginEditing(
  preset: BrushPreset,
  makeId: (base: string) => string = (base) => `${base}-custom`,
): BrushEditorState {
  if (isBuiltInPreset(preset.id)) {
    const copy = clampBrushPreset({
      ...preset,
      id: makeId(preset.id),
      name: `${preset.name} copy`,
    });
    return { draft: copy, baseline: copy, isNewCopy: true };
  }
  const working = clampBrushPreset(preset);
  return { draft: working, baseline: working, isNewCopy: false };
}

/** Apply a field change, keeping the draft inside legal ranges. */
export function editField<K extends keyof BrushPreset>(
  state: BrushEditorState,
  key: K,
  value: BrushPreset[K],
): BrushEditorState {
  return { ...state, draft: clampBrushPreset({ ...state.draft, [key]: value }) };
}

/** True when the draft differs from what Reset would restore. */
export function isDirty(state: BrushEditorState): boolean {
  return !presetsEqual(state.draft, state.baseline);
}

export function resetDraft(state: BrushEditorState): BrushEditorState {
  return { ...state, draft: state.baseline };
}

/** Mark the current draft as saved, so it becomes the new Reset target. */
export function commitDraft(state: BrushEditorState): BrushEditorState {
  return { draft: state.draft, baseline: state.draft, isNewCopy: false };
}

/** Fork the draft under a new id, for "Save As". */
export function saveAs(
  state: BrushEditorState,
  name: string,
  makeId: (base: string) => string,
): BrushEditorState {
  const copy = clampBrushPreset({ ...state.draft, id: makeId(state.draft.id), name });
  return { draft: copy, baseline: copy, isNewCopy: false };
}

function presetsEqual(a: BrushPreset, b: BrushPreset): boolean {
  const keys = Object.keys(a) as Array<keyof BrushPreset>;
  for (const key of keys) {
    if (key === 'dynamics') {
      if (JSON.stringify(a.dynamics) !== JSON.stringify(b.dynamics)) return false;
      continue;
    }
    if (a[key] !== b[key]) return false;
  }
  return true;
}

/** Which sections have anything meaningful to show for this preset. */
export function relevantSections(preset: BrushPreset): BrushEditorSection[] {
  return BRUSH_EDITOR_SECTIONS.filter((section) => {
    // An eraser removes pixels, so grain and wet mixing have nothing to act on.
    if (preset.eraser && (section.id === 'grain' || section.id === 'wet-media')) return false;
    return true;
  }).map((s) => s.id);
}
