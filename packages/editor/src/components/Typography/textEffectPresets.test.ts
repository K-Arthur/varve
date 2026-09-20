import type { TextNode } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import {
  applyTextEffectPreset,
  CLEAR_TEXT_EFFECT_PATCH,
  TEXT_EFFECT_PRESETS,
  textEffectPresetById,
} from './textEffectPresets';

function makeText(): TextNode {
  return {
    id: 'text-1',
    kind: 'text',
    name: 'Dialogue',
    text: 'We leave at dawn.',
    transform: [1, 0, 0, 1, 40, 80],
    w: 220,
    h: 96,
    fontSize: 18,
    fontFamily: 'Inter',
    fontWeight: 400,
    storyBinding: { storyId: 'story-1', threadIndex: 0 },
    richText: { paragraphs: [{ runs: [{ text: 'We leave at dawn.' }] }] },
  } as unknown as TextNode;
}

describe('text effect presets', () => {
  it('declares unique, described presets', () => {
    const ids = TEXT_EFFECT_PRESETS.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const preset of TEXT_EFFECT_PRESETS) {
      expect(preset.label.length).toBeGreaterThan(0);
      expect(preset.description.length).toBeGreaterThan(0);
    }
    expect(textEffectPresetById('sfx-impact')).toBeDefined();
    expect(textEffectPresetById('missing')).toBeUndefined();
  });

  it('never touches content, story binding, or geometry', () => {
    const node = makeText();
    for (const preset of TEXT_EFFECT_PRESETS) {
      const next = applyTextEffectPreset(node, preset);
      expect(next.text).toBe(node.text);
      expect(next.richText).toEqual(node.richText);
      expect(next.storyBinding).toEqual(node.storyBinding);
      expect(next.transform).toEqual(node.transform);
      expect(next.w).toBe(node.w);
      expect(next.h).toBe(node.h);
    }
  });

  it('the sound effect preset produces heavy uppercase display type with an outline', () => {
    const next = applyTextEffectPreset(makeText(), textEffectPresetById('sfx-impact')!);
    expect(next.textCase).toBe('uppercase');
    expect(next.fontWeight).toBe(900);
    expect(next.textAlign).toBe('center');
    expect(next.strokes).toHaveLength(1);
    expect(next.strokes?.[0]?.weight).toBe(3);
  });

  it('the body-text preset removes the outline without changing the font size', () => {
    const withOutline = applyTextEffectPreset(makeText(), textEffectPresetById('sfx-impact')!);
    const next = applyTextEffectPreset(withOutline, textEffectPresetById('body-reset')!);
    expect(next.strokes).toEqual([]);
    expect(next.fontSize).toBe(18);
    expect(next.text).toBe('We leave at dawn.');
  });

  it('the clear patch removes only the outline', () => {
    const withOutline = applyTextEffectPreset(makeText(), textEffectPresetById('outline')!);
    const next = { ...withOutline, ...CLEAR_TEXT_EFFECT_PATCH };
    expect(next.strokes).toEqual([]);
    expect(next.textCase).toBe(withOutline.textCase);
    expect(next.fontWeight).toBe(withOutline.fontWeight);
  });
});
