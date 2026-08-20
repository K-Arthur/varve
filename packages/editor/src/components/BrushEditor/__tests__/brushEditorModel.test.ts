import { BUILT_IN_BRUSH_PRESETS, defaultBrushPreset } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import {
  beginEditing,
  commitDraft,
  editField,
  isDirty,
  relevantSections,
  resetDraft,
  saveAs,
} from '../brushEditorModel';

describe('brush editor model', () => {
  it('edits a built-in as a copy, never in place', () => {
    const builtIn = BUILT_IN_BRUSH_PRESETS['built-in-round']!;
    const state = beginEditing(builtIn);
    expect(state.isNewCopy).toBe(true);
    expect(state.draft.id).not.toBe(builtIn.id);
    expect(state.draft.name).toContain('copy');
    // The packaged definition is untouched.
    expect(BUILT_IN_BRUSH_PRESETS['built-in-round']!.name).toBe(builtIn.name);
  });

  it('edits a custom preset directly', () => {
    const state = beginEditing(defaultBrushPreset('mine', 'Mine'));
    expect(state.isNewCopy).toBe(false);
    expect(state.draft.id).toBe('mine');
  });

  it('starts clean and becomes dirty on edit', () => {
    let state = beginEditing(defaultBrushPreset('mine', 'Mine'));
    expect(isDirty(state)).toBe(false);
    state = editField(state, 'hardness', 0.2);
    expect(isDirty(state)).toBe(true);
  });

  it('clamps values that are out of range', () => {
    const state = editField(beginEditing(defaultBrushPreset('m', 'M')), 'opacity', 5);
    expect(state.draft.opacity).toBe(1);
  });

  it('restores the baseline on reset', () => {
    let state = beginEditing(defaultBrushPreset('m', 'M'));
    const original = state.draft.hardness;
    state = editField(state, 'hardness', 0.1);
    state = resetDraft(state);
    expect(state.draft.hardness).toBe(original);
    expect(isDirty(state)).toBe(false);
  });

  it('makes the saved draft the new reset target', () => {
    let state = beginEditing(defaultBrushPreset('m', 'M'));
    state = editField(state, 'hardness', 0.1);
    state = commitDraft(state);
    expect(isDirty(state)).toBe(false);
    state = resetDraft(state);
    expect(state.draft.hardness).toBe(0.1);
  });

  it('detects a dynamics change as dirty', () => {
    let state = beginEditing(defaultBrushPreset('m', 'M'));
    state = editField(state, 'dynamics', [
      { input: 'pressure', target: 'size', curve: [0, 0, 1, 1], min: 0.1, max: 1 },
    ]);
    expect(isDirty(state)).toBe(true);
  });

  it('forks under a new id for Save As', () => {
    let state = beginEditing(defaultBrushPreset('m', 'M'));
    state = editField(state, 'radius', 40);
    const forked = saveAs(state, 'Fork', (base) => `${base}-2`);
    expect(forked.draft.id).toBe('m-2');
    expect(forked.draft.name).toBe('Fork');
    expect(forked.draft.radius).toBe(40);
    expect(isDirty(forked)).toBe(false);
  });

  it('hides sections an eraser cannot use', () => {
    const eraser = { ...defaultBrushPreset('e', 'E'), eraser: true };
    const sections = relevantSections(eraser);
    expect(sections).not.toContain('grain');
    expect(sections).not.toContain('wet-media');
    expect(sections).toContain('tip');
  });

  it('shows every section for an ordinary brush', () => {
    expect(relevantSections(defaultBrushPreset('b', 'B'))).toHaveLength(6);
  });
});
