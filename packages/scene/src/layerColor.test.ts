import { describe, expect, it } from 'vitest';
import {
  LAYER_COLOR_LABELS,
  LAYER_COLORS,
  layerColorLabel,
  normalizeLayerColor,
} from './layerColor';

describe('layer color contract', () => {
  it('defines one stable seven-color vocabulary and user-facing labels', () => {
    expect(LAYER_COLORS).toEqual(['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'gray']);
    expect(LAYER_COLOR_LABELS.blue).toBe('Blue');
    expect(layerColorLabel('blue')).toBe('Blue color tag');
    expect(layerColorLabel(null)).toBeNull();
  });

  it('normalizes unknown values to the untagged state', () => {
    expect(normalizeLayerColor('violet')).toBeNull();
    expect(normalizeLayerColor(undefined)).toBeNull();
    expect(normalizeLayerColor('green')).toBe('green');
  });
});
